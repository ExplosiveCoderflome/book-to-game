import type { SqliteDatabase } from '../../../platform/database.js';
import type { DraftProvenance, WorldDraft, WorldRevision } from '@novel-game/contracts';
import { AppError } from '../../../shared/errors.js';
import type { WorldRepository } from '../application/ports.js';
export class SqliteWorldRepository implements WorldRepository {
  constructor(private readonly db: SqliteDatabase) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS world_drafts (
        id TEXT PRIMARY KEY, source_id TEXT NOT NULL, version INTEGER NOT NULL CHECK(version > 0),
        data TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS world_revisions (
        id TEXT PRIMARY KEY, draft_id TEXT NOT NULL REFERENCES world_drafts(id), source_id TEXT NOT NULL,
        version INTEGER NOT NULL CHECK(version > 0), data TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(draft_id, version)
      );
      CREATE TRIGGER IF NOT EXISTS world_revisions_immutable_update BEFORE UPDATE ON world_revisions
      BEGIN SELECT RAISE(ABORT, 'Published world revisions are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS world_revisions_immutable_delete BEFORE DELETE ON world_revisions
      BEGIN SELECT RAISE(ABORT, 'Published world revisions are immutable'); END;
    `);
    this.ensureArchiveColumn();
  }
  insertDraft(draft: WorldDraft): void {
    this.db.prepare('INSERT INTO world_drafts(id,source_id,version,data,created_at,updated_at) VALUES(?,?,?,?,?,?)')
      .run(draft.id, draft.sourceId, draft.version, JSON.stringify(draft), draft.createdAt, draft.updatedAt);
  }
  private ensureArchiveColumn(): void {
    const cols = this.db.prepare('PRAGMA table_info(world_drafts)').all() as {name: string}[];
    if (!cols.some(c => c.name === 'archived_at')) this.db.exec('ALTER TABLE world_drafts ADD COLUMN archived_at TEXT');
  }
  archiveDraft(id: string): boolean {
    return this.db.prepare('UPDATE world_drafts SET archived_at=? WHERE id=? AND archived_at IS NULL').run(new Date().toISOString(), id).changes > 0;
  }
  getDraft(id: string): WorldDraft | undefined {return parse<WorldDraft>(this.db.prepare('SELECT data FROM world_drafts WHERE id=?').get(id));}
  listDrafts(): WorldDraft[] {return this.db.prepare('SELECT data FROM world_drafts WHERE archived_at IS NULL ORDER BY created_at DESC, id').all().map(row => parse<WorldDraft>(row)!);}
  updateDraft(draft: WorldDraft, expectedVersion: number): void {
    const result = this.db.prepare('UPDATE world_drafts SET version=?,data=?,updated_at=? WHERE id=? AND version=?').run(draft.version, JSON.stringify(draft), draft.updatedAt, draft.id, expectedVersion);
    if (!result.changes) throw new AppError('DRAFT_VERSION_CONFLICT', '草稿已更新，请刷新后编辑', 409);
  }
  setProvenanceIfMissing(id: string, provenance: DraftProvenance): boolean {
    return this.db.transaction(() => {
      const draft = this.getDraft(id);
      if (!draft || draft.content.provenance) return false;
      this.db.prepare('UPDATE world_drafts SET data=? WHERE id=?').run(JSON.stringify({...draft, content: {...draft.content, provenance}}), id);
      return true;
    }).immediate();
  }
  getRevision(id: string): WorldRevision | undefined {return parse<WorldRevision>(this.db.prepare('SELECT data FROM world_revisions WHERE id=?').get(id));}
  findRevision(draftId: string, version: number): WorldRevision | undefined {
    return parse<WorldRevision>(this.db.prepare('SELECT data FROM world_revisions WHERE draft_id=? AND version=?').get(draftId, version));
  }
  listRevisions(): WorldRevision[] {return this.db.prepare('SELECT data FROM world_revisions ORDER BY created_at DESC, id').all().map(row => parse<WorldRevision>(row)!);}
  publish(revision: WorldRevision): WorldRevision {
    return this.db.transaction(() => {
      const existing = this.findRevision(revision.draftId, revision.version); if (existing) return existing;
      const draft = this.getDraft(revision.draftId);
      if (!draft || draft.version !== revision.version) throw new AppError('DRAFT_VERSION_CONFLICT', '草稿已更新，请刷新后发布', 409);
      this.db.prepare('INSERT INTO world_revisions(id,draft_id,source_id,version,data,created_at) VALUES(?,?,?,?,?,?)')
        .run(revision.id, revision.draftId, revision.sourceId, revision.version, JSON.stringify(revision), revision.createdAt);
      return revision;
    }).immediate();
  }
}
function parse<T>(row: unknown): T | undefined {return row ? JSON.parse((row as {data: string}).data) as T : undefined;}
