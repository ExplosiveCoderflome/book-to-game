import type { SqliteDatabase } from '../../../platform/database.js';
import { randomUUID } from 'node:crypto';
import type { Analysis, AnalysisResult, BranchSkeleton, GenerationInput, JobFailure } from '@novel-game/contracts';
import { AppError } from '../../../shared/errors.js';
import { formatJobError } from '../domain/failure.js';
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
        ...(input.playerRole !== undefined ? {playerRole: input.playerRole} : {}), ...(input.canonPolicy ? {canonPolicy: input.canonPolicy} : {})});
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
      job.progress = job.completedChunks / job.totalChunks * 0.8;
      job.stage = `分析小说 ${job.completedChunks}/${job.totalChunks}`;
    });
  }
  saveAnalysis(id: string, owner: string, analysis: AnalysisResult): boolean {
    return this.owned(id, owner, job => {job.analysis = analysis; job.progress = 0.85; job.stage = job.mode === 'open' ? '设计开放世界' : '设计分支冒险';});
  }
  saveSkeleton(id: string, owner: string, skeleton: BranchSkeleton): boolean {
    return this.owned(id, owner, job => {
      job.skeleton = skeleton;
      job.progress = Math.max(job.progress, 0.9);
      job.stage = '骨架已锁定，正在写正文';
    });
  }
  completeWith(id: string, owner: string, createDraft: () => string): boolean {
    return this.owned(id, owner, job => {
      job.draftId = createDraft(); job.status = 'succeeded'; job.stage = '草稿已生成'; job.progress = 1; job.error = null; job.failure = null;
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
