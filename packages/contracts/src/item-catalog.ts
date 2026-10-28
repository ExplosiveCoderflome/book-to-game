import { z } from 'zod';

/**
 * Workspace Item Catalog (M-item-1): reusable item assets for building hard rows (M-item-2+).
 * Same Catalog layer as Building Library / stat / map templates — not a playtime runtime.
 * Currency stays world `resources`; Catalog only stores soft price hints.
 */

export const ITEM_CATALOG_SCHEMA_VERSION = 1 as const;

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);

/** Closed set v1 — UI must not invent free-string categories. */
export const ITEM_CATEGORIES = [
  'consumable', 'equipment', 'material', 'info', 'key', 'quest', 'misc',
] as const;
export type ItemCategory = (typeof ITEM_CATEGORIES)[number];
export const itemCategorySchema = z.enum(ITEM_CATEGORIES);

export const ITEM_CATEGORY_LABEL: Record<ItemCategory, string> = {
  consumable: '消耗品',
  equipment: '装备',
  material: '材料',
  info: '情报',
  key: '钥匙',
  quest: '任务物品',
  misc: '杂项',
};

/** Soft Catalog price / value hint — resourceId optional; world binding resolves real currency. */
export const itemPriceHintSchema = z.object({
  amount: z.number().finite(),
  resourceId: id.optional(),
  /** Cross-genre role hint (e.g. primary_coin); never a required world-specific id. */
  roleHint: z.string().min(1).max(40).optional(),
});
export type ItemPriceHint = z.infer<typeof itemPriceHintSchema>;

export const itemStackSchema = z.object({
  max: z.number().int().positive().max(9999).optional(),
  unique: z.boolean().optional(),
}).superRefine((val, ctx) => {
  if (val.unique === true && val.max !== undefined && val.max > 1) {
    ctx.addIssue({
      code: 'custom',
      message: 'unique 物品禁止 stack.max > 1',
      path: ['max'],
    });
  }
});
export type ItemStack = z.infer<typeof itemStackSchema>;

export const itemProvenanceSchema = z.object({
  source: z.string().max(120).optional(),
  createdAt: z.string().datetime({ offset: true }).optional(),
  fromDraftLabel: z.string().max(80).optional(),
});
export type ItemProvenance = z.infer<typeof itemProvenanceSchema>;

export const itemAssetSchema = z.object({
  id,
  version: z.number().int().positive(),
  label: z.string().min(1).max(80),
  category: itemCategorySchema,
  tags: z.array(z.string().min(1).max(40)).max(16).optional(),
  stack: itemStackSchema.optional(),
  defaultPriceHint: itemPriceHintSchema.optional(),
  resourceValue: z.array(itemPriceHintSchema).max(12).optional(),
  blurb: z.string().max(500).optional(),
  generateHint: z.string().max(2000).optional(),
  /** Display-only portrait; data URL or /media/… path. Never affects rules/play. */
  imageUrl: z.string().min(1).max(200_000).optional(),
  imagePath: z.string().min(1).max(260).optional(),
  imageProvider: z.string().min(1).max(80).optional(),
  imagePrompt: z.string().max(2000).optional(),
  provenance: itemProvenanceSchema.optional(),
});
export type ItemAsset = z.infer<typeof itemAssetSchema>;

export const itemCatalogSchema = z.object({
  schemaVersion: z.literal(ITEM_CATALOG_SCHEMA_VERSION),
  items: z.array(itemAssetSchema).max(2000),
  /** Reserved for future cross-project packs (v1 unused). */
  packId: z.string().min(1).max(80).optional(),
});
export type ItemCatalog = z.infer<typeof itemCatalogSchema>;

export const itemCatalogViewSchema = z.object({
  catalog: itemCatalogSchema,
  revision: z.number().int().nonnegative(),
  /** Soft warnings from last save/validate (unknown resourceId format, etc.). */
  warnings: z.array(z.string()).optional(),
});
export type ItemCatalogView = z.infer<typeof itemCatalogViewSchema>;

