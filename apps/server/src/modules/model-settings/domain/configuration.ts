import { AppError } from '../../../shared/errors.js';
export interface ProviderConfiguration {baseUrl: string; model: string; apiKey: string; timeoutMs: number}
export function normalizeEndpoint(value: string): string {
  let url: URL;
  try {url = new URL(value);} catch {throw new AppError('INVALID_MODEL_ENDPOINT', '模型地址必须是 HTTP(S) 地址');}
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new AppError('INVALID_MODEL_ENDPOINT', '模型地址必须是无内嵌凭据和查询参数的 HTTP(S) 地址');
  }
  if (/\/chat\/completions\/?$/.test(url.pathname) || /\/models\/?$/.test(url.pathname)) {
    throw new AppError('INVALID_MODEL_ENDPOINT', '请填写模型服务基础地址（通常以 /v1 结尾），不要填写 /chat/completions 或 /models');
  }
  return url.toString().replace(/\/$/, '');
}
export function isConfigured(config: ProviderConfiguration): boolean {
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(config.baseUrl).hostname);
  return Boolean(config.model && (config.apiKey || local));
}
