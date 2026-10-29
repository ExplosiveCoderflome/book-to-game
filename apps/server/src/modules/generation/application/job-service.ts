import { generationInputSchema, productionPlanSchema, type GenerationInput, type GenerationJob, type ProductionPlan } from '@novel-game/contracts';
import { AppError } from '../../../shared/errors.js';
import { chunkSource } from '../domain/chunks.js';
import { selectChapters } from '../domain/selection.js';
import type { JobRepository, SourceReader, StoredJob } from '../domain/ports.js';
import { assertProductionPlan, productionUnits } from '../domain/production.js';
import { assertPlanMechanics, checkProductionPlan } from './plan-check.js';

export function publicJob(job: StoredJob): GenerationJob {
  const {requestId: _requestId, checkpoints: _checkpoints, ...result} = job;
  return result;
}
export class JobService {
  constructor(private readonly repository: JobRepository, private readonly sources: SourceReader,
    private readonly providerAvailable: () => boolean) {}
  create(input: GenerationInput): GenerationJob {
    const data = generationInputSchema.parse(input);
    if (data.productionBrief && data.mode !== 'open') throw new AppError('INVALID_PRODUCTION', '分阶段角色扮演游戏制作需要开放冒险模式', 422);
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
  approveProduction(id: string, plan: ProductionPlan): GenerationJob {
    const job = this.repository.get(id);
    if (!job?.productionBrief) throw new AppError('JOB_NOT_FOUND', '游戏制作任务不存在', 404);
    const parsed = productionPlanSchema.parse(plan);
    assertProductionPlan(parsed, job.productionBrief, selectChapters(this.sources.get(job.sourceId), job.chapterIds));
    assertPlanMechanics(parsed); // S5: block approval (and prose generation) while the rules cannot work
    return publicJob(this.repository.approveProduction(id, parsed));
  }
  /** S5: read-only rule check of a (possibly edited) plan; errors would block approval. */
  checkProductionPlan(plan: ProductionPlan) { return checkProductionPlan(productionPlanSchema.parse(plan)); }
  rewriteProduction(id: string, unitKey: string, direction: string): GenerationJob {
    const job = this.repository.get(id);
    if (!job?.productionState || !productionUnits(job.productionState.plan).some(unit => unit.key === unitKey)) throw new AppError('PRODUCTION_UNIT_NOT_FOUND', '要修订的正文单元不存在', 404);
    if (!this.providerAvailable()) throw new AppError('MODEL_NOT_CONFIGURED', '请先配置模型再修订正文', 503);
    return publicJob(this.repository.rewriteProduction(id, unitKey, direction));
  }
}
