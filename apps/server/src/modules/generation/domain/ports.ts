import type { Analysis, AnalysisResult, BranchSkeleton, GameContent, GenerationInput, GenerationJob, JobFailure, ScanDepth, SceneExtension, SourceDocument, WorldContent, ProductionBrief, ProductionPlan, ProductionNarrative, ProductionUnit, LintReport, PlaytestReport } from '@novel-game/contracts';

export interface SourceReader { get(id: string): SourceDocument }
export interface SourceChunk {
  index: number; chapterIds: string[];
  paragraphs: {chapterId: string; paragraphId: string; text: string}[];
}
export interface StoredJob extends GenerationJob {
  direction: string; requestId: string; checkpoints: Analysis[];
  /** S1 ⑦: model id that produced the draft (recorded at completion; absent on legacy jobs). */
  model?: string;
}
export interface JobRepository {
  create(input: GenerationInput, totalChunks: number): StoredJob;
  get(id: string): StoredJob | null;
  findByRequestId(requestId: string): StoredJob | null;
  list(): StoredJob[];
  retry(id: string): StoredJob;
  cancel(id: string): StoredJob;
  claim(owner: string, now: number, leaseMs: number): StoredJob | null;
  heartbeat(id: string, owner: string, now: number, leaseMs: number): boolean;
  saveChunk(id: string, owner: string, index: number, analysis: Analysis): boolean;
  saveAnalysis(id: string, owner: string, analysis: AnalysisResult): boolean;
  saveSkeleton(id: string, owner: string, skeleton: BranchSkeleton): boolean;
  saveProductionPlan(id: string, owner: string, plan: ProductionPlan): boolean;
  approveProduction(id: string, plan: ProductionPlan): StoredJob;
  rewriteProduction(id: string, unitKey: string, direction: string): StoredJob;
  saveProductionText(id: string, owner: string, unit: ProductionUnit, text: ProductionNarrative, total: number): boolean;
  saveProductionLint(id: string, owner: string, lint: LintReport, playtest?: PlaytestReport): boolean;
  completeWith(id: string, owner: string, createDraft: () => string, model?: string): boolean;
  fail(id: string, owner: string, failure: string | JobFailure): void;
}
export interface ModelRepairIssue {code: string; message: string; path?: string}
export interface ModelRepairFeedback {errors: ModelRepairIssue[]}
export interface GenerationProvider {
  /** Model id used for provenance (S1 ⑦). */
  readonly modelName?: string;
  analyze(chunk: SourceChunk, signal: AbortSignal, feedback?: ModelRepairFeedback): Promise<Analysis>;
  /** Legacy one-shot path; used when skeleton/expand are absent. */
  generate?(analysis: AnalysisResult, direction: string, signal: AbortSignal, feedback?: ModelRepairFeedback): Promise<GameContent>;
  generateSkeleton?(analysis: AnalysisResult, direction: string, signal: AbortSignal, feedback?: ModelRepairFeedback, scanDepth?: ScanDepth, options?: { statTemplateId?: string }): Promise<BranchSkeleton>;
  expandScenes?(analysis: AnalysisResult, direction: string, skeleton: BranchSkeleton, signal: AbortSignal, feedback?: ModelRepairFeedback): Promise<GameContent>;
  extendScenes?(content: GameContent, sceneId: string, direction: string, signal: AbortSignal, feedback?: ModelRepairFeedback, options?: {neighborCount?: 1 | 2}): Promise<SceneExtension>;
  generateWorld?(analysis: AnalysisResult, options: WorldGenerationOptions, signal: AbortSignal, feedback?: ModelRepairFeedback): Promise<WorldContent>;
  planProduction?(analysis: AnalysisResult, brief: ProductionBrief, chapterIds: string[], signal: AbortSignal, feedback?: ModelRepairFeedback): Promise<ProductionPlan>;
  writeProductionUnit?(plan: ProductionPlan, unit: ProductionUnit, previousTexts: ProductionNarrative[], signal: AbortSignal, feedback?: ModelRepairFeedback): Promise<ProductionNarrative>;
}
export type DraftWriter = (input: {sourceId: string; content: GameContent; provenance?: {generator: string; model?: string; source?: 'runner'}}) => {id: string};
export interface WorldGenerationOptions {direction: string; chapterIds: string[]; playerRole: string; canonPolicy: 'faithful' | 'divergent'}
export type WorldDraftWriter = (input: {sourceId: string; content: WorldContent}) => {id: string};

/** S1 ⑦: one model-call log line (only the fields provenance tracing needs). */
export interface ModelLogEvent {timestamp: string; pid?: number; event: string; jobId?: string; model?: string}
export interface ModelLogReader {events(): ModelLogEvent[]}
