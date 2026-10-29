import type { AgentRepairCandidate } from '@novel-game/contracts';
import type { SqliteDatabase } from '../../../platform/database.js';
import type { RepairRepository } from '../application/repair-ports.js';
import { AppError } from '../../../shared/errors.js';

export class SqliteRepairRepository implements RepairRepository {
  constructor(private readonly db: SqliteDatabase) {
    db.exec(`CREATE TABLE IF NOT EXISTS agent_repairs (
      id TEXT PRIMARY KEY, draft_id TEXT NOT NULL, base_version INTEGER NOT NULL, ending_id TEXT NOT NULL,
      status TEXT NOT NULL, payload TEXT NOT NULL, UNIQUE(draft_id, base_version, ending_id)
    )`);
  }
  private read(row: unknown): AgentRepairCandidate | undefined {
    return row ? JSON.parse((row as {payload: string}).payload) as AgentRepairCandidate : undefined;
  }
  get(id: string) {return this.read(this.db.prepare('SELECT payload FROM agent_repairs WHERE id=?').get(id));}
  find(draftId: string, version: number, endingId: string) {
    return this.read(this.db.prepare('SELECT payload FROM agent_repairs WHERE draft_id=? AND base_version=? AND ending_id=?').get(draftId, version, endingId));
  }
  list(draftId: string) {
    return this.db.prepare('SELECT payload FROM agent_repairs WHERE draft_id=? ORDER BY rowid DESC LIMIT 20').all(draftId).map(row => this.read(row)!);
  }
  insert(candidate: AgentRepairCandidate) {
    this.db.prepare('INSERT OR IGNORE INTO agent_repairs(id,draft_id,base_version,ending_id,status,payload) VALUES(?,?,?,?,?,?)')
      .run(candidate.id, candidate.draftId, candidate.baseVersion, candidate.endingId, candidate.status, JSON.stringify(candidate));
    return this.find(candidate.draftId, candidate.baseVersion, candidate.endingId)!;
  }
  update(candidate: AgentRepairCandidate) {
    const result = this.db.prepare("UPDATE agent_repairs SET status=?,payload=? WHERE id=? AND status='pending'")
      .run(candidate.status, JSON.stringify(candidate), candidate.id);
    if (result.changes !== 1) throw new AppError('AGENT_REPAIR_STATE_CONFLICT', '候选已处理，请刷新列表', 409);
  }
}
