import {
  blockSpecSchema, catalogKindSchema, funProfileSchema, simulationStrategySchema, statTemplateSchema,
  type CatalogDataMap, type CatalogKind,
} from '@novel-game/contracts';
import type { SqliteDatabase } from '../../../platform/database.js';
import { AppError } from '../../../shared/errors.js';
import type { BlockCatalogRepository, StoredCatalogOverride } from '../application/ports.js';

const MIGRATION_VERSION = 1;

/** 独立、幂等的 SQLite 迁移；只新增目录覆盖表，不修改既有世界、草稿或存档表。 */
export function migrateBlockCatalog(db: SqliteDatabase): void {
  db.exec(`CREATE TABLE IF NOT EXISTS block_catalog_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`);
  const applied = db.prepare('SELECT version FROM block_catalog_migrations WHERE version=?').get(MIGRATION_VERSION);
  if (applied) return;
  db.transaction(() => {
    db.exec(`CREATE TABLE IF NOT EXISTS block_catalog_overrides (
      kind TEXT NOT NULL,
      id TEXT NOT NULL,
      version INTEGER NOT NULL CHECK(version > 0),
      data TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(kind, id)
    )`);
    db.prepare('INSERT OR IGNORE INTO block_catalog_migrations(version,applied_at) VALUES(?,?)')
      .run(MIGRATION_VERSION, new Date().toISOString());
  }).immediate();
}

export class SqliteBlockCatalogRepository implements BlockCatalogRepository {
  constructor(private readonly db: SqliteDatabase) {
    migrateBlockCatalog(db);
  }

  get<K extends CatalogKind>(kind: K, id: string): StoredCatalogOverride<K> | undefined {
    const row = this.db.prepare('SELECT kind,id,data,updated_at FROM block_catalog_overrides WHERE kind=? AND id=?').get(kind, id) as Row | undefined;
    return row ? decode<K>(row) : undefined;
  }

  list(): StoredCatalogOverride[] {
    const rows = this.db.prepare('SELECT kind,id,data,updated_at FROM block_catalog_overrides ORDER BY kind,id').all() as Row[];
    return rows.map(row => decode(row));
  }

  save<K extends CatalogKind>(kind: K, data: CatalogDataMap[K], expectedCustomVersion: number | null): StoredCatalogOverride<K> {
    return this.db.transaction(() => {
      const current = this.get(kind, data.id);
      if (expectedCustomVersion === null && current) throw conflict(kind, data.id, current.data.version);
      if (expectedCustomVersion !== null && current?.data.version !== expectedCustomVersion) {
        throw conflict(kind, data.id, current?.data.version ?? 0);
      }
      const updatedAt = new Date().toISOString();
      this.db.prepare(`INSERT INTO block_catalog_overrides(kind,id,version,data,updated_at) VALUES(?,?,?,?,?)
        ON CONFLICT(kind,id) DO UPDATE SET version=excluded.version,data=excluded.data,updated_at=excluded.updated_at`)
        .run(kind, data.id, data.version, JSON.stringify(data), updatedAt);
      return {kind, id: data.id, data, updatedAt};
    }).immediate();
  }

  delete(kind: CatalogKind, id: string, expectedCustomVersion: number): void {
    this.db.transaction(() => {
      const current = this.get(kind, id);
      if (!current || current.data.version !== expectedCustomVersion) throw conflict(kind, id, current?.data.version ?? 0);
      this.db.prepare('DELETE FROM block_catalog_overrides WHERE kind=? AND id=? AND version=?').run(kind, id, expectedCustomVersion);
    }).immediate();
  }
}

interface Row {kind: string; id: string; data: string; updated_at: string}

function decode<K extends CatalogKind>(row: Row): StoredCatalogOverride<K> {
  const kind = catalogKindSchema.parse(row.kind) as K;
  const raw: unknown = JSON.parse(row.data);
  const data = parseData(kind, raw);
  return {kind, id: row.id, data, updatedAt: row.updated_at};
}

function parseData<K extends CatalogKind>(kind: K, raw: unknown): CatalogDataMap[K] {
  switch (kind) {
    case 'block': return blockSpecSchema.parse(raw) as CatalogDataMap[K];
    case 'fun-profile': return funProfileSchema.parse(raw) as CatalogDataMap[K];
    case 'stat-template': return statTemplateSchema.parse(raw) as CatalogDataMap[K];
    case 'simulation-strategy': return simulationStrategySchema.parse(raw) as CatalogDataMap[K];
  }
}

function conflict(kind: CatalogKind, id: string, currentVersion: number): AppError {
  return new AppError('CATALOG_CONFLICT', `目录条目已更新，请重新载入后再保存（当前版本 ${currentVersion}）`, 409, {kind, id, currentVersion});
}
