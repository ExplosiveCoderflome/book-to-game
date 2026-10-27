import assert from 'node:assert/strict';
import { test } from 'node:test';
import { worldMapSchema } from '@novel-game/contracts';
import { hexToPixel } from '@novel-game/rules';
import { createEmptyMap } from '../src/lib/world-map';
import {
  addPaletteEntry, cellsInRadius, countUsage, deletePaletteEntry, floodFill, paintCells, pixelToHex,
  pushHistory, redoHistory, undoHistory, updatePaletteEntry, layerCentroids,
} from '../src/lib/world-map-edit';

test('brush radius covers 1 / 7 / 19 cells away from edges and clips at bounds', () => {
  const g = createEmptyMap(10, 10).geometry;
  const c = { q: 3, r: 4 };
  assert.equal(cellsInRadius(g, c, 0).length, 1);
  assert.equal(cellsInRadius(g, c, 1).length, 7);
  assert.equal(cellsInRadius(g, c, 2).length, 19);
  assert.ok(cellsInRadius(g, { q: 0, r: 0 }, 1).length < 7);
});

test('pixelToHex inverts hexToPixel', () => {
  const g = createEmptyMap(10, 10).geometry;
  for (const a of [{ q: 0, r: 0 }, { q: 3, r: 4 }, { q: -2, r: 7 }]) {
    const p = hexToPixel(g, a); assert.deepEqual(pixelToHex(g, p.x + 3, p.y - 2), a);
  }
});

test('paint, flood fill, erase on terrain layer', () => {
  let m = createEmptyMap(4, 4);
  const add = addPaletteEntry(m, 'terrain', '森林'); m = add.map;
  m = floodFill(m, 'terrain', '0,0', add.id);
  assert.equal(countUsage(m, 'terrain', add.id), 16);
  const sea = addPaletteEntry(m, 'terrain', '海'); m = sea.map;
  m = paintCells(m, 'terrain', ['0,0', '1,0'], sea.id);
  assert.equal(countUsage(m, 'terrain', sea.id), 2);
  m = floodFill(m, 'terrain', '0,0', null);
  assert.equal(countUsage(m, 'terrain', sea.id), 0);
  assert.equal(paintCells(m, 'terrain', ['0,0'], null), m, 'no-op returns same object');
  assert.ok(worldMapSchema.safeParse(m).success);
});

test('delete palette entry reassigns or clears explicitly; rename keeps id', () => {
  let m = createEmptyMap(3, 3);
  const a = addPaletteEntry(m, 'faction', '王冠'); m = a.map;
  const b = addPaletteEntry(m, 'faction', '盟约'); m = b.map;
  m = paintCells(m, 'faction', ['0,0', '1,0'], a.id);
  m = updatePaletteEntry(m, 'faction', a.id, { label: '蓝冠', color: '#112233' });
  assert.equal(m.layers.factions?.factions[0].id, a.id);
  assert.equal(m.layers.factions?.factions[0].name, '蓝冠');
  const re = deletePaletteEntry(m, 'faction', a.id, b.id);
  assert.equal(countUsage(re, 'faction', b.id), 2);
  const cl = deletePaletteEntry(m, 'faction', a.id, null);
  assert.equal(Object.keys(cl.layers.factions!.cells).length, 0);
});

test('undo/redo history', () => {
  const m0 = createEmptyMap(2, 2); const m1 = createEmptyMap(3, 3);
  let h = pushHistory({ past: [], future: [] }, m0);
  const u = undoHistory(h, m1)!; assert.equal(u.map, m0); h = u.h;
  const r = redoHistory(h, m0)!; assert.equal(r.map, m1);
  assert.equal(undoHistory({ past: [], future: [] }, m0), null);
});

test('region layer: paint/fill/palette/delete-reassign share the generic path', () => {
  const base = { mapSchemaVersion: 1 as const, geometry: { kind: 'hex' as const, orientation: 'pointy' as const, cols: 4, rows: 3, size: 20 }, layers: {}, pois: [] };
  const a = addPaletteEntry(base, 'region', '北境');
  const b = addPaletteEntry(a.map, 'region', '南境');
  let m = paintCells(b.map, 'region', ['0,0', '1,0'], a.id);
  m = floodFill(m, 'region', '2,0', b.id);
  assert.equal(countUsage(m, 'region', a.id), 2);
  assert.equal(countUsage(m, 'region', b.id), 10);
  m = updatePaletteEntry(m, 'region', a.id, { label: '北境林地' });
  assert.equal(m.layers.regions?.regions.find(r => r.id === a.id)?.name, '北境林地');
  m = deletePaletteEntry(m, 'region', a.id, b.id);
  assert.equal(countUsage(m, 'region', b.id), 12);
  assert.equal(m.layers.regions?.regions.length, 1);
  const c = layerCentroids(m, 'region', () => ({ x: 1, y: 2 }));
  assert.deepEqual(c.get(b.id), { x: 1, y: 2, n: 12 });
});
