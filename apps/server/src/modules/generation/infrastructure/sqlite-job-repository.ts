import type { SqliteDatabase } from '../../../platform/database.js';
import { randomUUID } from 'node:crypto';
import type { Analysis, AnalysisResult, BranchSkeleton, GenerationInput, JobFailure, ProductionPlan, ProductionUnit, ProductionNarrative, LintReport, PlaytestReport } from '@novel-game/contracts';
import { AppError } from '../../../shared/errors.js';
import { formatJobError } from '../domain/failure.js';
import { productionUnits } from '../domain/production.js';
import type { JobRepository, StoredJob } from '../domain/ports.js';

interface Row {id: string; status: string; owner: string | null; lease_until: number; payload: string}
export class SqliteJobRepository implements JobRepository {
  constructor(private readonly db: SqliteDatabase) {
    db.exec(`CREATE TABLE IF NOT EXISTS generation_jobs (
      id TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, fingerprint TEXT NOT NULL,
      status TEXT NOT NULL, owner TEXT, lease_until INTEGER NOT NULL DEFAULT 0, payload TEXT NOT NULL
    ); CREATE INDEX IF NOT EXISTS generation_job_queue ON generation_jobs(status, lease_until);`);
  }
  private row(id: string): Row {
    const row = this.db.prepare('SELECT * FROM generation_jobs WHERE id=?').get(id) as Row | undefined;
    if (!row) throw new AppError('JOB_NOT_FOUND', '任务不存在', 404);
    return row;
  }
  private write(row: Row, job: StoredJob): void {
    job.updatedAt = new Date().toISOString();
    this.db.prepare('UPDATE generation_jobs SET status=?,owner=?,lease_until=?,payload=? WHERE id=?')
      .run(job.status, row.owner, row.lease_until, JSON.stringify(job), row.id);
  }
  create(input: GenerationInput, totalChunks: number): StoredJob {
    return this.db.transaction(() => {
      const fingerprint = JSON.stringify({sourceId: input.sourceId, direction: input.direction,
        ...(input.mode !== undefined ? {mode: input.mode} : {}), ...(input.chapterIds ? {chapterIds: input.chapterIds} : {}),
        ...(input.playerRole !== undefined ? {playerRole: input.playerRole} : {}), ...(input.canonPolicy ? {canonPolicy: input.canonPolicy} : {}),
        ...(input.scanDepth ? {scanDepth: input.scanDepth} : {}),
        ...(input.statTemplateId ? {statTemplateId: input.statTemplateId} : {}),
        ...(input.productionBrief ? {productionBrief: input.productionBrief} : {})});
      const existing = this.db.prepare('SELECT payload,fingerprint FROM generation_jobs WHERE request_id=?').get(input.requestId) as {payload: string; fingerprint: string} | undefined;
      if (existing) {
        if (existing.fingerprint !== fingerprint) throw new AppError('IDEMPOTENCY_CONFLICT', '请求 ID 重复且输入冲突', 409);
        return JSON.parse(existing.payload) as StoredJob;
      }
      const at = new Date().toISOString();
      const job: StoredJob = {...input, id: randomUUID(), status: 'queued', stage: '等待分析', progress: 0,
        completedChunks: 0, totalChunks, error: null, draftId: null, analysis: null, skeleton: null, checkpoints: [], createdAt: at, updatedAt: at};
      this.db.prepare('INSERT INTO generation_jobs(id,request_id,fingerprint,status,payload) VALUES(?,?,?,?,?)')
        .run(job.id, input.requestId, fingerprint, job.status, JSON.stringify(job));
      return job;
    }).immediate();
  }
  get(id: string): StoredJob | null {
    const row = this.db.prepare('SELECT payload FROM generation_jobs WHERE id=?').get(id) as {payload: string} | undefined;
    return row ? JSON.parse(row.payload) : null;
  }
  findByRequestId(requestId: string): StoredJob | null {
    const row = this.db.prepare('SELECT payload FROM generation_jobs WHERE request_id=?').get(requestId) as {payload: string} | undefined;
    return row ? JSON.parse(row.payload) : null;
  }
  list(): StoredJob[] {
    return (this.db.prepare('SELECT payload FROM generation_jobs ORDER BY rowid DESC').all() as {payload: string}[]).map(r => JSON.parse(r.payload));
  }
  private change(id: string, operation: 'retry' | 'cancel'): StoredJob {
    return this.db.transaction(() => {
      const row = this.row(id); const job: StoredJob = JSON.parse(row.payload);
      if (operation === 'retry') {
        if (!['failed', 'cancelled'].includes(job.status)) throw new AppError('JOB_STATE_CONFLICT', '只有失败或取消的任务可以重试', 409);
        job.status = 'queued'; job.error = null; job.failure = null; job.stage = '等待恢复'; job.skeleton = null;
      } else {
        if (job.status === 'succeeded') throw new AppError('JOB_STATE_CONFLICT', '任务已完成，无法取消', 409);
        job.status = 'cancelled'; job.stage = '已取消';
      }
      row.owner = null; row.lease_until = 0; this.write(row, job); return job;
    }).immediate();
  }
  retry(id: string): StoredJob { return this.change(id, 'retry'); }
  cancel(id: string): StoredJob { return this.change(id, 'cancel'); }
  claim(owner: string, now: number, leaseMs: number): StoredJob | null {
    return this.db.transaction(() => {
      const row = this.db.prepare("SELECT * FROM generation_jobs WHERE status='queued' OR (status='running' AND lease_until<=?) ORDER BY rowid LIMIT 1").get(now) as Row | undefined;
      if (!row) return null;
      const job: StoredJob = JSON.parse(row.payload);
      job.status = 'running'; job.stage = '分析小说'; row.owner = owner; row.lease_until = now + leaseMs;
      this.write(row, job); return job;
    }).immediate();
  }
  heartbeat(id: string, owner: string, now: number, leaseMs: number): boolean {
    return this.db.prepare("UPDATE generation_jobs SET lease_until=? WHERE id=? AND owner=? AND status='running' AND lease_until>?")
      .run(now + leaseMs, id, owner, now).changes === 1;
  }
  private owned(id: string, owner: string, update: (job: StoredJob) => void): boolean {
    return this.db.transaction(() => {
      const row = this.row(id);
      if (row.owner !== owner || row.status !== 'running' || row.lease_until <= Date.now()) return false;
      const job: StoredJob = JSON.parse(row.payload);
      update(job); this.write(row, job); return true;
    }).immediate();
  }
  saveChunk(id: string, owner: string, index: number, analysis: Analysis): boolean {
    return this.owned(id, owner, job => {
      if (job.checkpoints.length !== index) throw new AppError('CHECKPOINT_CONFLICT', '任务断点序号冲突', 409);
      job.checkpoints.push(analysis); job.completedChunks = job.checkpoints.length;
      job.progress = job.completedChunks / job.totalChunks * (job.productionBrief ? 0.15 : 0.8);
      job.stage = `分析小说 ${job.completedChunks}/${job.totalChunks}`;
    });
  }
  saveAnalysis(id: string, owner: string, analysis: AnalysisResult): boolean {
    return this.owned(id, owner, job => {job.analysis = analysis; job.progress = job.productionBrief ? Math.max(job.progress, 0.2) : 0.85; job.stage = job.mode === 'open' ? '设计开放世界' : '设计分支冒险';});
  }
  saveSkeleton(id: string, owner: string, skeleton: BranchSkeleton): boolean {
    return this.owned(id, owner, job => {
      job.skeleton = skeleton;
      job.progress = Math.max(job.progress, 0.9);
      job.stage = '骨架已锁定，正在写正文';
    });
  }
  saveProductionPlan(id: string, owner: string, plan: ProductionPlan): boolean {
    return this.owned(id, owner, job => {
      job.productionState = {plan, approved: false, texts: {}};
      job.status = 'awaiting_review'; job.stage = '请审阅人物与玩法规划'; job.progress = 0.25;
    });
  }
  approveProduction(id: string, plan: ProductionPlan): StoredJob {
    return this.db.transaction(() => {
      const row = this.row(id); const job: StoredJob = JSON.parse(row.payload);
      if (job.status !== 'awaiting_review') throw new AppError('JOB_STATE_CONFLICT', '只有待审阅的规划可以确认', 409);
      job.productionState = {plan, approved: true, texts: {}};
      job.status = 'queued'; job.stage = '规划已确认，等待逐段生成';
      row.owner = null; row.lease_until = 0; this.write(row, job); return job;
    }).immediate();
  }
  saveProductionText(id: string, owner: string, unit: ProductionUnit, text: ProductionNarrative, total: number): boolean {
    return this.owned(id, owner, job => {
      job.productionState!.texts[unit.key] = text;
      const count = Object.keys(job.productionState!.texts).length;
      job.progress = 0.25 + 0.7 * count / total;
      job.stage = `内容写作 ${count}/${total} · ${unit.id}`;
    });
  }
  rewriteProduction(id: string, unitKey: string, direction: string): StoredJob {
    return this.db.transaction(() => {
      const row = this.row(id); const job: StoredJob = JSON.parse(row.payload);
      if (!['succeeded', 'failed'].includes(job.status) || !job.productionState?.approved) throw new AppError('JOB_STATE_CONFLICT', '完成或失败的内容写作任务才能修订单段', 409);
      const state = job.productionState;
      state.rewrite = {key: unitKey, direction, previousText: state.texts[unitKey] ?? (state.rewrite?.key === unitKey ? state.rewrite.previousText : undefined)};
      delete state.texts[unitKey]; delete state.lint; delete state.playtest;
      job.status = 'queued'; job.stage = '等待修订正文'; job.error = null; job.failure = null; job.draftId = null;
      job.progress = 0.25 + 0.7 * Object.keys(state.texts).length / productionUnits(state.plan).length;
      row.owner = null; row.lease_until = 0; this.write(row, job); return job;
    }).immediate();
  }
  saveProductionLint(id: string, owner: string, lint: LintReport, playtest?: PlaytestReport): boolean {
    return this.owned(id, owner, job => {
      job.productionState!.lint = lint;
      if (playtest) job.productionState!.playtest = playtest;
      job.stage = '检查可玩内容'; job.progress = 0.98;
    });
  }
  completeWith(id: string, owner: string, createDraft: () => string, model?: string): boolean {
    return this.owned(id, owner, job => {
      job.draftId = createDraft(); if (model) job.model = model.slice(0, 200); job.status = 'succeeded'; job.stage = job.productionState?.lint?.errors ? '内容已生成，体检问题待审改' : '草稿已生成'; job.progress = 1; job.error = null; job.failure = null;
      if (job.productionState) delete job.productionState.rewrite;
    });
  }
  fail(id: string, owner: string, failure: string | JobFailure): void {
    this.owned(id, owner, job => {
      job.status = 'failed'; job.stage = '等待重试';
      if (typeof failure === 'string') {job.error = failure; job.failure = null; return;}
      job.failure = failure; job.error = formatJobError(failure);
    });
  }
}
