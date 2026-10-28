import { z } from 'zod';
import {
  ITEM_CATEGORIES, ITEM_CATEGORY_LABEL, itemCategorySchema, itemPriceHintSchema, itemStackSchema,
  type ItemAssetDraft, type ItemCategory, type ItemPriceHint,
} from './item-catalog.js';
import { lootQtySchema, restockModeSchema, type LootLine, type ShelfLine } from './building-library.js';

/**
 * AI "propose item assets" (author-time, M-item-4).
 * Model only proposes; Catalog writes go through createItemAsset / accept.
 * Never mutates play/session state. Soft price hints only — no required world resourceId.
 */

export const ITEM_CATEGORY_COLOR: Record<ItemCategory, string> = {
  consumable: '#2a9d8f',
  equipment: '#457b9d',
  material: '#c9a227',
  info: '#6c757d',
  key: '#9b2226',
  quest: '#e76f51',
  misc: '#8d99ae',
};

/** Raw model item — no world-bound resourceId / quest flags as required truth. */
export const itemDraftModelItemSchema = z.object({
  label: z.string().trim().min(1).max(80),
  category: itemCategorySchema,
  tags: z.array(z.string().trim().min(1).max(40)).max(8).optional(),
  blurb: z.string().trim().max(500).optional(),
  generateHint: z.string().trim().max(2000).optional(),
  /** Soft relative price amount; Catalog hint only. */
  priceAmount: z.number().finite().optional(),
  /** Cross-genre role hint (primary_coin…); NEVER a required world resourceId. */
  priceRoleHint: z.string().trim().min(1).max(40).optional(),
  stackUnique: z.boolean().optional(),
  stackMax: z.number().int().positive().max(9999).optional(),
});
export type ItemDraftModelItem = z.infer<typeof itemDraftModelItemSchema>;

export const itemDraftModelOutputSchema = z.object({
  items: z.array(itemDraftModelItemSchema).max(16).default([]),
});
export type ItemDraftModelOutput = z.infer<typeof itemDraftModelOutputSchema>;

export const proposeItemAssetsInputSchema = z.object({
  prompt: z.string().trim().min(1).max(2000),
  categories: z.array(itemCategorySchema).max(ITEM_CATEGORIES.length).optional(),
  genre: z.string().trim().max(40).optional(),
  /** Optional novel / worldbook snippet — untrusted narrative only. */
  context: z.string().max(8_000).optional(),
  count: z.number().int().min(1).max(12).optional(),
});
export type ProposeItemAssetsInput = z.infer<typeof proposeItemAssetsInputSchema>;

/** One reviewable draft card before Catalog write. */
export const itemDraftCardSchema = z.object({
  draftId: z.string().min(1).max(80),
  category: itemCategorySchema,
  label: z.string().min(1).max(80),
  tags: z.array(z.string()).optional(),
  blurb: z.string().optional(),
  generateHint: z.string().optional(),
  defaultPriceHint: itemPriceHintSchema.optional(),
  stack: itemStackSchema.optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});
export type ItemDraftCard = z.infer<typeof itemDraftCardSchema>;

export const itemDraftProposalSchema = z.object({
  drafts: z.array(itemDraftCardSchema).max(16),
  warnings: z.array(z.string().max(200)).max(20),
  model: z.string().max(120).optional(),
});
export type ItemDraftProposal = z.infer<typeof itemDraftProposalSchema>;

export const acceptItemDraftsInputSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  drafts: z.array(itemDraftCardSchema).min(1).max(16),
});
export type AcceptItemDraftsInput = z.infer<typeof acceptItemDraftsInputSchema>;

export function modelItemToItemDraftCard(item: ItemDraftModelItem, index: number): ItemDraftCard {
  const card: ItemDraftCard = {
    draftId: `ai_item_${item.category}_${index + 1}`,
    category: item.category,
    label: item.label,
    color: ITEM_CATEGORY_COLOR[item.category],
  };
  if (item.tags?.length) card.tags = item.tags;
  if (item.blurb) card.blurb = item.blurb;
  if (item.generateHint) card.generateHint = item.generateHint;
  if (item.priceAmount !== undefined) {
    const hint: ItemPriceHint = { amount: item.priceAmount };
    if (item.priceRoleHint) hint.roleHint = item.priceRoleHint;
    card.defaultPriceHint = hint;
  }
  if (item.stackUnique || item.stackMax !== undefined) {
    const stack: { unique?: boolean; max?: number } = {};
    if (item.stackUnique) stack.unique = true;
    else if (item.stackMax !== undefined) stack.max = item.stackMax;
    card.stack = stack;
  }
  return card;
}

/** Convert a reviewed card into a Catalog create draft (no id — createItemAsset allocates). */
export function draftCardToItemAssetDraft(card: ItemDraftCard): ItemAssetDraft {
  const draft: ItemAssetDraft = {
    category: card.category,
    label: card.label,
    provenance: { source: 'ai-propose', createdAt: new Date().toISOString() },
  };
  if (card.tags?.length) draft.tags = card.tags;
  if (card.blurb) draft.blurb = card.blurb;
  if (card.generateHint) draft.generateHint = card.generateHint;
  if (card.defaultPriceHint) draft.defaultPriceHint = card.defaultPriceHint;
  if (card.stack) draft.stack = card.stack;
  return draft;
}

export { ITEM_CATEGORY_LABEL };

// ——— Optional: propose shelf / loot rows (may ONLY reference existing itemIds) ———

