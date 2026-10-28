/**
 * K15 (§12): ending passages + 「这一生」 recap — contracts, import, engine resolution at the moment the ending fires,
 * snapshot in the save (never recomputed on load), lint rules, simulator coverage, server ↔ offline parity.
 * Fixture: 《寿灯》 batch 3 (cumulative gold sample, 9 endings · 59 passages · 44 recap lines).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { SYSTEM_WAIT_ACTION_ID, worldContentSchema, type WorldContent, type WorldRevision } from '@novel-game/contracts';
import { btgWorldFileToContent, lintWorld } from '@novel-game/rules/preflight';
import { advanceAdventure, createAdventureState, projectAdventure, resolveEnding, type AdventureState } from '@novel-game/play-runtime';
import { simulateWorld } from '@novel-game/play-runtime/sim';
import { validateWorld } from '../src/modules/worlds/domain/validate-world.js';

const NOW = '2026-10-28T00:00:00Z';
const gold = (): WorldContent => worldContentSchema.parse(JSON.parse(readFileSync(new URL('../../../fixtures/s1/shoudeng.batch3.content.json', import.meta.url), 'utf8')));
const rev = (content: WorldContent, id = 'rev-k15'): WorldRevision => ({id, draftId: 'd', sourceId: 's', content, version: 1, createdAt: NOW});
let req = 0;
const rid = () => `33333333-3333-4333-8333-${String(++req).padStart(12, '0')}`;
const wait = (s: AdventureState, w: WorldContent) => advanceAdventure(s, {actionId: SYSTEM_WAIT_ACTION_ID, expectedTurn: s.turn, requestId: rid()}, w, NOW);
/** Gold world whose 寿元 starts at 1 (the first yearly tick crosses onMin → 坐化) and 「求哑伯添油」 already holds (recap line yabo_owed). */
const dying = (): WorldContent => {
  const w = gold(); w.resourceDefs!.shouyuan = {...w.resourceDefs!.shouyuan!, initial: 1};
  w.facts = w.facts.map(f => f.id === 'yabo_owed' ? {...f, initialValue: true} : f); return w;
};

test('K15 import: batch3 keeps endings[].passages and recap[]; validates with 0 errors', () => {
  const file = JSON.parse(readFileSync(new URL('../../../docs/samples/shoudeng/shoudeng.batch3.world.json', import.meta.url), 'utf8'));
  const world = worldContentSchema.parse(btgWorldFileToContent(file, {sourceChapterIds: ['shoudeng-c1']}));
  assert.equal(world.endings.reduce((n, e) => n + (e.passages?.length ?? 0), 0), 59);
  assert.equal(world.recap?.length, 44);
  assert.deepEqual({endings: world.endings, recap: world.recap}, {endings: gold().endings, recap: gold().recap}, 'fixture = import of the sample');
  assert.deepEqual(validateWorld(world, {chapters: [{id: 'shoudeng-c1', paragraphs: []}]} as never).errors, []);
  // Worlds without the fields still parse (fields are optional).
  const bare = gold(); delete bare.recap; for (const e of bare.endings) delete e.passages;
  assert.ok(worldContentSchema.safeParse(bare).success);
});

