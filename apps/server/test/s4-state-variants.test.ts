/**
 * S4 (docs/next-work-2026-10-29.md): repeat storylets pick their body by game state (`textCases`, first match wins,
 * evaluated whenever the card is shown); worlds without cases keep the old rotation. Lint flags shadowed / unreachable
 * cases and bodies that show someone after they died or left. Fixture fixtures/s4/state-variants.engine.json is SYNTHETIC.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { storyletBodies, worldContentSchema, type WorldContent, type WorldRevision } from '@novel-game/contracts';
import { lintStateVariants, lintWorld } from '@novel-game/rules/preflight';
import { advanceAdventure, createAdventureState, projectAdventure, storyletChoiceId, type AdventureState } from '@novel-game/play-runtime';
import { simulateWorld } from '@novel-game/play-runtime/sim';

const NOW = '2026-10-29T00:00:00Z';
const read = (p: string) => JSON.parse(readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8'));
const fixture = (): WorldContent => worldContentSchema.parse(read('fixtures/s4/state-variants.engine.json'));
const rev = (content: WorldContent): WorldRevision => ({id: 'rev-s4', draftId: 'd', sourceId: 's', content, version: 1, createdAt: NOW});
let n = 0;
const rid = () => `44444444-4444-4444-8444-${String(++n).padStart(12, '0')}`;
const act = (s: AdventureState, r: WorldRevision, actionId: string) => advanceAdventure(s, {actionId, expectedTurn: s.turn, requestId: rid()}, r.content, NOW);
const cardText = (s: AdventureState, r: WorldRevision) => projectAdventure(s, r).hand?.find(h => h.storyletId === 'inn_talk')?.text;

test('S4: a card repeated 3 times across 2 state changes shows the text for the current state each time', () => {
  const r = rev(fixture());
  let s = createAdventureState(r, 's4-a', NOW, {}, 3);
  const shown: string[] = [];
  const play = () => { shown.push(cardText(s, r)!); s = act(s, r, storyletChoiceId('inn_talk', 'chat')); };
  play();                            // healthy
  s = act(s, r, 'rain'); play();     // state change 1 → sick
  s = act(s, r, 'farewell'); play(); // state change 2 → gone (the later, more specific case is listed first)
  assert.deepEqual(shown.map(t => t.match(/【测试·(.+?)】/)![1]), ['默认', '病中', '已离开']);
  assert.equal(s.storyletState!.seen.inn_talk, 3);
});

test('S4: the body follows the state while the card waits in the hand (re-evaluated on every projection / reload)', () => {
  const r = rev(fixture());
  const s = createAdventureState(r, 's4-b', NOW, {}, 3);
  assert.match(cardText(s, r)!, /默认/);
  s.facts = {...s.facts, zhanggui_sick: true};
  assert.match(cardText(s, r)!, /病中/);
  const reloaded = JSON.parse(JSON.stringify(s)) as AdventureState;
  reloaded.facts = {...reloaded.facts, zhanggui_gone: true};
  assert.match(cardText(reloaded, r)!, /已离开/);
});

test('S4: worlds without textCases keep the old rotation (《寿灯》 batch3 hand texts are exactly bodies[variant])', async () => {
  const w = worldContentSchema.parse(read('fixtures/s1/shoudeng.batch3.content.json'));
  assert.ok(!(w.storylets ?? []).some(sl => sl.textCases));
  const r = rev(w);
  let s = createAdventureState(r, 's4-c', NOW, {}, 11);
  for (let i = 0; i < 60 && !s.ending; i++) {
    const view = projectAdventure(s, r);
    for (const card of s.hand ?? []) {
      const sl = w.storylets!.find(x => x.id === card.storyletId)!;
      assert.equal(view.hand!.find(h => h.storyletId === card.storyletId)!.text, storyletBodies(sl)[card.variant] ?? storyletBodies(sl)[0]);
    }
    const next = [...(view.hand ?? []).flatMap(h => h.choices), ...view.actions].find(a => a.enabled);
    if (!next) break;
    s = act(s, r, next.id);
  }
  // Simulator verdicts are unchanged for a world without cases.
  const a = await simulateWorld(r, {seeds: 10, routes: false, pacing: false, now: NOW});
  assert.deepEqual(a.checks.map(c => c.id), ['G1', 'G2', 'G4', 'G6', 'G8']);
});

test('S4 lint: a body that shows someone after they left, a shadowed case and an unreachable case are flagged', () => {
  const ok = fixture();
  assert.deepEqual(lintStateVariants(ok), [], 'the fixture covers both states');
  // Drop the 「已离开」 case → the sick case and the default body still name 老掌柜 after he left.
  const missing = fixture(); missing.storylets![0]!.textCases = missing.storylets![0]!.textCases!.filter(c => c.id !== 'gone');
  const contradiction = lintStateVariants(missing).find(i => i.ruleId === 'pool.state-contradiction')!;
  assert.ok(contradiction);
  assert.match(contradiction.message, /老掌柜离开了客栈/);
  assert.match(contradiction.message, /条件变体 sick/); assert.match(contradiction.message, /默认正文/);
  // Ordering mistake: the broader 「病中」 case first hides 「已离开」 (gone ⇒ sick in this world).
  const order = fixture(); const sl = order.storylets![0]!;
  sl.textCases = [sl.textCases![1]!, {...sl.textCases![0]!, when: [...sl.textCases![1]!.when, ...sl.textCases![0]!.when]}];
  assert.ok(lintStateVariants(order).some(i => i.ruleId === 'pool.case-shadowed' && /gone/.test(i.message)));
  // Unreachable: the case contradicts the card's own `when`; or needs more shows than maxTimes allows.
  const unreachable = fixture(); const card = unreachable.storylets![0]!;
  card.when = [{kind: 'fact', factId: 'zhanggui_gone', value: false}];
  card.textCases!.push({id: 'tenth', when: [{kind: 'storylet_seen', storyletId: 'inn_talk', atLeast: 10}], text: '【测试】第十一次。'});
  const u = lintStateVariants(unreachable).filter(i => i.ruleId === 'pool.case-unreachable');
  assert.equal(u.length, 2);
  // Through lintWorld: same rule ids under the pool category; cases count as variants for pool.few-variants.
  const report = lintWorld(missing);
  assert.ok(report.issues.some(i => i.ruleId === 'pool.state-contradiction' && i.category === 'pool'));
  assert.ok(!report.issues.some(i => i.ruleId === 'pool.few-variants' && i.target?.id === 'inn_talk'));
});

test('S4 parity: the offline player (HTML / exe port) shows the same state texts as the server', async () => {
  const { SqliteDatabase } = await import('../src/platform/database.js');
  const { AdventureService, SqliteAdventureRepository } = await import('../src/modules/adventure-sessions/index.js');
  const { MemorySaveStore, createLocalAdventurePort } = await import('@novel-game/play-runtime');
  // The fixture's placeholder prose would not pass the publish lint gate; the parity check only needs a revision.
  const revision = rev(fixture());
  const db = new SqliteDatabase(':memory:');
  try {
    const mk = () => { let i = 0; let ids = 0; return {now: () => new Date(Date.UTC(2026, 9, 29, 8, 0, i++)).toISOString(), newId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`, newSeed: () => 77}; };
    const { SqliteWorldRepository } = await import('../src/modules/worlds/index.js');
    const repo = new SqliteWorldRepository(db);
    repo.insertDraft({id: revision.draftId, sourceId: revision.sourceId, content: revision.content, version: 1, createdAt: NOW, updatedAt: NOW} as never);
    repo.publish(revision);
    const server = new AdventureService(new SqliteAdventureRepository(db), {getRevision: () => structuredClone(revision)}, {}, mk());
    const local = createLocalAdventurePort(structuredClone(revision), {buildingLibrary: {schemaVersion: 1, assets: []} as never, itemCatalog: {schemaVersion: 1, items: []} as never}, {packageId: 'pkg-s4', store: new MemorySaveStore(), ...mk()});
    let a = server.start({worldRevisionId: revision.id}); let b = local.start(revision.id);
    const texts: string[] = [];
    for (const actionId of [storyletChoiceId('inn_talk', 'chat'), 'rain', storyletChoiceId('inn_talk', 'chat'), 'farewell', storyletChoiceId('inn_talk', 'chat')]) {
      const ta = a.hand?.find(h => h.storyletId === 'inn_talk')?.text; const tb = b.hand?.find(h => h.storyletId === 'inn_talk')?.text;
      assert.equal(tb, ta); if (actionId.includes('inn_talk')) texts.push(ta!);
      const input = {actionId, expectedTurn: a.turn, requestId: rid()};
      a = server.act(a.id, input); b = local.act(b.id, input);
    }
    assert.deepEqual(texts.map(t => t.match(/【测试·(.+?)】/)![1]), ['默认', '病中', '已离开']);
  } finally { db.close(); }
});
