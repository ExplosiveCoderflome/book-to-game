import { z } from 'zod';
import { worldContentSchema } from './world.js';
import type { LintReport, PlaytestReport } from './preflight.js';

/** Author input, independent of a particular show, genre or provider. */
export const productionBriefSchema = z.object({
  title: z.string().trim().min(1).max(200),
  setting: z.string().trim().min(30).max(12000),
  playerRole: z.string().trim().min(2).max(500),
  goal: z.string().trim().min(10).max(2000),
  tone: z.string().trim().min(2).max(1000),
  tier: z.enum(['S', 'M']).default('S'),
});
export type ProductionBrief = z.infer<typeof productionBriefSchema>;
export const productionInputSchema = z.object({
  requestId: z.string().uuid(), brief: productionBriefSchema,
  sourceId: z.string().min(1).optional(),
});
export type ProductionInput = z.infer<typeof productionInputSchema>;

/** The author approves the actual executable mechanics before prose is generated. */
export const productionPlanSchema = z.object({
  bible: z.object({
    premise: z.string().min(20).max(2000),
    identityBoundaries: z.array(z.string().min(5).max(500)).min(2).max(12),
    cast: z.array(z.object({ name: z.string().min(1).max(80), role: z.string().min(2).max(200), relationshipToPlayer: z.string().min(5).max(500) })).min(3).max(16),
    styleGuide: z.string().min(30).max(2000),
  }),
  routes: z.array(z.object({ id: z.string().min(1).max(80), name: z.string().min(2).max(100),
    strategy: z.string().min(15).max(1000), endingIds: z.array(z.string().min(1).max(80)).min(1).max(10) })).min(3).max(8),
  world: worldContentSchema,
});
export type ProductionPlan = z.infer<typeof productionPlanSchema>;

/** Text-only model output: ids, conditions, costs and effects are never regenerated here. */
export const productionNarrativeSchema = z.object({
  texts: z.array(z.string().min(20).max(4000)).min(1).max(2),
  outcomes: z.record(z.string(), z.object({ text: z.string().min(15).max(1500),
    successText: z.string().min(15).max(1500).optional(), failureText: z.string().min(15).max(1500).optional() })).default({}),
});
export type ProductionNarrative = z.infer<typeof productionNarrativeSchema>;
export type ProductionUnit = { key: string; kind: 'location' | 'storylet' | 'action' | 'ending' | 'event' | 'timeout'; id: string; variants: 1 | 2;
  direction?: string; currentText?: ProductionNarrative };
export interface ProductionState {
  plan: ProductionPlan;
  approved: boolean;
  texts: Record<string, ProductionNarrative>;
  lint?: LintReport;
  playtest?: PlaytestReport;
  rewrite?: {key: string; direction: string; previousText?: ProductionNarrative};
}
