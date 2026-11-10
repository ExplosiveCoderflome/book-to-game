import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import type {WorldPackage, WorldRevision} from '@novel-game/contracts';
import {splitWorldPackage, compileWorldPackage, importWorldPackage, normalizeWorldJson, readWorldPackage, writeWorldPackage, writeCompiledWorld} from '../src/modules/world-package/index.js';
import {createWorkbench} from '../src/app/workbench.js';
import {createCommands} from '../src/app/commands/index.js';
import {createModelSettings} from '../src/platform/create-model-settings.js';
import {openDatabase} from '../src/platform/database.js';
import {content} from './helpers/open-fixture.js';
import {publishFerryWorld} from './helpers/publish-ferry-fixture.js';

const sha = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');
const invalid = (error: unknown) => (error as {code?: string}).code === 'WORLD_PACKAGE_INVALID';
const seal = (packet: WorldPackage) => {packet.manifest.files = Object.fromEntries(Object.entries(packet.files).map(([k,v]) => [k,sha(v)])); return packet;};

test('world package: native content and unknown legacy fields survive canonical and deep roundtrip without mutating input', () => {
  const world = {...content(), unknownFuture: {text: '汉字\r\n与😀', nested: [null, false, 0, 1.25]}, blockSelections: [], extensions: []};
  const before = structuredClone(world); const packet = splitWorldPackage(world);
  assert.ok(packet.files['state.json']); assert.ok(packet.files['content/locations.json']);
  const compiled = compileWorldPackage(packet, {verifyHashes: true});
  assert.deepEqual(compiled.world, world); assert.deepEqual(world, before);
  assert.equal(compiled.worldJson, normalizeWorldJson(world));
  const inferred=splitWorldPackage(content());assert.equal(inferred.manifest.selectionMode,'inferred');assert.ok(inferred.manifest.blocks.some(b=>b.blockId==='state-snapshot'));assert.equal(Object.hasOwn(compileWorldPackage(inferred).world,'blockSelections'),false); assert.equal(compiled.contentHash, sha(compiled.worldJson));
  const missing = splitWorldPackage({title: 'no optional arrays'});
  assert.equal(Object.hasOwn(compileWorldPackage(missing).world, 'extensions'), false);
  const reserved = JSON.parse('{"__proto__":{"polluted":true},"constructor":"data","locations":[]}');
  assert.deepEqual(compileWorldPackage(splitWorldPackage(reserved)).world, reserved);
  assert.equal(({} as {polluted?: boolean}).polluted, undefined);
});

test('shoudeng READ ONLY: all three unmodified source JSONs roundtrip deeply and canonical-byte-identically', async t => {
  const root = path.resolve('docs/samples/shoudeng');
  // The only operations on this protected tree are readdir/readFile. Never pass it to an output helper.
  const snapshots = new Map(readdirSync(root).map(name => [name, sha(readFileSync(path.join(root, name)))]));
  for (const batch of [1,2,3]) await t.test(`batch${batch}`, () => {
    const source = path.join(root, `shoudeng.batch${batch}.world.json`); const original = JSON.parse(readFileSync(source, 'utf8'));
    const packet = readWorldPackage(source); const compiled = compileWorldPackage(packet, {verifyHashes: true});
    assert.deepEqual(compiled.world, original); assert.equal(compiled.worldJson, normalizeWorldJson(original));
  });
  assert.deepEqual(readdirSync(root).sort(), [...snapshots.keys()].sort());
  for (const [name, digest] of snapshots) assert.equal(sha(readFileSync(path.join(root, name))), digest, `${name} must remain untouched`);
});

test('world package: shard filename order controls concatenation, not IDs; duplicates across shards reject', () => {
  const packet = splitWorldPackage({locations: [{id:'z'}, {id:'a'}], storylets: [], endings: []});
  delete packet.files['content/locations.json'];
  packet.files['content/locations-b.json'] = '[{"id":"a"}]'; packet.files['content/locations-a.json'] = '[{"id":"z"}]'; seal(packet);
  assert.deepEqual(compileWorldPackage(packet).world.locations, [{id:'z'}, {id:'a'}]);
  packet.files['content/locations-b.json'] = '[{"id":"z"}]';
  assert.throws(() => compileWorldPackage(packet), invalid);
});

test('world package: source edits get fresh release hashes; frozen verification catches tampering', () => {
  const packet = splitWorldPackage({title:'before', locations:[]});
  packet.files['content/texts.json'] = '{ "title": "after" }';
  assert.throws(() => compileWorldPackage(packet, {verifyHashes:true}), invalid);
  const compiled = compileWorldPackage(packet); assert.equal(compiled.world.title, 'after');
  assert.equal(compiled.manifest.files['content/texts.json'], sha(packet.files['content/texts.json']!));
  compileWorldPackage({...packet, manifest:compiled.manifest}, {verifyHashes:true});
});

