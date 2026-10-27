import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { content } from './helpers/open-fixture.js';
import type { WorldContent } from '@novel-game/contracts';
import { worldContentSchema } from '@novel-game/contracts';
import { applySetFactionRelation, applyTerritoryOverlay, effectiveRelation, evalWorldCondition, worldConditionKinds, worldEffectKinds } from '@novel-game/rules';
import { playMap, startWith } from './helpers/map-fixture.js';

const input = (actionId: string, expectedTurn: number) => ({ actionId, expectedTurn, requestId: randomUUID() });

function world(): WorldContent {
  const w = content();
  w.map = playMap(false);
  w.resources = { crown_troops: 100 };
  w.map.layers.factions!.factions[0].stats = [{ label: '兵力', resourceId: 'crown_troops' }];
  w.factionRelations = [{ a: 'crown', b: 'pact', stance: 'neutral', standing: 10 }];
  // Taking the market move also flips the whole west region to the pact and sours relations.
  const move = w.actions.find(a => a.id === 'to_market')!;
  move.effects = [...move.effects, { kind: 'set_territory', factionId: 'pact', regionId: 'west' }, { kind: 'set_faction_relation', a: 'pact', b: 'crown', stance: 'hostile', standingDelta: -60 }];
  w.actions.push({ ...move, id: 'parley', label: '谈判', locationId: 'market', effects: [{ kind: 'set', factId: 'bell', value: true }],
    availableWhen: [{ kind: 'faction_relation', a: 'crown', b: 'pact', stances: ['hostile'], atMost: -20 }] });
  return w;
}

test('kinds registered via KindRegistry', () => {
  assert.ok(worldConditionKinds.get('faction_relation') && worldConditionKinds.get('npc_at_location'));
  assert.ok(worldEffectKinds.get('set_territory') && worldEffectKinds.get('set_faction_relation'));
  assert.equal(worldContentSchema.safeParse({ ...world(), actions: [{ ...world().actions[0], effects: [{ kind: 'set_territory', factionId: 'pact' }] }, ...world().actions.slice(1)] }).success, false);
});

test('overlay helpers are pure; relation effective = override ?? authored ?? neutral', () => {
  const m = playMap(false); const before = structuredClone(m);
  const out = applyTerritoryOverlay(m, { '1,1': 'pact', '4,2': '' });
  assert.equal(out.layers.factions!.cells['1,1'], 'pact'); assert.equal(out.layers.factions!.cells['4,2'], undefined);
  assert.deepEqual(m, before);
  const w = world();
  assert.deepEqual(effectiveRelation(w, undefined, 'pact', 'crown'), { stance: 'neutral', standing: 10 });
  const o = applySetFactionRelation(w, undefined, { kind: 'set_faction_relation', a: 'crown', b: 'pact', standingDelta: -500 });
  assert.equal(o['crown|pact'].standing, -100);
  assert.equal(evalWorldCondition({ kind: 'faction_relation', a: 'crown', b: 'pact', atMost: -50 }, { facts: {}, knownFactIds: [], npcs: {}, elapsed: 0, relationOverlay: o }), true);
  assert.equal(evalWorldCondition({ kind: 'npc_at_location', npcId: 'keeper', locationId: 'dock' }, { facts: {}, knownFactIds: [], npcs: { keeper: { locationId: 'dock', knownFactIds: [] } as never }, elapsed: 0 }), true);
});

test('session: set_territory + set_faction_relation change play view only; authored revision untouched; conditions see overlay', () => {
  const { db, adventures, revision, view } = startWith(world());
  try {
    assert.equal(view.map?.faction?.id, 'crown');
    assert.deepEqual(view.map?.relations?.[0], { a: 'crown', b: 'pact', stance: 'neutral', standing: 10 });
    const v2 = adventures.act(view.id, input('to_market', 0));
    assert.equal(v2.map?.territory?.['1,1'], 'pact');
    assert.deepEqual(v2.map?.relations?.[0], { a: 'crown', b: 'pact', stance: 'hostile', standing: -50 });
    assert.ok(v2.actions.some(a => a.id === 'parley'), 'faction_relation condition sees session relation');
    assert.equal(revision.content.map!.layers.factions!.cells['1,1'], 'crown');
    assert.equal(adventures.get(view.id).map?.territory?.['1,1'], 'pact', 'overlay persisted in session');
  } finally { db.close(); }
});
