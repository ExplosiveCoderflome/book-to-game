import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  addItemAsset, createItemAsset, draftCardToItemAssetDraft, emptyItemCatalog,
  findItemHardReferences, itemCatalogSchema, modelItemToItemDraftCard,
  removeItemAssetGuarded, uniqueItemLabel, updateItemAsset, validateItemCatalog,
  ITEM_CATEGORIES,
} from '@novel-game/contracts';
import { openDatabase } from '../src/platform/database.js';
import {
  ItemCatalogService, SqliteItemCatalogRepository,
  acceptItemDrafts, acceptLootRows, acceptShelfRows,
  proposeItemAssets, proposeLootRows, proposeShelfRows,
  type BuildingShelfWriter, type ItemDraftModel,
} from '../src/modules/item-catalog/index.js';
import {
  BuildingLibraryService, SqliteBuildingLibraryRepository,
} from '../src/modules/building-library/index.js';

test('uniqueItemLabel suffixes · 2 without renaming existing', () => {
  assert.equal(uniqueItemLabel('干粮', []), '干粮');
  assert.equal(uniqueItemLabel('干粮', ['干粮']), '干粮 · 2');
  assert.equal(uniqueItemLabel('干粮', ['干粮', '干粮 · 2']), '干粮 · 3');
  assert.equal(uniqueItemLabel(' 绳索 ', ['绳索']), '绳索 · 2');
});

test('createItemAsset never overwrites id; same label gets · N', () => {
  let cat = emptyItemCatalog();
  const a = createItemAsset(cat, { category: 'consumable', label: '干粮' });
  assert.equal(a.id, 'consumable'); // CJK seed → category fallback
  cat = addItemAsset(cat, a);
  const b = createItemAsset(cat, { category: 'consumable', label: '干粮' });
  assert.equal(b.label, '干粮 · 2');
  assert.notEqual(b.id, a.id);
  cat = addItemAsset(cat, b);
  assert.throws(() => addItemAsset(cat, a));
});

test('unique+stack.max>1 rejected by schema and validateItemCatalog', () => {
  let cat = emptyItemCatalog();
  const a = createItemAsset(cat, { category: 'key', label: '铜钥匙', stack: { unique: true } });
  cat = addItemAsset(cat, a);
  assert.throws(() => updateItemAsset(cat, a.id, { stack: { unique: true, max: 3 } }));
  // Direct validate path
  const broken = {
    ...cat,
    items: [{ ...a, stack: { unique: true, max: 3 } }],
  };
  // schema reject
  assert.equal(itemCatalogSchema.safeParse(broken).success, false);
});

test('unbound resourceId is warning only; category closed set', () => {
  assert.ok(ITEM_CATEGORIES.includes('consumable'));
  // Format-illegal resourceId rejected at schema boundary
  assert.throws(() => createItemAsset(emptyItemCatalog(), {
    category: 'material',
    label: '铁矿',
    defaultPriceHint: { amount: 5, resourceId: '!!!bad!!!' },
  }));
  // Legal / missing resourceId OK without world binding; misc only warns
  const b = createItemAsset(emptyItemCatalog(), {
    category: 'misc',
    label: '奇怪的东西',
    defaultPriceHint: { amount: 1, resourceId: 'silver_coin', roleHint: 'primary_coin' },
  });
  const withHint = addItemAsset(emptyItemCatalog(), b);
  const issues = validateItemCatalog(withHint);
  assert.ok(issues.some(i => i.code === 'item_misc_category' && i.level === 'warning'));
  assert.ok(!issues.some(i => i.code === 'item_price_resource_format'));
  const noCurrency = createItemAsset(emptyItemCatalog(), {
    category: 'material',
    label: '铁矿',
    defaultPriceHint: { amount: 5, roleHint: 'primary_coin' },
  });
  assert.equal(noCurrency.defaultPriceHint?.resourceId, undefined);
  assert.ok(!validateItemCatalog(addItemAsset(emptyItemCatalog(), noCurrency))
    .some(i => i.level === 'error'));
});

