import { z } from 'zod';

/** Model output: deepened scene body only (MVP). */
export const fillSceneTextModelOutputSchema = z.object({
  text: z.string().trim().min(1).max(12000),
});
export type FillSceneTextModelOutput = z.infer<typeof fillSceneTextModelOutputSchema>;

export const fillSceneTextInputSchema = z.object({
  id: z.string().min(1),
  sceneId: z.string().min(1).max(80),
  direction: z.string().max(2000).optional(),
  /** Prefer dirty local prose when the author has unsaved edits. */
  currentText: z.string().max(12000).optional(),
  currentTitle: z.string().max(200).optional(),
});
export type FillSceneTextInput = z.infer<typeof fillSceneTextInputSchema>;

export const fillSceneTextResultSchema = z.object({
  status: z.enum(['ok', 'unavailable']),
  sceneId: z.string(),
  text: z.string().nullable(),
  reason: z.string().nullable(),
});
export type FillSceneTextResult = z.infer<typeof fillSceneTextResultSchema>;