test('K15 engine: only held passages, array order; recap by order then array order; nothing unheld leaks', () => {
  const world = gold(); const r = rev(world);
  const s = createAdventureState(r, 'k15-a', NOW, {}, 7);
  s.facts = {...s.facts, made_will: true, yabo_oil: true, yabo_gone: false, mother_dead: true, visited_home: false};
  s.resources = {...s.resources, realm: 3, zhaowan: 10, jieshou: 0};
  const end = resolveEnding(world, s, 'zuohua', 'failure');
  assert.deepEqual(end.passages?.map(p => p.id), ['zj', 'will', 'yabo_oil'], 'zhaowan_good / mother / jieshou do not hold');
  const zuohua = world.endings.find(e => e.id === 'zuohua')!;
  assert.deepEqual(end.passages?.map(p => p.text), ['zj', 'will', 'yabo_oil'].map(id => zuohua.passages!.find(p => p.id === id)!.text));
  const expectedRecap = world.recap!.filter(x => x.when.every(c => c.kind !== 'fact' || (s.facts[c.factId] ?? false) === c.value)).map(x => x.id);
  assert.ok(end.recap?.length, 'some recap lines hold');
  for (const line of end.recap!) assert.ok(expectedRecap.includes(line.id) || world.recap!.find(x => x.id === line.id)!.when.some(c => c.kind !== 'fact'), line.id);
  // order: explicit `order` wins, missing order = array index.
  const w2 = gold(); w2.recap = [
    {id: 'b', when: [], text: '二'}, {id: 'a', when: [], text: '一', order: -1}, {id: 'c', when: [{kind: 'fact', factId: 'made_will', value: false}], text: '三'}, {id: 'd', when: [], text: '四', order: 1.5},
  ];
  assert.deepEqual(resolveEnding(w2, s, 'zuohua', 'failure').recap?.map(x => x.id), ['a', 'b', 'd'], 'c does not hold → absent (no spoiler)');
  // No held entries → fields omitted (the UI hides the block).
  const w3 = gold(); w3.recap = [{id: 'x', when: [{kind: 'fact', factId: 'made_will', value: false}], text: '不成立'}];
  for (const e of w3.endings) e.passages = [];
  const empty = resolveEnding(w3, s, 'zuohua', 'failure');
  assert.equal(empty.passages, undefined);
  assert.deepEqual(empty.recap, [], 'world has recap[] but nothing held → [] (UI hides the block, no 「走过的路」 fallback)');
  const w4 = gold(); delete w4.recap;
  assert.equal(resolveEnding(w4, s, 'zuohua', 'failure').recap, undefined, 'world without recap[] → absent');
});

test('K15 engine: textVariants replace the body first, then passages append; `when` also accepts a single object and one anyOf level', () => {
  const world = gold(); const r = rev(world);
  const s = createAdventureState(r, 'k15-v', NOW, {}, 7);
  s.facts = {...s.facts, gongfa_kurong: true, made_will: true};
  s.resources = {...s.resources, realm: 0};
  const zuohua = world.endings.find(e => e.id === 'zuohua')!;
  const end = resolveEnding(world, s, 'zuohua', 'failure');
  assert.equal(end.text, zuohua.textVariants![0]!.text, 'variant body');
  assert.notEqual(end.text, zuohua.text);
  assert.ok(end.passages?.some(p => p.id === 'will'), 'passages still appended after the variant');
  const parsed = worldContentSchema.parse({...gold(), recap: [
    {id: 'single', when: {kind: 'fact', factId: 'made_will', value: true}, text: '单个对象'},
    {id: 'any', when: [{kind: 'anyOf', conditions: [{kind: 'fact', factId: 'made_will', value: false}, {kind: 'resource', resourceId: 'realm', atMost: 0}]}], text: '其一'},
    {id: 'none', when: {kind: 'fact', factId: 'made_will', value: false}, text: '不成立'},
  ]});
  assert.ok(Array.isArray(parsed.recap![0]!.when));
  assert.deepEqual(resolveEnding(parsed, s, 'zuohua', 'failure').recap?.map(x => x.id), ['single', 'any']);
  assert.equal(worldContentSchema.safeParse({...gold(), recap: [{id: 'x', when: [{kind: 'anyOf', conditions: [{kind: 'anyOf', conditions: []}]}], text: 't'}]}).success, false, 'no second anyOf level');
});