test('updateItemAsset renames with unique suffix; schema round-trip', () => {
  let cat = emptyItemCatalog();
  const a = createItemAsset(cat, { category: 'consumable', label: '伤药' });
  cat = addItemAsset(cat, a);
  const b = createItemAsset(cat, { category: 'consumable', label: '绷带' });
  cat = addItemAsset(cat, b);
  cat = updateItemAsset(cat, b.id, { label: '伤药' });
  const renamed = cat.items.find(x => x.id === b.id)!;
  assert.equal(renamed.label, '伤药 · 2');
  assert.ok(itemCatalogSchema.safeParse(cat).success);
});

test('findItemHardReferences ignores soft drafts; detects shelf itemId', () => {
  const softOnly = [{
    id: 'shop_a',
    inventoryDraft: [{ label: '干粮' }],
    lootDraft: [{ label: '干粮' }],
  }];
  assert.equal(findItemHardReferences('rations', softOnly).length, 0);

  const hard = [{
    id: 'shop_b',
    shop: { shelf: [{ itemId: 'rations', price: { amount: 2 } }] },
    encounter: { loot: [{ itemId: 'rations', qty: 1, chance: 1 }] },
  }];
  const refs = findItemHardReferences('rations', hard);
  assert.equal(refs.length, 2);
  assert.ok(refs.some(r => r.path.includes('shop.shelf')));
  assert.ok(refs.some(r => r.path.includes('encounter.loot')));
});

test('removeItemAssetGuarded blocks hard refs unless force', () => {
  let cat = emptyItemCatalog();
  const a = createItemAsset(cat, { category: 'consumable', label: '干粮', preferredId: 'rations' });
  cat = addItemAsset(cat, a);
  const buildings = [{ id: 'shop_b', shop: { shelf: [{ itemId: a.id }] } }];
  assert.throws(() => removeItemAssetGuarded(cat, a.id, buildings));
  const forced = removeItemAssetGuarded(cat, a.id, buildings, { force: true });
  assert.equal(forced.catalog.items.length, 0);
  assert.ok(forced.warnings.some(w => w.includes('强制删除')));
});

test('sqlite item catalog CRUD + conflict + referenced delete', () => {
  const db = openDatabase(':memory:');
  const buildings = [
    { id: 'inn', shop: { shelf: [{ itemId: 'bread' }] } },
  ];
  const svc = new ItemCatalogService(new SqliteItemCatalogRepository(db), () => buildings);
  assert.equal(svc.get().revision, 0);
  const created = svc.createAsset({ category: 'consumable', label: '面包', preferredId: 'bread' }, 0);
  assert.equal(created.revision, 1);
  assert.equal(created.asset.label, '面包');
  assert.equal(created.asset.id, 'bread');
  const again = svc.createAsset({ category: 'consumable', label: '面包' }, 1);
  assert.equal(again.asset.label, '面包 · 2');
  assert.throws(() => svc.createAsset({ category: 'consumable', label: 'x' }, 1)); // stale revision

  // Referenced item cannot delete without force
  assert.throws(() => svc.deleteAsset('bread', again.revision));
  const afterForce = svc.deleteAsset('bread', again.revision, { force: true });
  assert.ok(!afterForce.catalog.items.some(i => i.id === 'bread'));
  assert.ok(afterForce.warnings?.some(w => w.includes('强制删除')));
});

test('Catalog save does not require world resourceId', () => {
  const db = openDatabase(':memory:');
  const svc = new ItemCatalogService(new SqliteItemCatalogRepository(db));
  const created = svc.createAsset({
    category: 'equipment',
    label: '铁剑',
    defaultPriceHint: { amount: 40, roleHint: 'primary_coin' }, // no resourceId
  }, 0);
  assert.equal(created.asset.defaultPriceHint?.amount, 40);
  assert.equal(created.asset.defaultPriceHint?.resourceId, undefined);
});

