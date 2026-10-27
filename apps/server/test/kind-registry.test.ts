import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyStoryEffect,
  reachChoiceAvailable,
  evalStoryCondition,
  evalWorldCondition,
  listAllKindMeta,
  matchesWorldConditions,
  resetBuiltinKinds,
  storyConditionKinds,
  storyEffectKinds,
  worldConditionKinds,
  worldEffectKinds,
  KindRegistry,
} from '@novel-game/rules';

test('builtin kind registries list story + world kinds without duplicates', () => {
  resetBuiltinKinds();
  const storyCond = storyConditionKinds.list().map(m => m.kind).sort();
  const storyEff = storyEffectKinds.list().map(m => m.kind).sort();
  const worldCond = worldConditionKinds.list().map(m => m.kind).sort();
  const worldEff = worldEffectKinds.list().map(m => m.kind).sort();
  assert.deepEqual(storyCond, ['variable.equals', 'variable.gte']);
  assert.deepEqual(storyEff, ['variable.increment', 'variable.set']);
  assert.deepEqual(worldCond, ['at_terrain', 'fact', 'in_faction_territory', 'in_region', 'known', 'npc_knows', 'time']);
  assert.deepEqual(worldEff, ['move', 'npc_learn', 'npc_move', 'resource', 'reveal', 'set']);

  const all = listAllKindMeta();
  assert.equal(all.length, 17);
  assert.equal(new Set(all.map(m => `${m.family}:${m.kind}`)).size, 17);
  for (const meta of all) {
    assert.ok(meta.label.length > 0, `${meta.kind} missing label`);
    assert.ok(meta.description.length > 0, `${meta.kind} missing description`);
  }
});

test('register is idempotent: same kind overwrites, list size stable', () => {
  const registry = new KindRegistry<() => boolean>();
  registry.register({ kind: 'x', family: 'story.condition', label: '一', description: 'a', evaluate: () => true });
  registry.register({ kind: 'x', family: 'story.condition', label: '二', description: 'b', evaluate: () => false });
  assert.equal(registry.list().length, 1);
  assert.equal(registry.get('x')?.label, '二');
  assert.equal(registry.get('x')?.evaluate?.(), false);
});

test('unknown story condition kind fails closed', () => {
  resetBuiltinKinds();
  const bogus = { type: 'variable.equals', variable: 'trust', value: 1 } as const;
  assert.equal(evalStoryCondition(bogus, { trust: 1 }), true);
  try {
    // Temporarily remove equals evaluator to simulate unknown / unregistered.
    storyConditionKinds.clear();
    assert.equal(evalStoryCondition(bogus, { trust: 1 }), false);
    assert.equal(reachChoiceAvailable({ conditions: [bogus] }, { trust: 1 }), false);
  } finally {
    resetBuiltinKinds();
  }
});

test('unknown story effect kind fails closed', () => {
  resetBuiltinKinds();
  const set = { type: 'variable.set' as const, variable: 'trust', value: 2 };
  assert.deepEqual(applyStoryEffect(set, { trust: 0 }), { trust: 2 });
  try {
    storyEffectKinds.clear();
    assert.equal(applyStoryEffect(set, { trust: 0 }), null);
  } finally {
    resetBuiltinKinds();
  }
});

test('unknown world condition kind fails closed', () => {
  resetBuiltinKinds();
  const state = { facts: { door: true }, knownFactIds: [], npcs: {}, elapsed: 0 };
  assert.equal(evalWorldCondition({ kind: 'fact', factId: 'door', value: true }, state), true);
  try {
    worldConditionKinds.clear();
    assert.equal(evalWorldCondition({ kind: 'fact', factId: 'door', value: true }, state), false);
    assert.equal(matchesWorldConditions([{ kind: 'fact', factId: 'door', value: true }], state), false);
  } finally {
    resetBuiltinKinds();
  }
});

test('builtin story condition/effect semantics match prior hard-coded behavior', () => {
  resetBuiltinKinds();
  const vars = { trust: 1, promised: false, name: 'A' };
  assert.equal(evalStoryCondition({ type: 'variable.equals', variable: 'trust', value: 1 }, vars), true);
  assert.equal(evalStoryCondition({ type: 'variable.equals', variable: 'promised', value: true }, vars), false);
  assert.equal(evalStoryCondition({ type: 'variable.gte', variable: 'trust', value: 1 }, vars), true);
  assert.equal(evalStoryCondition({ type: 'variable.gte', variable: 'trust', value: 2 }, vars), false);
  assert.equal(evalStoryCondition({ type: 'variable.gte', variable: 'name', value: 0 }, vars), false);
  assert.equal(evalStoryCondition({ type: 'variable.equals', variable: 'missing', value: 1 }, vars), false);

  assert.deepEqual(applyStoryEffect({ type: 'variable.set', variable: 'promised', value: true }, vars), {
    ...vars, promised: true,
  });
  assert.deepEqual(applyStoryEffect({ type: 'variable.increment', variable: 'trust', value: 2 }, vars), {
    ...vars, trust: 3,
  });
  assert.equal(applyStoryEffect({ type: 'variable.increment', variable: 'name', value: 1 }, vars), null);
  assert.equal(applyStoryEffect({ type: 'variable.set', variable: 'missing', value: 1 }, vars), null);
});

test('map-aware world conditions read POI cell terrain / faction purely', () => {
  resetBuiltinKinds();
  const map = {
    mapSchemaVersion: 1 as const,
    geometry: { kind: 'hex' as const, orientation: 'pointy' as const, cols: 4, rows: 4, size: 24 },
    layers: {
      terrain: { palette: [{ id: 'coast', label: '海岸', color: '#aabbcc' }, { id: 'plains', label: '平原', color: '#aacc88' }], cells: { '0,0': 'coast', '1,0': 'plains' } },
      factions: { factions: [{ id: 'crown', name: '王冠', color: '#3355ff' }], cells: { '0,0': 'crown' } },
    },
    pois: [{ locationId: 'port', anchor: { cell: '0,0' } }, { locationId: 'farm', anchor: { cell: '1,0' } }],
  };
  const base = { facts: {}, knownFactIds: [], npcs: {}, elapsed: 0, map };
  const atPort = { ...base, locationId: 'port' };
  const atFarm = { ...base, locationId: 'farm' };
  assert.equal(evalWorldCondition({ kind: 'at_terrain', terrainIds: ['coast'] }, atPort), true);
  assert.equal(evalWorldCondition({ kind: 'at_terrain', terrainIds: ['coast'] }, atFarm), false);
  assert.equal(evalWorldCondition({ kind: 'at_terrain', terrainIds: ['plains', 'coast'] }, atFarm), true);
  assert.equal(evalWorldCondition({ kind: 'in_faction_territory', factionIds: ['crown'] }, atPort), true);
  assert.equal(evalWorldCondition({ kind: 'in_faction_territory', factionIds: ['crown'] }, atFarm), false);
  // fail closed: unplaced location, no map, no location
  assert.equal(evalWorldCondition({ kind: 'at_terrain', terrainIds: ['coast'] }, { ...base, locationId: 'nowhere' }), false);
  assert.equal(evalWorldCondition({ kind: 'at_terrain', terrainIds: ['coast'] }, { facts: {}, knownFactIds: [], npcs: {}, elapsed: 0, locationId: 'port' }), false);
  assert.equal(evalWorldCondition({ kind: 'in_faction_territory', factionIds: ['crown'] }, base), false);
  assert.equal(worldConditionKinds.get('at_terrain')?.label, '所在地形');
});
