import { z } from 'zod';
import { MAP_FILL_KINDS, mapFillKindSchema, type MapFillKind } from './world-map.js';
import {
  ITEM_CATEGORIES, itemCategorySchema, itemPriceHintSchema,
  type ItemCategory, type ItemPriceHint,
} from './item-catalog.js';

/**
 * Workspace Building Library (M-fill-2): reusable catalog assets for map fill placements.
 * Same layer as stat / map templates — not a runtime. Playtime still goes through locations / conditions / effects.
 */
export const BUILDING_LIBRARY_SCHEMA_VERSION = 1 as const;

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, '颜色须为 #rrggbb');

/** Optional inventory / loot draft line — authoring only; must fit existing resource shapes when compiled later. */
export const buildingStockLineSchema = z.object({
  label: z.string().min(1).max(80),
  resourceId: id.optional(),
  qty: z.number().finite().optional(),
});
export type BuildingStockLine = z.infer<typeof buildingStockLineSchema>;

export const buildingResourceCostSchema = z.object({
  resourceId: id,
  amount: z.number().finite(),
});
export type BuildingResourceCost = z.infer<typeof buildingResourceCostSchema>;

/** Default interact stub — labels / effect drafts only; no combat runtime. */
export const buildingInteractStubSchema = z.object({
  label: z.string().min(1).max(80).optional(),
  /** Free-form effect drafts for later compile; not evaluated at playtime from the library. */
  effectDrafts: z.array(z.record(z.string(), z.unknown())).max(20).optional(),
});
export type BuildingInteractStub = z.infer<typeof buildingInteractStubSchema>;

/** Soft Catalog price hint — reuse Item Catalog shape (resourceId optional). */
export const shelfPriceHintSchema = itemPriceHintSchema;
export type ShelfPriceHint = ItemPriceHint;

export const RESTOCK_MODES = ['none', 'on_visit', 'daily_stub'] as const;
export type RestockMode = (typeof RESTOCK_MODES)[number];
export const restockModeSchema = z.enum(RESTOCK_MODES);

/** Shop shelf template line — itemId required when the row exists; price is soft Catalog hint. */
export const shelfLineSchema = z.object({
  itemId: id,
  /** Catalog soft hint; world placement resolves real resourceId + true price. */
  price: shelfPriceHintSchema.optional(),
  stockMax: z.number().int().positive().max(9999).optional(),
  restock: z.object({
    mode: restockModeSchema,
    amount: z.number().int().nonnegative().max(9999).optional(),
  }).optional(),
  labelOverride: z.string().min(1).max(80).optional(),
});
export type ShelfLine = z.infer<typeof shelfLineSchema>;

export const shopContentSchema = z.object({
  /** Empty array is LEGAL in Catalog (template-only skeleton). */
  shelf: z.array(shelfLineSchema).max(80),
  categoryFilters: z.array(itemCategorySchema).max(ITEM_CATEGORIES.length).optional(),
  buyback: z.boolean().optional(),
});
export type ShopContent = z.infer<typeof shopContentSchema>;

export const SUPPLY_TARGET_KINDS = ['variable', 'resource'] as const;
export type SupplyTargetKind = (typeof SUPPLY_TARGET_KINDS)[number];

/** Supply recipe target — Catalog may omit name and use roleHint only (world-bind later). */
export const supplyTargetSchema = z.object({
  kind: z.enum(SUPPLY_TARGET_KINDS),
  /** World variable/resource name; if set in Catalog → world-bind-required warning. */
  name: z.string().min(1).max(80).optional(),
  /** Cross-genre semantic hint (heal_light / rest / sanity_light…) — preferred over genre-locked names. */
  roleHint: z.string().min(1).max(40).optional(),
});
export type SupplyTarget = z.infer<typeof supplyTargetSchema>;

