import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig, loadAccessToken } from '../src/platform/config.js';
test('local access token survives restart and absent provider stays disabled', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'novel-config-'));
  try {
    const config = loadConfig({DATA_DIR: dir});
    assert.equal(config.providerConfigured, false);
    const token = loadAccessToken(config.dataDir, undefined);
    assert.equal(token.length, 64);
    assert.equal(loadAccessToken(dir, undefined), token);
    assert.equal(loadAccessToken(dir, ''), token);
    assert.equal(readFileSync(path.join(dir, 'access-token.txt'), 'utf8').trim(), token);
    assert.throws(() => loadAccessToken(dir, 'short'), /24/);
    assert.throws(() => loadConfig({PORT: 'NaN'}), /PORT/);
    assert.throws(() => loadConfig({LLM_BASE_URL: 'file:///secret'}), /HTTP/);
    assert.equal(loadConfig({LLM_BASE_URL: 'http://127.0.0.1:8080/v1', LLM_MODEL: 'local-model'}).providerConfigured, true);
  } finally {rmSync(dir, {recursive: true, force: true});}
});
