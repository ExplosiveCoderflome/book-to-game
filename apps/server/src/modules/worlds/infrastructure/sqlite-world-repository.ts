import type { SqliteDatabase } from '../../../platform/database.js';
import type { DraftProvenance, WorldDraft, WorldRevision } from '@novel-game/contracts';
import { AppError } from '../../../shared/errors.js';
import type { WorldRepository } from '../application/ports.js';
import type { PreservationBaseline } from '../application/check-world-preservation.js';
import {reshapeHash} from '../application/world-reshape.js';
import {makePreservationBaseline} from '../application/check-world-preservation.js';
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
      CREATE TABLE IF NOT EXISTS world_preservation_baselines (
        draft_id TEXT PRIMARY KEY REFERENCES world_drafts(id), data TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS world_reshape_receipts (
        diff_hash TEXT PRIMARY KEY, draft_id TEXT NOT NULL REFERENCES world_drafts(id), data TEXT NOT NULL
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
  updateDraft(draft: WorldDraft, expectedVersion: number, baseline: PreservationBaseline): void {
    this.db.transaction(() => {
      this.capturePreservationBaseline(draft.id, baseline);
      const previous = this.getDraft(draft.id);
      const persisted = draft.qualityContractVersion === undefined && previous && usesNewQualityFeatures(draft.content)
        ? {...draft, qualityContractVersion: 1} : draft;
      const result = this.db.prepare('UPDATE world_drafts SET version=?,data=?,updated_at=? WHERE id=? AND version=?').run(persisted.version, JSON.stringify(persisted), persisted.updatedAt, persisted.id, expectedVersion);
      if (!result.changes) throw new AppError('DRAFT_VERSION_CONFLICT', '草稿已更新，请刷新后编辑', 409);
      this.db.prepare('UPDATE world_preservation_baselines SET data=? WHERE draft_id=?').run(JSON.stringify(baseline), draft.id);
    }).immediate();
  }
  getPreservationBaseline(id: string): PreservationBaseline | undefined {
    return parse<PreservationBaseline>(this.db.prepare('SELECT data FROM world_preservation_baselines WHERE draft_id=?').get(id));
  }
  getReshapeReceipt(diffHash: string): WorldDraft | undefined {
    return parse<WorldDraft>(this.db.prepare('SELECT data FROM world_reshape_receipts WHERE diff_hash=?').get(diffHash));
  }
  reshapeDraft(draft: WorldDraft, expectedVersion: number, baseline: PreservationBaseline, binding: {diffHash: string; beforeHash: string; baselineHash: string; baselinePresent: boolean}): WorldDraft {
    return this.db.transaction(() => {
      const previous = this.getDraft(draft.id);
      const storedBaseline = this.getPreservationBaseline(draft.id);
      const effectiveBaseline = storedBaseline ?? (previous ? {...makePreservationBaseline(previous.id, previous.version, previous.content), capturedAt: previous.updatedAt} : undefined);
      if (!previous || previous.version !== expectedVersion || reshapeHash(previous.content) !== binding.beforeHash
        || (storedBaseline !== undefined) !== binding.baselinePresent
        || reshapeHash(effectiveBaseline ?? null) !== binding.baselineHash) {
        throw new AppError('DRAFT_VERSION_CONFLICT', '重塑目标、版本或保留基线已变化，请重新提议并确认', 409);
      }
      this.updateDraft(draft, expectedVersion, baseline);
      const persisted = this.getDraft(draft.id)!;
      this.db.prepare('INSERT INTO world_reshape_receipts(diff_hash,draft_id,data) VALUES(?,?,?)').run(binding.diffHash, draft.id, JSON.stringify(persisted));
      return persisted;
    }).immediate();
  }
  capturePreservationBaseline(id: string, baseline: PreservationBaseline): PreservationBaseline {
    this.db.prepare('INSERT OR IGNORE INTO world_preservation_baselines(draft_id,data) VALUES(?,?)').run(id, JSON.stringify(baseline));
    return this.getPreservationBaseline(id)!;
  }
  updateQualityContract(id: string, version: number): void {
    this.db.transaction(() => {
      const draft = this.getDraft(id);
      if (!draft) throw new AppError('DRAFT_NOT_FOUND', '世界草稿不存在', 404);
      if (draft.qualityContractVersion !== undefined) return;
      this.db.prepare('UPDATE world_drafts SET data=? WHERE id=?').run(JSON.stringify({...draft, qualityContractVersion: version}), id);
    }).immediate();
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
function usesNewQualityFeatures(content: WorldDraft['content']): boolean {
  return !!(content.blockSelections?.length || content.ledgerVersion || content.causalClaims
    || [...content.actions, ...content.events, ...content.endings].some(item => item.ledgerAssertions?.length));
}
function parse<T>(row: unknown): T | undefined {return row ? JSON.parse((row as {data: string}).data) as T : undefined;}
