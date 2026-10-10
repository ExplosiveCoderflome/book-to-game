import type Database from 'better-sqlite3';
import { ModelSettingsService, SqliteModelSettingsRepository, type ProviderConfiguration } from '../modules/model-settings/index.js';
import { LocalSecretCodec } from './secrets.js';

export function createModelSettings(db: Database.Database, dataDir: string, fallback: ProviderConfiguration) {
  return new ModelSettingsService(new SqliteModelSettingsRepository(db), new LocalSecretCodec(dataDir), fallback);
}