export const itemCatalogSaveInputSchema = z.object({
  catalog: itemCatalogSchema,
  expectedRevision: z.number().int().nonnegative(),
});
export type ItemCatalogSaveInput = z.infer<typeof itemCatalogSaveInputSchema>;

export const emptyItemCatalog = (): ItemCatalog => ({
  schemaVersion: ITEM_CATALOG_SCHEMA_VERSION,
  items: [],
});

/**
 * Unique display label: if `desired` collides (exact match), append ` · 2`, ` · 3`, …
 * Never silently overwrites or renames an existing asset's stored label.
 */
export function uniqueItemLabel(desired: string, existingLabels: readonly string[]): string {
  const base = desired.trim().slice(0, 80) || '物品';
  const taken = new Set(existingLabels.map(l => l.trim()));
  if (!taken.has(base)) return base;
  for (let n = 2; n < 10_000; n++) {
    const candidate = `${base} · ${n}`.slice(0, 80);
    if (!taken.has(candidate)) return candidate;
  }
  return `${base} · ${Date.now()}`.slice(0, 80);
}

const safeId = (s: string) =>
  s.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').slice(0, 60);

/** Allocate a unique item id within the catalog. */
export function uniqueItemId(seed: string, existingIds: readonly string[], categoryHint?: string): string {
  const taken = new Set(existingIds);
  let base = safeId(seed);
  if (!base || !/[a-zA-Z0-9]/.test(base)) base = safeId(categoryHint ?? '') || 'item';
  let id = base;
  for (let i = 2; taken.has(id); i++) id = `${base}_${i}`.slice(0, 80);
  return id;
}

export type ItemAssetDraft = {
  category: ItemCategory;
  label: string;
  tags?: string[];
  stack?: ItemStack;
  defaultPriceHint?: ItemPriceHint;
  resourceValue?: ItemPriceHint[];
  blurb?: string;
  generateHint?: string;
  provenance?: ItemProvenance;
  imageUrl?: string;
  imagePath?: string;
  imageProvider?: string;
  imagePrompt?: string;
  preferredId?: string;
};

/**
 * Create a new item with unique label (· N suffix) and unique id.
 * Does not mutate the catalog — caller inserts the returned asset.
 */
export function createItemAsset(catalog: ItemCatalog, draft: ItemAssetDraft): ItemAsset {
  const label = uniqueItemLabel(draft.label, catalog.items.map(a => a.label));
  const id = uniqueItemId(draft.preferredId ?? draft.label, catalog.items.map(a => a.id), draft.category);
  const asset: ItemAsset = {
    id,
    version: 1,
    label,
    category: draft.category,
  };
  if (draft.tags?.length) asset.tags = draft.tags;
  if (draft.stack) asset.stack = draft.stack;
  if (draft.defaultPriceHint) asset.defaultPriceHint = draft.defaultPriceHint;
  if (draft.resourceValue?.length) asset.resourceValue = draft.resourceValue;
  if (draft.blurb) asset.blurb = draft.blurb;
  if (draft.generateHint) asset.generateHint = draft.generateHint;
  if (draft.provenance) asset.provenance = draft.provenance;
  if (draft.imageUrl) asset.imageUrl = draft.imageUrl;
  if (draft.imagePath) asset.imagePath = draft.imagePath;
  if (draft.imageProvider) asset.imageProvider = draft.imageProvider;
  if (draft.imagePrompt) asset.imagePrompt = draft.imagePrompt;
  return itemAssetSchema.parse(asset);
}

/** Insert asset; refuses silent overwrite of existing id. */
export function addItemAsset(catalog: ItemCatalog, asset: ItemAsset): ItemCatalog {
  if (catalog.items.some(a => a.id === asset.id)) {
    throw new Error(`物品目录已存在 id=${asset.id}，禁止静默覆盖；请新建条目或升格变体`);
  }
  return itemCatalogSchema.parse({
    ...catalog,
    items: [...catalog.items, asset],
  });
}

