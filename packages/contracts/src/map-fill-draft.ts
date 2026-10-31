import { z } from 'zod';
import { buildingDraftCardSchema } from './building-draft.js';
import { mapFillKindSchema } from './world-map.js';

/** Author-time map-fill proposal. The model never writes the world draft, library or a session. */
export const proposeMapFillInputSchema = z.object({
  prompt: z.string().trim().max(2000).optional(),
  kinds: z.array(mapFillKindSchema).max(5).optional(),
  count: z.number().int().min(1).max(12).optional(),
  /** New assets are reviewable drafts and still require a separate library accept. */
  allowNewAssets: z.boolean().optional(),
});
export type ProposeMapFillInput = z.infer<typeof proposeMapFillInputSchema>;

export const mapFillProposalItemSchema = z.object({
  proposalId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
  kind: mapFillKindSchema,
  locationId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
  label: z.string().min(1).max(80).optional(),
  buildingAssetId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/).optional(),
  buildingAssetVersion: z.number().int().positive().optional(),
  localOverrides: z.record(z.string(), z.unknown()).optional(),
  /** M-fill-4b: accept this into the library first, then place the returned asset id. */
  assetDraft: buildingDraftCardSchema.optional(),
}).refine(item => !(item.buildingAssetId && item.assetDraft), {
  message: '一条填充提案不能同时引用已有资产并新建资产',
});
export type MapFillProposalItem = z.infer<typeof mapFillProposalItemSchema>;

export const mapFillModelOutputSchema = z.object({
  placements: z.array(mapFillProposalItemSchema).max(16).default([]),
});
export type MapFillModelOutput = z.infer<typeof mapFillModelOutputSchema>;

export const mapFillProposalSchema = z.object({
  items: z.array(mapFillProposalItemSchema).max(16),
  warnings: z.array(z.string().max(240)).max(24),
  model: z.string().max(120).optional(),
});
export type MapFillProposal = z.infer<typeof mapFillProposalSchema>;

export const acceptMapFillInputSchema = z.object({
  version: z.number().int().positive(),
  mapId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/).optional(),
  items: z.array(mapFillProposalItemSchema).min(1).max(16),
});
export type AcceptMapFillInput = z.infer<typeof acceptMapFillInputSchema>;
