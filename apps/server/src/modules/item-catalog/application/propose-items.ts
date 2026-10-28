import {
  acceptItemDraftsInputSchema,
  acceptLootRowsInputSchema,
  acceptShelfRowsInputSchema,
  draftCardToItemAssetDraft,
  itemDraftModelOutputSchema,
  lootDraftModelOutputSchema,
  lootDraftRowToLootLine,
  modelItemToItemDraftCard,
  proposeItemAssetsInputSchema,
  proposeLootRowsInputSchema,
  proposeShelfRowsInputSchema,
  shelfDraftModelOutputSchema,
  shelfDraftRowToShelfLine,
  type AcceptItemDraftsInput,
  type AcceptLootRowsInput,
  type AcceptShelfRowsInput,
  type ItemAsset,
  type ItemCatalogView,
  type ItemDraftCard,
  type ItemDraftProposal,
  type LootDraftProposal,
  type LootDraftRowCard,
  type ProposeItemAssetsInput,
  type ProposeLootRowsInput,
  type ProposeShelfRowsInput,
  type ShelfDraftProposal,
  type ShelfDraftRow,
  ITEM_CATEGORIES,
  itemCategorySchema,
} from '@novel-game/contracts';
import { AppError } from '../../../shared/errors.js';
import type { ItemCatalogService } from './catalog-service.js';

/** AI adapter seam for item proposals. Implementations only propose; nothing here writes the catalog. */
export interface ItemDraftModel {
  proposeItems(
    input: {
      prompt: string;
      categories?: string[];
      genre?: string;
      context?: string;
      count: number;
      existingLabels: string[];
      categoryLabels: Record<string, string>;
    },
    signal: AbortSignal,
  ): Promise<unknown>;

  proposeShelfRows?(
    input: {
      prompt: string;
      genre?: string;
      context?: string;
      count: number;
      catalogItems: Array<{ id: string; label: string; category: string }>;
      categoryFilters?: string[];
    },
    signal: AbortSignal,
  ): Promise<unknown>;

  proposeLootRows?(
    input: {
      prompt: string;
      genre?: string;
      context?: string;
      count: number;
      catalogItems: Array<{ id: string; label: string; category: string }>;
    },
    signal: AbortSignal,
  ): Promise<unknown>;
}

/** Building library write seam for accepting shelf/loot onto an asset (no session/map mutation). */
export interface BuildingShelfWriter {
  getAsset(id: string): { id: string; kind: string; shop?: { shelf?: unknown[]; buyback?: boolean; categoryFilters?: string[] }; encounter?: { loot?: unknown[]; [k: string]: unknown }; lootDraft?: unknown } | undefined;
  updateAsset(
    id: string,
    patch: Record<string, unknown>,
    expectedRevision: number,
  ): { library: unknown; revision: number; asset?: unknown };
  getRevision(): number;
}

export const ITEM_DRAFT_CONTEXT_LIMIT = 6_000;

/**
 * Read-only: returns draft cards for author review. Does not mutate Item Catalog or play state.
 */
export async function proposeItemAssets(
  catalog: ItemCatalogService,
  input: ProposeItemAssetsInput,
  model: ItemDraftModel,
  signal: AbortSignal = AbortSignal.timeout(120_000),
  modelName?: string,
): Promise<ItemDraftProposal> {
  const parsed = proposeItemAssetsInputSchema.parse(input);
  const existingLabels = catalog.get().catalog.items.map(a => a.label);
  const count = parsed.count ?? 6;
  const raw = await model.proposeItems({
    prompt: parsed.prompt,
    categories: parsed.categories,
    genre: parsed.genre,
    context: parsed.context?.slice(0, ITEM_DRAFT_CONTEXT_LIMIT),
    count,
    existingLabels,
    categoryLabels: Object.fromEntries(
      ITEM_CATEGORIES.map(c => [c, c]),
    ),
  }, signal);

  const output = itemDraftModelOutputSchema.safeParse(raw);
  const warnings: string[] = [];
  if (!output.success) {
    throw new AppError('MODEL_INVALID_RESPONSE', '模型返回的物品草案无法解析', 502, {
      issues: output.error.issues.slice(0, 6).map(i => ({ path: i.path.join('.'), message: i.message })),
    });
  }

  let items = output.data.items;
  if (parsed.categories?.length) {
    const allow = new Set(parsed.categories);
    const filtered = items.filter(b => allow.has(b.category));
    if (filtered.length < items.length) {
      warnings.push(`已过滤 ${items.length - filtered.length} 条不在所选类别内的草案`);
      items = filtered;
    }
  }
  if (items.length === 0) warnings.push('模型未返回可用物品草案');

  // Soft: misc category warning (not blocked)
  const miscCount = items.filter(i => i.category === 'misc').length;
  if (miscCount > 0) warnings.push(`${miscCount} 条使用杂项类别，尽量改成更具体的类别`);

  const drafts = items.slice(0, 16).map((item, i) => modelItemToItemDraftCard(item, i));
  return {
    drafts,
    warnings,
    ...(modelName ? { model: modelName } : {}),
  };
}

