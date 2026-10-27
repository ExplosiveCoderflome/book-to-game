import { z } from 'zod';
export * from './world.js';
export { modelListInputSchema, modelSettingsInputSchema, type ModelListInput, type ModelListResult, type ModelSettingsInput, type ModelSettingsView, type ModelConnectionResult } from './model-settings.js';

export const evidenceSchema = z.object({ chapterId: z.string().min(1).max(80), paragraphId: z.string().min(1).max(80) });
export type Evidence = z.infer<typeof evidenceSchema>;
export interface Paragraph { id: string; index: number; text: string }
export interface Chapter { id: string; index: number; title: string; paragraphs: Paragraph[] }
export interface SourceSummary {
  id: string; title: string; filename: string; encoding: string;
  chapterCount: number; charCount: number; createdAt: string;
}
export interface SourceDocument extends SourceSummary { chapters: Chapter[] }

export const variableValueSchema = z.union([z.string().max(2000), z.number().finite(), z.boolean()]);
export type VariableValue = z.infer<typeof variableValueSchema>;
const variableNameSchema = z.string().min(1).max(80);
export const storyConditionSchema = z.discriminatedUnion('type', [
  z.object({type: z.literal('variable.equals'), variable: variableNameSchema, value: variableValueSchema}),
  z.object({type: z.literal('variable.gte'), variable: variableNameSchema, value: z.number().finite()}),
]);
export const storyEffectSchema = z.discriminatedUnion('type', [
  z.object({type: z.literal('variable.set'), variable: variableNameSchema, value: variableValueSchema}),
  z.object({type: z.literal('variable.increment'), variable: variableNameSchema, value: z.number().finite()}),
]);
export type StoryCondition = z.infer<typeof storyConditionSchema>;
export type StoryEffect = z.infer<typeof storyEffectSchema>;

export const choiceSchema = z.object({
  id: z.string().min(1).max(80), label: z.string().min(1).max(300), targetSceneId: z.string().min(1).max(80),
  conditions: z.array(storyConditionSchema).max(20).optional(), effects: z.array(storyEffectSchema).max(20).optional(),
});
export type Choice = z.infer<typeof choiceSchema>;
export const sceneSchema = z.object({
  id: z.string().min(1).max(80), title: z.string().min(1).max(200),
  text: z.string().min(1).max(12000), origin: z.enum(['source', 'adapted']),
  evidence: z.array(evidenceSchema).max(30), choices: z.array(choiceSchema).max(8),
  ending: z.string().max(1000).optional(),
});
export const canvasLayoutSchema = z.record(
  z.string().min(1).max(80),
  z.object({ x: z.number().finite(), y: z.number().finite() }),
);
export type CanvasLayout = z.infer<typeof canvasLayoutSchema>;
export const gameContentSchema = z.object({
  title: z.string().min(1).max(200), mode: z.literal('story'),
  premise: z.string().min(1).max(4000), adaptationNotes: z.string().max(4000),
  variables: z.record(variableNameSchema, variableValueSchema).optional(),
  /** Optional infinite-canvas node positions; authoring metadata, ignored by play runtime. */
  canvasLayout: canvasLayoutSchema.optional(),
  startSceneId: z.string().min(1).max(80), scenes: z.array(sceneSchema).min(3).max(100),
});
export type GameContent = z.infer<typeof gameContentSchema>;
export type Scene = z.infer<typeof sceneSchema>;
export interface Draft {
  id: string; sourceId: string; content: GameContent; version: number; createdAt: string; updatedAt: string;
}
export interface GameRevision {
  id: string; draftId: string; sourceId: string; version: number; content: GameContent; createdAt: string;
}
export interface ValidationResult { valid: boolean; errors: string[]; warnings: string[] }
export interface SessionView {
  id: string; gameRevisionId: string; turn: number; ended: boolean;
  variables?: Record<string, VariableValue>;
  scene: {id: string; title: string; text: string; ending?: string; choices: {id: string; label: string}[]};
  history: {turn: number; sceneId: string; choiceLabel?: string; text: string}[];
  createdAt: string; updatedAt: string;
}
export const actSchema = z.object({
  choiceId: z.string().min(1), expectedTurn: z.number().int().nonnegative(), requestId: z.string().uuid(),
});
export type ActInput = z.infer<typeof actSchema>;
export const analysisSchema = z.object({
  summary: z.string().min(1).max(2000),
  characters: z.array(z.object({name: z.string().max(120), description: z.string().max(1000), evidence: z.array(evidenceSchema).max(10)})).max(30),
  locations: z.array(z.object({name: z.string().max(120), description: z.string().max(1000), evidence: z.array(evidenceSchema).max(10)})).max(30),
  worldRules: z.array(z.object({text: z.string().max(1000), evidence: z.array(evidenceSchema).max(10)})).max(30),
  uncertainties: z.array(z.string().max(1000)).max(30),
});
export type Analysis = z.infer<typeof analysisSchema>;
export interface AnalysisResult extends Analysis { coverage: {chapterIds: string[]; totalChapters: number} }
export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export interface JobFailure {
  code: string; message: string; path?: string; step: string; attempt: number; requestId: string;
}
export interface GenerationJob {
  id: string; sourceId: string; status: JobStatus; stage: string; progress: number;
  completedChunks: number; totalChunks: number; error: string | null; draftId: string | null;
  analysis: AnalysisResult | null; createdAt: string; updatedAt: string;
  mode?: 'story' | 'open'; chapterIds?: string[]; playerRole?: string; canonPolicy?: 'faithful' | 'divergent'; direction?: string;
  failure?: JobFailure | null;
}
export const generationInputSchema = z.object({
  sourceId: z.string().min(1), requestId: z.string().uuid(),
  direction: z.string().max(2000).default('尊重原作世界规则，设计一次有明确选择后果的短篇冒险'),
  mode: z.enum(['story', 'open']).optional(), chapterIds: z.array(z.string().min(1).max(80)).min(1).max(1000).optional(),
  playerRole: z.string().trim().max(500).optional(), canonPolicy: z.enum(['faithful', 'divergent']).optional(),
});
export type GenerationInput = z.infer<typeof generationInputSchema>;
export interface RuntimeInfo { providerConfigured: boolean; supportedModes: ('story' | 'open')[]; version: string }
export interface ApiError { error: {code: string; message: string; details?: unknown; requestId?: string} }

/** Topology-first story graph: prose may be empty/short until expand. */
export const skeletonSceneSchema = z.object({
  id: z.string().min(1).max(80), title: z.string().min(1).max(200),
  text: z.string().max(12000).default(''), origin: z.enum(['source', 'adapted']),
  evidence: z.array(evidenceSchema).max(30).default([]), choices: z.array(choiceSchema).max(8),
  ending: z.string().max(1000).optional(),
});
export const branchSkeletonSchema = z.object({
  title: z.string().min(1).max(200), mode: z.literal('story'),
  premise: z.string().min(1).max(4000), adaptationNotes: z.string().max(4000),
  variables: z.record(variableNameSchema, variableValueSchema).optional(),
  canvasLayout: canvasLayoutSchema.optional(),
  startSceneId: z.string().min(1).max(80), scenes: z.array(skeletonSceneSchema).min(3).max(100),
});
export type SkeletonScene = z.infer<typeof skeletonSceneSchema>;
export type BranchSkeleton = z.infer<typeof branchSkeletonSchema>;

export {
  assessPlayability, annotatePlayability, collectPlayabilityIssues,
  type PlayabilityMode, type PlayabilityIssue, type PlayabilityAnnotation, type PlayabilityGraph, type PlayabilityResult,
} from './playability.js';
