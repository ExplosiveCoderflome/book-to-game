import { z } from 'zod';
import { MAP_FILL_KINDS, mapFillKindSchema, type MapFillKind } from './world-map.js';
import {
  BUILDING_KIND_COLOR,
  type BuildingAssetDraft,
  buildingResourceCostSchema,
  buildingStockLineSchema,
} from './building-library.js';

/**
 * AI "propose building assets" (author-time). Model only proposes; library writes go through catalog create.
 * Never mutates play/session state.
 */
export const buildingDraftModelItemSchema = z.object({
  label: z.string().trim().min(1).max(80),
  kind: mapFillKindSchema,
  tags: z.array(z.string().trim().min(1).max(40)).max(8).optional(),
  icon: z.string().trim().min(1).max(40).optional(),
  blurb: z.string().trim().max(500).optional(),
  interactLabel: z.string().trim().min(1).max(80).optional(),
  inventory: z.array(z.string().trim().min(1).max(80)).max(12).optional(),
  loot: z.array(z.string().trim().min(1).max(80)).max(12).optional(),
  worldbookTags: z.array(z.string().trim().min(1).max(40)).max(8).optional(),
});
export type BuildingDraftModelItem = z.infer<typeof buildingDraftModelItemSchema>;

export const buildingDraftModelOutputSchema = z.object({
  buildings: z.array(buildingDraftModelItemSchema).max(16).default([]),
});
export type BuildingDraftModelOutput = z.infer<typeof buildingDraftModelOutputSchema>;

export const proposeBuildingAssetsInputSchema = z.object({
  /** Short author prompt, e.g. "雾港海边城镇的日常设施". */
  prompt: z.string().trim().min(1).max(2000),
  /** Optional kind filter; when empty the model may mix kinds. */
  kinds: z.array(mapFillKindSchema).max(5).optional(),
  /** Soft genre hint: fantasy / urban / wasteland / wuxia / … */
  genre: z.string().trim().max(40).optional(),
  /** Optional novel / worldbook snippet — untrusted narrative only. */
  context: z.string().max(8_000).optional(),
  /** Desired count hint (1–12). Model may return fewer. */
  count: z.number().int().min(1).max(12).optional(),
});
export type ProposeBuildingAssetsInput = z.infer<typeof proposeBuildingAssetsInputSchema>;

/** One reviewable draft card before library write. */
export const buildingDraftCardSchema = z.object({
  draftId: z.string().min(1).max(80),
  kind: mapFillKindSchema,
  label: z.string().min(1).max(80),
  tags: z.array(z.string()).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  icon: z.string().optional(),
  blurb: z.string().optional(),
  defaultInteract: z.object({ label: z.string().min(1).max(80).optional() }).optional(),
  inventoryDraft: z.array(buildingStockLineSchema).optional(),
  lootDraft: z.array(buildingStockLineSchema).optional(),
  worldbookTags: z.array(z.string()).optional(),
  resourceCosts: z.array(buildingResourceCostSchema).optional(),
});
export type BuildingDraftCard = z.infer<typeof buildingDraftCardSchema>;

export const buildingDraftProposalSchema = z.object({
  drafts: z.array(buildingDraftCardSchema).max(16),
  warnings: z.array(z.string().max(200)).max(20),
  model: z.string().max(120).optional(),
});
export type BuildingDraftProposal = z.infer<typeof buildingDraftProposalSchema>;

export const acceptBuildingDraftsInputSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  drafts: z.array(buildingDraftCardSchema).min(1).max(16),
});
export type AcceptBuildingDraftsInput = z.infer<typeof acceptBuildingDraftsInputSchema>;

export function modelItemToDraftCard(item: BuildingDraftModelItem, index: number): BuildingDraftCard {
  const card: BuildingDraftCard = {
    draftId: `ai_${item.kind}_${index + 1}`,
    kind: item.kind,
    label: item.label,
    color: BUILDING_KIND_COLOR[item.kind],
  };
  if (item.tags?.length) card.tags = item.tags;
  if (item.icon) card.icon = item.icon;
  if (item.blurb) card.blurb = item.blurb;
  if (item.interactLabel) card.defaultInteract = { label: item.interactLabel };
  if (item.inventory?.length) card.inventoryDraft = item.inventory.map(label => ({ label }));
  if (item.loot?.length) card.lootDraft = item.loot.map(label => ({ label }));
  if (item.worldbookTags?.length) card.worldbookTags = item.worldbookTags;
  return card;
}

/** Convert a reviewed card into a catalog create draft (no id — createBuildingAsset allocates). */
export function draftCardToAssetDraft(card: BuildingDraftCard): BuildingAssetDraft {
  const draft: BuildingAssetDraft = {
    kind: card.kind,
    label: card.label,
    provenance: { source: 'ai-propose', createdAt: new Date().toISOString() },
  };
  if (card.tags?.length) draft.tags = card.tags;
  if (card.color) draft.color = card.color;
  if (card.icon) draft.icon = card.icon;
  if (card.blurb) draft.blurb = card.blurb;
  if (card.defaultInteract) draft.defaultInteract = card.defaultInteract;
  if (card.inventoryDraft?.length) draft.inventoryDraft = card.inventoryDraft;
  if (card.lootDraft?.length) draft.lootDraft = card.lootDraft;
  if (card.worldbookTags?.length) draft.worldbookTags = card.worldbookTags;
  if (card.resourceCosts?.length) draft.resourceCosts = card.resourceCosts;
  return draft;
}

export const BUILDING_DRAFT_KIND_HINT: Record<MapFillKind, string> = {
  shop: '商店/商铺',
  supply: '补给点',
  quest: '任务点/告示',
  encounter: '野外遭遇',
  boss: 'Boss巢穴',
};

export { MAP_FILL_KINDS as BUILDING_DRAFT_KINDS };