test('world package: unsafe/unsupported names, missing files, schema versions, and field collisions reject', async t => {
  for (const name of ['../secret.json','/state.json','content/../state.json','content/other.json','content\\locations.json','content/locations..json','ext/%2e.js']) await t.test(name, () => {
    const packet = splitWorldPackage({locations:[]}); packet.files[name]='{}'; seal(packet);
    assert.throws(() => compileWorldPackage(packet), invalid);
  });
  const mutations: Array<(packet: WorldPackage) => void> = [
    p => {delete p.files['state.json']; seal(p);}, p => {p.manifest.files['ghost.json']=sha('{}');},
    p => {Object.assign(p.manifest,{specVersion:2});}, p => {Object.assign(p.manifest,{target:'html'});},
    p => {p.files['content/texts.json']='{"resources":{}}';},
    p => {p.files['state.json']='{"title":"wrong owner"}';},
    p => {p.files['content/texts-extra.json']='{"title":"duplicate"}'; seal(p);},
  ];
  for (const [i, mutate] of mutations.entries()) await t.test(`invalid structure ${i}`, () => {
    const packet=splitWorldPackage({title:'source',locations:[]}); mutate(packet); assert.throws(()=>compileWorldPackage(packet),invalid);
  });
});

test('world package: non-JSON values and cyclic graphs cannot silently lose fields', () => {
  for (const world of [{a:undefined},{a:NaN},{a:Infinity},{a:1n},{a:new Date()}, {a:[,1]}]) assert.throws(()=>splitWorldPackage(world), invalid);
  const cycle: Record<string,unknown> = {}; cycle.self=cycle; assert.throws(()=>splitWorldPackage(cycle),invalid);
});

test('world package: extension source is read-only data, paired with declarations and never executed', () => {
  const code='throw new Error("must never execute");\r\n';
  const original={extensions:[{id:'test',version:'1.0.0',code,tests:[1,2,3]}]};
  const packet=splitWorldPackage(original); assert.equal(packet.files['ext/000000.js'],code);
  assert.deepEqual(compileWorldPackage(packet).world,original);
  delete packet.files['ext/000000.js'];seal(packet);assert.throws(()=>compileWorldPackage(packet),invalid);
  const orphan=splitWorldPackage({});orphan.files['ext/orphan.js']=code;seal(orphan);assert.throws(()=>compileWorldPackage(orphan),invalid);
});

test('world package: block order, empty arrays and versions stay exact; supported version constraints fail closed', () => {
  const world={blockSelections:[{blockId:'clock',version:1,params:{limit:24}}]};const packet=splitWorldPackage(world);
  assert.deepEqual(compileWorldPackage(packet,{supportedBlockVersions:{clock:1}}).world,world);
  assert.throws(()=>compileWorldPackage(packet,{supportedBlockVersions:{clock:2}}),invalid);
  assert.throws(()=>compileWorldPackage(packet,{supportedBlockVersions:{}}),invalid);
  packet.manifest.blocks[0]!.version=2; assert.throws(()=>compileWorldPackage(packet),invalid);
});