/** Update in place by id. Label collisions get · N suffix. Never creates duplicates. */
export function updateItemAsset(
  catalog: ItemCatalog,
  id: string,
  patch: Partial<Omit<ItemAsset, 'id'>>,
): ItemCatalog {
  const idx = catalog.items.findIndex(a => a.id === id);
  if (idx < 0) throw new Error(`物品目录中找不到：${id}`);
  const current = catalog.items[idx];
  const nextLabel = patch.label !== undefined
    ? uniqueItemLabel(patch.label, catalog.items.filter(a => a.id !== id).map(a => a.label))
    : current.label;
  const merged: ItemAsset = itemAssetSchema.parse({
    ...current,
    ...patch,
    id: current.id,
    label: nextLabel,
  });
  const items = catalog.items.slice();
  items[idx] = merged;
  return itemCatalogSchema.parse({ ...catalog, items });
}

export function removeItemAsset(catalog: ItemCatalog, id: string): ItemCatalog {
  const items = catalog.items.filter(a => a.id !== id);
  if (items.length === catalog.items.length) throw new Error(`物品目录中找不到：${id}`);
  return itemCatalogSchema.parse({ ...catalog, items });
}

export function findItemAsset(catalog: ItemCatalog, id: string, version?: number): ItemAsset | undefined {
  const matches = catalog.items.filter(a => a.id === id);
  if (!matches.length) return undefined;
  if (version === undefined) return matches[0];
  return matches.find(a => a.version === version) ?? matches[0];
}

/** Soft Catalog validation issues (save-time). Unknown world resourceId is warning-only. */
export type ItemCatalogIssue = {
  level: 'error' | 'warning';
  code: string;
  message: string;
  itemId?: string;
  path?: string;
};

const RESOURCE_ID_RE = /^[a-zA-Z0-9_-]{1,80}$/;

function checkPriceHint(
  hint: ItemPriceHint | undefined,
  itemId: string,
  path: string,
  issues: ItemCatalogIssue[],
): void {
  if (!hint) return;
  if (hint.resourceId !== undefined && !RESOURCE_ID_RE.test(hint.resourceId)) {
    issues.push({
      level: 'warning',
      code: 'item_price_resource_format',
      message: `物品 ${itemId} 的 ${path}.resourceId 格式不合法（Catalog 未绑世界时仅警告）`,
      itemId,
      path,
    });
  }
}

/**
 * Validate catalog on save.
 * - unique id / category closed set / unique+stack.max>1 → error (also enforced by zod)
 * - unbound/unknown resourceId format → warning only (never require world resourceId)
 */
export function validateItemCatalog(catalog: ItemCatalog): ItemCatalogIssue[] {
  const issues: ItemCatalogIssue[] = [];
  const seen = new Set<string>();
  for (const item of catalog.items) {
    if (seen.has(item.id)) {
      issues.push({
        level: 'error',
        code: 'item_duplicate_id',
        message: `物品 id 重复：${item.id}`,
        itemId: item.id,
      });
    }
    seen.add(item.id);
    if (!ITEM_CATEGORIES.includes(item.category)) {
      issues.push({
        level: 'error',
        code: 'item_category_invalid',
        message: `物品 ${item.id} 类别不在闭集内：${String(item.category)}`,
        itemId: item.id,
        path: 'category',
      });
    }
    if (item.stack?.unique === true && item.stack.max !== undefined && item.stack.max > 1) {
      issues.push({
        level: 'error',
        code: 'item_unique_stack_conflict',
        message: `物品 ${item.id}：unique 禁止 stack.max > 1`,
        itemId: item.id,
        path: 'stack.max',
      });
    }
    checkPriceHint(item.defaultPriceHint, item.id, 'defaultPriceHint', issues);
    for (let i = 0; i < (item.resourceValue?.length ?? 0); i++) {
      checkPriceHint(item.resourceValue![i], item.id, `resourceValue[${i}]`, issues);
    }
    if (item.category === 'misc') {
      issues.push({
        level: 'warning',
        code: 'item_misc_category',
        message: `物品 ${item.id} 使用杂项类别，尽量改成更具体的类别`,
        itemId: item.id,
        path: 'category',
      });
    }
  }
  return issues;
}