export const supplyRecipeSchema = z.object({
  id: z.string().min(1).max(80),
  label: z.string().min(1).max(80),
  /** Cross-genre semantic role key (preferred over locking target.name). */
  role: z.string().min(1).max(40).optional(),
  target: supplyTargetSchema,
  amount: z.number().finite(),
  cost: shelfPriceHintSchema.optional(),
  uses: z.object({
    perVisit: z.number().int().positive().max(99).optional(),
    perDayStub: z.number().int().positive().max(99).optional(),
  }).optional(),
  requiresItemId: id.optional(),
});
export type SupplyRecipe = z.infer<typeof supplyRecipeSchema>;

export const supplyContentSchema = z.object({
  /** Empty recipes LEGAL in Catalog (template-only). */
  recipes: z.array(supplyRecipeSchema).max(40),
});
export type SupplyContent = z.infer<typeof supplyContentSchema>;

/** Soft Catalog resource drop / reward hint — same shape as price hints (resourceId optional). */
export const softResourceHintSchema = itemPriceHintSchema;
export type SoftResourceHint = ItemPriceHint;

export const questItemQtySchema = z.object({
  itemId: id,
  qty: z.number().finite().positive().max(9999),
});
export type QuestItemQty = z.infer<typeof questItemQtySchema>;

export const questSlotRewardsSchema = z.object({
  items: z.array(questItemQtySchema).max(20).optional(),
  /** Catalog soft hints; world placement binds real resourceId. */
  resources: z.array(softResourceHintSchema).max(12).optional(),
  /** Soft flag name hints — NOT required novel-specific true facts. */
  flags: z.array(z.string().min(1).max(80)).max(20).optional(),
});
export type QuestSlotRewards = z.infer<typeof questSlotRewardsSchema>;

/**
 * Quest slot Catalog template (M-item-3).
 * Library = label / markerTag / optional placeholder questId; true questId & facts belong to world bind.
 */
export const questSlotSchema = z.object({
  /** Optional Catalog placeholder — NOT a required novel-specific true id. */
  questId: id.optional(),
  /** Optional world-flag-shaped placeholder; prefer markerTag in Catalog. */
  marker: z.string().min(1).max(80).optional(),
  /** Cross-genre semantic tag (e.g. tag:side_hunt); world bind resolves true facts. */
  markerTag: z.string().min(1).max(80).optional(),
  label: z.string().min(1).max(80),
  /** Free-form condition drafts for later compile — not evaluated from Catalog. */
  conditions: z.array(z.record(z.string(), z.unknown())).max(20).optional(),
  rewards: questSlotRewardsSchema.optional(),
  giveItems: z.array(questItemQtySchema).max(20).optional(),
});
export type QuestSlot = z.infer<typeof questSlotSchema>;

export const questContentSchema = z.object({
  /** Empty slots LEGAL in Catalog (template-only). */
  slots: z.array(questSlotSchema).max(40),
});
export type QuestContent = z.infer<typeof questContentSchema>;

export const lootQtySchema = z.union([
  z.number().finite().positive().max(9999),
  z.object({
    min: z.number().finite().nonnegative().max(9999),
    max: z.number().finite().positive().max(9999),
  }).refine(q => q.max >= q.min, { message: 'loot qty.max must be >= qty.min' }),
]);
export type LootQty = z.infer<typeof lootQtySchema>;

export const lootLineSchema = z.object({
  itemId: id,
  qty: lootQtySchema,
  chance: z.number().finite().min(0).max(1),
  /** Soft Catalog hints; world placement binds real resourceId. */
  resourceDrops: z.array(softResourceHintSchema).max(12).optional(),
});
export type LootLine = z.infer<typeof lootLineSchema>;

export const ENCOUNTER_TRIGGER_PREFS = ['enter_location', 'interact', 'custom'] as const;
export type EncounterTriggerPref = (typeof ENCOUNTER_TRIGGER_PREFS)[number];
export const encounterTriggerPrefSchema = z.enum(ENCOUNTER_TRIGGER_PREFS);

