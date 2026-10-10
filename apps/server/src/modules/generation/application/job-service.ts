import { generationInputSchema, type GenerationInput, type GenerationJob } from '@novel-game/contracts';
import { AppError } from '../../../shared/errors.js';
import { chunkSource } from '../domain/chunks.js';
import { selectChapters } from '../domain/selection.js';
import type { JobRepository, SourceReader, StoredJob } from '../domain/ports.js';

export function publicJob(job: StoredJob): GenerationJob {
  const {requestId: _requestId, checkpoints: _checkpoints, ...result} = job;
  return result;
}
export class JobService {
  constructor(private readonly repository: JobRepository, private readonly sources: SourceReader,
    private readonly providerAvailable: () => boolean) {}
  create(input: GenerationInput): GenerationJob {
    const data = generationInputSchema.parse(input);
    if (!this.providerAvailable()) throw new AppError('MODEL_NOT_CONFIGURED', '尚未配置模型。请进入“模型设置”填写服务地址、模型名称及 API Key，或通过 MCP 提交改编草稿。', 503);
    const source = selectChapters(this.sources.get(data.sourceId), data.chapterIds);
    if (data.chapterIds) data.chapterIds = source.chapters.map(c => c.id);
    const chunks = chunkSource(source);
    return publicJob(this.repository.create(data, chunks.length));
  }
  get(id: string): GenerationJob {
    const job = this.repository.get(id);
    if (!job) throw new AppError('JOB_NOT_FOUND', '任务不存在', 404);
    return publicJob(job);
  }
  list(): GenerationJob[] { return this.repository.list().map(publicJob); }
  retry(id: string): GenerationJob {
    if (!this.providerAvailable()) throw new AppError('MODEL_NOT_CONFIGURED', '请先配置模型再恢复任务', 503);
    return publicJob(this.repository.retry(id));
  }
  cancel(id: string): GenerationJob { return publicJob(this.repository.cancel(id)); }
}
