import assert from 'node:assert/strict';
import { test } from 'node:test';
import { worldMapSchema } from '@novel-game/contracts';
import { validateWorldMap } from '@novel-game/rules';
import { bindLocationToCell, createEmptyMap, resizeMap, unbindLocation } from '../src/lib/world-map';

test('createEmptyMap parses and clamps size', () => {
  const m = createEmptyMap(999, 0);
  assert.equal(m.geometry.cols, 64); assert.equal(m.geometry.rows, 1);
  assert.ok(worldMapSchema.safeParse(createEmptyMap()).success);
});

test('bind moves a single POI per location and ignores out-of-bounds cells', () => {
  let m = createEmptyMap(4, 4);
  m = bindLocationToCell(m, 'inn', '0,0');
  m = bindLocationToCell(m, 'inn', '1,1');
  assert.deepEqual(m.pois, [{ locationId: 'inn', anchor: { cell: '1,1' } }]);
  assert.equal(bindLocationToCell(m, 'gate', '99,0'), m);
  assert.equal(unbindLocation(m, 'inn').pois.length, 0);
});

test('resize keeps POIs so validation reports out-of-bounds instead of silently dropping', () => {
  let m = bindLocationToCell(createEmptyMap(8, 8), 'inn', '5,5');
  m = resizeMap(m, 3, 3);
  assert.equal(m.pois.length, 1);
  assert.ok(validateWorldMap(m, ['inn']).some(i => i.code === 'poi_out_of_bounds'));
});
