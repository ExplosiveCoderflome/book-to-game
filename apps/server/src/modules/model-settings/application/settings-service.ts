import { modelSettingsInputSchema, type ModelSettingsInput, type ModelSettingsView } from '@novel-game/contracts';
import { AppError } from '../../../shared/errors.js';
import { isConfigured, normalizeEndpoint, type ProviderConfiguration } from '../domain/configuration.js';
import type { ModelSettingsRepository, SecretCodec } from './ports.js';

export class ModelSettingsService {
  constructor(private readonly repository: ModelSettingsRepository, private readonly secrets: SecretCodec,
    private readonly fallback: ProviderConfiguration) {}

  get(): ModelSettingsView {
    const row = this.repository.get();
    const config = row ? {...row, apiKey: row.encryptedApiKey ? 'saved' : ''} : this.fallback;
    return {baseUrl: config.baseUrl, model: config.model, timeoutMs: config.timeoutMs,
      hasApiKey: Boolean(config.apiKey), configured: isConfigured(config), revision: row?.revision ?? 0,
      source: row ? 'workspace' : 'environment'};
  }
  resolve(): ProviderConfiguration {
    const row = this.repository.get();
    return row ? {baseUrl: row.baseUrl, model: row.model, timeoutMs: row.timeoutMs,
      apiKey: row.encryptedApiKey ? this.secrets.decrypt(row.encryptedApiKey) : ''} : {...this.fallback};
  }
  private prepare(input: ModelSettingsInput): ProviderConfiguration {
    const parsed = modelSettingsInputSchema.parse(input);
    const current = this.get();
    if (parsed.expectedRevision !== current.revision) throw new AppError('MODEL_SETTINGS_CONFLICT', '模型设置已更新，请重新载入后保存', 409);
    const baseUrl = normalizeEndpoint(parsed.baseUrl);
    if (current.hasApiKey && !parsed.apiKey && !parsed.clearApiKey && new URL(baseUrl).origin !== new URL(current.baseUrl).origin) {
      throw new AppError('MODEL_KEY_ORIGIN_CHANGED', '服务地址已变更，请为新服务重新填写 API Key 或明确清除密钥');
    }
    return {baseUrl, model: parsed.model, timeoutMs: parsed.timeoutMs,
      apiKey: parsed.clearApiKey ? '' : parsed.apiKey || this.resolve().apiKey};
  }
  save(input: ModelSettingsInput): ModelSettingsView {
    const config = this.prepare(input);
    const {apiKey, ...value} = config;
    this.repository.save({...value, encryptedApiKey: apiKey ? this.secrets.encrypt(apiKey) : ''}, input.expectedRevision);
    return this.get();
  }
  forTest(input: ModelSettingsInput): ProviderConfiguration { return this.prepare(input); }
}
