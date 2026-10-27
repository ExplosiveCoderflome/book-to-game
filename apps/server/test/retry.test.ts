import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backoffMs, classifyStatus, parseRetryAfter, retryDelayMs } from '../src/platform/model/retry.js';

test('status classification separates retryable transport failures', () => {
  for (const status of [408, 425, 429, 500, 502, 503, 504]) assert.equal(classifyStatus(status), 'retryable');
  for (const status of [400, 401, 403, 404, 409, 422]) assert.equal(classifyStatus(status), 'permanent');
});

test('Retry-After accepts seconds and HTTP dates and overrides backoff', () => {
  assert.equal(parseRetryAfter('2'), 2000);
  assert.equal(parseRetryAfter('0'), 0);
  assert.equal(parseRetryAfter('not-a-date'), undefined);
  const now = Date.parse('2026-10-27T00:00:00.000Z');
  assert.equal(parseRetryAfter('Tue, 27 Oct 2026 00:00:02 GMT', now), 2000);
  assert.equal(parseRetryAfter('Tue, 27 Oct 2026 00:00:00 GMT', now), 0);
  assert.equal(backoffMs(1, 10, 100, 0.5), 10);
  assert.equal(backoffMs(2, 10, 100, 0.5), 20);
  assert.equal(backoffMs(8, 10, 25, 0.5), 25);
  assert.equal(retryDelayMs({attempt: 1, baseMs: 5000, maxMs: 8000, random: 0.5, retryAfterMs: 0}), 0);
  assert.equal(retryDelayMs({attempt: 1, baseMs: 10, maxMs: 100, random: 0.5, retryAfterMs: 2000}), 2000);
  assert.equal(retryDelayMs({attempt: 2, baseMs: 10, maxMs: 100, random: 0.5}), 20);
});
