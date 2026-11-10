import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { SqliteDatabase as Database } from '../src/platform/database.js';
import { WorldService, SqliteWorldRepository } from '../src/modules/worlds/index.js';
import { AdventureService, SqliteAdventureRepository } from '../src/modules/adventure-sessions/index.js';
import { source, content } from './helpers/open-fixture.js';
import { createBuildingAsset, type BuildingLibrary, type WorldContent, type WorldMap } from '@novel-game/contracts';
import { exploreLocation, lockMapStructure, revealAround } from '@novel-game/rules';

import { playMap } from './helpers/map-fixture.js';
import { startRuntimeWorld as startWith } from './helpers/runtime-revision-fixture.js';
const input = (actionId: string, expectedTurn: number) => ({ actionId, expectedTurn, requestId: randomUUID() });

test('revealAround: cell + radius-1 neighbours, clipped to bounds', () => {
  assert.equal(revealAround(playMap(), '3,2').length, 7);
  assert.ok(revealAround(playMap(), '0,0').length < 7);
  assert.deepEqual(revealAround(playMap(), '99,99'), []);
});

test('play map view: HUD spatial status, reachable destinations, fog grows with visits; authored map untouched', () => {
  const world = { ...content(), map: playMap() };
  const authored = structuredClone(world.map);
  const { db, adventures, revision, view } = startWith(world);
  try {
    assert.ok(view.map);
    assert.equal(view.map.cell, '1,1');
    assert.deepEqual(view.map.terrain, { id: 'coast', label: '海岸' });
    assert.deepEqual(view.map.faction, { id: 'crown', name: '王冠' });
    assert.deepEqual(view.map.regions, [{ id: 'west', name: '西岸' }]);
    assert.deepEqual(view.map.reachable.map(r => r.locationId), ['market']);
    assert.equal(view.map.fog, true);
    const first = view.map.explored!.length;
    assert.ok(view.map.explored!.includes('1,1') && !view.map.explored!.includes('4,2'));
    const moved = adventures.act(view.id, input('to_market', 0));
    assert.equal(moved.map?.cell, '4,2');
    assert.ok(moved.map!.explored!.includes('1,1') && moved.map!.explored!.includes('4,2'));
    assert.ok(moved.map!.explored!.length > first);
    assert.deepEqual(revision.content.map, authored);
  } finally { db.close(); }
});

test('no map → no map view; fog off → no explored list', () => {
  const a = startWith(content()); try { assert.equal(a.view.map, undefined); } finally { a.db.close(); }
  const b = startWith({ ...content(), map: playMap(false) }); try { assert.equal(b.view.map?.fog, false); assert.equal(b.view.map?.explored, undefined); } finally { b.db.close(); }
});

test('exploreLocation is pure and idempotent', () => {
  const world = { map: playMap() };
  const once = exploreLocation(undefined, world, 'dock');
  assert.equal(exploreLocation(once, world, 'dock'), once);
  assert.deepEqual(exploreLocation(once, world, 'nowhere'), once);
});

test('M-fill-3b play icons resolve catalog color/overrides and fog hides sensitive icons', () => {
  const shop = createBuildingAsset({schemaVersion: 1, assets: []}, {kind: 'shop', label: '库内商店', color: '#123456', icon: '商'});
  const library: BuildingLibrary = {schemaVersion: 1, assets: [shop]};
  const map = lockMapStructure(playMap());
  map.fill = {
    placements: [
      {id: 'visible_shop', kind: 'shop', locationId: 'dock', buildingAssetId: shop.id, buildingAssetVersion: 1, localOverrides: {label: '渡口小店'}},
      {id: 'hidden_boss', kind: 'boss', locationId: 'market', label: '秘密Boss'},
    ],
    cellMarkers: [{id: 'roadside', kind: 'encounter', cell: '1,1'}],
    routeMarkers: [{id: 'route_encounter', kind: 'encounter', routeId: 'to_market'}],
  };
  const {db, adventures, view} = startWith({...content(), map}, {buildingLibrary: () => library});
  try {
    assert.deepEqual(view.map?.fillIcons?.map(icon => icon.id), ['visible_shop', 'roadside']);
    assert.equal(view.map?.fillIcons?.some(icon => icon.id === 'route_encounter'), false);
    assert.equal(view.map?.fillIcons?.[0].color, '#123456');
    assert.equal(view.map?.fillIcons?.[0].icon, '商');
    assert.equal(view.map?.fillIcons?.[0].label, '渡口小店');
    const moved = adventures.act(view.id, input('to_market', 0));
    assert.ok(moved.map?.fillIcons?.some(icon => icon.id === 'hidden_boss'));
    assert.ok(moved.map?.fillIcons?.some(icon => icon.id === 'visible_shop'));
    assert.equal(moved.map?.fillIcons?.find(icon => icon.id === 'route_encounter')?.illustrative, true);
    assert.equal(moved.actions.every(action => action.id !== 'start_encounter'), true, 'icons are not out-of-engine actions');
  } finally { db.close(); }
});
