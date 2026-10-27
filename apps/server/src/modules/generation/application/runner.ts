import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import { AppError } from '../../../shared/errors.js';
import type { Logger } from '../../../shared/logger.js';
import { assertExpandedHonorsSkeleton, assertPlayableSkeleton } from '../../games/index.js';
import { chunkSource, mergeAnalyses, validateAnalysis } from '../domain/chunks.js';
import { annotateFailure, failureCode, failurePath, feedbackFrom, toJobFailure } from '../domain/failure.js';
import type { DraftWriter, GenerationProvider, JobRepository, ModelRepairFeedback, SourceReader, WorldDraftWriter } from '../domain/ports.js';
import { selectChapters } from '../domain/selection.js';

const SEMANTIC_REPAIR = new Set(['INVALID_EVIDENCE', 'INVALID_GENERATED_GAME', 'INVALID_GENERATED_WORLD', 'WORLD_SCOPE_MISMATCH']);

export class GenerationRunner {
  constructor(private readonly repository: JobRepository, private readonly sources: SourceReader,
    private readonly provider: GenerationProvider, private readonly createDraft: DraftWriter, private readonly createWorld?: WorldDraftWriter,
    private readonly logger?: Logger, private readonly repairAttempts = 3) {}

  async runOnce(shutdown?: AbortSignal): Promise<boolean> {
    if (shutdown?.aborted) return false;
    const owner = randomUUID();
    const job = this.repository.claim(owner, Date.now(), 120000);
    if (!job) return false;
    const controller = new AbortController();
    const signal = shutdown ? AbortSignal.any([shutdown, controller.signal]) : controller.signal;
    const startedAt = performance.now();
    let completedCount = job.checkpoints.length;
    let step = 'prepare';
    const context = {jobId: job.id, requestId: job.requestId};
    const pulse = setInterval(() => {
      try {
        if (!this.repository.heartbeat(job.id, owner, Date.now(), 120000)) controller.abort();
      } catch { controller.abort(); }
    }, 5000);
    pulse.unref();
    try {
      const source = selectChapters(this.sources.get(job.sourceId), job.chapterIds);
      const chunks = chunkSource(source);
      const completed = [...job.checkpoints];
      this.logger?.info('generation.started', {jobId: job.id, requestId: job.requestId, sourceId: job.sourceId, mode: job.mode || 'story', totalChunks: chunks.length, completedChunks: completed.length});
      for (let i = completed.length; i < chunks.length; i++) {
        signal.throwIfAborted();
        step = `analyze:${i}`;
        const chunkStartedAt = performance.now();
        this.logger?.info('generation.chunk.started', {jobId: job.id, requestId: job.requestId, index: i, totalChunks: chunks.length, chapterIds: chunks[i].chapterIds,
          characters: chunks[i].paragraphs.reduce((sum, paragraph) => sum + paragraph.text.length, 0)});
        const result = await this.withRepair(step, signal, context, async feedback => validateAnalysis(await this.provider.analyze(chunks[i], signal, feedback), chunks[i]));
        if (!this.repository.saveChunk(job.id, owner, i, result)) return true;
        completed.push(result);
        completedCount = completed.length;
        this.logger?.info('generation.chunk.completed', {jobId: job.id, requestId: job.requestId, index: i, completedChunks: completed.length,
          totalChunks: chunks.length, durationMs: Math.round(performance.now() - chunkStartedAt)});
      }
      step = 'merge';
      const analysis = mergeAnalyses(completed, source);
      if (!this.repository.saveAnalysis(job.id, owner, analysis)) return true;
      this.logger?.info('generation.analysis.completed', {jobId: job.id, requestId: job.requestId, completedChunks: completed.length,
        totalChunks: chunks.length, durationMs: Math.round(performance.now() - startedAt)});
      signal.throwIfAborted();

      if (job.mode === 'open') {
        step = 'generate_world';
        this.logger?.info('generation.output.started', {jobId: job.id, requestId: job.requestId, mode: 'open', step});
        const committed = await this.withRepair(step, signal, context, async feedback => {
          if (!this.provider.generateWorld || !this.createWorld) throw new AppError('OPEN_PROVIDER_UNAVAILABLE', '当前生成器不支持开放世界');
          const chapterIds = source.chapters.map(c => c.id);
          const content = await this.provider.generateWorld(analysis, {direction: job.direction, chapterIds,
            playerRole: job.playerRole || '', canonPolicy: job.canonPolicy || 'faithful'}, signal, feedback);
          if (content.sourceChapterIds.length !== chapterIds.length || new Set(content.sourceChapterIds).size !== chapterIds.length ||
            chapterIds.some(id => !content.sourceChapterIds.includes(id))) {
            throw new AppError('WORLD_SCOPE_MISMATCH', '世界草案的章节范围与本次选择不一致，请重试设计步骤', 422, {
              path: 'sourceChapterIds', issues: [{path: 'sourceChapterIds', message: '世界草案的章节范围与本次选择不一致'}],
            });
          }
          signal.throwIfAborted();
          return this.repository.completeWith(job.id, owner, () => this.createWorld!({sourceId: job.sourceId, content}).id);
        });
        if (!committed) return true;
      } else {
        const twoStep = typeof this.provider.generateSkeleton === 'function' && typeof this.provider.expandScenes === 'function';
        let content;
        if (twoStep) {
          step = 'generate_skeleton';
          this.logger?.info('generation.output.started', {jobId: job.id, requestId: job.requestId, mode: 'story', step});
          const skeleton = await this.withRepair(step, signal, context, async feedback => {
            const draft = await this.provider.generateSkeleton!(analysis, job.direction, signal, feedback);
            assertPlayableSkeleton(draft);
            return draft;
          });
          step = 'expand_scenes';
          this.logger?.info('generation.output.started', {jobId: job.id, requestId: job.requestId, mode: 'story', step});
          content = await this.withRepair(step, signal, context, async feedback => {
            const expanded = await this.provider.expandScenes!(analysis, job.direction, skeleton, signal, feedback);
            assertExpandedHonorsSkeleton(skeleton, expanded);
            return expanded;
          });
        } else {
          step = 'generate';
          this.logger?.info('generation.output.started', {jobId: job.id, requestId: job.requestId, mode: 'story', step});
          content = await this.withRepair(step, signal, context, async feedback => {
            if (!this.provider.generate) throw new AppError('OPEN_PROVIDER_UNAVAILABLE', '当前生成器不支持分支故事');
            return this.provider.generate(analysis, job.direction, signal, feedback);
          });
        }
        signal.throwIfAborted();
        if (!this.repository.completeWith(job.id, owner, () => this.createDraft({sourceId: job.sourceId, content}).id)) return true;
      }
      this.logger?.info('generation.succeeded', {jobId: job.id, requestId: job.requestId, mode: job.mode || 'story', durationMs: Math.round(performance.now() - startedAt)});
    } catch (error) {
      // On shutdown leave the lease recoverable. Cancellation already revoked ownership.
      if (!signal.aborted) {
        const failure = toJobFailure(error, {step, attempt: 1, requestId: job.requestId, completedChunks: completedCount});
        this.logger?.error('generation.failed', {
          jobId: job.id, sourceId: job.sourceId, mode: job.mode || 'story', requestId: failure.requestId,
          code: failure.code, path: failure.path ?? '', step: failure.step, attempt: failure.attempt,
          message: failure.message.slice(0, 500), completedChunks: completedCount, durationMs: Math.round(performance.now() - startedAt),
        });
        this.repository.fail(job.id, owner, failure);
      }
    } finally { clearInterval(pulse); }
    return true;
  }

  private async withRepair<T>(step: string, signal: AbortSignal, context: {jobId: string; requestId: string},
    run: (feedback?: ModelRepairFeedback) => Promise<T>): Promise<T> {
    const repairs = Math.min(6, Math.max(1, Number.isInteger(this.repairAttempts) ? this.repairAttempts : 3));
    let feedback: ModelRepairFeedback | undefined;
    for (let attempt = 1; attempt <= repairs; attempt++) {
      try {
        return await run(feedback);
      } catch (error) {
        if (signal.aborted) throw error;
        const code = failureCode(error);
        const path = failurePath(error);
        const repairable = isSemanticRepair(error) && attempt < repairs;
        this.logger?.warn(repairable ? 'generation.repair.scheduled' : 'generation.step.failed', {
          jobId: context.jobId, requestId: context.requestId, step, attempt, code, path,
        });
        if (!repairable) throw annotateFailure(error, step, attempt);
        feedback = feedbackFrom(error);
      }
    }
    throw new AppError('UNEXPECTED_ERROR', '生成步骤失败');
  }
}

function isSemanticRepair(error: unknown): boolean {
  return error instanceof ZodError || (error instanceof AppError && SEMANTIC_REPAIR.has(error.code));
}
