import assert from 'node:assert/strict';
import { test } from 'node:test';
import { worldContentSchema, worldMapSchema } from '@novel-game/contracts';
import { cellKey, hexDistance, listHexCells, offsetToAxial, axialToOffset, validateWorldMap } from '@novel-game/rules';

const map = {
  mapSchemaVersion: 1, geometry: { kind: 'hex', orientation: 'pointy', cols: 6, rows: 4, size: 28 }, layers: {},
  pois: [{ locationId: 'a', anchor: { cell: '0,0' } }, { locationId: 'ghost', anchor: { cell: '1,0' } }],
} as const;

test('world map schema: versioned, hex geometry, rejects bad keys/versions/sizes', () => {
  assert.ok(worldMapSchema.safeParse(map).success);
  assert.equal(worldMapSchema.safeParse({ ...map, mapSchemaVersion: 2 }).success, false);
  assert.equal(worldMapSchema.safeParse({ ...map, geometry: { ...map.geometry, cols: 65 } }).success, false);
  assert.equal(worldMapSchema.safeParse({ ...map, pois: [{ locationId: 'a', anchor: { cell: 'x' } }] }).success, false);
  assert.equal(worldMapSchema.safeParse({ ...map, geometry: { kind: 'voronoi' } }).success, false);
});

test('worldContentSchema: map optional (absent ok) and parsed when present', () => {
  const shape = worldContentSchema.shape.map;
  assert.ok(shape.safeParse(undefined).success);
  assert.ok(shape.safeParse(map).success);
});

test('hex offset<->axial round-trip and distance', () => {
  for (const orientation of ['pointy', 'flat'] as const) {
    const g = { kind: 'hex' as const, orientation, cols: 5, rows: 4, size: 20 };
    const cells = listHexCells(g);
    assert.equal(cells.length, 20);
    assert.equal(new Set(cells.map(cellKey)).size, 20);
    for (let row = 0; row < 4; row++) for (let col = 0; col < 5; col++) assert.deepEqual(axialToOffset(g, offsetToAxial(g, col, row)), { col, row });
  }
  assert.equal(hexDistance({ q: 0, r: 0 }, { q: 2, r: -1 }), 2);
});

test('validateWorldMap: missing location, unbound, duplicate, out of bounds, shared cell', () => {
  const issues = validateWorldMap({ ...map, pois: [...map.pois,
    { locationId: 'a', anchor: { cell: '2,0' } }, { locationId: 'b', anchor: { cell: '40,0' } }, { locationId: 'c', anchor: { cell: '1,0' } }] }, ['a', 'b', 'c', 'd']);
  const codes = issues.map(i => i.code).sort();
  assert.deepEqual(codes, ['location_unbound', 'poi_cell_shared', 'poi_duplicate_location', 'poi_missing_location', 'poi_out_of_bounds']);
  assert.equal(issues.find(i => i.code === 'location_unbound')?.locationId, 'd');
  assert.equal(issues.find(i => i.code === 'location_unbound')?.level, 'warning');
  assert.deepEqual(validateWorldMap({ ...map, pois: [{ locationId: 'a', anchor: { cell: '0,0' } }] }, ['a']), []);
});
