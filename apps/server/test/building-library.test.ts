import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  addBuildingAsset, buildingLibrarySchema, createBuildingAsset, draftCardToAssetDraft,
  emptyBuildingLibrary, modelItemToDraftCard, promoteBuildingVariant, uniqueBuildingLabel,
  updateBuildingAsset, validateBuildingLibrary, type BuildingLibrary,
} from '@novel-game/contracts';
import { ItemCatalogService, SqliteItemCatalogRepository } from '../src/modules/item-catalog/index.js';
import { validateWorldMap } from '@novel-game/rules';
import { openDatabase } from '../src/platform/database.js';
import {
  acceptBuildingDrafts, BuildingLibraryService, proposeBuildingAssets, SqliteBuildingLibraryRepository,
  type BuildingDraftModel,
} from '../src/modules/building-library/index.js';

test('uniqueBuildingLabel suffixes · 2 without renaming existing', () => {
  assert.equal(uniqueBuildingLabel('杂货铺', []), '杂货铺');
  assert.equal(uniqueBuildingLabel('杂货铺', ['杂货铺']), '杂货铺 · 2');
  assert.equal(uniqueBuildingLabel('杂货铺', ['杂货铺', '杂货铺 · 2']), '杂货铺 · 3');
  assert.equal(uniqueBuildingLabel(' 铁匠 ', ['铁匠']), '铁匠 · 2');
});

test('uniqueBuildingId falls back to kind for CJK labels', () => {
  const a = createBuildingAsset(emptyBuildingLibrary(), { kind: 'shop', label: '杂货铺' });
  assert.equal(a.id, 'shop');
  const lib = addBuildingAsset(emptyBuildingLibrary(), a);
  const b = createBuildingAsset(lib, { kind: 'shop', label: '杂货铺' });
  assert.equal(b.id, 'shop_2');
  assert.equal(b.label, '杂货铺 · 2');
});

test('createBuildingAsset never overwrites id; promote creates new variant', () => {
  let lib = emptyBuildingLibrary();
  const a = createBuildingAsset(lib, { kind: 'shop', label: '杂货铺' });
  lib = addBuildingAsset(lib, a);
  const b = createBuildingAsset(lib, { kind: 'shop', label: '杂货铺' });
  assert.equal(b.label, '杂货铺 · 2');
  assert.notEqual(b.id, a.id);
  lib = addBuildingAsset(lib, b);
  assert.throws(() => addBuildingAsset(lib, a));

  const { library, asset } = promoteBuildingVariant(lib, a, { label: '码头杂货' });
  assert.notEqual(asset.id, a.id);
  assert.equal(asset.version, a.version + 1);
  assert.ok(asset.label.includes('码头杂货') || asset.label.startsWith('码头杂货'));
  assert.equal(library.assets.length, 3);
  assert.ok(library.assets.some(x => x.id === a.id && x.label === '杂货铺'));
});

test('updateBuildingAsset renames with unique suffix; schema round-trip', () => {
  let lib = emptyBuildingLibrary();
  const a = createBuildingAsset(lib, { kind: 'supply', label: '水井' });
  lib = addBuildingAsset(lib, a);
  const b = createBuildingAsset(lib, { kind: 'supply', label: '泉眼' });
  lib = addBuildingAsset(lib, b);
  lib = updateBuildingAsset(lib, b.id, { label: '水井' });
  const renamed = lib.assets.find(x => x.id === b.id)!;
  assert.equal(renamed.label, '水井 · 2');
  assert.ok(buildingLibrarySchema.safeParse(lib).success);
});

test('sqlite building library CRUD + conflict', () => {
  const db = openDatabase(':memory:');
  const svc = new BuildingLibraryService(new SqliteBuildingLibraryRepository(db));
  assert.equal(svc.get().revision, 0);
  assert.equal(svc.get().library.assets.length, 0);
  const created = svc.createAsset({ kind: 'quest', label: '告示板' }, 0);
  assert.equal(created.revision, 1);
  assert.equal(created.asset.label, '告示板');
  const again = svc.createAsset({ kind: 'quest', label: '告示板' }, 1);
  assert.equal(again.asset.label, '告示板 · 2');
  assert.throws(() => svc.createAsset({ kind: 'quest', label: 'x' }, 1)); // stale revision
  const promoted = svc.promoteVariant(created.asset.id, { label: '西城告示板' }, again.revision);
  assert.notEqual(promoted.asset.id, created.asset.id);
  svc.deleteAsset(again.asset.id, promoted.revision);
  assert.ok(!svc.get().library.assets.some(a => a.id === again.asset.id));
});

