import type { SqliteDatabase } from './database.js';
import { ModelSettingsService, SqliteModelSettingsRepository, type ProviderConfiguration } from '../modules/model-settings/index.js';
import { LocalSecretCodec } from './secrets.js';

export function createModelSettings(db: SqliteDatabase, dataDir: string, fallback: ProviderConfiguration) {
  return new ModelSettingsService(new SqliteModelSettingsRepository(db), new LocalSecretCodec(dataDir), fallback);
}
