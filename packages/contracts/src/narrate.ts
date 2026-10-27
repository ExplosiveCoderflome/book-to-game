import { z } from 'zod';

/** Raw model output: flavor narration only. */
export const narrateModelOutputSchema = z.object({
  narration: z.string().trim().min(1).max(800),
});
export type NarrateModelOutput = z.infer<typeof narrateModelOutputSchema>;

export const narrateInputSchema = z.object({
  /** When set, rejects if session turn drifted (soft client refresh). */
  expectedTurn: z.number().int().nonnegative().optional(),
  /** Bypass per-visit cache and call the model again. */
  force: z.boolean().optional(),
  /** Optional play-time「天道修正」system-prompt injection (phase 1: prompt-only). */
  tiandaoCorrect: z.boolean().optional(),
});
export type NarrateInput = z.infer<typeof narrateInputSchema>;

export const narrateResultSchema = z.object({
  status: z.enum(['ok', 'unavailable']),
  text: z.string().nullable(),
  sceneId: z.string(),
  turn: z.number().int().nonnegative(),
  reason: z.string().nullable(),
  cached: z.boolean().optional(),
});
export type NarrateResult = z.infer<typeof narrateResultSchema>;