/**
 * Accept reviewed drafts into the Catalog via createAsset (unique label · N, never overwrite id).
 * Does not touch sessions / play / map.
 */
export function acceptItemDrafts(
  catalog: ItemCatalogService,
  input: AcceptItemDraftsInput,
): ItemCatalogView & { assets: ItemAsset[] } {
  const parsed = acceptItemDraftsInputSchema.parse(input);
  let revision = parsed.expectedRevision;
  const assets: ItemAsset[] = [];
  let lastView: ItemCatalogView | undefined;
  for (const card of parsed.drafts) {
    const created = catalog.createAsset(draftCardToItemAssetDraft(card), revision);
    revision = created.revision;
    assets.push(created.asset);
    lastView = created;
  }
  const view = lastView ?? catalog.get();
  return { catalog: view.catalog, revision: view.revision, warnings: view.warnings, assets };
}

function resolveCatalogItem(
  items: Array<{ id: string; label: string; category: string }>,
  itemId?: string,
  label?: string,
): { id: string; label: string; category: string } | undefined {
  if (itemId) {
    const byId = items.find(i => i.id === itemId);
    if (byId) return byId;
  }
  if (label) {
    const trimmed = label.trim();
    const exact = items.find(i => i.label === trimmed);
    if (exact) return exact;
    // Strip · N suffix for fuzzy match against unique labels
    const base = trimmed.replace(/\s*·\s*\d+$/, '');
    return items.find(i => i.label === base || i.label.replace(/\s*·\s*\d+$/, '') === base);
  }
  return undefined;
}

function pendingFromUnknown(
  label: string,
  index: number,
  categoryHint?: string,
): ItemDraftCard {
  const catParse = itemCategorySchema.safeParse(categoryHint);
  const category = catParse.success ? catParse.data : 'misc';
  return {
    draftId: `ai_pending_item_${index + 1}`,
    category,
    label: label.slice(0, 80),
    blurb: '模型提出的新名词：请先入库，再挂货架/掉落',
    color: category === 'misc' ? '#8d99ae' : undefined,
  };
}

/**
 * Propose shelf rows. Only known Catalog itemIds become shelf draft rows.
 * Unknown nouns → pendingItemDrafts (must propose-item / accept first). Never writes Catalog or Building.
 */