test('validateWorldMap fill_unknown_building: warning without catalog, error with catalog', () => {
  const map = {
    mapSchemaVersion: 1 as const,
    geometry: { kind: 'hex' as const, orientation: 'pointy' as const, cols: 4, rows: 3, size: 24 },
    layers: {},
    pois: [{ locationId: 'a', anchor: { cell: '0,0' as const } }],
    fill: { placements: [{ id: 'p1', kind: 'shop' as const, locationId: 'a', buildingAssetId: 'missing_shop' }] },
  };
  assert.ok(validateWorldMap(map, ['a']).some(i => i.code === 'fill_unknown_building' && i.level === 'warning'));
  assert.ok(validateWorldMap(map, ['a'], { buildingAssetIds: new Set() }).some(i => i.code === 'fill_unknown_building' && i.level === 'error'));
  assert.ok(!validateWorldMap(map, ['a'], { buildingAssetIds: new Set(['missing_shop']) }).some(i => i.code === 'fill_unknown_building'));
});

test('modelItemToDraftCard + draftCardToAssetDraft round-trip shape', () => {
  const card = modelItemToDraftCard({
    label: '盐沼杂货', kind: 'shop', tags: ['城镇'], icon: '🏪',
    blurb: '卖干粮', interactLabel: '购物', inventory: ['干粮', '绳索'],
  }, 0);
  assert.equal(card.draftId, 'ai_shop_1');
  assert.equal(card.defaultInteract?.label, '购物');
  assert.equal(card.inventoryDraft?.[0].label, '干粮');
  const draft = draftCardToAssetDraft(card);
  assert.equal(draft.kind, 'shop');
  assert.equal(draft.provenance?.source, 'ai-propose');
});

test('proposeBuildingAssets (mock) is read-only; accept writes with · N', async () => {
  const db = openDatabase(':memory:');
  const svc = new BuildingLibraryService(new SqliteBuildingLibraryRepository(db));
  svc.createAsset({ kind: 'shop', label: '杂货铺' }, 0);

  const model: BuildingDraftModel = {
    async proposeBuildings() {
      return {
        buildings: [
          { label: '杂货铺', kind: 'shop', blurb: '重复名应在入库时加后缀' },
          { label: '铁匠铺', kind: 'shop', interactLabel: '打铁' },
          { label: '野外狼群', kind: 'encounter' }, // will be filtered by kinds
        ],
      };
    },
  };

  const before = svc.get().revision;
  const proposal = await proposeBuildingAssets(
    svc,
    { prompt: '城镇商店', kinds: ['shop'], count: 4 },
    model,
    AbortSignal.timeout(2000),
    'mock-buildings',
  );
  assert.equal(svc.get().revision, before, 'propose must not write library');
  assert.equal(proposal.model, 'mock-buildings');
  assert.equal(proposal.drafts.length, 2);
  assert.ok(proposal.warnings.some(w => w.includes('过滤')));

  const accepted = acceptBuildingDrafts(svc, {
    expectedRevision: svc.get().revision,
    drafts: proposal.drafts,
  });
  assert.equal(accepted.assets.length, 2);
  const labels = accepted.library.assets.map(a => a.label).sort();
  assert.ok(labels.includes('杂货铺'));
  assert.ok(labels.includes('杂货铺 · 2') || labels.includes('铁匠铺'));
  assert.ok(labels.includes('铁匠铺'));
  assert.equal(labels.filter(l => l.startsWith('杂货铺')).length, 2);
});

