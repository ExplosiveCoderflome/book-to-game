import assert from 'node:assert/strict';
import {test} from 'node:test';
import {BLOCKS,FUN_PROFILES,K_FEATURE_IDS,blockSpecSchema,engineBlockContractSchema,getBlock,lintBlocks,clockSchema,openingRollSchema,resourceDefSchema,worldContentSchema,worldEffectSchema,recapEntrySchema} from '@novel-game/contracts';
import {validateSelectedBlocks} from '../src/modules/worlds/index.js';
import {content} from './helpers/open-fixture.js';
import {blocksCommands} from '../src/app/commands/blocks.js';

test('K1–K16 migration: every legacy feature resolves to a versioned, bounded existing engine block', async t => {
  assert.equal(BLOCKS.length,22);assert.deepEqual(lintBlocks().filter(i=>i.severity==='error'),[]);
  for(const feature of K_FEATURE_IDS) await t.test(feature,()=>{
    const owners=BLOCKS.filter(b=>b.engine?.features.includes(feature));assert.ok(owners.length,`${feature} must be migrated`);
    for(const block of owners){const engine=engineBlockContractSchema.parse(block.engine);assert.ok(engine.compileTo.length);assert.ok(engine.example);assert.ok(engine.pitfalls.length);
      assert.deepEqual(engine.checks,block.acceptance);for(const profile of engine.profiles)assert.ok(FUN_PROFILES.some(p=>p.id===profile));for(const write of engine.writes)assert.notEqual(write.maxChange,undefined);}
  });
  const snapshot=getBlock('state-snapshot')!;assert.deepEqual(snapshot.engine!.hooks,['onLoad']);assert.deepEqual(snapshot.engine!.writes,[]);assert.deepEqual(snapshot.engine!.playerUi,[]);
});

test('K blocks: mutation onLoad and malformed numeric ranges reject rather than inventing a second engine',()=>{
  const engine=getBlock('state-snapshot')!.engine!;
  assert.throws(()=>engineBlockContractSchema.parse({...engine,writes:[{state:'rng',maxChange:1}]}));
  const clock=getBlock('clock')!;
  assert.throws(()=>blockSpecSchema.parse({...clock,params:[{key:'bad',label:'bad',type:'integer',default:1,min:2,max:1}]}));
  assert.throws(()=>blockSpecSchema.parse({...clock,params:[{key:'bad',label:'bad',type:'string',min:0}]}));
});

test('K block numeric parameters: exact runtime lower/upper limits pass and adjacent values reject',async t=>{
  for(const [id,key,min,max] of [['clock','limit',1,2400],['storylet-pool','hand_size',1,5],['opening-roll','rerolls',0,20]] as const){
    const original=getBlock(id)!;const spec={...original,requires:[],composesWith:{dependsOn:[],conflictsWith:[]},params:original.params.filter(p=>p.key===key)};
    const catalog={get:()=>({kind:'block' as const,id,origin:'builtin' as const,version:1,data:spec})} as Parameters<typeof validateSelectedBlocks>[2];
    for(const value of [min,max,min-1,max+1]) await t.test(`${id}/${key}=${value}`,()=>{
      const run=()=>validateSelectedBlocks(content(),[{blockId:id,version:1,params:{[key]:value}}],catalog);
      if(value>=min&&value<=max)assert.equal(run()[0]!.params[key],value);else assert.throws(run,e=>(e as {code?:string}).code==='WORLD_COMPOSITION_INVALID');
    });
  }
});


test('K block example fragments parse against the existing runtime schemas',()=>{
  const example=(id:string)=>JSON.parse(getBlock(id)!.engine!.example);
  clockSchema.parse(example('clock').clock);
  openingRollSchema.parse(example('opening-roll'));
  resourceDefSchema.parse(example('stat-templates').resourceDefs.energy);
  worldContentSchema.shape.storyletRules.parse(example('storylet-pool').storyletRules);
  worldContentSchema.shape.locations.element.shape.textVariants.parse(example('world-map').textVariants);
  worldEffectSchema.parse(example('encounters'));
  recapEntrySchema.parse(example('endings-recap').recap[0]);
  assert.equal(example('state-snapshot').clockFired,0);
});


test('K block catalog discovery stays compact; complete contracts remain explicitly readable',async()=>{
  const commands=blocksCommands();
  const summary=await commands.find(c=>c.name==='list_blocks')!.execute({}) as {blocks:Array<{id:string;engine?:unknown}>};
  assert.equal(summary.blocks.length,22);assert.ok(summary.blocks.every(block=>!Object.hasOwn(block,'engine')));
  assert.ok(Buffer.byteLength(JSON.stringify(summary))<32*1024);
  const detail=await commands.find(c=>c.name==='get_block')!.execute({id:'state-snapshot'}) as {data:{engine:{features:string[]}}};
  assert.deepEqual(detail.data.engine.features,['K14']);
});