export async function proposeShelfRows(
  catalog: ItemCatalogService,
  input: ProposeShelfRowsInput,
  model: ItemDraftModel,
  signal: AbortSignal = AbortSignal.timeout(120_000),
  modelName?: string,
): Promise<ShelfDraftProposal> {
  if (!model.proposeShelfRows) {
    throw new AppError('MODEL_NOT_CONFIGURED', '当前模型未实现货架提议', 501);
  }
  const parsed = proposeShelfRowsInputSchema.parse(input);
  let catalogItems = catalog.get().catalog.items.map(a => ({
    id: a.id, label: a.label, category: a.category,
  }));
  if (parsed.categoryFilters?.length) {
    const allow = new Set(parsed.categoryFilters);
    catalogItems = catalogItems.filter(i => allow.has(i.category as typeof ITEM_CATEGORIES[number]));
  }
  if (catalogItems.length === 0) {
    return {
      rows: [],
      pendingItemDrafts: [],
      warnings: ['物品目录为空或筛选后无条目；请先 propose-item / 手动入库后再提议货架'],
      ...(modelName ? { model: modelName } : {}),
    };
  }

  const count = parsed.count ?? 6;
  const raw = await model.proposeShelfRows({
    prompt: parsed.prompt,
    genre: parsed.genre,
    context: parsed.context?.slice(0, 4_000),
    count,
    catalogItems,
    categoryFilters: parsed.categoryFilters,
  }, signal);

  const output = shelfDraftModelOutputSchema.safeParse(raw);
  if (!output.success) {
    throw new AppError('MODEL_INVALID_RESPONSE', '模型返回的货架草案无法解析', 502, {
      issues: output.error.issues.slice(0, 6).map(i => ({ path: i.path.join('.'), message: i.message })),
    });
  }

  const warnings: string[] = [];
  const rows: ShelfDraftRow[] = [];
  const pendingItemDrafts: ItemDraftCard[] = [];
  const seenPending = new Set<string>();

  for (const [i, row] of output.data.shelf.slice(0, 24).entries()) {
    const known = resolveCatalogItem(catalogItems, row.itemId, row.label);
    if (known) {
      const draft: ShelfDraftRow = {
        draftId: `ai_shelf_${i + 1}`,
        itemId: known.id,
        itemLabel: known.label,
      };
      if (row.priceAmount !== undefined) {
        draft.price = { amount: row.priceAmount };
        if (row.priceRoleHint) draft.price.roleHint = row.priceRoleHint;
      }
      if (row.stockMax !== undefined) draft.stockMax = row.stockMax;
      if (row.restockMode) draft.restock = { mode: row.restockMode };
      if (row.labelOverride) draft.labelOverride = row.labelOverride;
      rows.push(draft);
    } else {
      const noun = (row.label ?? row.itemId ?? '未知物品').slice(0, 80);
      warnings.push(`新名词「${noun}」未入库，已挂起为物品草案（禁止直写货架）`);
      if (!seenPending.has(noun)) {
        seenPending.add(noun);
        pendingItemDrafts.push(pendingFromUnknown(noun, pendingItemDrafts.length));
      }
    }
  }

  if (rows.length === 0 && pendingItemDrafts.length === 0) {
    warnings.push('模型未返回可用货架草案');
  }

  return {
    rows,
    pendingItemDrafts,
    warnings,
    ...(modelName ? { model: modelName } : {}),
  };
}

/**
 * Propose loot rows. Same discipline as shelf: unknown nouns → pending items, never direct loot write.
 */
export async function proposeLootRows(
  catalog: ItemCatalogService,
  input: ProposeLootRowsInput,
  model: ItemDraftModel,
  signal: AbortSignal = AbortSignal.timeout(120_000),
  modelName?: string,
): Promise<LootDraftProposal> {
  if (!model.proposeLootRows) {
    throw new AppError('MODEL_NOT_CONFIGURED', '当前模型未实现掉落提议', 501);
  }
  const parsed = proposeLootRowsInputSchema.parse(input);
  const catalogItems = catalog.get().catalog.items.map(a => ({
    id: a.id, label: a.label, category: a.category,
  }));
  if (catalogItems.length === 0) {
    return {
      rows: [],
      pendingItemDrafts: [],
      warnings: ['物品目录为空；请先 propose-item / 手动入库后再提议掉落'],
      ...(modelName ? { model: modelName } : {}),
    };
  }

  const count = parsed.count ?? 6;
  const raw = await model.proposeLootRows({
    prompt: parsed.prompt,
    genre: parsed.genre,
    context: parsed.context?.slice(0, 4_000),
    count,
    catalogItems,
  }, signal);

  const output = lootDraftModelOutputSchema.safeParse(raw);
  if (!output.success) {
    throw new AppError('MODEL_INVALID_RESPONSE', '模型返回的掉落草案无法解析', 502, {
      issues: output.error.issues.slice(0, 6).map(i => ({ path: i.path.join('.'), message: i.message })),
    });
  }

  const warnings: string[] = [];
  const rows: LootDraftRowCard[] = [];
  const pendingItemDrafts: ItemDraftCard[] = [];
  const seenPending = new Set<string>();

  for (const [i, row] of output.data.loot.slice(0, 24).entries()) {
    const known = resolveCatalogItem(catalogItems, row.itemId, row.label);
    if (known) {
      rows.push({
        draftId: `ai_loot_${i + 1}`,
        itemId: known.id,
        itemLabel: known.label,
        qty: row.qty ?? 1,
        chance: row.chance ?? 1,
      });
    } else {
      const noun = (row.label ?? row.itemId ?? '未知物品').slice(0, 80);
      warnings.push(`新名词「${noun}」未入库，已挂起为物品草案（禁止直写掉落）`);
      if (!seenPending.has(noun)) {
        seenPending.add(noun);
        pendingItemDrafts.push(pendingFromUnknown(noun, pendingItemDrafts.length));
      }
    }
  }

  if (rows.length === 0 && pendingItemDrafts.length === 0) {
    warnings.push('模型未返回可用掉落草案');
  }

  return {
    rows,
    pendingItemDrafts,
    warnings,
    ...(modelName ? { model: modelName } : {}),
  };
}

