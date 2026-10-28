import type { BuildingLibrary } from '@novel-game/contracts';
import { buildingLibrarySchema } from '@novel-game/contracts';
import type { SqliteDatabase } from '../../../platform/database.js';
import { AppError } from '../../../shared/errors.js';
import type { BuildingLibraryRepository, StoredBuildingLibrary } from '../application/ports.js';

export class SqliteBuildingLibraryRepository implements BuildingLibraryRepository {
  constructor(private readonly db: SqliteDatabase) {
    db.exec(`CREATE TABLE IF NOT EXISTS building_library (
      id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, data TEXT NOT NULL
    )`);
  }
  get(): StoredBuildingLibrary | null {
    const row = this.db.prepare('SELECT revision,data FROM building_library WHERE id=1').get() as {revision: number; data: string} | undefined;
    if (!row) return null;
    return { library: buildingLibrarySchema.parse(JSON.parse(row.data)), revision: row.revision };
  }
  save(library: BuildingLibrary, expectedRevision: number): StoredBuildingLibrary {
    return this.db.transaction(() => {
      if ((this.get()?.revision ?? 0) !== expectedRevision) {
        throw new AppError('BUILDING_LIBRARY_CONFLICT', '建筑库已更新，请重新载入后再保存', 409);
      }
      const parsed = buildingLibrarySchema.parse(library);
      const revision = expectedRevision + 1;
      this.db.prepare('INSERT INTO building_library(id,revision,data) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,data=excluded.data')
        .run(revision, JSON.stringify(parsed));
      return { library: parsed, revision };
    }).immediate();
  }
}
