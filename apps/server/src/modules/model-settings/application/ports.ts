import type { ProviderConfiguration } from '../domain/configuration.js';
export interface StoredModelSettings extends Omit<ProviderConfiguration, 'apiKey'> {
  encryptedApiKey: string; revision: number;
}
export interface ModelSettingsRepository {
  get(): StoredModelSettings | null;
  save(value: Omit<StoredModelSettings, 'revision'>, expectedRevision: number): StoredModelSettings;
}
export interface SecretCodec {encrypt(value: string): string; decrypt(value: string): string}
