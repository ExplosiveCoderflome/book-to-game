import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig, loadAccessToken, KUAIPAO_BASE_URL, KUAIPAO_MODEL, KUAIPAO_BACKUP_MODEL, resolveKuaipaoApiKey } from '../src/platform/config.js';
test('local access token survives restart and absent provider stays disabled', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'novel-config-'));
  try {
    const config = loadConfig({DATA_DIR: dir});
    assert.equal(config.providerConfigured, false);
    assert.ok(config.allowedOrigins.includes('http://127.0.0.1:5174'));
    const token = loadAccessToken(config.dataDir, undefined);
    assert.equal(token.length, 64);
    assert.equal(loadAccessToken(dir, undefined), token);
    assert.equal(loadAccessToken(dir, ''), token);
    assert.equal(readFileSync(path.join(dir, 'access-token.txt'), 'utf8').trim(), token);
    assert.throws(() => loadAccessToken(dir, 'short'), /24/);
    assert.throws(() => loadConfig({PORT: 'NaN'}), /PORT/);
    assert.throws(() => loadConfig({LLM_BASE_URL: 'file:///secret'}), /HTTP/);
    assert.equal(loadConfig({LLM_BASE_URL: 'http://127.0.0.1:8080/v1', LLM_MODEL: 'local-model'}).providerConfigured, true);
    assert.equal(config.provider.maxAttempts, 3);
    assert.equal(config.provider.retryBaseMs, 500);
    assert.equal(config.provider.repairAttempts, 3);
    assert.equal(config.provider.streamIdleTimeoutMs, 120000);
    assert.equal(config.provider.streamTotalTimeoutMs, 600000);
    const stream = loadConfig({LLM_STREAM_IDLE_TIMEOUT_MS: '180000', LLM_STREAM_TOTAL_TIMEOUT_MS: '900000'});
    assert.equal(stream.provider.streamIdleTimeoutMs, 180000);
    assert.equal(stream.provider.streamTotalTimeoutMs, 900000);
    assert.throws(() => loadConfig({LLM_STREAM_IDLE_TIMEOUT_MS: '0'}), /LLM_STREAM_IDLE_TIMEOUT_MS/);
    assert.throws(() => loadConfig({LLM_STREAM_TOTAL_TIMEOUT_MS: 'NaN'}), /LLM_STREAM_TOTAL_TIMEOUT_MS/);
    const tuned = loadConfig({LLM_MAX_ATTEMPTS: '2', LLM_RETRY_BASE_MS: '0', LLM_RETRY_MAX_MS: '1000', LLM_REPAIR_ATTEMPTS: '4'});
    assert.deepEqual({maxAttempts: tuned.provider.maxAttempts, retryBaseMs: tuned.provider.retryBaseMs, repairAttempts: tuned.provider.repairAttempts},
      {maxAttempts: 2, retryBaseMs: 0, repairAttempts: 4});
    assert.throws(() => loadConfig({LLM_MAX_ATTEMPTS: '0'}), /LLM_MAX_ATTEMPTS/);
    assert.throws(() => loadConfig({LLM_RETRY_BASE_MS: '1000', LLM_RETRY_MAX_MS: '10'}), /LLM_RETRY_MAX_MS/);
  } finally {rmSync(dir, {recursive: true, force: true});}
});

test('XFYUN_API_KEY selects only the XFYUN chat-completions provider by default', () => {
  const config = loadConfig({XFYUN_API_KEY: 'test-xfyun-key'});
  assert.equal(config.provider.baseUrl, 'https://maas-api.cn-huabei-1.xf-yun.com/v1');
  assert.equal(config.provider.model, 'spark-x2.6');
  assert.equal(config.provider.apiKey, 'test-xfyun-key');
  assert.equal(config.providerConfigured, true);

  const other = loadConfig({XFYUN_API_KEY: 'test-xfyun-key', LLM_BASE_URL: 'https://api.example.test/v1', LLM_MODEL: 'other'});
  assert.equal(other.provider.apiKey, '', 'XFYUN key must never be sent to another provider');
});

