import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateWorldbookContent, worldMapSchema, type WorldCondition, type WorldMap, type Worldbook } from '@novel-game/contracts';
import { entriesForPlace, evalWorldCondition, geometryFor, locationDistance, locationSpatial, registeredGeometryKinds, validateWorldMap, worldConditionKinds, worldbookBlockReason } from '@novel-game/rules';

const map: WorldMap = {
  mapSchemaVersion: 1,
  geometry: { kind: 'hex', orientation: 'pointy', cols: 6, rows: 4, size: 28 },
  layers: {
    terrain: { palette: [{ id: 'plain', label: '平原', color: '#aabbcc' }], cells: { '0,0': 'plain' } },
    regions: { regions: [{ id: 'north', name: '北境', color: '#336699', tags: ['wild'] }, { id: 'south', name: '南境', color: '#993366' }], cells: { '0,0': 'north', '2,0': 'south' } },
  },
  pois: [{ locationId: 'a', anchor: { cell: '0,0' } }, { locationId: 'b', anchor: { cell: '2,0' } }, { locationId: 'c', anchor: { cell: '1,1' } }],
};

test('map schema: legacy maps without regions still parse; region layer parses', () => {
  assert.ok(worldMapSchema.safeParse({ ...map, layers: {} }).success);
  assert.ok(worldMapSchema.safeParse(map).success);
  assert.equal(worldMapSchema.safeParse({ ...map, geometry: { ...map.geometry, kind: 'square' } }).success, false);
});

test('geometry adapter seam: hex registered; neighbors/distance/inBounds', () => {
  assert.deepEqual(registeredGeometryKinds(), ['hex']);
  const g = geometryFor(map)!;
  assert.equal(g.kind, 'hex');
  assert.equal(g.listCells().length, 24);
  assert.equal(g.distance('0,0', '2,0'), 2);
  assert.ok(g.neighbors('0,0').every(c => g.inBounds(c)));
  assert.equal(g.inBounds('99,99'), false);
  assert.equal(locationDistance(map, 'a', 'b'), 2);
});

test('locationSpatial resolves terrain/region; unplaced → empty', () => {
  assert.deepEqual(locationSpatial(map, 'a'), { cell: '0,0', terrainId: 'plain', factionId: undefined, regionIds: ['north'] });
  assert.deepEqual(locationSpatial(map, 'c').regionIds, []);
  assert.deepEqual(locationSpatial(map, 'zzz'), { regionIds: [] });
  assert.deepEqual(locationSpatial(undefined, 'a'), { regionIds: [] });
});

test('in_region kind registered and evaluated through geometry seam', () => {
  assert.ok(worldConditionKinds.get('in_region'));
  const base = { facts: {}, knownFactIds: [], npcs: {}, elapsed: 0, map } as never as Parameters<typeof evalWorldCondition>[1];
  const cond: WorldCondition = { kind: 'in_region', regionIds: ['north'] };
  assert.equal(evalWorldCondition(cond, { ...base, locationId: 'a' }), true);
  assert.equal(evalWorldCondition(cond, { ...base, locationId: 'b' }), false);
  assert.equal(evalWorldCondition(cond, { ...base, locationId: 'c' }), false);
  assert.equal(evalWorldCondition(cond, { ...base, locationId: 'a', map: undefined }), false);
});

test('region layer validation flags unknown region ids', () => {
  const bad: WorldMap = { ...map, layers: { ...map.layers, regions: { regions: map.layers.regions!.regions, cells: { '0,0': 'ghost' } } } };
  assert.ok(validateWorldMap(bad, ['a', 'b', 'c']).some(i => i.code === 'layer_unknown_region'));
});

test('worldbook region scope: selection + hard rules + validation', () => {
  const wb: Worldbook = { entries: [{ id: 'n', title: '北境寒律', keys: [], content: '北境禁火', kind: 'rule', scope: { type: 'regions', regionIds: ['north'] },
    constraints: [{ type: 'forbid_choice_tags', tags: ['fire'], message: '北境禁止生火' }] }] };
  assert.equal(entriesForPlace(wb, 'a', 'location', { regionIds: locationSpatial(map, 'a').regionIds }).length, 1);
  assert.equal(entriesForPlace(wb, 'b', 'location', { regionIds: locationSpatial(map, 'b').regionIds }).length, 0);
  assert.equal(entriesForPlace(wb, 'a', 'location').length, 0, 'no ctx → region entries inactive');
  assert.equal(worldbookBlockReason({ id: 'x', tags: ['fire'] }, 'a', {}, wb, [], 'location', { regionIds: ['north'] }), '北境禁止生火');
  const v = validateWorldbookContent({ worldbook: { entries: [{ ...wb.entries[0], scope: { type: 'regions', regionIds: ['ghost'] } }] }, regionIds: new Set(['north']), variables: {}, choiceTags: new Set(['fire']) });
  assert.ok(v.errors.some(e => e.includes('ghost')));
});
