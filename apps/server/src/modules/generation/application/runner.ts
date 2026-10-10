import { randomUUID } from 'node:crypto';
import { AppError } from '../../../shared/errors.js';
import { chunkSource, mergeAnalyses, validateAnalysis } from '../domain/chunks.js';
import type { DraftWriter, GenerationProvider, JobRepository, SourceReader, WorldDraftWriter } from '../domain/ports.js';
import { selectChapters } from '../domain/selection.js';

export class GenerationRunner {
  constructor(private readonly repository: JobRepository, private readonly sources: SourceReader,
    private readonly provider: GenerationProvider, private readonly createDraft: DraftWriter, private readonly createWorld?: WorldDraftWriter) {}

  async runOnce(shutdown?: AbortSignal): Promise<boolean> {
    if (shutdown?.aborted) return false;
    const owner = randomUUID();
    const job = this.repository.claim(owner, Date.now(), 120000);
    if (!job) return false;
    const controller = new AbortController();
    const signal = shutdown ? AbortSignal.any([shutdown, controller.signal]) : controller.signal;
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
      for (let i = completed.length; i < chunks.length; i++) {
        signal.throwIfAborted();
        const result = validateAnalysis(await this.provider.analyze(chunks[i], signal), chunks[i]);
        if (!this.repository.saveChunk(job.id, owner, i, result)) return true;
        completed.push(result);
      }
      const analysis = mergeAnalyses(completed, source);
      if (!this.repository.saveAnalysis(job.id, owner, analysis)) return true;
      signal.throwIfAborted();
      if (job.mode === 'open') {
        if (!this.provider.generateWorld || !this.createWorld) throw new AppError('OPEN_PROVIDER_UNAVAILABLE', '当前生成器不支持开放世界');
        const chapterIds = source.chapters.map(c => c.id);
        const content = await this.provider.generateWorld(analysis, {direction: job.direction, chapterIds,
          playerRole: job.playerRole || '', canonPolicy: job.canonPolicy || 'faithful'}, signal);
        if (content.sourceChapterIds.length !== chapterIds.length || new Set(content.sourceChapterIds).size !== chapterIds.length ||
          chapterIds.some(id => !content.sourceChapterIds.includes(id))) throw new AppError('WORLD_SCOPE_MISMATCH', '世界草案的章节范围与本次选择不一致，请重试设计步骤', 422);
        signal.throwIfAborted();
        this.repository.completeWith(job.id, owner, () => this.createWorld!({sourceId: job.sourceId, content}).id);
      } else {
        const content = await this.provider.generate(analysis, job.direction, signal);
        signal.throwIfAborted();
        this.repository.completeWith(job.id, owner, () => this.createDraft({sourceId: job.sourceId, content}).id);
      }
    } catch (error) {
      // On shutdown leave the lease recoverable. Cancellation already revoked ownership.
      if (!signal.aborted) this.repository.fail(job.id, owner, error instanceof AppError
        ? error.message : '本步骤执行失败，已保存完成的分析块。请检查模型配置或响应格式后重试。');
    } finally { clearInterval(pulse); }
    return true;
  }
}
