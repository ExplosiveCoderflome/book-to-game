import { z } from 'zod';
import { worldContentSchema, resourceDefSchema, storyletSchema, endConditionSchema } from './world.js';

const entityId = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
const entityOperation = <E extends string, T extends z.ZodTypeAny>(entity: E, schema: T) => z.union([
  z.object({entity: z.literal(entity), op: z.literal('add'), value: schema}).strict(),
  z.object({entity: z.literal(entity), op: z.literal('replace'), id: entityId, value: schema}).strict(),
  z.object({entity: z.literal(entity), op: z.literal('remove'), id: entityId}).strict(),
]);
const resourceOperation = z.union([
  z.object({entity: z.literal('resource'), op: z.literal('add'), resourceId: entityId, value: resourceDefSchema}).strict(),
  z.object({entity: z.literal('resource'), op: z.literal('replace'), id: entityId, value: resourceDefSchema}).strict(),
  z.object({entity: z.literal('resource'), op: z.literal('remove'), id: entityId}).strict(),
]);

export const worldCompositionOperationSchema = z.union([
  entityOperation('location', worldContentSchema.shape.locations.element),
  entityOperation('fact', worldContentSchema.shape.facts.element),
  entityOperation('action', worldContentSchema.shape.actions.element),
  entityOperation('storylet', storyletSchema),
  resourceOperation,
  entityOperation('event', worldContentSchema.shape.events.element),
  entityOperation('ending', worldContentSchema.shape.endings.element),
  entityOperation('end-condition', endConditionSchema),
]);
export type WorldCompositionOperation = z.infer<typeof worldCompositionOperationSchema>;

export const blockSelectionSchema = z.object({blockId: z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/), version: z.number().int().positive(), params: z.record(z.string(), z.unknown()).default({})}).strict();
export const validateWorldCompositionInputSchema = z.object({worldId: z.string().min(1), expectedVersion: z.number().int().positive(), operations: z.array(worldCompositionOperationSchema).min(1).max(100), blockSelections: z.array(blockSelectionSchema).max(40).optional()}).strict();
export const applyWorldCompositionInputSchema = validateWorldCompositionInputSchema;
export type WorldCompositionInput = z.infer<typeof validateWorldCompositionInputSchema>;

export const createWorldFromIdeaInputSchema = z.object({requestId: z.string().uuid(), title: z.string().trim().min(1).max(160), idea: z.string().trim().min(1).max(16000), sourceIds: z.array(z.string().uuid()).max(20).default([]), content: worldContentSchema, blockSelections: z.array(blockSelectionSchema).max(40).optional()}).strict();
export type CreateWorldFromIdeaInput = z.infer<typeof createWorldFromIdeaInputSchema>;

export const ideaWorldSourceKind = 'idea-world';

export const checkWorldLedgerInputSchema = z.object({worldId: z.string().min(1).max(80), expectedVersion: z.number().int().positive(), maxStates: z.number().int().min(100).max(10_000).optional()}).strict();
export type CheckWorldLedgerInput = z.infer<typeof checkWorldLedgerInputSchema>;
export const ledgerWitnessSchema = z.object({seed: z.number().int().positive(), actionIds: z.array(entityId).max(200)}).strict();
export type LedgerWitness = z.infer<typeof ledgerWitnessSchema>;

export const checkWorldCausalityInputSchema = z.object({worldId: z.string().min(1).max(80), expectedVersion: z.number().int().positive(),
  witnessReportId: z.string().uuid().optional(), maxStates: z.number().int().min(100).max(10_000).default(1_000)}).strict()
  .refine(input => input.witnessReportId === undefined, {message: 'witnessReportId 暂不支持；请按当前 hash 重新生成因果报告'});
export type CheckWorldCausalityInput = z.infer<typeof checkWorldCausalityInputSchema>;
export const checkWorldPreservationInputSchema = z.object({worldId: z.string().min(1).max(80), expectedVersion: z.number().int().positive()}).strict();
export type CheckWorldPreservationInput = z.infer<typeof checkWorldPreservationInputSchema>;