test('SvgBuildingImageProvider is deterministic for same seed inputs', async () => {
  const { SvgBuildingImageProvider, hashSeed } = await import('../src/modules/building-library/index.js');
  const p = new SvgBuildingImageProvider();
  const req = {
    prompt: 'shop', label: '杂货铺', kind: 'shop' as const, tags: ['城镇'], color: '#c9a227',
    width: 256, height: 256, seed: hashSeed(['杂货铺', 'shop', '城镇']),
  };
  const a = await p.generate(req);
  const b = await p.generate(req);
  assert.equal(a.mimeType, 'image/svg+xml');
  assert.equal(a.provider, 'svg-illustrator');
  assert.deepEqual(Buffer.from(a.data), Buffer.from(b.data));
  const svg = Buffer.from(a.data).toString('utf8');
  assert.match(svg, /杂货铺/);
  assert.match(svg, /<svg /);
});

test('BuildingImageService writes SVG data URL onto asset without touching play state', async () => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const dir = mkdtempSync(path.join(tmpdir(), 'btg-bimg-'));
  const media = path.join(dir, 'building-images');
  const db = openDatabase(':memory:');
  const svc = new BuildingLibraryService(new SqliteBuildingLibraryRepository(db));
  const { BuildingImageService, SvgBuildingImageProvider, createBuildingImageProvider } = await import('../src/modules/building-library/index.js');
  const svg = new SvgBuildingImageProvider();
  const images = new BuildingImageService(svc, svg, media, svg);
  const created = svc.createAsset({ kind: 'shop', label: '码头杂货' }, 0);
  const out = await images.generateForAsset({ assetId: created.asset.id, expectedRevision: created.revision, preferSvg: true });
  assert.ok(out.asset.imageUrl?.startsWith('data:image/svg+xml'));
  assert.equal(out.asset.imageProvider, 'svg-illustrator');
  assert.ok(out.image.imagePath?.includes('building-images/'));
  const preview = await images.preview({ label: '告示板', kind: 'quest', preferSvg: true });
  assert.ok(preview.imageUrl.startsWith('data:image/svg+xml'));
  // conflict
  await assert.rejects(() => images.generateForAsset({ assetId: created.asset.id, expectedRevision: 0 }), /建筑库已更新|BUILDING_LIBRARY_CONFLICT/);
});

test('createBuildingImageProvider falls back to svg when IMAGE_MODEL unset', async () => {
  const { createBuildingImageProvider } = await import('../src/modules/building-library/index.js');
  const { provider } = createBuildingImageProvider({ ...process.env, IMAGE_MODEL: '' });
  const result = await provider.generate({
    prompt: 'test', label: '水井', kind: 'supply', width: 128, height: 128,
  });
  assert.equal(result.provider, 'svg-illustrator');
});

test('empty shop.shelf / supply.recipes legal in Catalog; unknown itemId errors', () => {
  let lib = emptyBuildingLibrary();
  const shopEmpty = createBuildingAsset(lib, {
    kind: 'shop',
    label: '空货架杂货',
    shop: { shelf: [], buyback: false, categoryFilters: ['consumable'] },
  });
  lib = addBuildingAsset(lib, shopEmpty);
  assert.deepEqual(shopEmpty.shop?.shelf, []);
  assert.ok(buildingLibrarySchema.safeParse(lib).success);
  assert.equal(validateBuildingLibrary(lib, { itemIds: new Set() }).filter(i => i.level === 'error').length, 0);

  const supplyEmpty = createBuildingAsset(lib, {
    kind: 'supply',
    label: '空配方旅店',
    supply: { recipes: [] },
  });
  lib = addBuildingAsset(lib, supplyEmpty);
  assert.deepEqual(supplyEmpty.supply?.recipes, []);

  // Unknown itemId → error when itemIds provided
  const badShop = createBuildingAsset(lib, {
    kind: 'shop',
    label: '坏货架',
    shop: { shelf: [{ itemId: 'missing_item', price: { amount: 3, roleHint: 'primary_coin' } }] },
  });
  const withBad = { ...lib, assets: [...lib.assets, badShop] };
  const errors = validateBuildingLibrary(withBad, { itemIds: new Set(['rations']) })
    .filter(i => i.level === 'error');
  assert.ok(errors.some(e => e.code === 'building_shelf_unknown_item'));

  // Known itemId OK; price without resourceId OK
  const goodShop = createBuildingAsset(emptyBuildingLibrary(), {
    kind: 'shop',
    label: '好货架',
    shop: { shelf: [{ itemId: 'rations', price: { amount: 2, roleHint: 'primary_coin' } }] },
  });
  assert.equal(
    validateBuildingLibrary(
      { schemaVersion: 1, assets: [goodShop] },
      { itemIds: new Set(['rations']) },
    ).filter(i => i.level === 'error').length,
    0,
  );
});