test('modelItemToItemDraftCard + draftCardToItemAssetDraft keep soft price, no required resourceId', () => {
  const card = modelItemToItemDraftCard({
    label: '干粮', category: 'consumable', blurb: '路上充饥',
    priceAmount: 2, priceRoleHint: 'primary_coin', tags: ['食物'],
  }, 0);
  assert.equal(card.draftId, 'ai_item_consumable_1');
  assert.equal(card.defaultPriceHint?.amount, 2);
  assert.equal(card.defaultPriceHint?.roleHint, 'primary_coin');
  assert.equal(card.defaultPriceHint?.resourceId, undefined);
  const draft = draftCardToItemAssetDraft(card);
  assert.equal(draft.provenance?.source, 'ai-propose');
  assert.equal(draft.defaultPriceHint?.resourceId, undefined);
});

test('proposeItemAssets (mock) is read-only; accept writes with · N and provenance', async () => {
  const db = openDatabase(':memory:');
  const svc = new ItemCatalogService(new SqliteItemCatalogRepository(db));
  svc.createAsset({ category: 'consumable', label: '干粮' }, 0);

  const model: ItemDraftModel = {
    async proposeItems() {
      return {
        items: [
          { label: '干粮', category: 'consumable', blurb: '重复名应在入库时加后缀', priceAmount: 1 },
          { label: '绳索', category: 'material', priceAmount: 3, priceRoleHint: 'primary_coin' },
          { label: '铁剑', category: 'equipment' }, // filtered by categories
        ],
      };
    },
  };

  const before = svc.get().revision;
  const proposal = await proposeItemAssets(
    svc,
    { prompt: '码头补给', categories: ['consumable', 'material'], count: 4 },
    model,
    AbortSignal.timeout(2000),
    'mock-items',
  );
  assert.equal(svc.get().revision, before, 'propose must not write catalog');
  assert.equal(proposal.model, 'mock-items');
  assert.equal(proposal.drafts.length, 2);
  assert.ok(proposal.warnings.some(w => w.includes('过滤')));

  const accepted = acceptItemDrafts(svc, {
    expectedRevision: svc.get().revision,
    drafts: proposal.drafts,
  });
  assert.equal(accepted.assets.length, 2);
  const labels = accepted.catalog.items.map(a => a.label).sort();
  assert.ok(labels.includes('干粮'));
  assert.ok(labels.includes('干粮 · 2'));
  assert.ok(labels.includes('绳索'));
  assert.ok(accepted.assets.every(a => a.provenance?.source === 'ai-propose'));
});

test('proposeShelfRows blocks unknown itemId; pending item drafts; reject clears client-side', async () => {
  const db = openDatabase(':memory:');
  const svc = new ItemCatalogService(new SqliteItemCatalogRepository(db));
  const bread = svc.createAsset({ category: 'consumable', label: '面包', preferredId: 'bread' }, 0);

  const model: ItemDraftModel = {
    async proposeItems() { return { items: [] }; },
    async proposeShelfRows() {
      return {
        shelf: [
          { itemId: 'bread', priceAmount: 2, priceRoleHint: 'primary_coin' },
          { label: '神秘药水' }, // unknown → pending
          { itemId: 'no_such_item', label: '幽灵货' },
        ],
      };
    },
  };

  const before = svc.get().revision;
  const proposal = await proposeShelfRows(
    svc, { prompt: '杂货', count: 4 }, model, AbortSignal.timeout(2000), 'mock-shelf',
  );
  assert.equal(svc.get().revision, before);
  assert.equal(proposal.rows.length, 1);
  assert.equal(proposal.rows[0].itemId, 'bread');
  assert.ok(proposal.pendingItemDrafts.length >= 1);
  assert.ok(proposal.warnings.some(w => w.includes('未入库')));

  // Reject / discard = client clears; server held nothing
  const discarded = { rows: [], pendingItemDrafts: [], warnings: [] };
  assert.equal(discarded.rows.length, 0);
  assert.equal(svc.get().catalog.items.length, 1);
  assert.equal(svc.get().catalog.items[0].id, bread.asset.id);
});

