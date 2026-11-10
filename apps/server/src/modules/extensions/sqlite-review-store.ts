import {randomUUID} from 'node:crypto';
import {AsyncLocalStorage} from 'node:async_hooks';
import type {SqliteDatabase} from '../../platform/database.js';
import {AppError} from '../../shared/errors.js';
import type {ExtensionRejectionCounterPort, ExtensionReviewResult} from './reviewer.js';

const LEASE_MS = 30 * 60_000;
/** Durable scope is the existing server draft id, never an extension/model-supplied id.
 * A lease serializes async QuickJS/simulation without holding an SQLite transaction across await.
 */
export class SqliteExtensionReviewStore implements ExtensionRejectionCounterPort {
  private readonly active = new AsyncLocalStorage<{scope: string; owner: string}>();
  constructor(private readonly db: SqliteDatabase) {
    db.exec(`CREATE TABLE IF NOT EXISTS extension_review_scopes (
      scope TEXT PRIMARY KEY, rejections INTEGER NOT NULL DEFAULT 0 CHECK(rejections BETWEEN 0 AND 3), owner TEXT, lease_until INTEGER NOT NULL DEFAULT 0
    ); CREATE TABLE IF NOT EXISTS extension_review_evidence (
      scope TEXT NOT NULL, version INTEGER NOT NULL, content_hash TEXT NOT NULL, data TEXT NOT NULL,
      PRIMARY KEY(scope,version,content_hash)
    );`);
  }
  count(scope: string): number {
    const row = this.db.prepare('SELECT rejections FROM extension_review_scopes WHERE scope=?').get(scope) as {rejections: number} | undefined;
    const count = row?.rejections ?? 0;
    if (!Number.isSafeInteger(count) || count < 0 || count > 3) throw new AppError('EXTENSION_REVIEW_STORAGE', '扩展驳回次数记录无效，已拒绝发布', 503);
    return count;
  }
  evidence(scope: string, version: number, hash: string): ExtensionReviewResult | undefined {
    const row = this.db.prepare('SELECT data FROM extension_review_evidence WHERE scope=? AND version=? AND content_hash=?').get(scope, version, hash) as {data: string} | undefined;
    return row ? JSON.parse(row.data) : undefined;
  }
  record(scope: string, version: number, hash: string, result: ExtensionReviewResult) {
    const owner = this.assertOwner(scope);
    const saved = this.db.prepare(`INSERT INTO extension_review_evidence(scope,version,content_hash,data)
      SELECT ?,?,?,? WHERE EXISTS (SELECT 1 FROM extension_review_scopes WHERE scope=? AND owner=? AND lease_until>=?)
      ON CONFLICT(scope,version,content_hash) DO UPDATE SET data=excluded.data`)
      .run(scope, version, hash, JSON.stringify(result), scope, owner, Date.now());
    if (!saved.changes) throw new AppError('EXTENSION_REVIEW_STORAGE', '扩展审查锁已失效，已拒绝保存审查证据', 503);
  }
  async withReview<T>(scope: string, work: Parameters<ExtensionRejectionCounterPort['withReview']>[1]): Promise<T> {
    const owner = randomUUID(); const now = Date.now();
    const locked = this.db.prepare(`INSERT INTO extension_review_scopes(scope,owner,lease_until) VALUES(?,?,?)
      ON CONFLICT(scope) DO UPDATE SET owner=excluded.owner,lease_until=excluded.lease_until
      WHERE extension_review_scopes.owner IS NULL OR extension_review_scopes.lease_until < ?`).run(scope, owner, now + LEASE_MS, now);
    if (!locked.changes) throw new AppError('EXTENSION_REVIEW_BUSY', '该草稿已有扩展审查进行中，请等待完成后重试', 409);
    try {
      return await this.active.run({scope, owner}, async () => work({read: async () => {this.assertOwner(scope); return this.count(scope);}, increment: async () => {
        this.assertOwner(scope);
        const changed = this.db.prepare('UPDATE extension_review_scopes SET rejections=rejections+1 WHERE scope=? AND owner=? AND rejections<3 AND lease_until>=?').run(scope, owner, Date.now());
        if (!changed.changes) throw new AppError('EXTENSION_REVIEW_STORAGE', '扩展驳回次数未能持久保存，已拒绝发布', 503);
        return this.count(scope);
      }})) as T;
    } finally {
      this.db.prepare('UPDATE extension_review_scopes SET owner=NULL,lease_until=0 WHERE scope=? AND owner=?').run(scope, owner);
    }
  }
  private assertOwner(scope: string) {
    const active = this.active.getStore();
    const owner = active?.scope === scope ? active.owner : undefined;
    const row = this.db.prepare('SELECT owner,lease_until FROM extension_review_scopes WHERE scope=?').get(scope) as {owner: string; lease_until: number} | undefined;
    if (!owner || row?.owner !== owner || row.lease_until < Date.now()) throw new AppError('EXTENSION_REVIEW_STORAGE', '扩展审查锁已失效，已拒绝保存审查结论和发布', 503);
    return owner;
  }
}
