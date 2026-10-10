import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import type { ModelConfig } from './model/chat-completions.js';

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const port = Number(env.PORT || 4317);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 必须是 1–65535 的整数');
  const dataDir = path.resolve(env.DATA_DIR || 'data');
  const baseUrl = env.LLM_BASE_URL || 'https://api.openai.com/v1';
  let parsed: URL;
  try {parsed = new URL(baseUrl);} catch {throw new Error('LLM_BASE_URL 必须是 HTTP(S) 地址');}
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('LLM_BASE_URL 必须是无凭据和查询参数的 HTTP(S) 地址');
  }
  const timeoutMs = Number(env.LLM_TIMEOUT_MS || 90000);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 300000) throw new Error('LLM_TIMEOUT_MS 必须在 1000–300000 毫秒之间');
  const provider: ModelConfig = {baseUrl, model: env.LLM_MODEL?.trim() || '', apiKey: env.LLM_API_KEY?.trim() || '', timeoutMs};
  const localProvider = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  const allowedOrigins = [`http://127.0.0.1:${port}`, `http://localhost:${port}`, 'http://127.0.0.1:5173', 'http://localhost:5173'];
  return {port, dataDir, databasePath: path.join(dataDir, 'workbench.sqlite'), allowedOrigins, provider,
    providerConfigured: Boolean(provider.model && (provider.apiKey || localProvider))};
}
export function loadAccessToken(dataDir: string, supplied: string | undefined): string {
  if (supplied?.trim()) {
    if (supplied.trim().length < 24) throw new Error('APP_ACCESS_TOKEN 至少需要 24 个字符');
    return supplied.trim();
  }
  mkdirSync(dataDir, {recursive: true});
  const tokenFile = path.join(dataDir, 'access-token.txt');
  try {
    const existing = readFileSync(tokenFile, 'utf8').trim();
    if (existing.length < 24) throw new Error('本地 access-token.txt 无效，请修复或移除后重启');
    return existing;
  } catch (error) {if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;}
  const token = randomBytes(32).toString('hex');
  try {writeFileSync(tokenFile, token + '\n', {flag: 'wx', mode: 0o600});}
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return loadAccessToken(dataDir, undefined);
    throw error;
  }
  return token;
}
