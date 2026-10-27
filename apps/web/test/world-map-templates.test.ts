import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAP_TEMPLATES, getMapTemplate, worldMapSchema } from '@novel-game/contracts';
import { validateWorldMap } from '@novel-game/rules';
import { applyMapTemplate, createEmptyMap, resizeMapEdge, setPoiVenueType } from '../src/lib/world-map';

test('ships three valid genre map templates', () => {
  assert.deepEqual(MAP_TEMPLATES.map(t => t.id), ['fantasy_xianxia', 'urban_modern', 'post_apocalyptic']);
  const city = getMapTemplate('urban_modern')!;
  for (const d of ['住宅区', '商业区', '工业区', '码头', '公园', '水域', '贫民窟']) assert.ok(city.terrain.some(t => t.label === d), d);
});

test('apply template only adds missing entries and never renames', () => {
  const city = getMapTemplate('urban_modern')!;
  let map = createEmptyMap(8, 6);
  map = { ...map, layers: { terrain: { palette: [{ id: 'docks', label: '我的码头', color: '#000000' }], cells: { '0,0': 'docks' } } } };
  const r = applyMapTemplate(map, city);
  assert.equal(r.map.layers.terrain!.palette.find(p => p.id === 'docks')!.label, '我的码头');
  assert.equal(r.map.layers.terrain!.palette.length, city.terrain.length);
  assert.equal(r.map.venueTypes!.length, city.venueTypes.length);
  assert.equal(r.map.mapTemplate!.mapTemplateId, 'urban_modern');
  assert.equal(applyMapTemplate(r.map, city).added, 0);
  worldMapSchema.parse(r.map);
});

test('edge resize shifts content on left/top and keeps it on right/bottom', () => {
  let map = createEmptyMap(4, 4);
  map = { ...map, layers: { terrain: { palette: [{ id: 'a', label: 'A', color: '#111111' }], cells: { '0,0': 'a' } } }, pois: [{ locationId: 'x', anchor: { cell: '0,0' } }] };
  const left = resizeMapEdge(map, 'left', 2);
  assert.equal(left.geometry.cols, 6); assert.equal(left.pois[0].anchor.cell, '2,0'); assert.deepEqual(left.layers.terrain!.cells, { '2,0': 'a' });
  const top = resizeMapEdge(map, 'top', 2);
  assert.equal(top.geometry.rows, 6); assert.deepEqual(validateWorldMap(top, ['x']).filter(i => i.level === 'error'), []);
  const right = resizeMapEdge(map, 'right', -1); assert.equal(right.geometry.cols, 3); assert.equal(right.pois[0].anchor.cell, '0,0');
  const shrinkLeft = resizeMapEdge(map, 'left', -1);
  assert.ok(validateWorldMap(shrinkLeft, ['x']).some(i => i.code === 'poi_out_of_bounds'));
});

test('venue type must exist in map.venueTypes', () => {
  const base = { ...createEmptyMap(4, 4), pois: [{ locationId: 'x', anchor: { cell: '1,1' } }] };
  const bad = setPoiVenueType(base, 'x', 'hospital');
  assert.ok(validateWorldMap(bad, ['x']).some(i => i.code === 'poi_unknown_venue'));
  const ok = applyMapTemplate(bad, getMapTemplate('urban_modern')!).map;
  assert.ok(!validateWorldMap(ok, ['x']).some(i => i.code === 'poi_unknown_venue'));
});