/** Catalog trigger preference — location/fog instance binds at placement. */
export const encounterTriggerSchema = z.object({
  preference: encounterTriggerPrefSchema.optional(),
  note: z.string().max(200).optional(),
  /** Free-form condition drafts for later compile. */
  conditions: z.array(z.record(z.string(), z.unknown())).max(20).optional(),
});
export type EncounterTrigger = z.infer<typeof encounterTriggerSchema>;

/**
 * Encounter / boss Catalog template (M-item-3).
 * Boss defeat flag MUST NOT be required in Catalog (no defeatFlag field).
 * Empty loot LEGAL.
 */
export const encounterContentSchema = z.object({
  /** Optional pack id placeholder or semantic tag — world binds true encounter pack id. */
  packId: z.string().min(1).max(80).optional(),
  /** Semantic pack tag alternative to packId (e.g. tag:road_ambush). */
  packTag: z.string().min(1).max(80).optional(),
  trigger: encounterTriggerSchema.optional(),
  /** Effect drafts including start_encounter stubs — not evaluated from Catalog. */
  effectRefs: z.array(z.record(z.string(), z.unknown())).max(20).optional(),
  /** Empty loot LEGAL in Catalog (template-only). */
  loot: z.array(lootLineSchema).max(80),
  /** Explicit boss marker; kind===boss may also imply boss without this field. */
  boss: z.boolean().optional(),
});
export type EncounterContent = z.infer<typeof encounterContentSchema>;

export const buildingAssetSchema = z.object({
  id,
  version: z.number().int().positive(),
  label: z.string().min(1).max(80),
  kind: mapFillKindSchema,
  tags: z.array(z.string().min(1).max(40)).max(16).optional(),
  color: color.optional(),
  /** Icon key or short emoji; authoring display only. */
  icon: z.string().min(1).max(40).optional(),
  blurb: z.string().max(500).optional(),
  defaultInteract: buildingInteractStubSchema.optional(),
  inventoryDraft: z.array(buildingStockLineSchema).max(40).optional(),
  lootDraft: z.array(buildingStockLineSchema).max(40).optional(),
  worldbookTags: z.array(z.string().min(1).max(40)).max(16).optional(),
  worldbookEntryIds: z.array(id).max(20).optional(),
  resourceCosts: z.array(buildingResourceCostSchema).max(12).optional(),
  /** Display-only portrait; data URL or /media/… path. Never affects rules/play. */
  imageUrl: z.string().min(1).max(200_000).optional(),
  /** Relative path under DATA_DIR when stored as a file (e.g. building-images/x.svg). */
  imagePath: z.string().min(1).max(260).optional(),
  imageProvider: z.string().min(1).max(80).optional(),
  imagePrompt: z.string().max(2000).optional(),
  /** Hard shop template (M-item-2). Empty shelf [] is legal in Catalog. */
  shop: shopContentSchema.optional(),
  /** Hard supply template (M-item-2). Empty recipes [] is legal in Catalog. */
  supply: supplyContentSchema.optional(),
  /** Hard quest slots template (M-item-3). Empty slots [] is legal in Catalog. */
  quest: questContentSchema.optional(),
  /** Hard encounter/boss loot + trigger template (M-item-3). Empty loot [] is legal. No defeat flag required. */
  encounter: encounterContentSchema.optional(),
  provenance: z.object({
    source: z.string().max(120).optional(),
    mapId: z.string().max(80).optional(),
    locationId: id.optional(),
    createdAt: z.string().datetime({ offset: true }).optional(),
  }).optional(),
});
export type BuildingAsset = z.infer<typeof buildingAssetSchema>;

export const buildingLibrarySchema = z.object({
  schemaVersion: z.literal(BUILDING_LIBRARY_SCHEMA_VERSION),
  assets: z.array(buildingAssetSchema).max(500),
  /** Reserved for future cross-project packs (v1 unused). */
  packId: z.string().min(1).max(80).optional(),
  exportManifest: z.record(z.string(), z.unknown()).optional(),
});
export type BuildingLibrary = z.infer<typeof buildingLibrarySchema>;

