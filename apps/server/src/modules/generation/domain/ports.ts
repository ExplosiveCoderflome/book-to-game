import type { Analysis, AnalysisResult, BranchSkeleton, GameContent, GenerationInput, GenerationJob, JobFailure, ScanDepth, SceneExtension, SourceDocument, WorldContent } from '@novel-game/contracts';

export interface SourceReader { get(id: string): SourceDocument }
export interface SourceChunk {
  index: number; chapterIds: string[];
  paragraphs: {chapterId: string; paragraphId: string; text: string}[];
}
export interface StoredJob extends GenerationJob {
  direction: string; requestId: string; checkpoints: Analysis[];
}
export interface JobRepository {
  create(input: GenerationInput, totalChunks: number): StoredJob;
  get(id: string): StoredJob | null;
  list(): StoredJob[];
  retry(id: string): StoredJob;
  cancel(id: string): StoredJob;
  claim(owner: string, now: number, leaseMs: number): StoredJob | null;
  heartbeat(id: string, owner: string, now: number, leaseMs: number): boolean;
  saveChunk(id: string, owner: string, index: number, analysis: Analysis): boolean;
  saveAnalysis(id: string, owner: string, analysis: AnalysisResult): boolean;
  saveSkeleton(id: string, owner: string, skeleton: BranchSkeleton): boolean;
  completeWith(id: string, owner: string, createDraft: () => string): boolean;
  fail(id: string, owner: string, failure: string | JobFailure): void;
}
export interface ModelRepairIssue {code: string; message: string; path?: string}
export interface ModelRepairFeedback {errors: ModelRepairIssue[]}
export interface GenerationProvider {
  analyze(chunk: SourceChunk, signal: AbortSignal, feedback?: ModelRepairFeedback): Promise<Analysis>;
  /** Legacy one-shot path; used when skeleton/expand are absent. */
  generate?(analysis: AnalysisResult, direction: string, signal: AbortSignal, feedback?: ModelRepairFeedback): Promise<GameContent>;
  generateSkeleton?(analysis: AnalysisResult, direction: string, signal: AbortSignal, feedback?: ModelRepairFeedback, scanDepth?: ScanDepth): Promise<BranchSkeleton>;
  expandScenes?(analysis: AnalysisResult, direction: string, skeleton: BranchSkeleton, signal: AbortSignal, feedback?: ModelRepairFeedback): Promise<GameContent>;
  extendScenes?(content: GameContent, sceneId: string, direction: string, signal: AbortSignal, feedback?: ModelRepairFeedback): Promise<SceneExtension>;
  generateWorld?(analysis: AnalysisResult, options: WorldGenerationOptions, signal: AbortSignal, feedback?: ModelRepairFeedback): Promise<WorldContent>;
}
export type DraftWriter = (input: {sourceId: string; content: GameContent}) => {id: string};
export interface WorldGenerationOptions {direction: string; chapterIds: string[]; playerRole: string; canonPolicy: 'faithful' | 'divergent'}
export type WorldDraftWriter = (input: {sourceId: string; content: WorldContent}) => {id: string};
