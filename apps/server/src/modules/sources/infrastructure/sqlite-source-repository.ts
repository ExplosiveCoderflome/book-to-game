import type { SqliteDatabase } from '../../../platform/database.js';
import type { SourceDocument, SourceSummary } from '@novel-game/contracts';
import type { IdeaSourceRequestRepository, SourceRepository } from '../application/source-service.js';

export class SqliteSourceRepository implements SourceRepository, IdeaSourceRequestRepository {
  constructor(private readonly database: SqliteDatabase) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS sources (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        filename TEXT NOT NULL,
        encoding TEXT NOT NULL,
        chapter_count INTEGER NOT NULL,
        char_count INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        document_json TEXT NOT NULL,
        original_bytes BLOB NOT NULL
      );
      CREATE TABLE IF NOT EXISTS idea_world_requests (
        request_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, source_id TEXT NOT NULL REFERENCES sources(id), world_id TEXT
      );
    `);
  }

  getIdeaRequest(requestId: string): {fingerprint: string; sourceId: string; worldId: string | null} | undefined {
    const row = this.database.prepare('SELECT fingerprint, source_id AS sourceId, world_id AS worldId FROM idea_world_requests WHERE request_id=?').get(requestId) as {fingerprint: string; sourceId: string; worldId: string | null} | undefined;
    return row;
  }
  saveIdeaRequest(requestId: string, fingerprint: string, sourceId: string, worldId: string): void {
    this.database.prepare('INSERT INTO idea_world_requests(request_id,fingerprint,source_id,world_id) VALUES(?,?,?,?)').run(requestId, fingerprint, sourceId, worldId);
  }

  save(document: SourceDocument, bytes: Uint8Array): void {
    this.database.transaction(() => {
      this.database.prepare(`INSERT INTO sources
        (id, title, filename, encoding, chapter_count, char_count, created_at, document_json, original_bytes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        document.id, document.title, document.filename, document.encoding, document.chapterCount,
        document.charCount, document.createdAt, JSON.stringify(document), Buffer.from(bytes),
      );
    })();
  }

  get(id: string): SourceDocument | undefined {
    const row = this.database.prepare('SELECT document_json FROM sources WHERE id = ?').get(id) as { document_json: string } | undefined;
    return row ? JSON.parse(row.document_json) as SourceDocument : undefined;
  }

  list(): SourceSummary[] {
    return this.database.prepare(`SELECT id, title, filename, encoding, chapter_count AS chapterCount,
      char_count AS charCount, created_at AS createdAt FROM sources ORDER BY created_at DESC, id DESC`).all() as SourceSummary[];
  }

  getOriginalBytes(id: string): Buffer | undefined {
    const row = this.database.prepare('SELECT original_bytes FROM sources WHERE id = ?').get(id) as { original_bytes: Uint8Array } | undefined;
    return row ? Buffer.from(row.original_bytes) : undefined;
  }
}