export const buildingLibraryViewSchema = z.object({
  library: buildingLibrarySchema,
  revision: z.number().int().nonnegative(),
  /** Soft Catalog warnings (world-bind-required, price resource format, …). */
  warnings: z.array(z.string()).optional(),
});
export type BuildingLibraryView = z.infer<typeof buildingLibraryViewSchema>;

export const buildingLibrarySaveInputSchema = z.object({
  library: buildingLibrarySchema,
  expectedRevision: z.number().int().nonnegative(),
});
export type BuildingLibrarySaveInput = z.infer<typeof buildingLibrarySaveInputSchema>;

export const emptyBuildingLibrary = (): BuildingLibrary => ({
  schemaVersion: BUILDING_LIBRARY_SCHEMA_VERSION,
  assets: [],
});

/** Kind labels reused from map fill (Chinese). */
export const BUILDING_KIND_LABEL: Record<MapFillKind, string> = {
  shop: '商店', supply: '补给', quest: '任务点', encounter: '遭遇', boss: 'Boss',
};

export { MAP_FILL_KINDS as BUILDING_KINDS };

/** Default palette colors per kind (authoring). */
export const BUILDING_KIND_COLOR: Record<MapFillKind, string> = {
  shop: '#c9a227', supply: '#2a9d8f', quest: '#457b9d', encounter: '#e76f51', boss: '#9b2226',
};

/**
 * Unique display label: if `desired` collides (exact match), append ` · 2`, ` · 3`, …
 * Never silently overwrites or renames an existing asset's stored label.
 */
export function uniqueBuildingLabel(desired: string, existingLabels: readonly string[]): string {
  const base = desired.trim().slice(0, 80) || '建筑';
  const taken = new Set(existingLabels.map(l => l.trim()));
  if (!taken.has(base)) return base;
  for (let n = 2; n < 10_000; n++) {
    const candidate = `${base} · ${n}`.slice(0, 80);
    if (!taken.has(candidate)) return candidate;
  }
  return `${base} · ${Date.now()}`.slice(0, 80);
}

const safeId = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').slice(0, 60);

/** Allocate a unique asset id within the library. */
export function uniqueBuildingId(seed: string, existingIds: readonly string[], kindHint?: string): string {
  const taken = new Set(existingIds);
  let base = safeId(seed);
  if (!base || !/[a-zA-Z0-9]/.test(base)) base = safeId(kindHint ?? '') || 'building';
  let id = base;
  for (let i = 2; taken.has(id); i++) id = `${base}_${i}`.slice(0, 80);
  return id;
}

export type BuildingAssetDraft = {
  kind: MapFillKind;
  label: string;
  tags?: string[];
  color?: string;
  icon?: string;
  blurb?: string;
  defaultInteract?: BuildingInteractStub;
  inventoryDraft?: BuildingStockLine[];
  lootDraft?: BuildingStockLine[];
  worldbookTags?: string[];
  worldbookEntryIds?: string[];
  resourceCosts?: BuildingResourceCost[];
  shop?: ShopContent;
  supply?: SupplyContent;
  quest?: QuestContent;
  encounter?: EncounterContent;
  provenance?: BuildingAsset['provenance'];
  imageUrl?: string;
  imagePath?: string;
  imageProvider?: string;
  imagePrompt?: string;
  /** Prefer this id if free; otherwise uniquify. */
  preferredId?: string;
};

/**
 * Create a new asset with unique label (· N suffix) and unique id.
 * Does not mutate the library — caller inserts the returned asset.
 */
