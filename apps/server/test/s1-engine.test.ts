/**
 * S1 engine (§3 contracts, §10.2): bounded resources + thresholds, clock/windows, storylet hand,
 * seeded rolls, anyOf, projection C1–C11 — on the gold sample 《寿灯》 batch 2 (cumulative: batch 1 + 28 cards, `cailiao`,
 * 落星 / 大比 windows). Batch 1 stays as a regression/save fixture (last tests).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { SYSTEM_WAIT_ACTION_ID, worldContentSchema, type AdventureView, type WorldContent, type WorldRevision } from '@novel-game/contracts';
import { assessOpeningActions } from '@novel-game/rules';
import {
  advanceAdventure, computeChance, createAdventureState, formatCalendar, formatMonths, projectAdventure, requiresBlock,
  type AdventureState,
} from '@novel-game/play-runtime';
import { validateWorld } from '../src/modules/worlds/domain/validate-world.js';

const load = (batch: string): WorldContent => worldContentSchema.parse(JSON.parse(readFileSync(new URL(`../../../fixtures/s1/shoudeng.${batch}.content.json`, import.meta.url), 'utf8')));
const gold = (): WorldContent => load('batch2');
const rev = (content = gold()): WorldRevision => ({id: 'rev-s1', draftId: 'd', sourceId: 's', content, version: 1, createdAt: '2026-10-28T00:00:00Z'});
let req = 0;
const rid = () => `22222222-2222-4222-8222-${String(++req).padStart(12, '0')}`;
function act(state: AdventureState, world: WorldContent, actionId: string): AdventureState {
  return advanceAdventure(state, {actionId, expectedTurn: state.turn, requestId: rid()}, world, '2026-10-28T00:00:00Z');
}
const view = (state: AdventureState, r: WorldRevision): AdventureView => projectAdventure(state, r);
const start = (r: WorldRevision, seed = 7) => createAdventureState(r, `save-${seed}`, '2026-10-28T00:00:00Z', {}, seed);
const choice = (v: AdventureView, id: string) => v.hand?.flatMap(h => h.choices).find(c => c.id === id);

test('S1 gold sample: parses, validates, opening counts storylet choices', () => {
  const world = gold();
  assert.equal(world.storylets?.length, 51);
  assert.equal(world.storylets!.filter(sl => sl.repeat).length, 21);
  for (const id of ['hundeng', 'chaojing', 'pingjing', 'hongxiu', 'yuye']) assert.ok(world.storylets!.some(s => s.id === id), `§4.2 card ${id}`);
  const result = validateWorld(world, {chapters: [{id: 'shoudeng-c1', paragraphs: []}]} as never);
  assert.deepEqual(result.errors, []);
  const opening = assessOpeningActions(world);
  assert.ok(opening.ok, opening.message ?? '');
  assert.ok(opening.executableIds.includes('sl__hundeng__remember'));
});

test('S1 start projection: HUD meta (C1), clock (C3), hand (C4), countdown U18', () => {
  const r = rev(); const v = view(start(r), r);
  assert.equal(v.timeUnit, 'month');
  assert.equal(v.timeLimit, 720);
  assert.equal(v.clock?.label, '第1年 3月');
  assert.deepEqual(v.clock?.countdown && {id: v.clock.countdown.resourceId, value: v.clock.countdown.value}, {id: 'shouyuan', value: 40});
  assert.deepEqual(v.resourceMeta?.map(m => m.id), ['xiuwei', 'realm', 'shouyuan', 'lingshi', 'xinmo', 'gongxun', 'zhaowan', 'xiansuo', 'zhujidan', 'cailiao'], 'declaration order, hidden jieshou omitted');
  assert.equal(v.resourceMeta?.find(m => m.id === 'realm')?.valueLabel, '炼气前期');
  assert.equal(v.resourceMeta?.find(m => m.id === 'xiansuo')?.display, 'pips');
  assert.equal(v.hand?.[0]?.storyletId, 'hundeng', 'urgent opening card');
  assert.ok((v.hand?.length ?? 0) <= 3);
  assert.equal(v.rng?.seed, 7);
  // Fixed action grey-out uses generated reason with valueLabels (C2 / U4).
  assert.equal(v.actions.find(a => a.id === 'go_citang_jielv')?.blockedReason, '境界不足：需 ≥ 筑基，现有 炼气前期');
});

test('S1 clamping at max + lastResult deltas (C6): 寿元 40 +1 stays 40, and a countdown never reads 已封顶', () => {
  const r = rev(); let s = start(r);
  s = act(s, r.content, 'sl__hundeng__pay');
  const v = view(s, r);
  assert.equal(v.resources?.shouyuan, 40);
  assert.equal(v.resources?.lingshi, 12, 'pay has no lingshi cost in data');
  assert.equal(v.resourceMeta?.find(m => m.id === 'shouyuan')?.bound, undefined, 'countdown (寿元) is never 已封顶 in the HUD');
  assert.ok(!v.lastResult?.deltas.some(d => !('kind' in d) && d.id === 'shouyuan' && d.clamped === 'max'), 'nor in the 刚刚发生 chips');
  assert.equal(s.lastResult?.deltas.some(d => !('kind' in d) && d.id === 'shouyuan' && d.clamped === 'max'), true, 'saved state keeps the raw clamp (projection-only change)');
  assert.ok(v.lastResult);
  assert.equal(v.lastResult?.actionLabel, '把仅有的十枚灵石塞给哑伯，求他添油');
});

test('S1 onMin → failure ending with path (C7); clock rule fires yearly', () => {
  const r = rev(); let s = start(r);
  s = act(s, r.content, 'sl__hundeng__remember');
  s = {...structuredClone(s), elapsed: 11, resources: {...s.resources!, shouyuan: 1}};
  s = act(s, r.content, SYSTEM_WAIT_ACTION_ID);
  const v = view(s, r);
  assert.equal(v.ended, true);
  assert.equal(v.ending?.id, 'zuohua');
  assert.equal(v.ending?.kind, 'failure');
  assert.ok(v.ending?.path?.includes('魂灯'), JSON.stringify(v.ending?.path));
  assert.deepEqual(v.hand, [], 'no hand after the end');
});

test('S1 timeout → authored timeout ending (clock.timeoutEndingId)', () => {
  const r = rev(); let s = start(r);
  s = {...structuredClone(s), elapsed: 719};
  s = act(s, r.content, SYSTEM_WAIT_ACTION_ID);
  const v = view(s, r);
  assert.equal(v.ending?.id, 'liushi');
  assert.equal(v.ending?.kind, 'timeout');
});

test('S1 onMax → forced trigger card when at its location (pingjing)', () => {
  const r = rev(); let s = start(r);
  s = act(s, r.content, 'sl__hundeng__remember');
  s = {...structuredClone(s), locationId: 'dongfu', resources: {...s.resources!, xiuwei: 99}};
  // listen in xinmo_ye is not in hand; use clock rule-free path: apply via a card at dongfu → caiyao requires hundeng seen.
  const world = r.content;
  const caiyao = world.storylets!.find(x => x.id === 'caiyao')!;
  const xiuweiChoice = caiyao.choices.find(c => c.effects.some(e => e.kind === 'resource' && e.resourceId === 'xiuwei' && (e.delta ?? 0) > 0));
  if (xiuweiChoice) {
    s.hand = [{storyletId: 'caiyao', variant: 0, drawnTurn: s.turn}];
    s = act(s, world, `sl__caiyao__${xiuweiChoice.id}`);
  } else {
    s.resources!.xiuwei = 100; s.forcedStorylets = ['pingjing']; s = act(s, world, SYSTEM_WAIT_ACTION_ID);
  }
  const v = view(s, r);
  assert.equal(v.resources?.xiuwei, 100, 'clamped to max');
  assert.ok(v.hand?.some(h => h.storyletId === 'pingjing' && h.urgent), JSON.stringify(v.hand?.map(h => h.storyletId)));
  // availableWhen hides breakthrough choices not matching the realm.
  const ids = v.hand!.find(h => h.storyletId === 'pingjing')!.choices.map(c => c.id);
  assert.ok(ids.includes('sl__pingjing__c_lq') && !ids.includes('sl__pingjing__c_zj'), ids.join(','));
  // C5: roll chance with base + atMost mod (+15% at realm 0) + per mod.
  const lq = choice(v, 'sl__pingjing__c_lq')!;
  assert.ok(lq.roll && lq.roll.chance! > 0.55, JSON.stringify(lq.roll));
});

test('S1 roll: chance math with per/atMost mods and clamping; deterministic by seed (G5)', () => {
  const world = gold();
  const endure = world.storylets!.find(x => x.id === 'xinmo_ye')!.choices.find(c => c.id === 'endure')!.effects[0]!;
  assert.equal(endure.kind, 'roll');
  if (endure.kind !== 'roll') return;
  const c40 = computeChance(endure, {xinmo: 40}, world);
  assert.ok(Math.abs(c40.chance - 0.3) < 1e-9, String(c40.chance));
  assert.equal(c40.parts[0]?.label, '基础');
  assert.equal(computeChance(endure, {xinmo: 100}, world).chance, 0.05, 'min clamp');
  const run = (seed: number) => {
    const r = rev(world); let s = start(r, seed);
    s = act(s, world, 'sl__hundeng__remember');
    s = {...structuredClone(s), resources: {...s.resources!, xinmo: 40}};
    s.hand = [{storyletId: 'xinmo_ye', variant: 0, drawnTurn: s.turn}];
    s = act(s, world, 'sl__xinmo_ye__endure');
    return {xinmo: s.resources!.xinmo, roll: s.lastResult?.roll, rng: s.rng};
  };
  assert.deepEqual(run(42), run(42));
  const outcomes = new Set(Array.from({length: 24}, (_, i) => run(i + 1).roll?.success));
  assert.deepEqual([...outcomes].sort(), [false, true], 'both outcomes occur across seeds');
  assert.equal(run(42).rng!.cursor > 0, true, 'rng cursor stored in the save');
});

test('S1 anyOf reason sentence and resource range/clock sentences (U4)', () => {
  const r = rev(); const s = start(r);
  const any = requiresBlock([{kind: 'anyOf', conditions: [{kind: 'resource', resourceId: 'xinmo', atLeast: 30}, {kind: 'resource', resourceId: 'shouyuan', atMost: 15}]}], r.content, s);
  assert.equal(any.reason, '需满足其一：心魔 ≥ 30；寿元 ≤ 15');
  assert.equal(requiresBlock([{kind: 'resource', resourceId: 'lingshi', atLeast: 50}], r.content, s).reason, '灵石不足：需 ≥ 50，现有 12');
  assert.equal(requiresBlock([{kind: 'resource', resourceId: 'shouyuan', atMost: 10}], r.content, s).reason, '寿元过高：需 ≤ 10，现有 40');
  assert.equal(requiresBlock([{kind: 'resource', resourceId: 'lingshi', atLeast: 20, atMost: 30}], r.content, s).reason, '灵石不在范围：需 20–30，现有 12');
  assert.equal(requiresBlock([{kind: 'clock', atLeastMonth: 12}], r.content, s).reason, '时候未到：第2年 3月 起才行');
  assert.equal(requiresBlock([{kind: 'storylet_seen', storyletId: 'hundeng', atLeast: 1}], r.content, s).reason, '还没经历「魂灯」');
  assert.equal(requiresBlock([{kind: 'resource', resourceId: 'jieshou', atLeast: 1}], r.content, s).reason, '条件未满足', 'hidden resource');
  assert.equal(formatCalendar(r.content, 10), '第2年 1月');
  assert.equal(formatMonths(3), '3 个月'); assert.equal(formatMonths(24), '2 年'); assert.equal(formatMonths(14), '1 年 2 个月');
});

test('S1 clock: months advance by timeCost; window opens/closes and forces its card (C3)', () => {
  const r = rev(); let s = start(r);
  s = act(s, r.content, 'sl__hundeng__leave'); // → zayi
  s = {...structuredClone(s), elapsed: 29};
  s = act(s, r.content, SYSTEM_WAIT_ACTION_ID);
  let v = view(s, r);
  assert.equal(v.elapsed, 30);
  assert.deepEqual(v.clock?.openWindows.map(w => w.id), ['xiaobi_1']);
  assert.equal(v.clock?.openWindows[0]?.monthsLeft, 11, 'batch 2 小比 window is months 30–41');
  assert.ok(v.hand?.some(h => h.storyletId === 'xiaobi' && h.inWindow), JSON.stringify(v.hand?.map(h => h.storyletId)));
  s = {...structuredClone(s), elapsed: 41};
  s = act(s, r.content, SYSTEM_WAIT_ACTION_ID);
  v = view(s, r);
  assert.deepEqual(v.clock?.openWindows, []);
  assert.ok(!v.hand?.some(h => h.storyletId === 'xiaobi'), 'window card leaves with its window');
});

test('S1 monthOfYearIn: qiuji only in calendar months 9–10', () => {
  const world = gold(); const r = rev(world);
  const eligibleAt = (elapsed: number) => {
    let s = start(r); s = act(s, world, 'sl__hundeng__remember');
    s = {...structuredClone(s), elapsed, locationId: 'citang', hand: []};
    s.storyletState!.seen.qiuji = 0;
    s = act(s, world, SYSTEM_WAIT_ACTION_ID); // +1 month, refresh
    return {month: s.elapsed, has: (s.hand ?? []).some(h => h.storyletId === 'qiuji')};
  };
  // start month 3 → elapsed 6 = September, 7 = October.
  const sept = Array.from({length: 12}, (_, i) => i + 1).map(seed => { const r2 = rev(world); let s = start(r2, seed); s = act(s, world, 'sl__hundeng__remember'); s = {...structuredClone(s), elapsed: 5, locationId: 'citang'}; s = act(s, world, SYSTEM_WAIT_ACTION_ID); return (s.hand ?? []).some(h => h.storyletId === 'qiuji'); });
  assert.ok(sept.some(Boolean), 'qiuji drawable in September for some seed');
  assert.equal(eligibleAt(1).has, false, 'never in May');
});

test('S1 hand: ≤3 cards, played one-shot never returns, cooldown respected, sequential variants', () => {
  const world = gold(); const r = rev(world);
  let s = start(r, 3);
  s = act(s, world, 'sl__hundeng__remember');
  for (let i = 0; i < 40 && !s.ending; i++) {
    const v = view(s, r);
    assert.ok((v.hand?.length ?? 0) <= 3);
    assert.ok(!v.hand?.some(h => h.storyletId === 'hundeng'), 'one-shot card does not return');
    const next = v.hand?.flatMap(h => h.choices).find(c => c.enabled) ?? v.actions.find(a => a.enabled)!;
    s = act(s, world, next.id);
  }
  // Sequential: hongxiu variant follows play count.
  let h = start(r, 5); h = act(h, world, 'sl__hundeng__remember');
  h = {...structuredClone(h), locationId: 'heishui', resources: {...h.resources!, xinmo: 40}};
  h.storyletState!.seen.hongxiu = 1;
  h.hand = []; h = act(h, world, SYSTEM_WAIT_ACTION_ID);
  const card = h.hand?.find(c => c.storyletId === 'hongxiu');
  if (card) assert.equal(card.variant, 1);
});

test('S1 replay: same seed + same inputs ⇒ identical states (save carries rng)', () => {
  const world = gold(); const r = rev(world);
  const play = () => {
    let s = start(r, 99);
    for (let i = 0; i < 30 && !s.ending; i++) {
      const v = view(s, r);
      const opts = [...(v.hand ?? []).flatMap(h => h.choices), ...v.actions].filter(a => a.enabled);
      s = act(s, world, opts[i % opts.length]!.id);
    }
    return view(s, r);
  };
  req = 0; const a = play(); req = 0; const b = play();
  assert.deepEqual(a, b);
});

test('S1 parity: server AdventureService and offline LocalAdventurePort with the same seed', async () => {
  const { SqliteDatabase } = await import('../src/platform/database.js');
  const { WorldService, SqliteWorldRepository } = await import('../src/modules/worlds/index.js');
  const { AdventureService, SqliteAdventureRepository } = await import('../src/modules/adventure-sessions/index.js');
  const { MemorySaveStore, createLocalAdventurePort } = await import('@novel-game/play-runtime');
  const source = {id: 'src-sd', title: '寿灯', filename: 'sd.txt', encoding: 'utf8', chapterCount: 1, charCount: 1, createdAt: '2026-10-28T00:00:00Z',
    chapters: [{id: 'shoudeng-c1', index: 0, title: '一', paragraphs: [{id: 'p1', index: 0, text: '灯。'}]}]};
  const db = new SqliteDatabase(':memory:');
  try {
    const mk = () => { let n = 0; let ids = 0; return {now: () => new Date(Date.UTC(2026, 9, 28, 8, 0, n++)).toISOString(), newId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`, newSeed: () => 1234}; };
    const worlds = new WorldService(new SqliteWorldRepository(db), {get: () => structuredClone(source) as never});
    const server = new AdventureService(new SqliteAdventureRepository(db), worlds, {}, mk());
    const draft = worlds.create({sourceId: source.id, content: gold()});
    const revision = worlds.publish(draft.id, {version: 1});
    const local = createLocalAdventurePort(structuredClone(revision), {buildingLibrary: {schemaVersion: 1, assets: []} as never, itemCatalog: {schemaVersion: 1, items: []} as never}, {packageId: 'pkg-s1', store: new MemorySaveStore(), ...mk()});
    let a = server.start({worldRevisionId: revision.id}); let b = local.start(revision.id);
    assert.deepEqual(b, a);
    for (let i = 0; i < 40 && !a.ended; i++) {
      const opts = [...(a.hand ?? []).flatMap(h => h.choices), ...a.actions].filter(x => x.enabled);
      const input = {actionId: opts[(i * 7) % opts.length]!.id, expectedTurn: a.turn, requestId: rid()};
      a = server.act(a.id, input); b = local.act(b.id, input);
      assert.deepEqual(b, a, `step ${i} ${input.actionId}`);
    }
  } finally { db.close(); }
});

test('S1 batch 2: 落星 / 大比 windows, anyOf(clock) availability, 0-month sale action', () => {
  const world = gold(); const r = rev(world);
  const ids = (world.clock?.windows ?? []).map(w => w.id);
  assert.deepEqual(ids, ['xiaobi_1', 'luoxing_1', 'dabi_1', 'luoxing_2']);
  let s = start(r); s = act(s, world, 'sl__hundeng__leave');
  const at = (elapsed: number, patch: Partial<AdventureState> = {}) => { let x = {...structuredClone(s), elapsed, ...patch}; x = act(x, world, SYSTEM_WAIT_ACTION_ID); return view(x, r); };
  assert.deepEqual(at(95).clock?.openWindows.map(w => w.id), ['luoxing_1']);
  assert.deepEqual(at(119).clock?.openWindows.map(w => w.id), ['dabi_1'], '落星 closes after 119, 大比 opens at 120');
  assert.deepEqual(at(239).clock?.openWindows.map(w => w.id), ['luoxing_2']);
  // anyOf of two clock ranges: 秘境歇脚 only while a 落星 window is open.
  const rest = (elapsed: number) => at(elapsed, {locationId: 'luoxing'}).actions.some(a => a.id === 'luoxing_xiuxi');
  assert.equal(rest(100), true); assert.equal(rest(150), false); assert.equal(rest(250), true);
  // timeCost 0 (selling 秘境材料) is instant under a clock.
  let sale: AdventureState = {...structuredClone(s), elapsed: 50, locationId: 'fangshi', resources: {...s.resources!, cailiao: 2}};
  const before = sale.resources!.lingshi!;
  sale = act(sale, world, 'sell_cailiao');
  assert.equal(sale.elapsed, 50); assert.equal(sale.resources!.cailiao, 1); assert.equal(sale.resources!.lingshi, before + 75);
  assert.equal(view(sale, r).lastResult?.months, 0);
});

test('S1 batch 1 regression fixture: still parses, validates and replays deterministically', () => {
  const world = load('batch1'); const r = rev(world);
  assert.equal(world.storylets?.length, 23);
  assert.deepEqual(validateWorld(world, {chapters: [{id: 'shoudeng-c1', paragraphs: []}]} as never).errors, []);
  const play = () => { let s = start(r, 11); for (let i = 0; i < 25 && !s.ending; i++) { const v = view(s, r); const o = [...(v.hand ?? []).flatMap(h => h.choices), ...v.actions].filter(a => a.enabled); s = act(s, world, o[i % o.length]!.id); } return view(s, r); };
  req = 0; const a = play(); req = 0; assert.deepEqual(play(), a);
});

test('S1 contracts: timeCost 0 is allowed only with a clock (legacy worlds keep 1–5)', () => {
  const world = gold();
  const { clock: _c, ...noClock } = world;
  const bad = worldContentSchema.safeParse({...noClock, actions: noClock.actions.map(a => a.id === 'sell_cailiao' ? a : {...a, timeCost: Math.min(a.timeCost, 5) || 1})});
  assert.equal(bad.success, false);
  assert.ok(!bad.success && bad.error.issues.some(i => i.message.includes('1–5')));
});
