import type { SqliteDatabase } from '../../../platform/database.js';
import { randomUUID } from 'node:crypto';
import type { AgentAction, AgentDecision, AgentDecisionRepository } from '../domain/ports.js';

interface Row {
  id: string; job_id: string; action: string; job_updated_at: string;
  summary: string; detail: string | null; created_at: string;
}

function toDecision(row: Row): AgentDecision {
  return {
    id: row.id, jobId: row.job_id, action: row.action as AgentAction,
    jobUpdatedAt: row.job_updated_at, summary: row.summary,
    detail: row.detail ? JSON.parse(row.detail) as unknown : undefined,
    createdAt: row.created_at,
  };
}

export class SqliteDecisionRepository implements AgentDecisionRepository {
  constructor(private readonly db: SqliteDatabase) {
    db.exec(`CREATE TABLE IF NOT EXISTS agent_decisions (
      id TEXT PRIMARY KEY, job_id TEXT NOT NULL, action TEXT NOT NULL,
      job_updated_at TEXT NOT NULL, summary TEXT NOT NULL, detail TEXT, created_at TEXT NOT NULL
    ); CREATE INDEX IF NOT EXISTS agent_decision_job ON agent_decisions(job_id, action);
    CREATE TABLE IF NOT EXISTS agent_heartbeat (id INTEGER PRIMARY KEY CHECK (id = 1), updated_at TEXT NOT NULL);`);
  }

  record(decision: Omit<AgentDecision, 'id' | 'createdAt'>): AgentDecision {
    const row: Row = {
      id: randomUUID(), job_id: decision.jobId, action: decision.action,
      job_updated_at: decision.jobUpdatedAt, summary: decision.summary,
      detail: decision.detail === undefined ? null : JSON.stringify(decision.detail),
      created_at: new Date().toISOString(),
    };
    this.db.prepare('INSERT INTO agent_decisions(id, job_id, action, job_updated_at, summary, detail, created_at) VALUES(?,?,?,?,?,?,?)')
      .run(row.id, row.job_id, row.action, row.job_updated_at, row.summary, row.detail, row.created_at);
    return toDecision(row);
  }

  list(limit: number): AgentDecision[] {
    return (this.db.prepare('SELECT * FROM agent_decisions ORDER BY rowid DESC LIMIT ?').all(limit) as Row[]).map(toDecision);
  }

  exists(jobId: string, action: AgentAction, jobUpdatedAt: string): boolean {
    const row = this.db.prepare('SELECT 1 FROM agent_decisions WHERE job_id=? AND action=? AND job_updated_at=? LIMIT 1')
      .get(jobId, action, jobUpdatedAt) as { '1': number } | undefined;
    return !!row;
  }

  count(jobId: string, action: AgentAction): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM agent_decisions WHERE job_id=? AND action=?').get(jobId, action) as { n: number };
    return row.n;
  }

  total(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM agent_decisions').get() as { n: number };
    return row.n;
  }

  beat(): void {
    const at = new Date().toISOString();
    this.db.prepare('INSERT INTO agent_heartbeat(id, updated_at) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at').run(at);
  }

  lastBeat(): string | null {
    const row = this.db.prepare('SELECT updated_at FROM agent_heartbeat WHERE id=1').get() as { updated_at: string } | undefined;
    return row?.updated_at ?? null;
  }
}
