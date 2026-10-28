import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { projectFillActions, fillSpecificBlockedReason, mergeFillSeedResources, mergeFillSeedFacts, lootChancePasses } from '@novel-game/rules';
import { advanceAdventure } from '@novel-game/play-runtime';
import { projectAdventure } from '@novel-game/play-runtime';
import type { AdventureState } from '@novel-game/play-runtime';
import { fillDemoWorld } from './helpers/fill-fixture.js';
import { AppError } from '../src/shared/errors.js';

function startState(world = fillDemoWorld()): AdventureState {
  const fill = projectFillActions(world);
  const now = '2026-10-28T04:00:00.000Z';
  const facts = mergeFillSeedFacts(
    Object.fromEntries(world.facts.map(f => [f.id, f.initialValue])),
    fill.seedFacts,
  );
  const knownFactIds = world.facts.filter(f => f.playerKnown).map(f => f.id);
  for (const id of Object.keys(fill.seedFacts)) {
    if (!knownFactIds.includes(id)) knownFactIds.push(id);
  }
  return {
    schemaVersion: 1,
    id: 'adv-fill',
    worldRevisionId: 'rev-fill',
    turn: 0,
    elapsed: 0,
    locationId: world.initialLocationId,
    facts,
    knownFactIds,
    resources: mergeFillSeedResources({ ...(world.resources ?? {}) }, fill.seedResources),
    takenTags: [],
    npcs: Object.fromEntries(world.npcs.map(n => [n.id, { locationId: n.initialLocationId, knownFactIds: [...n.knownFactIds] }])),
    performedActionIds: [],
    triggeredEventIds: [],
    history: [],
    createdAt: now,
    updatedAt: now,
  };
}

function revision(world = fillDemoWorld()) {
  return {
    id: 'rev-fill',
    draftId: 'draft-fill',
    sourceId: 'src',
    content: world,
    version: 1,
    createdAt: '2026-10-28T00:00:00.000Z',
  };
}

test('projectFillActions: shop/supply/quest lines + empty groups; no forged price', () => {
  const world = fillDemoWorld();
  const proj = projectFillActions(world);
  assert.ok(proj.actions.some(a => a.id.startsWith('fill_buy_') && a.costHints?.length));
  assert.ok(proj.actions.some(a => a.label.includes('灵砂') && a.costHints?.[0]?.includes('9')));
  assert.ok(proj.actions.some(a => a.id.startsWith('fill_supply_')));
  assert.ok(proj.actions.some(a => a.id.startsWith('fill_quest_accept_')));
  assert.ok(proj.actions.some(a => a.id.startsWith('fill_quest_deliver_')));
  const emptyShop = proj.groups.find(g => g.label === '歇业铺面');
  assert.ok(emptyShop);
  assert.equal(emptyShop?.lineActionIds.length, 0);
  assert.match(emptyShop?.emptyMessage ?? '', /尚未开张/);
  const emptyQuest = proj.groups.find(g => g.label === '空告示');
  assert.match(emptyQuest?.emptyMessage ?? '', /暂时没有任务/);
  // Unbound price must not compile as enabled success path without resourceId
  const unboundWorld = fillDemoWorld();
  const shop = unboundWorld.map!.fill!.placements.find(p => p.id === 'pl_shop')!;
  (shop.localOverrides as { shop: { shelf: { itemId: string; price?: { amount: number } }[] } }).shop.shelf = [
    { itemId: 'ghost', price: { amount: 3 } }, // no resourceId
  ];
  const unbound = projectFillActions(unboundWorld).actions.find(a => a.label.includes('ghost') || a.id.includes('fill_buy_pl_shop_0'));
  assert.ok(unbound);
  assert.equal(unbound!.requires.some(r => r.kind === 'fact' && r.factId === '__fill_never__'), true);
});

test('AdventureView projects fill actions with costHints/kindHint/fillGroups at market', () => {
  const world = fillDemoWorld();
  const state = startState(world);
  const view = projectAdventure(state, revision(world));
  assert.ok(view.actions.some(a => a.kindHint === 'shop' && a.costHints?.length));
  assert.ok(view.actions.some(a => a.kindHint === 'supply'));
  assert.ok(view.actions.some(a => a.kindHint === 'quest'));
  assert.ok((view.fillGroups?.length ?? 0) >= 3);
  const sand = view.actions.find(a => a.label.includes('灵砂'));
  assert.ok(sand);
  assert.equal(sand!.enabled, false);
  assert.match(sand!.blockedReason ?? '', /通货不足/);
});