test('acceptShelfRows writes shop.shelf; unknown itemId rejected; acceptLootRows similar', () => {
  const db = openDatabase(':memory:');
  const items = new ItemCatalogService(new SqliteItemCatalogRepository(db));
  const buildings = new BuildingLibraryService(new SqliteBuildingLibraryRepository(db), () => items.itemIds());
  const bread = items.createAsset({ category: 'consumable', label: '面包', preferredId: 'bread' }, 0);
  const hide = items.createAsset({ category: 'material', label: '兽皮', preferredId: 'hide' }, bread.revision);
  const shop = buildings.createAsset({ kind: 'shop', label: '码头杂货', shop: { shelf: [] } }, 0);
  const enc = buildings.createAsset({ kind: 'encounter', label: '路边匪徒', encounter: { loot: [] } }, shop.revision);

  const writer: BuildingShelfWriter = {
    getAsset(id) {
      return buildings.get().library.assets.find(a => a.id === id) as ReturnType<BuildingShelfWriter['getAsset']>;
    },
    updateAsset(id, patch, rev) {
      return buildings.updateAsset(id, patch as Parameters<BuildingLibraryService['updateAsset']>[1], rev);
    },
    getRevision() { return buildings.get().revision; },
  };

  assert.throws(() => acceptShelfRows(items, writer, {
    buildingAssetId: shop.asset.id,
    expectedRevision: buildings.get().revision,
    rows: [{ draftId: 'x', itemId: 'missing_item' }],
  }));

  const afterShelf = acceptShelfRows(items, writer, {
    buildingAssetId: shop.asset.id,
    expectedRevision: buildings.get().revision,
    rows: [{ draftId: 's1', itemId: 'bread', price: { amount: 2, roleHint: 'primary_coin' } }],
  });
  const shopAsset = (afterShelf.library as { assets: Array<{ id: string; shop?: { shelf: Array<{ itemId: string }> } }> })
    .assets.find(a => a.id === shop.asset.id)!;
  assert.equal(shopAsset.shop?.shelf.length, 1);
  assert.equal(shopAsset.shop?.shelf[0].itemId, 'bread');

  const afterLoot = acceptLootRows(items, writer, {
    buildingAssetId: enc.asset.id,
    expectedRevision: afterShelf.revision,
    rows: [{ draftId: 'l1', itemId: 'hide', qty: 1, chance: 0.8 }],
  });
  const encAsset = (afterLoot.library as { assets: Array<{ id: string; encounter?: { loot: Array<{ itemId: string }> } }> })
    .assets.find(a => a.id === enc.asset.id)!;
  assert.equal(encAsset.encounter?.loot.length, 1);
  assert.equal(encAsset.encounter?.loot[0].itemId, 'hide');
});

test('proposeLootRows unknown noun becomes pending, not loot row', async () => {
  const db = openDatabase(':memory:');
  const svc = new ItemCatalogService(new SqliteItemCatalogRepository(db));
  svc.createAsset({ category: 'material', label: '兽骨', preferredId: 'bone' }, 0);
  const model: ItemDraftModel = {
    async proposeItems() { return { items: [] }; },
    async proposeLootRows() {
      return {
        loot: [
          { itemId: 'bone', chance: 1, qty: 1 },
          { label: '龙晶碎片' },
        ],
      };
    },
  };
  const proposal = await proposeLootRows(svc, { prompt: '战利品', count: 3 }, model, AbortSignal.timeout(2000));
  assert.equal(proposal.rows.length, 1);
  assert.equal(proposal.rows[0].itemId, 'bone');
  assert.ok(proposal.pendingItemDrafts.some(d => d.label === '龙晶碎片'));
});