test('KUAIPAO_API_KEY unwraps raw or JSON secret envelope, validates host, preserves LLM_API_KEY override and never echoes secret values in errors', () => {
  assert.equal(KUAIPAO_BASE_URL, 'https://kuaipao.ai/v1');
  assert.equal(KUAIPAO_MODEL, 'gemini-4-argon');
  assert.equal(KUAIPAO_BACKUP_MODEL, 'gemini-3.1-pro-preview');

  const rawConfig = loadConfig({KUAIPAO_API_KEY: 'test-kuaipao-raw-secret'});
  assert.equal(rawConfig.provider.baseUrl, 'https://api.openai.com/v1');
  assert.equal(rawConfig.provider.model, '');
  assert.equal(rawConfig.provider.apiKey, '');
  assert.equal(rawConfig.providerConfigured, false);
  assert.equal(loadConfig({KUAIPAO_API_KEY: '{invalid-development-envelope'}).providerConfigured, false, 'development key is not even parsed without opt-in');
  assert.equal(loadConfig({KUAIPAO_API_KEY: 'dev-key', XFYUN_API_KEY: 'test-xfyun-key'}).provider.model, 'spark-x2.6');
  assert.throws(() => loadConfig({LLM_BASE_URL: KUAIPAO_BASE_URL, LLM_API_KEY: 'explicit-key', LLM_MODEL: KUAIPAO_MODEL}), /LLM_ALLOW_KUAIPAO_RUNTIME/);
  assert.equal(loadConfig({KUAIPAO_API_KEY: 'dev-key', LLM_ALLOW_KUAIPAO_RUNTIME: 'true'}).providerConfigured, false, 'opt-in alone still does not select a provider');

  const envelopeSecret = 'kp-envelope-secret-do-not-echo';
  const envelopeJson = JSON.stringify({_type: 'secret', key: envelopeSecret, url: 'https://kuaipao.ai/v1/'});
  const envConfig = loadConfig({LLM_ALLOW_KUAIPAO_RUNTIME: 'true', LLM_BASE_URL: KUAIPAO_BASE_URL, KUAIPAO_API_KEY: envelopeJson});
  assert.equal(envConfig.provider.baseUrl, 'https://kuaipao.ai/v1');
  assert.equal(envConfig.provider.model, 'gemini-4-argon');
  assert.equal(envConfig.provider.apiKey, envelopeSecret);
  assert.equal(envConfig.providerConfigured, true);

  const backupConfig = loadConfig({LLM_ALLOW_KUAIPAO_RUNTIME: 'true', LLM_BASE_URL: KUAIPAO_BASE_URL, KUAIPAO_API_KEY: envelopeJson, LLM_MODEL: KUAIPAO_BACKUP_MODEL});
  assert.equal(backupConfig.provider.model, 'gemini-3.1-pro-preview');
  assert.equal(backupConfig.provider.apiKey, envelopeSecret);

  const overrideConfig = loadConfig({
    LLM_ALLOW_KUAIPAO_RUNTIME: 'true',
    KUAIPAO_API_KEY: envelopeJson,
    LLM_BASE_URL: 'https://kuaipao.ai/v1',
    LLM_API_KEY: 'explicit-override-key',
  });
  assert.equal(overrideConfig.provider.apiKey, 'explicit-override-key');

  const otherHost = loadConfig({
    KUAIPAO_API_KEY: envelopeJson,
    LLM_BASE_URL: 'https://api.example.test/v1',
    LLM_MODEL: 'other-model',
  });
  assert.equal(otherHost.provider.apiKey, '', 'KUAIPAO_API_KEY must never leak to non-kuaipao host');

  const otherHostWithExplicit = loadConfig({
    KUAIPAO_API_KEY: envelopeJson,
    LLM_BASE_URL: 'https://api.example.test/v1',
    LLM_MODEL: 'other-model',
    LLM_API_KEY: 'other-host-explicit-key',
  });
  assert.equal(otherHostWithExplicit.provider.apiKey, 'other-host-explicit-key');

  for (const bad of [
    `{"_type":"secret","key":"${envelopeSecret}`,
    JSON.stringify({_type: 'secret', key: '', url: 'https://kuaipao.ai/v1'}),
    JSON.stringify({_type: 'secret', key: `{"nested":"${envelopeSecret}"}`, url: 'https://kuaipao.ai/v1'}),
    JSON.stringify({_type: 'secret', key: envelopeSecret, url: 'https://evil.example.test/v1'}),
    JSON.stringify({_type: 'secret', key: envelopeSecret, url: 'file:///etc/passwd'}),
  ]) {
    assert.throws(() => resolveKuaipaoApiKey(bad), (err: unknown) => {
      const msg = String(err);
      assert.equal(msg.includes(envelopeSecret), false, 'error message must never echo secret value');
      return true;
    });
  }
});

test('agent run budgets: environment defaults, tuning and fail-closed validation', () => {
  const defaults = loadConfig({}).provider;
  assert.equal(defaults.chatContextTargetBytes, 96 * 1024);
  assert.equal(defaults.chatRecentTurns, 4);
  assert.equal(defaults.chatRunTokenBudget, 256000);
  assert.equal(defaults.chatMaxOutputTokens, 8192);
  const tuned = loadConfig({CHAT_CONTEXT_TARGET_BYTES: '65536', CHAT_RECENT_TURNS: '2', CHAT_RUN_TOKEN_BUDGET: '80000', CHAT_MAX_OUTPUT_TOKENS: '4096'}).provider;
  assert.equal(tuned.chatContextTargetBytes, 65536); assert.equal(tuned.chatRecentTurns, 2);
  assert.equal(tuned.chatRunTokenBudget, 80000); assert.equal(tuned.chatMaxOutputTokens, 4096);
  for (const [key, value] of Object.entries({CHAT_CONTEXT_TARGET_BYTES: '999999', CHAT_RECENT_TURNS: '0', CHAT_RUN_TOKEN_BUDGET: 'NaN', CHAT_MAX_OUTPUT_TOKENS: '0'}))
    assert.throws(() => loadConfig({[key]: value}), new RegExp(key));
});
