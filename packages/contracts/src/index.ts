import { z } from 'zod';
import { productionBriefSchema, type ProductionBrief, type ProductionState } from './production.js';
export * from './production.js';
export * from './world.js';
export * from './world-map.js';
export * from './map-templates.js';
export * from './building-library.js';
export * from './building-draft.js';
export * from './building-image.js';
export * from './item-catalog.js';
export * from './item-draft.js';
export * from './map-draft.js';
export type * from './preflight.js';
export {
  worldbookSchema, worldbookEntrySchema, worldbookConstraintSchema, worldbookEntryKindSchema,
  worldbookScopeSchema, emptyWorldbook, validateWorldbookContent,
  type Worldbook, type WorldbookEntry, type WorldbookConstraint, type WorldbookEntryKind, type WorldbookScope,
  type WorldbookPlaceKind,
} from './worldbook.js';
import { worldbookSchema } from './worldbook.js';
export {
  STAT_TEMPLATES, getStatTemplate, getStatTemplateRef, templateInitialVariables,
  applyStatTemplateVariables, displayLabelForVariable, roleForVariable, statTemplatePromptPayload,
  statTemplateIdSchema, statRoleSchema, statTemplateSchema, statTemplateVariableSchema,
  statTemplateRefSchema,
  type StatTemplate, type StatTemplateId, type StatTemplateVariable, type StatRole,
  type StatTemplateRef,
} from './stat-templates.js';
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
  /** Optional tags for worldbook hard rules (forbid / gate). Does not invent graph edges. */
  tags: z.array(z.string().min(1).max(40)).max(10).optional(),
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
  /** Lore + hard rules (power/upgrade/agency caps). Constraints are engine-enforced. */
  worldbook: worldbookSchema.optional(),
  /** Optional genre stat-template id; authoring metadata for HUD labels / regen hints. */
  statTemplateId: z.string().min(1).max(40).optional(),
  /** Template catalog version stamped with id; ignored by the rule engine. */
  statTemplateVersion: z.number().int().positive().optional(),
  startSceneId: z.string().min(1).max(80), scenes: z.array(sceneSchema).min(3).max(100),
});
export type GameContent = z.infer<typeof gameContentSchema>;
export type Scene = z.infer<typeof sceneSchema>;
export interface Draft {
  id: string; sourceId: string; content: GameContent; version: number; createdAt: string; updatedAt: string;
  /** S1 ⑦: who generated this story draft. Draft metadata only (never part of content or packages); sticky across edits. */
  provenance?: DraftProvenance;
}
/** S1 ⑦ provenance. `source`: runner = stamped at generation; backfill = traced later from run records / logs; copy = inherited from an identical mock draft. */
export interface DraftProvenance {generator: string; model?: string; source?: 'runner' | 'backfill' | 'copy'; copiedFrom?: string}
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
export const scanDepthSchema = z.enum(['coarse', 'medium', 'fine']);
export type ScanDepth = z.infer<typeof scanDepthSchema>;
export type JobStatus = 'queued' | 'running' | 'awaiting_review' | 'succeeded' | 'failed' | 'cancelled';
export interface JobFailure {
  code: string; message: string; path?: string; step: string; attempt: number; requestId: string;
}
export interface GenerationJob {
  id: string; sourceId: string; status: JobStatus; stage: string; progress: number;
  completedChunks: number; totalChunks: number; error: string | null; draftId: string | null;
  analysis: AnalysisResult | null;
  /** Locked story skeleton after generate_skeleton; exposed for mid-job canvas placeholders. */
  skeleton?: BranchSkeleton | null;
  createdAt: string; updatedAt: string;
  mode?: 'story' | 'open'; chapterIds?: string[]; playerRole?: string; canonPolicy?: 'faithful' | 'divergent'; direction?: string;
  scanDepth?: ScanDepth;
  /** Optional genre stat template for story skeleton variable seeding. */
  statTemplateId?: string;
  failure?: JobFailure | null;
  productionBrief?: ProductionBrief;
  productionState?: ProductionState;
}
export const generationInputSchema = z.object({
  sourceId: z.string().min(1), requestId: z.string().uuid(),
  direction: z.string().max(2000).default('尊重原作世界规则，设计一次有明确选择后果的短篇冒险'),
  mode: z.enum(['story', 'open']).optional(), chapterIds: z.array(z.string().min(1).max(80)).min(1).max(1000).optional(),
  playerRole: z.string().trim().max(500).optional(), canonPolicy: z.enum(['faithful', 'divergent']).optional(),
  /** Story first-scan node granularity: coarse=章弧, medium=默认, fine=细拍. Ignored for open. */
  scanDepth: scanDepthSchema.optional(),
  /** Optional genre stat template id (story mode). Seeds preferred variables into skeleton prompt. */
  statTemplateId: z.string().min(1).max(40).optional(),
  productionBrief: productionBriefSchema.optional(),
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
  worldbook: worldbookSchema.optional(),
  statTemplateId: z.string().min(1).max(40).optional(),
  statTemplateVersion: z.number().int().positive().optional(),
  startSceneId: z.string().min(1).max(80), scenes: z.array(skeletonSceneSchema).min(3).max(100),
});
export type SkeletonScene = z.infer<typeof skeletonSceneSchema>;
export type BranchSkeleton = z.infer<typeof branchSkeletonSchema>;

/** Model proposal to grow the graph from one anchor scene without wiping others. */
export const sceneExtensionSchema = z.object({
  scenes: z.array(sceneSchema).min(1).max(8),
  /** New choices attached to the anchor scene; targets must be in scenes[] (new) or existing graph. */
  anchorChoices: z.array(choiceSchema).min(1).max(4),
});
export type SceneExtension = z.infer<typeof sceneExtensionSchema>;
export const extendDraftSceneInputSchema = z.object({
  id: z.string().min(1),
  version: z.number().int().positive(),
  sceneId: z.string().min(1).max(80),
  direction: z.string().max(2000).optional(),
  /** How many neighbor scenes to grow from the anchor this round (1=单叶, 2=双邻). */
  neighborCount: z.union([z.literal(1), z.literal(2)]).optional(),
});
export type ExtendDraftSceneInput = z.infer<typeof extendDraftSceneInputSchema>;



export {
  proposeCandidateSchema, proposeActModelOutputSchema, proposeActInputSchema, proposeActResultSchema,
  proposeAdventureModelOutputSchema, proposeAdventureActInputSchema, proposeAdventureActResultSchema,
  resolveProposedId,
  type ProposeCandidate, type ProposeActModelOutput, type ProposeActInput, type ProposeActResult,
  type ProposeAdventureModelOutput, type ProposeAdventureActInput, type ProposeAdventureActResult,
} from './propose-act.js';

export {
  narrateModelOutputSchema, narrateInputSchema, narrateResultSchema,
  type NarrateModelOutput, type NarrateInput, type NarrateResult,
} from './narrate.js';

export {
  fillSceneTextModelOutputSchema, fillSceneTextInputSchema, fillSceneTextResultSchema,
  type FillSceneTextModelOutput, type FillSceneTextInput, type FillSceneTextResult,
} from './fill-scene-text.js';


export type { AgentRepairCandidate, AgentRepairChange, AgentRepairVerification } from './agent-repair.js';
export type { AgentChatToolCall, AgentChatMessage, AgentChatAction, AgentChatConversation, AgentChatSummary } from './agent-chat.js';
export { authorReadSchema, type AuthorReadInput } from './author-read.js';
