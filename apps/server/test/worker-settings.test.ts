import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as wait } from 'node:timers/promises';
import { openDatabase } from '../src/platform/database.js';
import { createModelSettings } from '../src/platform/create-model-settings.js';
import { createWorkbench } from '../src/app/workbench.js';

test('already-running worker reads new model and encrypted key on save and retry without restart', {timeout: 20000}, async () => {
  const requests: {model: string; authorization: string | undefined}[] = [];
  const provider = createServer(async (req, res) => {
    let body = ''; for await (const part of req) body += part;
    requests.push({model: JSON.parse(body).model, authorization: req.headers.authorization});
    // A controlled provider failure lets us retry the same durable job with a changed configuration.
    res.statusCode = 503; res.end('test unavailable');
  }).listen(0, '127.0.0.1');
  await once(provider, 'listening');
  const dir = mkdtempSync(path.join(tmpdir(), 'live-worker-settings-'));
  const db = openDatabase(path.join(dir, 'workbench.sqlite'));
  const settings = createModelSettings(db, dir, {baseUrl: 'https://api.example.test/v1', model: '', apiKey: '', timeoutMs: 2000});
  const w = createWorkbench(db, settings);
  const worker = spawn(process.execPath, ['--import', 'tsx', 'apps/server/src/worker.ts'], {
    cwd: fileURLToPath(new URL('../../..', import.meta.url)),
    env: {...process.env, DATA_DIR: dir, LLM_MODEL: '', LLM_API_KEY: '', LLM_BASE_URL: 'https://api.example.test/v1', LLM_TIMEOUT_MS: '2000'},
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  let output = ''; worker.stdout.on('data', part => {output += part;}); worker.stderr.on('data', part => {output += part;});
  const exited = once(worker, 'exit');
  async function until(check: () => boolean) {
    const deadline = Date.now() + 7000;
    while (!check()) {assert.equal(worker.exitCode, null, output); assert.ok(Date.now() < deadline, output || 'worker did not progress'); await wait(50);}
  }
  try {
    await until(() => output.includes('worker 已启动'));
    const input = {baseUrl: `http://127.0.0.1:${(provider.address() as {port: number}).port}/v1`, model: 'first-model', apiKey: 'first-test-key', timeoutMs: 2000, expectedRevision: 0};
    settings.save(input);
    const source = w.sources.importFile({title: '试验', filename: 'test.txt', bytes: Buffer.from('第一章 渡口\n你站在渡口。')});
    const job = w.jobs.create({sourceId: source.id, requestId: crypto.randomUUID(), direction: ''});
    await until(() => w.jobs.get(job.id).status === 'failed');
    settings.save({...input, model: 'second-model', apiKey: 'second-test-key', expectedRevision: 1});
    w.jobs.retry(job.id);
    await until(() => w.jobs.get(job.id).status === 'failed');
    assert.deepEqual(requests, [
      {model: 'first-model', authorization: 'Bearer first-test-key'},
      {model: 'second-model', authorization: 'Bearer second-test-key'},
    ]);
  } finally {
    worker.kill(); await exited; db.close();
    await new Promise<void>(r => provider.close(() => r())); rmSync(dir, {recursive: true, force: true});
  }
});