/** Model shelf row — itemId preferred; label alone is treated as a new noun (must become item draft first). */
export const shelfDraftModelRowSchema = z.object({
  itemId: z.string().trim().min(1).max(80).optional(),
  /** Free label — if itemId missing/unknown, becomes pending item draft, NEVER a shelf write. */
  label: z.string().trim().min(1).max(80).optional(),
  priceAmount: z.number().finite().optional(),
  priceRoleHint: z.string().trim().min(1).max(40).optional(),
  stockMax: z.number().int().positive().max(9999).optional(),
  restockMode: restockModeSchema.optional(),
  labelOverride: z.string().trim().min(1).max(80).optional(),
}).refine(r => !!(r.itemId || r.label), { message: 'shelf row needs itemId or label' });
export type ShelfDraftModelRow = z.infer<typeof shelfDraftModelRowSchema>;

export const shelfDraftModelOutputSchema = z.object({
  shelf: z.array(shelfDraftModelRowSchema).max(24).default([]),
});
export type ShelfDraftModelOutput = z.infer<typeof shelfDraftModelOutputSchema>;

export const lootDraftModelRowSchema = z.object({
  itemId: z.string().trim().min(1).max(80).optional(),
  label: z.string().trim().min(1).max(80).optional(),
  qty: lootQtySchema.optional(),
  chance: z.number().finite().min(0).max(1).optional(),
}).refine(r => !!(r.itemId || r.label), { message: 'loot row needs itemId or label' });
export type LootDraftModelRow = z.infer<typeof lootDraftModelRowSchema>;

export const lootDraftModelOutputSchema = z.object({
  loot: z.array(lootDraftModelRowSchema).max(24).default([]),
});
export type LootDraftModelOutput = z.infer<typeof lootDraftModelOutputSchema>;

export const proposeShelfRowsInputSchema = z.object({
  prompt: z.string().trim().min(1).max(2000),
  buildingAssetId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/).optional(),
  genre: z.string().trim().max(40).optional(),
  context: z.string().max(4_000).optional(),
  count: z.number().int().min(1).max(12).optional(),
  /** Prefer these categories when suggesting from Catalog. */
  categoryFilters: z.array(itemCategorySchema).max(ITEM_CATEGORIES.length).optional(),
});
export type ProposeShelfRowsInput = z.infer<typeof proposeShelfRowsInputSchema>;

export const proposeLootRowsInputSchema = z.object({
  prompt: z.string().trim().min(1).max(2000),
  buildingAssetId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/).optional(),
  genre: z.string().trim().max(40).optional(),
  context: z.string().max(4_000).optional(),
  count: z.number().int().min(1).max(12).optional(),
});
export type ProposeLootRowsInput = z.infer<typeof proposeLootRowsInputSchema>;

/** Resolved shelf draft row — always a known Catalog itemId. */
export const shelfDraftRowSchema = z.object({
  draftId: z.string().min(1).max(80),
  itemId: z.string().min(1).max(80),
  itemLabel: z.string().min(1).max(80).optional(),
  price: itemPriceHintSchema.optional(),
  stockMax: z.number().int().positive().max(9999).optional(),
  restock: z.object({
    mode: restockModeSchema,
    amount: z.number().int().nonnegative().max(9999).optional(),
  }).optional(),
  labelOverride: z.string().min(1).max(80).optional(),
});
export type ShelfDraftRow = z.infer<typeof shelfDraftRowSchema>;

export const lootDraftRowSchema = z.object({
  draftId: z.string().min(1).max(80),
  itemId: z.string().min(1).max(80),
  itemLabel: z.string().min(1).max(80).optional(),
  qty: lootQtySchema,
  chance: z.number().finite().min(0).max(1),
});
export type LootDraftRowCard = z.infer<typeof lootDraftRowSchema>;

/**
 * Shelf/loot proposal: known rows + optional pending item drafts for new nouns.
 * Reject / discard clears client state; server never persists these drafts.
 */
export const shelfDraftProposalSchema = z.object({
  rows: z.array(shelfDraftRowSchema).max(24),
  /** New nouns that must be accepted into Item Catalog first — never written as shelf. */
  pendingItemDrafts: z.array(itemDraftCardSchema).max(16),
  warnings: z.array(z.string().max(200)).max(20),
  model: z.string().max(120).optional(),
});
export type ShelfDraftProposal = z.infer<typeof shelfDraftProposalSchema>;

export const lootDraftProposalSchema = z.object({
  rows: z.array(lootDraftRowSchema).max(24),
  pendingItemDrafts: z.array(itemDraftCardSchema).max(16),
  warnings: z.array(z.string().max(200)).max(20),
  model: z.string().max(120).optional(),
});
export type LootDraftProposal = z.infer<typeof lootDraftProposalSchema>;

export const acceptShelfRowsInputSchema = z.object({
  buildingAssetId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
  expectedRevision: z.number().int().nonnegative(),
  rows: z.array(shelfDraftRowSchema).min(1).max(24),
  /** Replace existing shelf (true) or append (false, default). */
  replace: z.boolean().optional(),
});
export type AcceptShelfRowsInput = z.infer<typeof acceptShelfRowsInputSchema>;

export const acceptLootRowsInputSchema = z.object({
  buildingAssetId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
  expectedRevision: z.number().int().nonnegative(),
  rows: z.array(lootDraftRowSchema).min(1).max(24),
  replace: z.boolean().optional(),
});
export type AcceptLootRowsInput = z.infer<typeof acceptLootRowsInputSchema>;

export function shelfDraftRowToShelfLine(row: ShelfDraftRow): ShelfLine {
  const line: ShelfLine = { itemId: row.itemId };
  if (row.price) line.price = row.price;
  if (row.stockMax !== undefined) line.stockMax = row.stockMax;
  if (row.restock) line.restock = row.restock;
  if (row.labelOverride) line.labelOverride = row.labelOverride;
  return line;
}

export function lootDraftRowToLootLine(row: LootDraftRowCard): LootLine {
  return { itemId: row.itemId, qty: row.qty, chance: row.chance };
}