test('K15 engine: passages resolve with the state when the ending fires (onMin path), timeout ending gets extras too', () => {
  const w = dying(); const r = rev(w);
  let s = createAdventureState(r, 'k15-b', NOW, {}, 7);
  for (let i = 0; i < 24 && !s.ending; i++) s = wait(s, w);
  assert.equal(s.ending?.id, 'zuohua'); assert.equal(s.ending?.kind, 'failure');
  const v = projectAdventure(s, r);
  assert.deepEqual(v.ending?.passages, s.ending?.passages, 'projection carries the snapshot');
  assert.equal(v.ending?.recap?.[0]?.id, 'yabo_owed', JSON.stringify(v.ending?.recap));
  // timeout (authored liushi) also resolves passages/recap
  const g = gold(); const rg = rev(g);
  let t = createAdventureState(rg, 'k15-c', NOW, {}, 7);
  t = {...structuredClone(t), elapsed: 719, facts: {...t.facts, taught_newcomer: true}};
  t = wait(t, g);
  assert.equal(t.ending?.kind, 'timeout');
  assert.ok(t.ending?.passages?.some(p => p.id === 'taught'), JSON.stringify(t.ending?.passages));
});

test('K15 save snapshot: loading a finished save never recomputes passages/recap (offline port)', async () => {
  const { MemorySaveStore, createLocalAdventurePort } = await import('@novel-game/play-runtime');
  const w = dying(); const revision = rev(w, 'rev-k15-save');
  const store = new MemorySaveStore();
  let n = 0; let ids = 0;
  const deps = () => ({now: () => new Date(Date.UTC(2026, 9, 28, 8, 0, n++)).toISOString(), newId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`, newSeed: () => 1234});
  const cat = {buildingLibrary: {schemaVersion: 1, assets: []} as never, itemCatalog: {schemaVersion: 1, items: []} as never};
  const port = createLocalAdventurePort(structuredClone(revision), cat, {packageId: 'pkg-k15', store, ...deps()});
  let v = port.start(revision.id);
  for (let i = 0; i < 24 && !v.ended; i++) v = port.act(v.id, {actionId: SYSTEM_WAIT_ACTION_ID, expectedTurn: v.turn, requestId: rid()});
  assert.ok(v.ended && v.ending?.recap?.length);
  // Same package id + store, but authored recap/passages changed: the saved ending is shown as it was.
  const edited = structuredClone(revision);
  edited.content.recap = [{id: 'new', when: [], text: '后来才写的一行'}];
  for (const e of edited.content.endings) e.passages = [{id: 'new', when: [], text: '后来才写的一段'}];
  const reopened = createLocalAdventurePort(edited, cat, {packageId: 'pkg-k15', store, ...deps()});
  assert.deepEqual(reopened.get(v.id).ending, v.ending);
});

test('K15 parity: server AdventureService and offline LocalAdventurePort reach the same ending snapshot', async () => {
  const { SqliteDatabase } = await import('../src/platform/database.js');
  const { WorldService, SqliteWorldRepository } = await import('../src/modules/worlds/index.js');
  const { AdventureService, SqliteAdventureRepository } = await import('../src/modules/adventure-sessions/index.js');
  const { MemorySaveStore, createLocalAdventurePort } = await import('@novel-game/play-runtime');
  const source = {id: 'src-sd', title: '寿灯', filename: 'sd.txt', encoding: 'utf8', chapterCount: 1, charCount: 1, createdAt: NOW,
    chapters: [{id: 'shoudeng-c1', index: 0, title: '一', paragraphs: [{id: 'p1', index: 0, text: '灯。'}]}]};
  const db = new SqliteDatabase(':memory:');
  try {
    const mk = () => { let n = 0; let ids = 0; return {now: () => new Date(Date.UTC(2026, 9, 28, 8, 0, n++)).toISOString(), newId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`, newSeed: () => 1234}; };
    const worlds = new WorldService(new SqliteWorldRepository(db), {get: () => structuredClone(source) as never});
    const server = new AdventureService(new SqliteAdventureRepository(db), worlds, {}, mk());
    const draft = worlds.create({sourceId: source.id, content: dying()});
    const revision = worlds.publish(draft.id, {version: 1});
    const local = createLocalAdventurePort(structuredClone(revision), {buildingLibrary: {schemaVersion: 1, assets: []} as never, itemCatalog: {schemaVersion: 1, items: []} as never}, {packageId: 'pkg-k15p', store: new MemorySaveStore(), ...mk()});
    let a = server.start({worldRevisionId: revision.id}); let b = local.start(revision.id);
    for (let i = 0; i < 24 && !a.ended; i++) {
      const input = {actionId: SYSTEM_WAIT_ACTION_ID, expectedTurn: a.turn, requestId: rid()};
      a = server.act(a.id, input); b = local.act(b.id, input);
    }
    assert.ok(a.ended && a.ending?.recap?.length);
    assert.deepEqual(b.ending, a.ending);
    assert.deepEqual(server.get(a.id).ending, a.ending, 'server reload = saved snapshot');
  } finally { db.close(); }
});

