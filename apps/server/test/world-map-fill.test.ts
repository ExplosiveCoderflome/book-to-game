import assert from 'node:assert/strict';
import { test } from 'node:test';
import { worldEffectSchema, worldMapSchema, type WorldMap } from '@novel-game/contracts';
import {
  assertMapWriteAllowed, isStructureLocked, lockMapStructure, unlockMapStructure,
  validateWorldMap, worldEffectKinds,
} from '@novel-game/rules';

const base: WorldMap = {
  mapSchemaVersion: 1,
  geometry: { kind: 'hex', orientation: 'pointy', cols: 6, rows: 4, size: 28 },
  layers: { terrain: { palette: [{ id: 'plain', label: '平原', color: '#c8e6c9' }], cells: { '0,0': 'plain' } } },
  pois: [{ locationId: 'a', anchor: { cell: '0,0' } }],
};

test('fill + structureLocked schema: optional, closed kinds, rejects unknown kind', () => {
  assert.ok(worldMapSchema.safeParse(base).success);
  const locked = lockMapStructure(base);
  assert.ok(worldMapSchema.safeParse(locked).success);
  assert.ok(worldMapSchema.safeParse({
    ...locked,
    fill: {
      placements: [
        { id: 'shop_a', kind: 'shop', locationId: 'a', label: '杂货铺' },
        { id: 'boss_a', kind: 'boss', locationId: 'a' },
      ],
      cellMarkers: [{ id: 'road_1', kind: 'encounter', cell: '1,0' }],
    },
  }).success);
  assert.equal(worldMapSchema.safeParse({
    ...base, fill: { placements: [{ id: 'x', kind: 'tavern', locationId: 'a' }] },
  }).success, false);
});

test('structure lock gate: refuse size/poi/layer edits; allow fill/fog/unlock', () => {
  const locked = lockMapStructure(base);
  assert.equal(isStructureLocked(locked), true);
  assert.equal(assertMapWriteAllowed(locked, { ...locked, geometry: { ...locked.geometry, cols: 8 } }).ok, false);
  assert.equal(assertMapWriteAllowed(locked, { ...locked, pois: [] }).ok, false);
  assert.equal(assertMapWriteAllowed(locked, {
    ...locked,
    layers: { terrain: { palette: locked.layers.terrain!.palette, cells: { '0,0': 'plain', '1,0': 'plain' } } },
  }).ok, false);
  assert.equal(assertMapWriteAllowed(locked, undefined).ok, false);

  const withFill = { ...locked, fill: { placements: [{ id: 'shop_a', kind: 'shop' as const, locationId: 'a' }] } };
  assert.equal(assertMapWriteAllowed(locked, withFill).ok, true);
  assert.equal(assertMapWriteAllowed(locked, { ...locked, fog: true }).ok, true);
  assert.equal(assertMapWriteAllowed(locked, unlockMapStructure(locked)).ok, true);
  assert.equal(assertMapWriteAllowed(base, { ...base, geometry: { ...base.geometry, cols: 8 } }).ok, true);
});

test('validateWorldMap fill: missing location error, unbound warning, cell marker warning', () => {
  const map: WorldMap = {
    ...lockMapStructure(base),
    fill: {
      placements: [
        { id: 'ok', kind: 'shop', locationId: 'a' },
        { id: 'ghost', kind: 'quest', locationId: 'missing' },
        { id: 'loose', kind: 'supply', locationId: 'b' },
      ],
      cellMarkers: [{ id: 'm1', kind: 'encounter', cell: '2,0' }],
    },
  };
  const codes = validateWorldMap(map, ['a', 'b']).map(i => i.code).sort();
  assert.ok(codes.includes('fill_missing_location'));
  assert.ok(codes.includes('fill_unbound_location'));
  assert.ok(codes.includes('fill_unbound_marker'));
  assert.ok(!codes.includes('fill_duplicate_id'));
});

test('start_encounter stub registered and schema-valid; no other fill kinds in effects', () => {
  assert.ok(worldEffectKinds.get('start_encounter'));
  assert.ok(worldEffectSchema.safeParse({ kind: 'start_encounter', label: '野狼' }).success);
  assert.ok(worldEffectSchema.safeParse({ kind: 'start_encounter', placementId: 'boss_a' }).success);
});
