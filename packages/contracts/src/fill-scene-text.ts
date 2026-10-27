import { z } from 'zod';

/** Model output: deepened body; optional polished title when requested. */
export const fillSceneTextModelOutputSchema = z.object({
  text: z.string().trim().min(1).max(12000),
  title: z.string().trim().min(1).max(200).optional(),
});
export type FillSceneTextModelOutput = z.infer<typeof fillSceneTextModelOutputSchema>;

export const fillSceneTextInputSchema = z.object({
  id: z.string().min(1),
  sceneId: z.string().min(1).max(80),
  direction: z.string().max(2000).optional(),
  /** When true, model may also return a polished title; client applies only if present. */
  polishTitle: z.boolean().optional(),
  /** Prefer dirty local prose when the author has unsaved edits. */
  currentText: z.string().max(12000).optional(),
  currentTitle: z.string().max(200).optional(),
});
export type FillSceneTextInput = z.infer<typeof fillSceneTextInputSchema>;

export const fillSceneTextResultSchema = z.object({
  status: z.enum(['ok', 'unavailable']),
  sceneId: z.string(),
  text: z.string().nullable(),
  title: z.string().nullable(),
  reason: z.string().nullable(),
});
export type FillSceneTextResult = z.infer<typeof fillSceneTextResultSchema>;