test('K15 lint: id unique, text non-empty, references exist, every ending has a reachable recap line (warning)', () => {
  const clean = lintWorld(gold());
  assert.deepEqual(clean.issues.filter(i => i.ruleId.startsWith('k15.')), [], 'batch3 is K15-clean');
  assert.equal(clean.errors, 0);
  const w = gold();
  const jiedan = w.endings.find(e => e.id === 'jiedan')!;
  jiedan.passages = [...jiedan.passages!, {...jiedan.passages![0]!}, {id: 'ghost', when: [{kind: 'fact', factId: 'no_such_fact', value: true}], text: '  '}];
  w.recap = [...w.recap!, {...w.recap![0]!}, {id: 'r_bad', when: [{kind: 'resource', resourceId: 'zhaowan', atLeast: 999}], text: '越界'}];
  const r = lintWorld(w);
  const ids = r.issues.map(i => `${i.severity}:${i.ruleId}:${i.message}`);
  assert.ok(ids.some(x => x.startsWith('error:k15.duplicate-id') && x.includes('jiedan') && x.includes('yabo_alive')), ids.join('\n'));
  assert.ok(ids.some(x => x.startsWith('error:k15.duplicate-id') && x.includes('回顾') && x.includes(w.recap![0]!.id)));
  assert.ok(ids.some(x => x.startsWith('error:k15.empty-text') && x.includes('ghost')));
  assert.ok(ids.some(x => x.startsWith('error:k15.unknown-reference') && x.includes('no_such_fact')));
  assert.ok(ids.some(x => x.startsWith('error:k15.unknown-reference') && x.includes('r_bad')));
  // recap that can never hold at a given ending → warning for that ending only
  const w2 = gold(); w2.recap = [{id: 'only_if_not_will', when: [{kind: 'fact', factId: 'made_will', value: false}], text: '没立遗嘱'}];
  w2.endings.find(e => e.id === 'jiedan')!.when = [{kind: 'fact', factId: 'made_will', value: true}];
  const r2 = lintWorld(w2);
  const warn = r2.issues.filter(i => i.ruleId === 'k15.recap-unreachable');
  assert.deepEqual(warn.map(i => i.severity), ['warning']);
  assert.match(warn[0]!.message, /jiedan/);
  // banned phrases are checked in passages / recap
  const w3 = gold(); w3.recap![0]!.text = '命运的齿轮开始转动';
  assert.ok(lintWorld(w3, {bannedPhrases: ['命运的齿轮']}).issues.some(i => i.ruleId === 'text.banned-phrase' && i.message.includes('回顾')));
});

test('K15 simulator: reports passage / recap coverage per ending', async () => {
  const report = await simulateWorld(rev(gold()), {seeds: 4, strategies: ['random', 'lazy']});
  const x = report.endingExtras!;
  assert.ok(x, 'present for a K15 world');
  const reached = Object.entries(x.byEnding).filter(([id]) => id !== '(none)');
  assert.ok(reached.length > 0);
  for (const [, v] of reached) assert.ok(v.withRecap <= v.runs);
  assert.ok(Object.keys(x.recapHits).length > 0);
  assert.equal(x.passagesNeverShown.length + Object.keys(x.passageHits).length >= 1, true);
  const bare = gold(); delete bare.recap; for (const e of bare.endings) delete e.passages;
  assert.equal((await simulateWorld(rev(bare), {seeds: 1, strategies: ['random']})).endingExtras, undefined);
});