test('supply recipe roleHint-only target OK; target.name warns world-bind', () => {
  const roleOnly = createBuildingAsset(emptyBuildingLibrary(), {
    kind: 'supply',
    label: '轻疗所',
    supply: {
      recipes: [{
        id: 'heal_light_1',
        label: '简单包扎',
        role: 'heal_light',
        target: { kind: 'variable', roleHint: 'heal_light' },
        amount: 10,
        cost: { amount: 5, roleHint: 'primary_coin' },
      }],
    },
  });
  const issuesOk = validateBuildingLibrary(
    { schemaVersion: 1, assets: [roleOnly] },
    { itemIds: new Set() },
  );
  assert.equal(issuesOk.filter(i => i.level === 'error').length, 0);
  assert.ok(!issuesOk.some(i => i.code === 'building_recipe_world_bind_required'));

  const named = createBuildingAsset(emptyBuildingLibrary(), {
    kind: 'supply',
    label: '写死气血',
    supply: {
      recipes: [{
        id: 'qi_1',
        label: '回气',
        target: { kind: 'variable', name: 'qi', roleHint: 'heal_light' },
        amount: 20,
      }],
    },
  });
  const issuesWarn = validateBuildingLibrary({ schemaVersion: 1, assets: [named] });
  assert.ok(issuesWarn.some(i => i.code === 'building_recipe_world_bind_required' && i.level === 'warning'));
  // Must NOT error just because name is a genre var — Catalog allows it with warning
  assert.equal(issuesWarn.filter(i => i.level === 'error').length, 0);
});

test('sqlite building library persists shop/supply; rejects unknown itemId', () => {
  const db = openDatabase(':memory:');
  const items = new ItemCatalogService(new SqliteItemCatalogRepository(db));
  const bread = items.createAsset({ category: 'consumable', label: '面包', preferredId: 'bread' }, 0);
  const svc = new BuildingLibraryService(
    new SqliteBuildingLibraryRepository(db),
    () => items.itemIds(),
  );
  const emptyShop = svc.createAsset({
    kind: 'shop', label: '空店', shop: { shelf: [] },
  }, 0);
  assert.deepEqual(emptyShop.asset.shop?.shelf, []);

  assert.throws(() => svc.createAsset({
    kind: 'shop',
    label: '悬空店',
    shop: { shelf: [{ itemId: 'nope' }] },
  }, emptyShop.revision));

  const withShelf = svc.createAsset({
    kind: 'shop',
    label: '面包店',
    shop: {
      shelf: [{ itemId: bread.asset.id, price: { amount: 4, roleHint: 'primary_coin' }, stockMax: 10 }],
      categoryFilters: ['consumable'],
    },
  }, emptyShop.revision);
  assert.equal(withShelf.asset.shop?.shelf[0]?.itemId, 'bread');
  assert.equal(withShelf.asset.shop?.shelf[0]?.price?.amount, 4);

  const supply = svc.createAsset({
    kind: 'supply',
    label: '驿站',
    supply: {
      recipes: [{
        id: 'rest_1', label: '打尖', role: 'rest',
        target: { kind: 'variable', roleHint: 'rest' },
        amount: 15,
        requiresItemId: bread.asset.id,
      }],
    },
  }, withShelf.revision);
  assert.equal(supply.asset.supply?.recipes[0]?.role, 'rest');

  // inventoryDraft transitional still works alongside hard shop
  const hybrid = svc.updateAsset(withShelf.asset.id, {
    inventoryDraft: [{ label: '旧草稿干粮' }],
    version: (withShelf.asset.version ?? 1) + 1,
  }, supply.revision);
  const updated = hybrid.library.assets.find(a => a.id === withShelf.asset.id)!;
  assert.equal(updated.inventoryDraft?.[0]?.label, '旧草稿干粮');
  assert.equal(updated.shop?.shelf[0]?.itemId, 'bread');
});

