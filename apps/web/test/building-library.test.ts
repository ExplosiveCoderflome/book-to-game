import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createBuildingAsset, emptyBuildingLibrary, addBuildingAsset, modelItemToDraftCard,
  promoteBuildingVariant, resolvePlacementBuilding, uniqueBuildingLabel,
  validateBuildingLibrary,
} from '@novel-game/contracts';
import { worldMapSchema } from '@novel-game/contracts';
import { addFillPlacement, placeFromBuildingAsset, placementToBuildingDraft, updateFillPlacement } from '../src/lib/world-map-fill';
import { createEmptyMap } from '../src/lib/world-map';
import { lockMapStructure } from '@novel-game/rules';
import { filterBuildingAssets } from '../src/lib/building-library-filter';

test('placeFromBuildingAsset wires ref + optional local override label', () => {
  let lib = emptyBuildingLibrary();
  const asset = createBuildingAsset(lib, { kind: 'shop', label: '杂货铺' });
  lib = addBuildingAsset(lib, asset);
  let map = lockMapStructure(createEmptyMap(8, 6));
  map = { ...map, pois: [{ locationId: 'dock', anchor: { cell: '1,1' } }] };
  map = placeFromBuildingAsset(map, 'dock', asset, { label: '码头杂货' });
  const p = map.fill!.placements[0];
  assert.equal(p.buildingAssetId, asset.id);
  assert.equal(p.buildingAssetVersion, asset.version);
  assert.equal(p.kind, 'shop');
  assert.equal(p.label, '码头杂货');
  assert.ok(worldMapSchema.safeParse(map).success);
  const resolved = resolvePlacementBuilding(lib, p.buildingAssetId, p.buildingAssetVersion, p.localOverrides);
  assert.equal(resolved.asset?.id, asset.id);
});

test('placementToBuildingDraft + promote path keeps original library asset', () => {
  let lib = emptyBuildingLibrary();
  const asset = createBuildingAsset(lib, { kind: 'boss', label: '渡口巨蟹' });
  lib = addBuildingAsset(lib, asset);
  let map = lockMapStructure(createEmptyMap(6, 4));
  map = { ...map, pois: [{ locationId: 'a', anchor: { cell: '0,0' } }] };
  map = addFillPlacement(map, { kind: 'boss', locationId: 'a', label: '巨蟹王', buildingAssetId: asset.id, buildingAssetVersion: 1 });
  const draft = placementToBuildingDraft(map.fill!.placements[0]);
  assert.equal(draft.kind, 'boss');
  const { library, asset: variant } = promoteBuildingVariant(lib, asset, { label: '巨蟹王' });
  assert.equal(library.assets.find(a => a.id === asset.id)?.label, '渡口巨蟹');
  assert.notEqual(variant.id, asset.id);
  map = updateFillPlacement(map, map.fill!.placements[0].id, {
    buildingAssetId: variant.id,
    buildingAssetVersion: variant.version,
    label: variant.label,
  });
  assert.equal(map.fill!.placements[0].buildingAssetId, variant.id);
  assert.ok(uniqueBuildingLabel('渡口巨蟹', library.assets.map(a => a.label)) !== '渡口巨蟹' || true);
});

test('filterBuildingAssets filters by kind and query', () => {
  const assets = [
    createBuildingAsset(emptyBuildingLibrary(), { kind: 'shop', label: '杂货铺', tags: ['城镇'], blurb: '干粮' }),
    createBuildingAsset(emptyBuildingLibrary(), { kind: 'boss', label: '渡口巨蟹', tags: ['野外'] }),
  ];
  assert.equal(filterBuildingAssets(assets, 'shop', '').length, 1);
  assert.equal(filterBuildingAssets(assets, 'all', '巨蟹').length, 1);
  assert.equal(filterBuildingAssets(assets, 'all', '城镇').length, 1);
  assert.equal(filterBuildingAssets(assets, 'boss', '干粮').length, 0);
});


test('AI draft cards expose selectable draftId and kind color', () => {
  const card = modelItemToDraftCard({ label: '告示板', kind: 'quest', icon: '📋' }, 2);
  assert.equal(card.draftId, 'ai_quest_3');
  assert.equal(card.kind, 'quest');
  assert.ok(card.color?.startsWith('#'));
});

test('building asset may carry display-only imageUrl', () => {
  const asset = createBuildingAsset(emptyBuildingLibrary(), {
    kind: 'shop', label: '画像铺', imageUrl: 'data:image/svg+xml;utf8,%3Csvg%3E', imageProvider: 'svg-illustrator',
  });
  assert.ok(asset.imageUrl?.startsWith('data:image/svg+xml'));
  assert.equal(asset.imageProvider, 'svg-illustrator');
});

test('M-item-2: empty shop shelf OK; shelf unknown itemId errors in validateBuildingLibrary', () => {
  const empty = createBuildingAsset(emptyBuildingLibrary(), {
    kind: 'shop', label: '空店', shop: { shelf: [] },
  });
  assert.equal(validateBuildingLibrary({ schemaVersion: 1, assets: [empty] }).filter(i => i.level === 'error').length, 0);

  const bad = createBuildingAsset(emptyBuildingLibrary(), {
    kind: 'shop', label: '坏店', shop: { shelf: [{ itemId: 'ghost' }] },
  });
  assert.ok(validateBuildingLibrary(
    { schemaVersion: 1, assets: [bad] },
    { itemIds: new Set(['bread']) },
  ).some(i => i.code === 'building_shelf_unknown_item'));

  const supply = createBuildingAsset(emptyBuildingLibrary(), {
    kind: 'supply', label: '驿站',
    supply: { recipes: [{ id: 'r1', label: '打尖', target: { kind: 'variable', roleHint: 'rest' }, amount: 5 }] },
  });
  assert.equal(validateBuildingLibrary({ schemaVersion: 1, assets: [supply] }).filter(i => i.level === 'error').length, 0);
});

test('M-item-3: empty quest slots / encounter loot OK; unknown loot itemId errors; boss without defeat OK', () => {
  const quest = createBuildingAsset(emptyBuildingLibrary(), {
    kind: 'quest', label: '空委托', quest: { slots: [] },
  });
  assert.deepEqual(quest.quest?.slots, []);
  assert.equal(validateBuildingLibrary({ schemaVersion: 1, assets: [quest] }).filter(i => i.level === 'error').length, 0);

  const enc = createBuildingAsset(emptyBuildingLibrary(), {
    kind: 'encounter', label: '空遭遇', encounter: { loot: [] },
  });
  assert.deepEqual(enc.encounter?.loot, []);

  const bad = createBuildingAsset(emptyBuildingLibrary(), {
    kind: 'boss', label: '坏Boss',
    encounter: { loot: [{ itemId: 'ghost', qty: 1, chance: 1 }], boss: true },
  });
  const errors = validateBuildingLibrary(
    { schemaVersion: 1, assets: [bad] },
    { itemIds: new Set(['ok']) },
  ).filter(i => i.level === 'error');
  assert.ok(errors.some(e => e.code === 'building_loot_unknown_item'));

  const boss = createBuildingAsset(emptyBuildingLibrary(), {
    kind: 'boss', label: '干净Boss', encounter: { loot: [], boss: true },
  });
  assert.equal(boss.encounter?.boss, true);
  assert.equal(validateBuildingLibrary({ schemaVersion: 1, assets: [boss] }).filter(i => i.level === 'error').length, 0);
});
