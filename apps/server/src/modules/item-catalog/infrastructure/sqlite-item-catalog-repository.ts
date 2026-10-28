import type { ItemCatalog } from '@novel-game/contracts';
import { itemCatalogSchema } from '@novel-game/contracts';
import type { SqliteDatabase } from '../../../platform/database.js';
import { AppError } from '../../../shared/errors.js';
import type { ItemCatalogRepository, StoredItemCatalog } from '../application/ports.js';

export class SqliteItemCatalogRepository implements ItemCatalogRepository {
  constructor(private readonly db: SqliteDatabase) {
    db.exec(`CREATE TABLE IF NOT EXISTS item_catalog (
      id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, data TEXT NOT NULL
    )`);
  }
  get(): StoredItemCatalog | null {
    const row = this.db.prepare('SELECT revision,data FROM item_catalog WHERE id=1').get() as
      | { revision: number; data: string }
      | undefined;
    if (!row) return null;
    return { catalog: itemCatalogSchema.parse(JSON.parse(row.data)), revision: row.revision };
  }
  save(catalog: ItemCatalog, expectedRevision: number): StoredItemCatalog {
    return this.db.transaction(() => {
      if ((this.get()?.revision ?? 0) !== expectedRevision) {
        throw new AppError('ITEM_CATALOG_CONFLICT', '物品目录已更新，请重新载入后再保存', 409);
      }
      const parsed = itemCatalogSchema.parse(catalog);
      const revision = expectedRevision + 1;
      this.db.prepare(
        'INSERT INTO item_catalog(id,revision,data) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,data=excluded.data',
      ).run(revision, JSON.stringify(parsed));
      return { catalog: parsed, revision };
    }).immediate();
  }
}