/**
 * Accept shelf draft rows onto a BuildingAsset.shop.shelf.
 * Rejects unknown itemIds (Catalog must already contain them).
 * Does not write session / map structure.
 */
export function acceptShelfRows(
  catalog: ItemCatalogService,
  buildings: BuildingShelfWriter,
  input: AcceptShelfRowsInput,
): { library: unknown; revision: number } {
  const parsed = acceptShelfRowsInputSchema.parse(input);
  const knownIds = catalog.itemIds();
  for (const row of parsed.rows) {
    if (!knownIds.has(row.itemId)) {
      throw new AppError(
        'ITEM_NOT_IN_CATALOG',
        `货架行引用未知 itemId=${row.itemId}；请先入库物品，禁止直写`,
        422,
        { itemId: row.itemId },
      );
    }
  }
  const asset = buildings.getAsset(parsed.buildingAssetId);
  if (!asset) {
    throw new AppError('BUILDING_NOT_FOUND', `建筑库中找不到：${parsed.buildingAssetId}`, 404);
  }
  if (asset.kind !== 'shop') {
    throw new AppError('BUILDING_KIND_MISMATCH', `建筑 ${parsed.buildingAssetId} 不是商店，无法写入货架`, 422);
  }
  const newLines = parsed.rows.map(shelfDraftRowToShelfLine);
  const prevShelf = (asset.shop?.shelf ?? []) as ReturnType<typeof shelfDraftRowToShelfLine>[];
  const shelf = parsed.replace ? newLines : [...prevShelf, ...newLines];
  const shop = {
    ...(asset.shop ?? {}),
    shelf,
  };
  return buildings.updateAsset(parsed.buildingAssetId, { shop }, parsed.expectedRevision);
}

/**
 * Accept loot draft rows onto BuildingAsset.encounter.loot.
 */
export function acceptLootRows(
  catalog: ItemCatalogService,
  buildings: BuildingShelfWriter,
  input: AcceptLootRowsInput,
): { library: unknown; revision: number } {
  const parsed = acceptLootRowsInputSchema.parse(input);
  const knownIds = catalog.itemIds();
  for (const row of parsed.rows) {
    if (!knownIds.has(row.itemId)) {
      throw new AppError(
        'ITEM_NOT_IN_CATALOG',
        `掉落行引用未知 itemId=${row.itemId}；请先入库物品，禁止直写`,
        422,
        { itemId: row.itemId },
      );
    }
  }
  const asset = buildings.getAsset(parsed.buildingAssetId);
  if (!asset) {
    throw new AppError('BUILDING_NOT_FOUND', `建筑库中找不到：${parsed.buildingAssetId}`, 404);
  }
  if (asset.kind !== 'encounter' && asset.kind !== 'boss') {
    throw new AppError('BUILDING_KIND_MISMATCH', `建筑 ${parsed.buildingAssetId} 不是遭遇/Boss，无法写入掉落`, 422);
  }
  const newLines = parsed.rows.map(lootDraftRowToLootLine);
  const prevLoot = (asset.encounter?.loot ?? []) as ReturnType<typeof lootDraftRowToLootLine>[];
  const loot = parsed.replace ? newLines : [...prevLoot, ...newLines];
  const encounter = {
    ...(asset.encounter ?? {}),
    loot,
  };
  return buildings.updateAsset(parsed.buildingAssetId, { encounter }, parsed.expectedRevision);
}
