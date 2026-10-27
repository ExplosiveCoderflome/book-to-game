import { z } from 'zod';

/** One currently visible+enabled option the model may name. */
export const proposeCandidateSchema = z.object({
  id: z.string().min(1).max(80),
  label: z.string().min(1).max(200),
});
export type ProposeCandidate = z.infer<typeof proposeCandidateSchema>;

/** Raw model output: only an id from the provided list, or none. */
export const proposeActModelOutputSchema = z.object({
  choiceId: z.union([z.string().min(1).max(80), z.literal('none')]),
  rationale: z.string().max(300).optional(),
});
export type ProposeActModelOutput = z.infer<typeof proposeActModelOutputSchema>;

export const proposeActInputSchema = z.object({
  text: z.string().trim().min(1).max(500),
  expectedTurn: z.number().int().nonnegative(),
  requestId: z.string().uuid(),
  /** When true (default), a validated choiceId advances the session via act. */
  autoAct: z.boolean().optional().default(true),
  /** Optional play-time「天道修正」system-prompt injection (phase 1: prompt-only). */
  tiandaoCorrect: z.boolean().optional(),
});
export type ProposeActInput = z.infer<typeof proposeActInputSchema>;

export const proposeActResultSchema = z.object({
  status: z.enum(['acted', 'mapped', 'none', 'rejected']),
  choiceId: z.string().nullable(),
  label: z.string().nullable(),
  reason: z.string().nullable(),
  candidates: z.array(proposeCandidateSchema),
  /** Present when status === 'acted'. */
  session: z.unknown().optional(),
});
export type ProposeActResult = z.infer<typeof proposeActResultSchema>;

/** Adventure variant: same shape, actionId instead of choiceId in model output. */
export const proposeAdventureModelOutputSchema = z.object({
  actionId: z.union([z.string().min(1).max(80), z.literal('none')]),
  rationale: z.string().max(300).optional(),
});
export type ProposeAdventureModelOutput = z.infer<typeof proposeAdventureModelOutputSchema>;

export const proposeAdventureActInputSchema = z.object({
  text: z.string().trim().min(1).max(500),
  expectedTurn: z.number().int().nonnegative(),
  requestId: z.string().uuid(),
  autoAct: z.boolean().optional().default(true),
  /** Optional play-time「天道修正」system-prompt injection (phase 1: prompt-only). */
  tiandaoCorrect: z.boolean().optional(),
});
export type ProposeAdventureActInput = z.infer<typeof proposeAdventureActInputSchema>;

export const proposeAdventureActResultSchema = z.object({
  status: z.enum(['acted', 'mapped', 'none', 'rejected']),
  actionId: z.string().nullable(),
  label: z.string().nullable(),
  reason: z.string().nullable(),
  candidates: z.array(proposeCandidateSchema),
  adventure: z.unknown().optional(),
});
export type ProposeAdventureActResult = z.infer<typeof proposeAdventureActResultSchema>;

/**
 * Server-side gate: model may only pick from projected (worldbook-filtered) candidates.
 * Does not invent edges; returns none/rejected with zh-CN reasons.
 */
export function resolveProposedId(
  proposed: string | 'none',
  candidates: ProposeCandidate[],
): { status: 'mapped'; id: string; label: string } | { status: 'none' | 'rejected'; reason: string } {
  if (proposed === 'none') {
    return { status: 'none', reason: '未能匹配到当前可选行动，请从下列选项中选择。' };
  }
  const hit = candidates.find(c => c.id === proposed);
  if (!hit) {
    return { status: 'rejected', reason: '模型点名了当前不可用的选项（可能被世界书禁止或未出现在可见列表）。' };
  }
  return { status: 'mapped', id: hit.id, label: hit.label };
}