export function createBuildingAsset(
  library: BuildingLibrary,
  draft: BuildingAssetDraft,
): BuildingAsset {
  const label = uniqueBuildingLabel(draft.label, library.assets.map(a => a.label));
  const id = uniqueBuildingId(draft.preferredId ?? draft.label, library.assets.map(a => a.id), draft.kind);
  const asset: BuildingAsset = {
    id,
    version: 1,
    label,
    kind: draft.kind,
  };
  if (draft.tags?.length) asset.tags = draft.tags;
  if (draft.color) asset.color = draft.color;
  else asset.color = BUILDING_KIND_COLOR[draft.kind];
  if (draft.icon) asset.icon = draft.icon;
  if (draft.blurb) asset.blurb = draft.blurb;
  if (draft.defaultInteract) asset.defaultInteract = draft.defaultInteract;
  if (draft.inventoryDraft?.length) asset.inventoryDraft = draft.inventoryDraft;
  if (draft.lootDraft?.length) asset.lootDraft = draft.lootDraft;
  if (draft.worldbookTags?.length) asset.worldbookTags = draft.worldbookTags;
  if (draft.worldbookEntryIds?.length) asset.worldbookEntryIds = draft.worldbookEntryIds;
  if (draft.resourceCosts?.length) asset.resourceCosts = draft.resourceCosts;
  if (draft.kind === 'shop' && draft.shop) asset.shop = draft.shop;
  if (draft.kind === 'supply' && draft.supply) asset.supply = draft.supply;
  if (draft.kind === 'quest' && draft.quest) asset.quest = draft.quest;
  if ((draft.kind === 'encounter' || draft.kind === 'boss') && draft.encounter) {
    asset.encounter = draft.kind === 'boss'
      ? { ...draft.encounter, boss: draft.encounter.boss ?? true }
      : draft.encounter;
  }
  if (draft.provenance) asset.provenance = draft.provenance;
  if (draft.imageUrl) asset.imageUrl = draft.imageUrl;
  if (draft.imagePath) asset.imagePath = draft.imagePath;
  if (draft.imageProvider) asset.imageProvider = draft.imageProvider;
  if (draft.imagePrompt) asset.imagePrompt = draft.imagePrompt;
  return buildingAssetSchema.parse(asset);
}

/** Insert asset; refuses silent overwrite of existing id. */
export function addBuildingAsset(library: BuildingLibrary, asset: BuildingAsset): BuildingLibrary {
  if (library.assets.some(a => a.id === asset.id)) {
    throw new Error(`建筑库已存在 id=${asset.id}，禁止静默覆盖；请升格为新变体`);
  }
  return buildingLibrarySchema.parse({
    ...library,
    assets: [...library.assets, asset],
  });
}

/** Update in place by id (same id+version bump or keep version — caller decides). Never creates duplicates. */
export function updateBuildingAsset(
  library: BuildingLibrary,
  id: string,
  patch: Partial<Omit<BuildingAsset, 'id'>>,
): BuildingLibrary {
  const idx = library.assets.findIndex(a => a.id === id);
  if (idx < 0) throw new Error(`建筑库中找不到资产：${id}`);
  const current = library.assets[idx];
  const nextLabel = patch.label !== undefined
    ? uniqueBuildingLabel(patch.label, library.assets.filter(a => a.id !== id).map(a => a.label))
    : current.label;
  const mergedRaw: Record<string, unknown> = {
    ...current,
    ...patch,
    id: current.id,
    label: nextLabel,
  };
  const nextKind = (mergedRaw.kind as MapFillKind) ?? current.kind;
  if (nextKind !== 'shop') delete mergedRaw.shop;
  if (nextKind !== 'supply') delete mergedRaw.supply;
  if (nextKind !== 'quest') delete mergedRaw.quest;
  if (nextKind !== 'encounter' && nextKind !== 'boss') delete mergedRaw.encounter;
  const merged: BuildingAsset = buildingAssetSchema.parse(mergedRaw);
  const assets = library.assets.slice();
  assets[idx] = merged;
  return buildingLibrarySchema.parse({ ...library, assets });
}

export function removeBuildingAsset(library: BuildingLibrary, id: string): BuildingLibrary {
  const assets = library.assets.filter(a => a.id !== id);
  if (assets.length === library.assets.length) throw new Error(`建筑库中找不到资产：${id}`);
  return buildingLibrarySchema.parse({ ...library, assets });
}

