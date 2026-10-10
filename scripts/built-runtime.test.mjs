import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { setTimeout as wait } from 'node:timers/promises';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

test('built API and worker start under plain Node and serve model settings', {timeout: 15000}, async () => {
  const socket = createServer().listen(0, '127.0.0.1'); await once(socket, 'listening');
  const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
  const dir = mkdtempSync(path.join(tmpdir(), 'built-workbench-'));
  const token = 'built-runtime-only-test-access-code';
  const processes = [];
  try {
    for (const name of ['main', 'worker']) {
      const child = spawn(process.execPath, [`dist/server/${name}.mjs`], {
        cwd: fileURLToPath(new URL('..', import.meta.url)), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
        env: {...process.env, PORT: String(port), DATA_DIR: dir, APP_ACCESS_TOKEN: token,
          LLM_MODEL: '', LLM_API_KEY: '', LLM_BASE_URL: 'https://api.example.test/v1', LLM_TIMEOUT_MS: '2000'},
      });
      const record = {child, output: '', exited: once(child, 'exit')}; processes.push(record);
      child.stdout.on('data', part => {record.output += part;}); child.stderr.on('data', part => {record.output += part;});
    }
    const deadline = Date.now() + 7000;
    while (!processes[0].output.includes(String(port)) || !processes[1].output.includes('worker 已启动')) {
      for (const p of processes) assert.equal(p.child.exitCode, null, p.output);
      assert.ok(Date.now() < deadline, processes.map(p => p.output).join('\n')); await wait(50);
    }
    const response = await fetch(`http://127.0.0.1:${port}/api/settings/model`, {headers: {Authorization: `Bearer ${token}`}});
    assert.equal(response.status, 200);
    const settings = await response.json(); assert.equal(settings.configured, false); assert.equal(settings.revision, 0);
  } finally {
    for (const p of processes) p.child.kill(); await Promise.all(processes.map(p => p.exited));
    rmSync(dir, {recursive: true, force: true});
  }
});
