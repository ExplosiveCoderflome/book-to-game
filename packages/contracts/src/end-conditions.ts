import { z } from 'zod';
import {
  endConditionSetDraftSchema,
  worldConditionSchema,
  worldEndConditionsSchema,
  type EndConditionDraft,
  type WorldEndConditions,
} from './world.js';

/**
 * 终局条件的 Agent 提议 / 确认契约（阿拼 `end-conditions`）。
 *
 * 关键纪律：
 * - 提议只读：模型或 mock 只产出「多套胜负条件包」，不改草稿。
 * - 确认才写：作者挑一套（或提交自定义文本解析成同一结构）后，才写入 world.endConditions。
 * - 每次改动都带严重度：改胜负条件会重塑整局，编辑路径必须显式确认。
 */

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);

/** Read-only author input. Never carries the whole manuscript. */
export const proposeEndConditionsInputSchema = z.object({
  worldDraftId: z.string().min(1),
  /** Optional intent / theme hint; the draft stays the source of truth. */
  intent: z.string().trim().max(500).optional(),
  /** Optional brief excerpt (e.g. production brief goal / setting). */
  summary: z.string().trim().max(2000).optional(),
});
export type ProposeEndConditionsInput = z.infer<typeof proposeEndConditionsInputSchema>;

/** Model-side output: 2–4 complete packages, each with ≥1 win and ≥1 lose condition. */
export const endConditionsModelOutputSchema = z.object({
  packages: z.array(endConditionSetDraftSchema).min(2).max(4),
  warnings: z.array(z.string().max(240)).max(12).default([]),
});
export type EndConditionsModelOutput = z.infer<typeof endConditionsModelOutputSchema>;

/** Read-only proposal returned to the author for picking one package or writing custom text. */
export const proposeEndConditionsProposalSchema = z.object({
  worldDraftId: z.string().min(1),
  baseVersion: z.number().int().positive(),
  packages: z.array(endConditionSetDraftSchema).min(2).max(4),
  warnings: z.array(z.string().max(240)).max(12),
  /** Author-facing warning: every end-condition package reshapes the whole run. */
  severity: z.literal('reshapes-game'),
  severityNote: z.string().min(1).max(300),
  model: z.string().max(120).optional(),
});
export type ProposeEndConditionsProposal = z.infer<typeof proposeEndConditionsProposalSchema>;

/** One chosen package: exactly what the proposal returned. Custom text is parsed into the same drafts. */
export const endConditionSelectionSchema = z.union([
  z.object({
    kind: z.literal('package'),
    packageId: z.string().min(1).max(80),
    packageLabel: z.string().min(1).max(120).optional(),
    win: z.array(z.object({
      id: id.optional(), label: z.string().min(1).max(200),
      when: z.array(worldConditionSchema).min(1).max(10), note: z.string().max(300).optional(),
    })).min(1).max(6),
    lose: z.array(z.object({
      id: id.optional(), label: z.string().min(1).max(200),
      when: z.array(worldConditionSchema).min(1).max(10), note: z.string().max(300).optional(),
    })).min(1).max(6),
  }),
  z.object({
    kind: z.literal('custom'),
    /** Natural-language lines; parsed against the draft's resources / facts / storylets. */
    text: z.string().trim().min(1).max(4000),
  }),
]);
export type EndConditionSelection = z.infer<typeof endConditionSelectionSchema>;

/**
 * Apply an author-confirmed end-condition set. `version` is the optimistic draft lock.
 * `acknowledgeReshape` must be true when the draft already has end conditions — editing them later
 * reshapes the whole game and the author must opt in explicitly.
 */
export const applyEndConditionsInputSchema = z.object({
  worldDraftId: z.string().min(1),
  version: z.number().int().positive(),
  selection: endConditionSelectionSchema,
  acknowledgeReshape: z.boolean().default(false),
});
export type ApplyEndConditionsInput = z.infer<typeof applyEndConditionsInputSchema>;

export const applyEndConditionsResultSchema = z.object({
  draftId: z.string().min(1),
  version: z.number().int().positive(),
  endConditions: worldEndConditionsSchema,
  severity: z.literal('reshapes-game'),
  severityNote: z.string().min(1).max(300),
});
export type ApplyEndConditionsResult = z.infer<typeof applyEndConditionsResultSchema>;

/** Convenience: the shape written into a world, with fresh ids and source metadata. */
export function buildWorldEndConditions(input: {
  source: WorldEndConditions['source'];
  win: EndConditionDraft[];
  lose: EndConditionDraft[];
  packageId?: string;
  packageLabel?: string;
  endingFor: (kind: 'win' | 'lose', draft: EndConditionDraft, index: number) => string;
}): WorldEndConditions {
  const toItem = (kind: 'win' | 'lose') => (draft: EndConditionDraft, index: number) => ({
    id: draft.id ?? `${kind}_${index + 1}`,
    kind,
    label: draft.label,
    when: draft.when,
    endingId: input.endingFor(kind, draft, index),
    ...(draft.note ? {note: draft.note} : {}),
  });
  return worldEndConditionsSchema.parse({
    source: input.source,
    ...(input.packageId ? {packageId: input.packageId} : {}),
    ...(input.packageLabel ? {packageLabel: input.packageLabel} : {}),
    severity: 'reshapes-game' as const,
    win: input.win.map(toItem('win')),
    lose: input.lose.map(toItem('lose')),
  });
}
