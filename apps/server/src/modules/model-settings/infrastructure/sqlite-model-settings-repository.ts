import type { SqliteDatabase } from '../../../platform/database.js';
import { AppError } from '../../../shared/errors.js';
import type { ModelSettingsRepository, StoredModelSettings } from '../application/ports.js';

export class SqliteModelSettingsRepository implements ModelSettingsRepository {
  constructor(private readonly db: SqliteDatabase) {
    db.exec(`CREATE TABLE IF NOT EXISTS model_settings (
      id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, data TEXT NOT NULL
    )`);
  }
  get(): StoredModelSettings | null {
    const row = this.db.prepare('SELECT revision,data FROM model_settings WHERE id=1').get() as {revision: number; data: string} | undefined;
    return row ? {...JSON.parse(row.data), revision: row.revision} : null;
  }
  save(value: Omit<StoredModelSettings, 'revision'>, expectedRevision: number): StoredModelSettings {
    return this.db.transaction(() => {
      if ((this.get()?.revision ?? 0) !== expectedRevision) throw new AppError('MODEL_SETTINGS_CONFLICT', '模型设置已更新，请重新载入后保存', 409);
      const revision = expectedRevision + 1;
      this.db.prepare('INSERT INTO model_settings(id,revision,data) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,data=excluded.data')
        .run(revision, JSON.stringify(value));
      return {...value, revision};
    }).immediate();
  }
}