export type LocalPlacementOverrides = {
  label?: string;
  color?: string;
  icon?: string;
  blurb?: string;
  tags?: string[];
  inventoryDraft?: BuildingStockLine[];
  lootDraft?: BuildingStockLine[];
  worldbookTags?: string[];
  resourceCosts?: BuildingResourceCost[];
  /** Extension point for world-bound shop/supply/quest/encounter overrides (placement UX). */
  shop?: ShopContent;
  supply?: SupplyContent;
  quest?: QuestContent;
  encounter?: EncounterContent;
};

/**
 * Explicit 「升格变体」: write placement overrides (+ optional base) back as a NEW library asset.
 * Never overwrites the original id/version.
 */
export function promoteBuildingVariant(
  library: BuildingLibrary,
  base: BuildingAsset,
  overrides: LocalPlacementOverrides = {},
  opts?: { label?: string; provenance?: BuildingAsset['provenance'] },
): { library: BuildingLibrary; asset: BuildingAsset } {
  const labelSeed = opts?.label ?? overrides.label ?? `${base.label} · 变体`;
  const draft: BuildingAssetDraft = {
    kind: base.kind,
    label: labelSeed,
    preferredId: `${base.id}_v`,
    tags: overrides.tags ?? base.tags,
    color: overrides.color ?? base.color,
    icon: overrides.icon ?? base.icon,
    blurb: overrides.blurb ?? base.blurb,
    defaultInteract: base.defaultInteract,
    inventoryDraft: overrides.inventoryDraft ?? base.inventoryDraft,
    lootDraft: overrides.lootDraft ?? base.lootDraft,
    worldbookTags: overrides.worldbookTags ?? base.worldbookTags,
    worldbookEntryIds: base.worldbookEntryIds,
    resourceCosts: overrides.resourceCosts ?? base.resourceCosts,
    shop: overrides.shop ?? base.shop,
    supply: overrides.supply ?? base.supply,
    quest: overrides.quest ?? base.quest,
    encounter: overrides.encounter ?? base.encounter,
    provenance: opts?.provenance ?? {
      source: `promote:${base.id}@${base.version}`,
      createdAt: new Date().toISOString(),
    },
  };
  const asset = createBuildingAsset(library, draft);
  // Keep lineage: bump semantic version relative to base for display (still a new id).
  asset.version = base.version + 1;
  return { library: addBuildingAsset(library, asset), asset };
}

export function findBuildingAsset(library: BuildingLibrary, id: string, version?: number): BuildingAsset | undefined {
  const matches = library.assets.filter(a => a.id === id);
  if (!matches.length) return undefined;
  if (version === undefined) return matches[0];
  return matches.find(a => a.version === version) ?? matches[0];
}

/** Merge library asset + local overrides for display / compile-down (does not mutate either). */
export function resolvePlacementBuilding(
  library: BuildingLibrary | undefined,
  buildingAssetId: string | undefined,
  buildingAssetVersion: number | undefined,
  localOverrides: Record<string, unknown> | undefined,
): { asset?: BuildingAsset; displayLabel?: string; displayColor?: string; displayIcon?: string } {
  if (!buildingAssetId || !library) return {
    displayLabel: typeof localOverrides?.label === 'string' ? localOverrides.label : undefined,
  };
  const asset = findBuildingAsset(library, buildingAssetId, buildingAssetVersion);
  if (!asset) return {
    displayLabel: typeof localOverrides?.label === 'string' ? localOverrides.label : undefined,
  };
  const o = localOverrides ?? {};
  return {
    asset,
    displayLabel: typeof o.label === 'string' && o.label.trim() ? o.label.trim() : asset.label,
    displayColor: typeof o.color === 'string' ? o.color : asset.color,
    displayIcon: typeof o.icon === 'string' ? o.icon : asset.icon,
  };
}


export type BuildingLibraryIssue = {
  level: 'error' | 'warning';
  code: string;
  message: string;
  buildingAssetId?: string;
  path?: string;
};

const RESOURCE_ID_RE = /^[a-zA-Z0-9_-]{1,80}$/;

