import { z } from 'zod';
import { funTagSchema } from './fun-profiles.js';
import { blockShelfIdSchema } from './blocks.js';

/** Read-only author input for `propose_fun_profile`. The draft is the source of truth. */
export const proposeFunProfileInputSchema = z.object({
  worldDraftId: z.string().min(1),
  sourceId: z.string().min(1).optional(),
  /** Optional short author summary; never the full manuscript. */
  summary: z.string().trim().max(2000).optional(),
  intent: z.string().trim().max(500).optional(),
});
export type ProposeFunProfileInput = z.infer<typeof proposeFunProfileInputSchema>;

/** A recommended block is always cross-checked against the BlockSpec registry. */
export const funBlockRecommendationSchema = z.object({
  id: z.string().min(1).max(80),
  label: z.string().min(1).max(80),
  blurb: z.string().min(1).max(400),
  funTags: z.array(funTagSchema).max(16),
  /** 积木商店货架归属，便于按货架分组展示。 */
  shelves: z.array(blockShelfIdSchema).min(1).max(5),
});
export type FunBlockRecommendation = z.infer<typeof funBlockRecommendationSchema>;

export const funProfileModelOutputSchema = z.object({
  profileId: z.string().min(1).max(40),
  rationale: z.string().min(1).max(500),
  customHints: z.array(z.string().max(200)).max(8).default([]),
});
export type FunProfileModelOutput = z.infer<typeof funProfileModelOutputSchema>;

export const proposeFunProfileProposalSchema = z.object({
  worldDraftId: z.string().min(1),
  baseVersion: z.number().int().positive(),
  suggestedProfileId: z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/),
  rationale: z.string().min(1).max(500),
  customHints: z.array(z.string().max(200)).max(8),
  recommendedBlocks: z.array(funBlockRecommendationSchema).max(32),
  warnings: z.array(z.string().max(240)).max(12),
  model: z.string().max(120).optional(),
});
export type ProposeFunProfileProposal = z.infer<typeof proposeFunProfileProposalSchema>;

export const recommendBlocksForProfileInputSchema = z.object({
  profileId: z.string().min(1).max(40),
});
export type RecommendBlocksForProfileInput = z.infer<typeof recommendBlocksForProfileInputSchema>;

export const recommendBlocksForProfileResultSchema = z.object({
  profileId: z.string().min(1).max(40),
  blocks: z.array(funBlockRecommendationSchema).max(32),
  warnings: z.array(z.string().max(240)).max(12),
});
export type RecommendBlocksForProfileResult = z.infer<typeof recommendBlocksForProfileResultSchema>;
