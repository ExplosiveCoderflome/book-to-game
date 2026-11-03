import { z } from 'zod';

/** Raw model output: flavor narration only. */
export const narrateModelOutputSchema = z.object({
  narration: z.string().trim().min(1).max(800),
});
export type NarrateModelOutput = z.infer<typeof narrateModelOutputSchema>;

/** Raw model output for the AI NPC bubble: one short in-character line. */
export const npcDialogModelOutputSchema = z.object({
  dialog: z.string().trim().min(1).max(600),
});
export type NpcDialogModelOutput = z.infer<typeof npcDialogModelOutputSchema>;

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

/** AI NPC bubble input: only currently visible NPCs may be addressed. */
export const npcDialogInputSchema = z.object({
  /** NPC id from the current adventure view; unknown ids are rejected (no invention). */
  npcId: z.string().trim().min(1).max(120),
  expectedTurn: z.number().int().nonnegative().optional(),
  force: z.boolean().optional(),
  tiandaoCorrect: z.boolean().optional(),
});
export type NpcDialogInput = z.infer<typeof npcDialogInputSchema>;

export const npcDialogResultSchema = z.object({
  status: z.enum(['ok', 'unavailable']),
  text: z.string().nullable(),
  npcId: z.string(),
  sceneId: z.string(),
  turn: z.number().int().nonnegative(),
  reason: z.string().nullable(),
  cached: z.boolean().optional(),
});
export type NpcDialogResult = z.infer<typeof npcDialogResultSchema>;
