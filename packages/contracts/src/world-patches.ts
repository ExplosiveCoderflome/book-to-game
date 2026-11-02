import { z } from 'zod';

const patchId = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
const optionalPatchValue = z.unknown().refine(
  value => value === undefined || (JSON.stringify(value)?.length ?? 0) <= 4000,
  '补丁预览单值不能超过 4000 字符',
);

/** A small, human-reviewable world diff. Never carries the whole WorldContent. */
export const worldPatchChangeSchema = z.object({
  path: z.string().min(1).max(160),
  op: z.enum(['add', 'remove', 'replace']),
  before: optionalPatchValue.optional(),
  after: optionalPatchValue.optional(),
  note: z.string().max(240).optional(),
});
export type WorldPatchChange = z.infer<typeof worldPatchChangeSchema>;

export const proposeClockPatchInputSchema = z.object({
  worldDraftId: z.string().min(1),
  intent: z.string().trim().max(500).optional(),
  unit: z.enum(['day', 'week', 'month', 'year']).optional(),
  limitMonths: z.number().int().min(1).max(2400).optional(),
});
export type ProposeClockPatchInput = z.infer<typeof proposeClockPatchInputSchema>;

export const proposeStoryletPatchInputSchema = z.object({
  worldDraftId: z.string().min(1),
  storyletId: patchId.optional(),
  intent: z.string().trim().max(500).optional(),
  title: z.string().min(1).max(120).optional(),
  text: z.string().min(1).max(2000).optional(),
  kind: z.enum(['main', 'repeat', 'trigger']).optional(),
  locationIds: z.array(patchId).max(40).optional(),
  choiceLabel: z.string().min(1).max(200).optional(),
}).refine(input => !!(input.storyletId || input.intent || input.title || input.text), '至少提供 storyletId、intent、title 或 text');
export type ProposeStoryletPatchInput = z.infer<typeof proposeStoryletPatchInputSchema>;

export const worldPatchModelOutputSchema = z.object({
  summary: z.string().min(1).max(500),
  changes: z.array(worldPatchChangeSchema).max(24).default([]),
  warnings: z.array(z.string().max(240)).max(12).default([]),
});
export type WorldPatchModelOutput = z.infer<typeof worldPatchModelOutputSchema>;

export const worldPatchProposalSchema = z.object({
  worldDraftId: z.string().min(1),
  baseVersion: z.number().int().positive(),
  kind: z.enum(['clock', 'storylet']),
  summary: z.string().min(1).max(500),
  changes: z.array(worldPatchChangeSchema).max(24),
  warnings: z.array(z.string().max(240)).max(12),
  model: z.string().max(120).optional(),
});
export type WorldPatchProposal = z.infer<typeof worldPatchProposalSchema>;

/** Apply an already-reviewed field-level proposal. `version` is the optimistic draft lock. */
export const applyWorldPatchInputSchema = z.object({
  worldDraftId: z.string().min(1),
  version: z.number().int().positive(),
  changes: z.array(worldPatchChangeSchema).min(1).max(24),
});
export type ApplyWorldPatchInput = z.infer<typeof applyWorldPatchInputSchema>;