function checkHintResource(
  hint: ItemPriceHint | undefined,
  buildingAssetId: string,
  path: string,
  issues: BuildingLibraryIssue[],
): void {
  if (!hint?.resourceId) return;
  if (!RESOURCE_ID_RE.test(hint.resourceId)) {
    issues.push({
      level: 'warning',
      code: 'building_price_resource_format',
      message: `建筑 ${buildingAssetId} 的 ${path}.resourceId 格式不合法（Catalog 未绑世界时仅警告）`,
      buildingAssetId,
      path,
    });
  }
}

/**
 * Catalog-save validation for Building Library hard templates (M-item-2/3).
 * - Empty shop.shelf / supply.recipes / quest.slots / encounter.loot → OK (template-only).
 * - Unknown itemId / requiresItemId / giveItems / rewards.items / loot.itemId → error when itemIds provided.
 * - Does NOT require world-bound resourceId / genre questId / boss defeat flag.
 * - target.name / questId placeholder present → warning world-bind-required (not error).
 */
export function validateBuildingLibrary(
  library: BuildingLibrary,
  opts?: { itemIds?: ReadonlySet<string> },
): BuildingLibraryIssue[] {
  const issues: BuildingLibraryIssue[] = [];
  const itemIds = opts?.itemIds;
  const seen = new Set<string>();

  for (const asset of library.assets) {
    if (seen.has(asset.id)) {
      issues.push({
        level: 'error',
        code: 'building_duplicate_id',
        message: `建筑 id 重复：${asset.id}`,
        buildingAssetId: asset.id,
      });
    }
    seen.add(asset.id);

    if (asset.shop) {
      for (const [i, line] of asset.shop.shelf.entries()) {
        const path = `shop.shelf[${i}]`;
        if (!line.itemId) {
          issues.push({
            level: 'error',
            code: 'building_shelf_missing_item',
            message: `建筑 ${asset.id} 货架行缺少 itemId`,
            buildingAssetId: asset.id,
            path: `${path}.itemId`,
          });
        } else if (itemIds && !itemIds.has(line.itemId)) {
          issues.push({
            level: 'error',
            code: 'building_shelf_unknown_item',
            message: `建筑 ${asset.id} 货架引用未知物品：${line.itemId}`,
            buildingAssetId: asset.id,
            path: `${path}.itemId`,
          });
        }
        checkHintResource(line.price, asset.id, `${path}.price`, issues);
      }
      for (const [i, cat] of (asset.shop.categoryFilters ?? []).entries()) {
        if (!ITEM_CATEGORIES.includes(cat as ItemCategory)) {
          issues.push({
            level: 'error',
            code: 'building_shop_filter_invalid',
            message: `建筑 ${asset.id} categoryFilters[${i}] 不在物品类别闭集内`,
            buildingAssetId: asset.id,
            path: `shop.categoryFilters[${i}]`,
          });
        }
      }
    }

    if (asset.supply) {
      const recipeIds = new Set<string>();
      for (const [i, recipe] of asset.supply.recipes.entries()) {
        const path = `supply.recipes[${i}]`;
        if (recipeIds.has(recipe.id)) {
          issues.push({
            level: 'error',
            code: 'building_recipe_duplicate_id',
            message: `建筑 ${asset.id} 补给配方 id 重复：${recipe.id}`,
            buildingAssetId: asset.id,
            path: `${path}.id`,
          });
        }
        recipeIds.add(recipe.id);
        if (recipe.requiresItemId) {
          if (itemIds && !itemIds.has(recipe.requiresItemId)) {
            issues.push({
              level: 'error',
              code: 'building_recipe_unknown_item',
              message: `建筑 ${asset.id} 补给配方引用未知物品：${recipe.requiresItemId}`,
              buildingAssetId: asset.id,
              path: `${path}.requiresItemId`,
            });
          }
        }
        if (recipe.target.name) {
          issues.push({
            level: 'warning',
            code: 'building_recipe_world_bind_required',
            message: `建筑 ${asset.id} 配方 ${recipe.id} 写了 target.name=${recipe.target.name}（Catalog 未绑世界；试玩前需世界绑定）`,
            buildingAssetId: asset.id,
            path: `${path}.target.name`,
          });
        }
        checkHintResource(recipe.cost, asset.id, `${path}.cost`, issues);
      }
    }

    if (asset.quest) {
      for (const [i, slot] of asset.quest.slots.entries()) {
        const path = `quest.slots[${i}]`;
        if (slot.questId) {
          issues.push({
            level: 'warning',
            code: 'building_quest_world_bind_required',
            message: `建筑 ${asset.id} 任务槽写了 questId=${slot.questId}（Catalog 占位；试玩前需世界绑定真 id）`,
            buildingAssetId: asset.id,
            path: `${path}.questId`,
          });
        }
        for (const [j, gi] of (slot.giveItems ?? []).entries()) {
          const gPath = `${path}.giveItems[${j}]`;
          if (!gi.itemId) {
            issues.push({
              level: 'error',
              code: 'building_quest_give_missing_item',
              message: `建筑 ${asset.id} 任务槽交付行缺少 itemId`,
              buildingAssetId: asset.id,
              path: `${gPath}.itemId`,
            });
          } else if (itemIds && !itemIds.has(gi.itemId)) {
            issues.push({
              level: 'error',
              code: 'building_quest_give_unknown_item',
              message: `建筑 ${asset.id} 任务槽交付引用未知物品：${gi.itemId}`,
              buildingAssetId: asset.id,
              path: `${gPath}.itemId`,
            });
          }
        }
        for (const [j, ri] of (slot.rewards?.items ?? []).entries()) {
          const rPath = `${path}.rewards.items[${j}]`;
          if (!ri.itemId) {
            issues.push({
              level: 'error',
              code: 'building_quest_reward_missing_item',
              message: `建筑 ${asset.id} 任务槽奖励行缺少 itemId`,
              buildingAssetId: asset.id,
              path: `${rPath}.itemId`,
            });
          } else if (itemIds && !itemIds.has(ri.itemId)) {
            issues.push({
              level: 'error',
              code: 'building_quest_reward_unknown_item',
              message: `建筑 ${asset.id} 任务槽奖励引用未知物品：${ri.itemId}`,
              buildingAssetId: asset.id,
              path: `${rPath}.itemId`,
            });
          }
        }
        for (const [j, rh] of (slot.rewards?.resources ?? []).entries()) {
          checkHintResource(rh, asset.id, `${path}.rewards.resources[${j}]`, issues);
        }
      }
    }

    if (asset.encounter) {
      for (const [i, line] of asset.encounter.loot.entries()) {
        const path = `encounter.loot[${i}]`;
        if (!line.itemId) {
          issues.push({
            level: 'error',
            code: 'building_loot_missing_item',
            message: `建筑 ${asset.id} 掉落行缺少 itemId`,
            buildingAssetId: asset.id,
            path: `${path}.itemId`,
          });
        } else if (itemIds && !itemIds.has(line.itemId)) {
          issues.push({
            level: 'error',
            code: 'building_loot_unknown_item',
            message: `建筑 ${asset.id} 掉落引用未知物品：${line.itemId}`,
            buildingAssetId: asset.id,
            path: `${path}.itemId`,
          });
        }
        for (const [j, rd] of (line.resourceDrops ?? []).entries()) {
          checkHintResource(rd, asset.id, `${path}.resourceDrops[${j}]`, issues);
        }
      }
      if (asset.encounter.packId) {
        issues.push({
          level: 'warning',
          code: 'building_encounter_world_bind_required',
          message: `建筑 ${asset.id} 写了 encounter.packId=${asset.encounter.packId}（Catalog 占位；试玩前需世界绑定真 id）`,
          buildingAssetId: asset.id,
          path: 'encounter.packId',
        });
      }
      // Boss defeat flag must NEVER be required — ensure we never invent such an error code.
    }
  }
  return issues;
}