test('deleting item blocked when shop.shelf hard-ref exists', () => {
  const db = openDatabase(':memory:');
  let buildings: Array<{ id: string; shop?: { shelf?: Array<{ itemId?: string }> } }> = [];
  const items = new ItemCatalogService(new SqliteItemCatalogRepository(db), () => buildings);
  const bread = items.createAsset({ category: 'consumable', label: '面包', preferredId: 'bread' }, 0);
  const svc = new BuildingLibraryService(
    new SqliteBuildingLibraryRepository(db),
    () => items.itemIds(),
  );
  const shop = svc.createAsset({
    kind: 'shop', label: '店', shop: { shelf: [{ itemId: 'bread' }] },
  }, 0);
  buildings = svc.get().library.assets;
  assert.throws(() => items.deleteAsset('bread', bread.revision));
  // Clear hard ref then delete OK
  const cleared = svc.updateAsset(shop.asset.id, { shop: { shelf: [] }, version: 2 }, shop.revision);
  buildings = cleared.library.assets;
  const after = items.deleteAsset('bread', items.get().revision);
  assert.ok(!after.catalog.items.some(i => i.id === 'bread'));
});

test('M-item-3: empty quest.slots / encounter.loot legal; unknown loot/giveItems itemId errors; boss without defeat flag OK', () => {
  const emptyQuest = createBuildingAsset(emptyBuildingLibrary(), {
    kind: 'quest',
    label: '空告示板',
    quest: { slots: [] },
  });
  assert.deepEqual(emptyQuest.quest?.slots, []);
  assert.equal(
    validateBuildingLibrary({ schemaVersion: 1, assets: [emptyQuest] }, { itemIds: new Set() })
      .filter(i => i.level === 'error').length,
    0,
  );

  const emptyEnc = createBuildingAsset(emptyBuildingLibrary(), {
    kind: 'encounter',
    label: '空遭遇',
    encounter: { loot: [], trigger: { preference: 'enter_location' } },
  });
  assert.deepEqual(emptyEnc.encounter?.loot, []);
  assert.equal(
    validateBuildingLibrary({ schemaVersion: 1, assets: [emptyEnc] }).filter(i => i.level === 'error').length,
    0,
  );

  // Boss without defeat flag — schema has no defeatFlag; must parse + validate OK
  const boss = createBuildingAsset(emptyBuildingLibrary(), {
    kind: 'boss',
    label: '狼王巢',
    encounter: {
      loot: [],
      packTag: 'tag:wolf_king',
      boss: true,
    },
  });
  assert.equal(boss.encounter?.boss, true);
  assert.ok(!('defeatFlag' in (boss.encounter ?? {})));
  assert.equal(
    validateBuildingLibrary({ schemaVersion: 1, assets: [boss] }).filter(i => i.level === 'error').length,
    0,
  );

  const badLoot = createBuildingAsset(emptyBuildingLibrary(), {
    kind: 'encounter',
    label: '坏掉落',
    encounter: { loot: [{ itemId: 'ghost_loot', qty: 1, chance: 0.5 }] },
  });
  const lootErrors = validateBuildingLibrary(
    { schemaVersion: 1, assets: [badLoot] },
    { itemIds: new Set(['rations']) },
  ).filter(i => i.level === 'error');
  assert.ok(lootErrors.some(e => e.code === 'building_loot_unknown_item'));

  const badGive = createBuildingAsset(emptyBuildingLibrary(), {
    kind: 'quest',
    label: '坏交付',
    quest: {
      slots: [{
        label: '交狼牙',
        markerTag: 'tag:side_hunt',
        giveItems: [{ itemId: 'missing_fang', qty: 1 }],
      }],
    },
  });
  const giveErrors = validateBuildingLibrary(
    { schemaVersion: 1, assets: [badGive] },
    { itemIds: new Set(['rations']) },
  ).filter(i => i.level === 'error');
  assert.ok(giveErrors.some(e => e.code === 'building_quest_give_unknown_item'));

  // questId placeholder → warning only, not error
  const withQuestId = createBuildingAsset(emptyBuildingLibrary(), {
    kind: 'quest',
    label: '有占位',
    quest: { slots: [{ label: '主线', questId: 'quest_wolf_started', markerTag: 'tag:main' }] },
  });
  const qIssues = validateBuildingLibrary({ schemaVersion: 1, assets: [withQuestId] });
  assert.ok(qIssues.some(i => i.code === 'building_quest_world_bind_required' && i.level === 'warning'));
  assert.equal(qIssues.filter(i => i.level === 'error').length, 0);
});

