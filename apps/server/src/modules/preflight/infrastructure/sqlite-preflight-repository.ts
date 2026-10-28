import type { LintReport, PlaytestReport } from '@novel-game/contracts';
import type { SqliteDatabase } from '../../../platform/database.js';
import type { PreflightKind, PreflightRepository, StoredPreflight } from '../application/ports.js';

/** One row per (kind, draft, report type); the latest report replaces the previous one. */
export class SqlitePreflightRepository implements PreflightRepository {
  constructor(private readonly db: SqliteDatabase) {
    db.exec(`CREATE TABLE IF NOT EXISTS preflight_reports (
      kind TEXT NOT NULL, draft_id TEXT NOT NULL, report_type TEXT NOT NULL, draft_version INTEGER NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL,
      PRIMARY KEY(kind, draft_id, report_type)
    )`);
  }
  get(kind: PreflightKind, draftId: string): StoredPreflight {
    const rows = this.db.prepare('SELECT report_type,data FROM preflight_reports WHERE kind=? AND draft_id=?').all(kind, draftId) as {report_type: string; data: string}[];
    const out: StoredPreflight = {};
    for (const row of rows) {
      if (row.report_type === 'lint') out.lint = JSON.parse(row.data) as LintReport;
      if (row.report_type === 'playtest') out.playtest = JSON.parse(row.data) as PlaytestReport;
    }
    return out;
  }
  saveLint(kind: PreflightKind, draftId: string, report: LintReport): void { this.save(kind, draftId, 'lint', report.draftVersion, report, report.createdAt); }
  savePlaytest(draftId: string, report: PlaytestReport): void { this.save('world', draftId, 'playtest', report.draftVersion, report, report.createdAt); }
  private save(kind: string, draftId: string, type: string, version: number, data: unknown, createdAt: string): void {
    this.db.prepare(`INSERT INTO preflight_reports(kind,draft_id,report_type,draft_version,data,created_at) VALUES(?,?,?,?,?,?)
      ON CONFLICT(kind,draft_id,report_type) DO UPDATE SET draft_version=excluded.draft_version,data=excluded.data,created_at=excluded.created_at`)
      .run(kind, draftId, type, version, JSON.stringify(data), createdAt);
  }
}
