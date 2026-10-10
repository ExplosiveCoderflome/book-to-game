import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { JsonlLogger } from '../src/platform/logger.js';

test('JSONL logger writes dated component records without changing the payload', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'novel-logs-'));
  try {
    const logger = new JsonlLogger(directory, 'test');
    logger.info('example', {requestId: 'req-1', status: 200});
    logger.error('failure', {code: 'MODEL_HTTP_ERROR'});
    const file = path.join(directory, `test-${new Date().toISOString().slice(0, 10)}.jsonl`);
    const lines = readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>);
    assert.equal(lines.length, 2);
    assert.deepEqual({event: lines[0].event, level: lines[0].level, component: lines[0].component, requestId: lines[0].requestId, status: lines[0].status},
      {event: 'example', level: 'info', component: 'test', requestId: 'req-1', status: 200});
    assert.equal(lines[1].event, 'failure');
  } finally {rmSync(directory, {recursive: true, force: true});}
});