test('sqlite building library persists quest/encounter; rejects unknown loot itemId; lootDraft transitional', () => {
  const db = openDatabase(':memory:');
  const items = new ItemCatalogService(new SqliteItemCatalogRepository(db));
  const fang = items.createAsset({ category: 'quest', label: '狼牙', preferredId: 'wolf_fang' }, 0);
  const svc = new BuildingLibraryService(
    new SqliteBuildingLibraryRepository(db),
    () => items.itemIds(),
  );

  const quest = svc.createAsset({
    kind: 'quest',
    label: '委托处',
    quest: {
      slots: [{
        label: '侧线狩猎',
        markerTag: 'tag:side_hunt',
        giveItems: [{ itemId: fang.asset.id, qty: 3 }],
        rewards: { items: [{ itemId: fang.asset.id, qty: 1 }] },
      }],
    },
  }, 0);
  assert.equal(quest.asset.quest?.slots[0]?.markerTag, 'tag:side_hunt');
  assert.equal(quest.asset.quest?.slots[0]?.giveItems?.[0]?.itemId, 'wolf_fang');

  assert.throws(() => svc.createAsset({
    kind: 'encounter',
    label: '悬空遭遇',
    encounter: { loot: [{ itemId: 'nope', qty: 1, chance: 1 }] },
  }, quest.revision));

  const enc = svc.createAsset({
    kind: 'encounter',
    label: '路边伏击',
    encounter: {
      loot: [{ itemId: fang.asset.id, qty: { min: 1, max: 2 }, chance: 0.75, resourceDrops: [{ amount: 5, roleHint: 'primary_coin' }] }],
      trigger: { preference: 'enter_location' },
      packTag: 'tag:road_ambush',
    },
    lootDraft: [{ label: '旧草稿掉落' }],
  }, quest.revision);
  assert.equal(enc.asset.encounter?.loot[0]?.itemId, 'wolf_fang');
  assert.equal(enc.asset.lootDraft?.[0]?.label, '旧草稿掉落');

  const boss = svc.createAsset({
    kind: 'boss',
    label: '狼王',
    encounter: { loot: [{ itemId: fang.asset.id, qty: 1, chance: 1 }], boss: true },
  }, enc.revision);
  assert.equal(boss.asset.encounter?.boss, true);
  // No defeat flag required — create succeeds without any defeat field
  assert.ok(boss.asset.encounter && !('defeatFlag' in boss.asset.encounter));
});

test('deleting item blocked when encounter.loot / quest.giveItems hard-ref exists', () => {
  const db = openDatabase(':memory:');
  let buildings: Array<{
    id: string;
    quest?: { slots?: Array<{ giveItems?: Array<{ itemId?: string }> }> };
    encounter?: { loot?: Array<{ itemId?: string }> };
  }> = [];
  const items = new ItemCatalogService(new SqliteItemCatalogRepository(db), () => buildings);
  const fang = items.createAsset({ category: 'material', label: '狼牙', preferredId: 'wolf_fang' }, 0);
  const svc = new BuildingLibraryService(
    new SqliteBuildingLibraryRepository(db),
    () => items.itemIds(),
  );
  const enc = svc.createAsset({
    kind: 'encounter', label: '伏击', encounter: { loot: [{ itemId: 'wolf_fang', qty: 1, chance: 1 }] },
  }, 0);
  buildings = svc.get().library.assets;
  assert.throws(() => items.deleteAsset('wolf_fang', fang.revision));
  const cleared = svc.updateAsset(enc.asset.id, { encounter: { loot: [] }, version: 2 }, enc.revision);
  buildings = cleared.library.assets;
  const after = items.deleteAsset('wolf_fang', items.get().revision);
  assert.ok(!after.catalog.items.some(i => i.id === 'wolf_fang'));
});