test('buy success: coin delta + own fact; locked when insufficient; stock empty locks', () => {
  const world = fillDemoWorld();
  let state = startState(world);
  const buy = projectFillActions(world).actions.find(a => a.label.includes('干粮'))!;
  state = advanceAdventure(state, { actionId: buy.id, expectedTurn: 0, requestId: randomUUID() }, world, '2026-10-28T04:01:00.000Z');
  assert.equal(state.resources.coin, 3);
  assert.equal(state.facts.own_dry_ration, true);
  assert.ok(state.knownFactIds.includes('own_dry_ration'));

  // spirit sand still locked
  const sand = projectFillActions(world).actions.find(a => a.label.includes('灵砂'))!;
  const reason = fillSpecificBlockedReason(sand, state.resources, state.facts) ?? 'x';
  assert.match(reason, /通货不足/);
  assert.throws(
    () => advanceAdventure(state, { actionId: sand.id, expectedTurn: state.turn, requestId: randomUUID() }, world, '2026-10-28T04:02:00.000Z'),
    (e: unknown) => e instanceof AppError && e.code === 'ACTION_BLOCKED',
  );

  // buy dry again (stock 2 → 1 left), then once more to empty
  state = advanceAdventure(state, { actionId: buy.id, expectedTurn: state.turn, requestId: randomUUID() }, world, '2026-10-28T04:03:00.000Z');
  assert.equal(state.resources.coin, 1);
  assert.throws(
    () => advanceAdventure(state, { actionId: buy.id, expectedTurn: state.turn, requestId: randomUUID() }, world, '2026-10-28T04:04:00.000Z'),
    (e: unknown) => e instanceof AppError && e.code === 'ACTION_BLOCKED',
  );
});

test('supply restores hp with cost; uses exhaust locks', () => {
  const world = fillDemoWorld();
  let state = startState(world);
  const supply = projectFillActions(world).actions.find(a => a.label.includes('打尖'))!;
  state = advanceAdventure(state, { actionId: supply.id, expectedTurn: 0, requestId: randomUUID() }, world, '2026-10-28T04:10:00.000Z');
  assert.equal(state.resources.hp, 5);
  assert.equal(state.resources.coin, 4);
  state = advanceAdventure(state, { actionId: supply.id, expectedTurn: state.turn, requestId: randomUUID() }, world, '2026-10-28T04:11:00.000Z');
  assert.equal(state.resources.hp, 7);
  assert.throws(
    () => advanceAdventure(state, { actionId: supply.id, expectedTurn: state.turn, requestId: randomUUID() }, world, '2026-10-28T04:12:00.000Z'),
    (e: unknown) => e instanceof AppError && e.code === 'ACTION_BLOCKED',
  );
});

test('quest accept sets fact; deliver when data present grants reward', () => {
  const world = fillDemoWorld();
  let state = startState(world);
  const accept = projectFillActions(world).actions.find(a => a.id.startsWith('fill_quest_accept_pl_quest'))!;
  state = advanceAdventure(state, { actionId: accept.id, expectedTurn: 0, requestId: randomUUID() }, world, '2026-10-28T04:20:00.000Z');
  assert.equal(state.facts.quest_dock_accepted, true);

  // deliver visible but locked without wolf ear
  const deliver = projectFillActions(world).actions.find(a => a.id.startsWith('fill_quest_deliver_'))!;
  assert.equal(deliver.availableWhen.some(c => c.kind === 'fact' && c.factId === 'quest_dock_accepted'), true);
  assert.throws(
    () => advanceAdventure(state, { actionId: deliver.id, expectedTurn: state.turn, requestId: randomUUID() }, world, '2026-10-28T04:20:30.000Z'),
    (e: unknown) => e instanceof AppError && e.code === 'ACTION_BLOCKED',
  );
  // move to dock, find ear, return, deliver
  state = advanceAdventure(state, { actionId: 'to_dock', expectedTurn: state.turn, requestId: randomUUID() }, world, '2026-10-28T04:21:00.000Z');
  state = advanceAdventure(state, { actionId: 'find_ear', expectedTurn: state.turn, requestId: randomUUID() }, world, '2026-10-28T04:22:00.000Z');
  assert.equal(state.facts.has_wolf_ear, true);
  state = advanceAdventure(state, { actionId: 'to_market', expectedTurn: state.turn, requestId: randomUUID() }, world, '2026-10-28T04:23:00.000Z');
  state = advanceAdventure(state, { actionId: deliver.id, expectedTurn: state.turn, requestId: randomUUID() }, world, '2026-10-28T04:24:00.000Z');
  assert.equal(state.facts.quest_dock_done, true);
  assert.ok(state.resources.coin >= 5); // +4 reward (started 5, no buys in this path)
});

test('G4 honesty: no fill placements → no fill actions/groups', () => {
  const world = fillDemoWorld();
  delete world.map!.fill;
  const proj = projectFillActions(world);
  assert.equal(proj.actions.length, 0);
  assert.equal(proj.groups.length, 0);
  const view = projectAdventure(startState(world), revision(world));
  assert.equal(view.fillGroups, undefined);
  assert.equal(view.actions.every(a => !a.kindHint), true);
});