/**
 * Hard-row reference hook for M-item-2+.
 * Scans building-like objects for nested `itemId` fields on known hard paths
 * (shop.shelf, supply.recipes.requiresItemId, quest rewards/giveItems, encounter.loot).
 * Soft `inventoryDraft` / `lootDraft` labels are NOT counted.
 */
export type ItemHardReference = {
  buildingAssetId: string;
  path: string;
};

type BuildingLike = {
  id: string;
  shop?: { shelf?: Array<{ itemId?: string }> };
  supply?: { recipes?: Array<{ requiresItemId?: string }> };
  quest?: {
    slots?: Array<{
      giveItems?: Array<{ itemId?: string }>;
      rewards?: { items?: Array<{ itemId?: string }> };
    }>;
  };
  encounter?: { loot?: Array<{ itemId?: string }> };
  /** Soft drafts — ignored for hard refs. */
  inventoryDraft?: unknown;
  lootDraft?: unknown;
};

export function findItemHardReferences(
  itemId: string,
  buildings: readonly BuildingLike[],
): ItemHardReference[] {
  const refs: ItemHardReference[] = [];
  for (const b of buildings) {
    for (const [i, line] of (b.shop?.shelf ?? []).entries()) {
      if (line.itemId === itemId) refs.push({ buildingAssetId: b.id, path: `shop.shelf[${i}].itemId` });
    }
    for (const [i, recipe] of (b.supply?.recipes ?? []).entries()) {
      if (recipe.requiresItemId === itemId) {
        refs.push({ buildingAssetId: b.id, path: `supply.recipes[${i}].requiresItemId` });
      }
    }
    for (const [i, slot] of (b.quest?.slots ?? []).entries()) {
      for (const [j, gi] of (slot.giveItems ?? []).entries()) {
        if (gi.itemId === itemId) refs.push({ buildingAssetId: b.id, path: `quest.slots[${i}].giveItems[${j}].itemId` });
      }
      for (const [j, ri] of (slot.rewards?.items ?? []).entries()) {
        if (ri.itemId === itemId) refs.push({ buildingAssetId: b.id, path: `quest.slots[${i}].rewards.items[${j}].itemId` });
      }
    }
    for (const [i, line] of (b.encounter?.loot ?? []).entries()) {
      if (line.itemId === itemId) refs.push({ buildingAssetId: b.id, path: `encounter.loot[${i}].itemId` });
    }
  }
  return refs;
}

/**
 * Delete with reference guard.
 * If hard refs exist and `force` is false, throws with code-ready message listing buildings.
 * Soft inventoryDraft/lootDraft do not block deletion.
 */
export function removeItemAssetGuarded(
  catalog: ItemCatalog,
  id: string,
  buildings: readonly BuildingLike[] = [],
  opts?: { force?: boolean },
): { catalog: ItemCatalog; warnings: string[] } {
  const refs = findItemHardReferences(id, buildings);
  const warnings: string[] = [];
  if (refs.length) {
    const summary = refs.map(r => `${r.buildingAssetId} (${r.path})`).join('；');
    if (!opts?.force) {
      throw new Error(
        `物品 ${id} 仍被建筑硬行引用：${summary}。请先解除引用，或传 force 强制删除（将留下悬空引用，由校验标错）。`,
      );
    }
    warnings.push(`已强制删除物品 ${id}；下列建筑硬行仍引用它：${summary}`);
  }
  return { catalog: removeItemAsset(catalog, id), warnings };
}