test('world package filesystem: legacy auto-import, new-directory-only edit/release output, no symlink following', () => {
  const dir=mkdtempSync(path.join(tmpdir(),'world-package-'));
  try {
    const world={title:'original',locations:[{id:'home'}]};const source=path.join(dir,'legacy.json');writeFileSync(source,JSON.stringify(world));const before=readFileSync(source);
    const packet=readWorldPackage(source); const editing=path.join(dir,'editing');writeWorldPackage(editing,packet);
    assert.deepEqual(compileWorldPackage(readWorldPackage(editing),{verifyHashes:true}).world,world);
    const release=path.join(dir,'release');writeCompiledWorld(release,packet);
    assert.deepEqual(JSON.parse(readFileSync(path.join(release,'world.json'),'utf8')),world);
    assert.deepEqual(JSON.parse(readFileSync(path.join(release,'manifest.json'),'utf8')),compileWorldPackage(packet).manifest);
    assert.throws(()=>writeWorldPackage(editing,packet),{code:'EEXIST'});assert.deepEqual(readFileSync(source),before);
    symlinkSync(source,path.join(dir,'source-link'));assert.throws(()=>readWorldPackage(path.join(dir,'source-link')));
    symlinkSync(source,path.join(editing,'content','texts-linked.json'));assert.throws(()=>readWorldPackage(editing));
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('world package CLI: split and compile operate fully offline and never overwrite existing outputs', () => {
  const dir=mkdtempSync(path.join(tmpdir(),'world-pack-cli-'));
  try {
    const source=path.join(dir,'legacy.json'); const original={locations:[{id:'one'}],title:'CLI'};writeFileSync(source,JSON.stringify(original));
    const run=(...args:string[])=>execFileSync(process.execPath,['node_modules/tsx/dist/cli.mjs','scripts/world-pack.ts',...args],{cwd:process.cwd(),encoding:'utf8',stdio:'pipe'});
    assert.match(run('split',source,path.join(dir,'edit')),/no model calls/);
    assert.match(run('compile',path.join(dir,'edit'),path.join(dir,'release')),/no model calls/);
    assert.deepEqual(JSON.parse(readFileSync(path.join(dir,'release','world.json'),'utf8')),original);
    assert.throws(()=>run('compile',source,path.join(dir,'release')));
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('world package shared commands: explicit export, guarded edits, true publish emits single content plus manifest', async () => {
  const db=openDatabase(':memory:');const dir=mkdtempSync(path.join(tmpdir(),'package-command-'));
  try {
    const wb=createWorkbench(db,createModelSettings(db,dir,{baseUrl:'https://unused.invalid',model:'',apiKey:'',timeoutMs:1000}),undefined,{allowMockPublish:true,dataDir:dir});
    const source=wb.sources.importFile({title:'source',filename:'source.txt',bytes:Buffer.from('original source passage')});
    const commands=createCommands(wb);const command=(name:string)=>commands.find(c=>c.name===name)!;
    const packet=splitWorldPackage(publishFerryWorld(source));
    const created=await command('create_world_draft').execute({sourceId:source.id,content:packet}) as {id:string;version:number};
    const bounded=await command('read_world_draft').execute({id:created.id}) as Record<string,unknown>;
    assert.equal(Object.hasOwn(bounded,'package'),false);
    const projected=await command('read_world_draft').execute({id:created.id,format:'world-package'}) as {id:string;version:number;package:WorldPackage};
    assert.equal(projected.version,1);assert.deepEqual(compileWorldPackage(projected.package).world,wb.worlds.get(created.id).content);
    const texts=JSON.parse(projected.package.files['content/texts.json']!);texts.title='Edited package';projected.package.files['content/texts.json']=JSON.stringify(texts);
    const edited=await command('update_world_draft').execute({id:created.id,version:1,content:projected.package}) as {version:number};assert.equal(edited.version,2);
    const before=wb.worlds.get(created.id);const invalidPacket=structuredClone(projected.package);invalidPacket.files['state.json']='{"title":"collision"}';
    await assert.rejects(async()=>command('update_world_draft').execute({id:created.id,version:2,content:invalidPacket}),invalid);
    assert.deepEqual(wb.worlds.get(created.id),before);
    await assert.rejects(async()=>command('update_world_draft').execute({id:created.id,version:1,content:projected.package}),e=>(e as {code?:string}).code==='DRAFT_VERSION_CONFLICT');
    const badVersion=wb.worlds.create({sourceId:source.id,content:{...publishFerryWorld(source),blockSelections:[{blockId:'state-snapshot',version:99,params:{}}]}});
    await assert.rejects(async()=>command('publish_world_draft').execute({id:badVersion.id,version:1}),e=>(e as {code?:string}).code==='BLOCK_VERSION_CONFLICT');
    assert.equal(wb.worlds.listRevisions().length,0);
    const declaredChecks=splitWorldPackage({...publishFerryWorld(source),checks:{}});const draftsBefore=wb.worlds.list().length;
    await assert.rejects(async()=>command('create_world_draft').execute({sourceId:source.id,content:declaredChecks}),e=>(e as {code?:string}).code==='WORLD_PACKAGE_CHECKS_UNSUPPORTED');
    assert.equal(wb.worlds.list().length,draftsBefore);
    const revision=await command('publish_world_draft').execute({id:created.id,version:2}) as WorldRevision;
    assert.deepEqual(revision.content,before.content);assert.equal(revision.packageManifest?.target,'world-content-json');
    assert.deepEqual(revision.packageManifest,compileWorldPackage(splitWorldPackage(before.content)).manifest);
    assert.deepEqual(await command('publish_world_draft').execute({id:created.id,version:2}),revision);
  } finally {db.close();rmSync(dir,{recursive:true,force:true});}
});


test('world package limits: exactly 512 files pass, 513 files and excessive nesting/bytes reject',()=>{
  const packet=splitWorldPackage({});
  for(let i=0;i<510;i++)packet.files[`content/texts-${i}.json`]='{}';seal(packet);
  assert.equal(Object.keys(packet.files).length,512);compileWorldPackage(packet);
  packet.files['content/texts-extra.json']='{}';seal(packet);assert.throws(()=>compileWorldPackage(packet),invalid);
  const bytes=splitWorldPackage({});const large='汉'.repeat(3*1024*1024);
  bytes.files['content/texts-a.json']=JSON.stringify({a:large});bytes.files['content/texts-b.json']=JSON.stringify({b:large});seal(bytes);
  assert.throws(()=>compileWorldPackage(bytes),invalid);
  let nested:unknown=0;for(let i=0;i<130;i++)nested={child:nested};assert.throws(()=>splitWorldPackage({nested}),invalid);
});


test('world package numeric boundary: signed zero survives deep roundtrip, not only JSON string comparison',()=>{
  const world={resources:{zero:-0},future:[-0,0,1.25]};
  assert.deepEqual(compileWorldPackage(splitWorldPackage(world)).world,world);
  assert.equal(Object.is((compileWorldPackage(importWorldPackage(JSON.parse('{"resources":{"zero":-0}}'))).world.resources as {zero:number}).zero,-0),true);
});
