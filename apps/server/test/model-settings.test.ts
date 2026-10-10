import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { openDatabase } from '../src/platform/database.js';
import { ModelSettingsService, SqliteModelSettingsRepository } from '../src/modules/model-settings/index.js';
import { LocalSecretCodec } from '../src/platform/secrets.js';
import { ModelConnectionProbe } from '../src/platform/model/connection-probe.js';

const fallback = {baseUrl: 'https://api.example.test/v1', model: '', apiKey: '', timeoutMs: 90000};
const input = {baseUrl: 'https://api.example.test/v1', model: 'test-model', apiKey: 'private-provider-key', timeoutMs: 90000, expectedRevision: 0};
test('settings survive restart, never return plaintext keys, and separate API/worker connections see saves', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'model-settings-'));
  const file = path.join(dir, 'data.sqlite'); let db = openDatabase(file); const workerDb = openDatabase(file);
  try {
    const service = new ModelSettingsService(new SqliteModelSettingsRepository(db), new LocalSecretCodec(dir), fallback);
    const worker = new ModelSettingsService(new SqliteModelSettingsRepository(workerDb), new LocalSecretCodec(dir), fallback);
    assert.equal(service.get().configured, false);
    assert.equal(service.get().source, 'environment');
    const saved = service.save(input);
    assert.equal(saved.hasApiKey, true); assert.equal(saved.configured, true); assert.equal(saved.revision, 1);
    assert.equal('apiKey' in saved, false); assert.doesNotMatch(JSON.stringify(saved), /private-provider-key/);
    assert.doesNotMatch(JSON.stringify(db.prepare('SELECT * FROM model_settings').all()), /private-provider-key/);
    assert.equal(worker.resolve().apiKey, input.apiKey);
    db.close(); db = openDatabase(file);
    const restarted = new ModelSettingsService(new SqliteModelSettingsRepository(db), new LocalSecretCodec(dir), fallback);
    assert.equal(restarted.resolve().apiKey, input.apiKey);
    assert.equal(restarted.get().source, 'workspace');
    const {apiKey: _key, ...keep} = input;
    const second = restarted.save({...keep, expectedRevision: 1, model: 'new-model'});
    assert.equal(second.revision, 2); assert.equal(worker.resolve().model, 'new-model');
    assert.equal(worker.resolve().apiKey, input.apiKey);
    assert.throws(() => worker.save({...input, expectedRevision: 1}), /更新|刷新/);
    restarted.save({...keep, expectedRevision: 2, clearApiKey: true});
    assert.equal(worker.get().hasApiKey, false); assert.equal(worker.get().configured, false);
    assert.equal(worker.resolve().apiKey, '');
  } finally {db.close(); workerDb.close(); rmSync(dir, {recursive: true, force: true});}
});
test('endpoint changes cannot silently send an existing key to another origin; invalid endpoints rejected', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'model-security-')); const db = openDatabase(':memory:');
  try {
    const service = new ModelSettingsService(new SqliteModelSettingsRepository(db), new LocalSecretCodec(dir), fallback);
    service.save(input);
    const next = {baseUrl: 'https://other.example.test/v1', model: 'test-model', timeoutMs: 30000, expectedRevision: 1};
    assert.throws(() => service.save(next), /重新填写|清除/);
    assert.throws(() => service.forTest(next), /重新填写|清除/);
    assert.throws(() => service.save({...next, apiKey: 'x', baseUrl: 'file:///tmp/models'}), /HTTP/);
    assert.throws(() => service.save({...next, apiKey: 'x', baseUrl: 'https://name:password@example.test/v1'}), /地址/);
    assert.equal(service.get().revision, 1);
    service.save({...next, apiKey: 'replacement'});
    assert.equal(service.resolve().apiKey, 'replacement');
  } finally {db.close(); rmSync(dir, {recursive: true, force: true});}
});
test('connection probe only lists models, uses credentials without reflecting provider errors', async () => {
  let method = ''; let url = ''; let auth = ''; let fail = false;
  const server = createServer((req, res) => {
    method = req.method!; url = req.url!; auth = req.headers.authorization!;
    if (fail) {res.statusCode = 401; res.end('do not expose private-provider-key'); return;}
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({data: [{id: 'test-model'}]}));
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const config = {...fallback, baseUrl: `http://127.0.0.1:${(server.address() as {port: number}).port}/v1`, model: 'test-model', apiKey: 'private-provider-key'};
    const probe = new ModelConnectionProbe();
    const good = await probe.test(config);
    assert.equal(good.reachable, true); assert.equal(good.modelAvailable, true);
    assert.equal(method, 'GET'); assert.equal(url, '/v1/models'); assert.equal(auth, 'Bearer private-provider-key');
    fail = true;
    await assert.rejects(probe.test(config), e => {
      assert.match(String(e), /401/); assert.doesNotMatch(String(e), /private-provider-key/); return true;
    });
  } finally {await new Promise<void>(r => server.close(() => r()));}
});