test('P2 encounter: projects fight/flee; start_encounter writes engage; loot + once lock', () => {
  const world = fillDemoWorld();
  const proj = projectFillActions(world);
  const fight = proj.actions.find(a => a.id === 'fill_enc_fight_pl_enc_marsh');
  const flee = proj.actions.find(a => a.id === 'fill_enc_flee_pl_enc_marsh');
  assert.ok(fight);
  assert.ok(flee);
  assert.equal(fight!.kindHint, 'encounter');
  assert.equal(flee!.kindHint, 'encounter');
  assert.ok(fight!.effects.some(e => e.kind === 'start_encounter'));
  assert.ok(proj.groups.some(g => g.label === '沼岸伏击' && g.lineActionIds.length === 2));

  let state = startState(world);
  state.locationId = 'dock';
  const coinBefore = state.resources.coin;
  state = advanceAdventure(state, { actionId: fight!.id, expectedTurn: 0, requestId: randomUUID() }, world, '2026-10-28T05:00:00.000Z');
  assert.equal(state.facts.enc_engaged_pl_enc_marsh, true);
  assert.equal(state.facts.enc_resolved_pl_enc_marsh, true);
  assert.equal(state.facts.own_salt_shard, true);
  assert.equal(state.resources.coin, coinBefore + 1);
  assert.match(state.history.at(-1)?.text ?? '', /取得|盐/);

  // once / resolved → locked with 已经了结
  const view = projectAdventure(state, revision(world));
  const lockedFight = view.actions.find(a => a.id === fight!.id);
  assert.ok(lockedFight);
  assert.equal(lockedFight!.enabled, false);
  assert.match(lockedFight!.blockedReason ?? '', /已经了结/);
  assert.throws(
    () => advanceAdventure(state, { actionId: fight!.id, expectedTurn: state.turn, requestId: randomUUID() }, world, '2026-10-28T05:01:00.000Z'),
    (e: unknown) => e instanceof AppError && e.code === 'ACTION_BLOCKED',
  );
});

test('P2 encounter: empty loot honest; flee costs hp and differs from fight', () => {
  const world = fillDemoWorld();
  let state = startState(world);
  state.locationId = 'gate';
  const fight = projectFillActions(world).actions.find(a => a.id === 'fill_enc_fight_pl_enc_empty')!;
  const hpBefore = state.resources.hp;
  const coinBefore = state.resources.coin;
  state = advanceAdventure(state, { actionId: fight.id, expectedTurn: 0, requestId: randomUUID() }, world, '2026-10-28T05:10:00.000Z');
  assert.equal(state.facts.enc_resolved_pl_enc_empty, true);
  assert.equal(state.resources.coin, coinBefore); // no loot resource
  assert.match(state.history.at(-1)?.text ?? '', /没有可拿走的东西|了结了这处威胁/);

  // flee path on fresh session
  state = startState(world);
  state.locationId = 'dock';
  const flee = projectFillActions(world).actions.find(a => a.id === 'fill_enc_flee_pl_enc_marsh')!;
  state = advanceAdventure(state, { actionId: flee.id, expectedTurn: 0, requestId: randomUUID() }, world, '2026-10-28T05:11:00.000Z');
  assert.equal(state.facts.enc_fled_pl_enc_marsh, true);
  assert.equal(state.facts.enc_resolved_pl_enc_marsh, true);
  assert.equal(state.facts.own_salt_shard, false); // no loot on flee
  assert.equal(state.resources.hp, hpBefore - 1);
  assert.match(state.history.at(-1)?.text ?? '', /脱身/);
});

test('P2 boss: defeat flag + kindHint boss; chance stub deterministic', () => {
  assert.equal(lootChancePasses(1, 'a', 'b'), true);
  assert.equal(lootChancePasses(0, 'a', 'b'), false);
  const mid1 = lootChancePasses(0.5, 'pl_x', 'item_y');
  const mid2 = lootChancePasses(0.5, 'pl_x', 'item_y');
  assert.equal(mid1, mid2);

  const world = fillDemoWorld();
  let state = startState(world);
  state.locationId = 'marsh';
  const fight = projectFillActions(world).actions.find(a => a.id === 'fill_enc_fight_pl_boss_tide')!;
  assert.equal(fight.kindHint, 'boss');
  state = advanceAdventure(state, { actionId: fight.id, expectedTurn: 0, requestId: randomUUID() }, world, '2026-10-28T05:20:00.000Z');
  assert.equal(state.facts.enc_defeated_pl_boss_tide, true);
  assert.equal(state.facts.own_tide_pearl, true);
  assert.match(state.history.at(-1)?.text ?? '', /击败/);
});

test('P2 G4: no encounter projection when no encounter placements', () => {
  const world = fillDemoWorld();
  world.map!.fill!.placements = world.map!.fill!.placements.filter(
    p => p.kind !== 'encounter' && p.kind !== 'boss',
  );
  const proj = projectFillActions(world);
  assert.equal(proj.actions.every(a => a.kindHint !== 'encounter' && a.kindHint !== 'boss'), true);
});
