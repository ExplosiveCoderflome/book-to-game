import assert from 'node:assert/strict';
import { test } from 'node:test';
import { worldMapSchema } from '@novel-game/contracts';
import { assertMapWriteAllowed, lockMapStructure, validateWorldMap } from '@novel-game/rules';
import { createEmptyMap, resizeMap, bindLocationToCell } from '../src/lib/world-map';
import { addFillPlacement, removeFillPlacement, unlockMapStructure } from '../src/lib/world-map-fill';
import { paintCells, addPaletteEntry } from '../src/lib/world-map-edit';

test('fill placements: add/remove round-trip; schema accepts', () => {
  let m = bindLocationToCell(createEmptyMap(4, 4), 'dock', '0,0');
  m = lockMapStructure(m);
  m = addFillPlacement(m, { kind: 'shop', locationId: 'dock', label: '码头杂货' });
  m = addFillPlacement(m, { kind: 'encounter', locationId: 'dock' });
  assert.equal(m.fill?.placements.length, 2);
  assert.ok(worldMapSchema.safeParse(m).success);
  const id = m.fill!.placements[0].id;
  m = removeFillPlacement(m, id);
  assert.equal(m.fill?.placements.length, 1);
  m = removeFillPlacement(m, m.fill!.placements[0].id);
  assert.equal(m.fill, undefined);
});

test('locked map: resize/paint/bind refused by gate; unlock restores', () => {
  let m = bindLocationToCell(createEmptyMap(4, 4), 'a', '0,0');
  const t = addPaletteEntry(m, 'terrain', '林'); m = t.map;
  m = paintCells(m, 'terrain', ['0,0'], t.id);
  m = lockMapStructure(m);
  assert.equal(assertMapWriteAllowed(m, resizeMap(m, 8, 4)).ok, false);
  assert.equal(assertMapWriteAllowed(m, paintCells(m, 'terrain', ['1,0'], t.id)).ok, false);
  assert.equal(assertMapWriteAllowed(m, bindLocationToCell(m, 'b', '1,0')).ok, false);
  const filled = addFillPlacement(m, { kind: 'boss', locationId: 'a', label: '渡口巨蟹' });
  assert.equal(assertMapWriteAllowed(m, filled).ok, true);
  const unlocked = unlockMapStructure(filled);
  assert.equal(assertMapWriteAllowed(unlocked, resizeMap(unlocked, 8, 4)).ok, true);
  assert.ok(validateWorldMap(filled, ['a']).every(i => i.code !== 'fill_missing_location'));
});
