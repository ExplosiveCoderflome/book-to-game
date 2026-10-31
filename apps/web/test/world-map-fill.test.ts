import assert from 'node:assert/strict';
import { test } from 'node:test';
import { worldMapSchema, type WorldContent } from '@novel-game/contracts';
import { assertMapWriteAllowed, lockMapStructure, projectMapFillIcons, validateWorldMap } from '@novel-game/rules';
import { createEmptyMap, resizeMap, bindLocationToCell } from '../src/lib/world-map';
import { addFillCellMarker, addFillPlacement, addFillRouteMarker, applyMapFillProposal, removeFillMarker, removeFillPlacement, unlockMapStructure, updateFillPlacement } from '../src/lib/world-map-fill';
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

test('M-fill-3a one location holds multiple placements and local overrides stay local', () => {
  let map = lockMapStructure(bindLocationToCell(createEmptyMap(4, 4), 'a', '0,0'));
  map = addFillPlacement(map, {kind: 'shop', locationId: 'a', buildingAssetId: 'shop_base', buildingAssetVersion: 1});
  map = addFillPlacement(map, {kind: 'quest', locationId: 'a'});
  assert.deepEqual(map.fill?.placements.map(placement => placement.id), ['shop_a', 'quest_a']);
  const id = map.fill!.placements[0].id;
  map = updateFillPlacement(map, id, {localOverrides: {label: '本地名', color: '#010203', icon: '铺'}});
  const icon = projectMapFillIcons(map).find(item => item.id === id);
  assert.equal(icon?.label, '本地名');
  assert.equal(icon?.color, '#010203');
  assert.equal(icon?.icon, '铺');
  assert.equal(map.fill?.placements[0].buildingAssetId, 'shop_base');
  assert.ok(worldMapSchema.safeParse(map).success);
});

test('M-fill-5 cell/route helpers preserve fill, warn, and remove cleanly', () => {
  let map = lockMapStructure(bindLocationToCell(createEmptyMap(4, 4), 'a', '0,0'));
  map = addFillCellMarker(map, {kind: 'encounter', cell: '1,0'});
  map = addFillRouteMarker(map, {kind: 'boss', routeId: 'move_a_b'});
  map = addFillPlacement(map, {kind: 'shop', locationId: 'a'});
  assert.ok(worldMapSchema.safeParse(map).success);
  const issues = validateWorldMap(map, ['a'], {routeIds: ['move_a_b'], buildingAssetIds: []});
  assert.equal(issues.filter(issue => issue.code === 'fill_unbound_marker').length, 2);
  assert.ok(issues.filter(issue => issue.code === 'fill_unbound_marker').every(issue => issue.level === 'warning'));
  map = removeFillMarker(map, map.fill!.cellMarkers![0].id);
  map = removeFillMarker(map, map.fill!.routeMarkers![0].id);
  assert.equal(map.fill?.cellMarkers, undefined);
  assert.equal(map.fill?.routeMarkers, undefined);
  assert.equal(map.fill?.placements.length, 1);
});

test('M-fill-4 review apply touches only locked fill and rejects new assets before library review', () => {
  const map = lockMapStructure(bindLocationToCell(createEmptyMap(4, 4), 'a', '0,0'));
  const content: WorldContent = {
    schemaVersion: 1, mode: 'open', title: 't', premise: 'p', playerRole: 'r', goal: 'g', worldRules: [], adaptationNotes: '', sourceChapterIds: [],
    initialLocationId: 'a', timeLimit: 5, timeoutEnding: 'e',
    locations: [{id: 'a', title: 'A', text: 'A', origin: 'adapted', evidence: []}], facts: [], npcs: [], actions: [], events: [],
    endings: [{id: 'e', title: 'e', text: 'e', when: [{kind: 'time', atLeast: 1}]}], map,
  };
  const next = applyMapFillProposal(content, undefined, [
    {proposalId: 'reviewed_shop', kind: 'shop', locationId: 'a', buildingAssetId: 'asset_shop', buildingAssetVersion: 2},
  ]);
  assert.equal(next.map?.fill?.placements[0].id, 'reviewed_shop');
  assert.deepEqual(next.map?.pois, content.map?.pois);
  assert.deepEqual(next.map?.geometry, content.map?.geometry);
  assert.equal(content.map?.fill, undefined, 'input content is not mutated');
  assert.throws(() => applyMapFillProposal(content, undefined, [{
    proposalId: 'new_first', kind: 'shop', locationId: 'a',
    assetDraft: {draftId: 'draft_shop', kind: 'shop', label: '新店'},
  }]), /先经建筑库审核/);
  assert.equal(content.map?.fill, undefined, 'rejected review has zero residue');
});
