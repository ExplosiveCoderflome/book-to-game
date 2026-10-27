import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import type { Socket } from 'node:net';
import { ChatCompletionsProvider, type ModelClientHooks, type ModelConfig } from '../src/platform/model/chat-completions.js';
import { AppError } from '../src/shared/errors.js';
import type { LogFields, Logger } from '../src/shared/logger.js';

const analysis = {summary: '渡口', characters: [], locations: [], worldRules: [], uncertainties: []};
const novel = 'UNIQUE_NOVEL_SENTENCE_SHOULD_NOT_BE_LOGGED';
const apiKey = 'sk-test-should-not-leak';
const chunk = {index: 0, chapterIds: ['c1'], paragraphs: [{chapterId: 'c1', paragraphId: 'p1', text: novel}]};

function envelope(content: string): string {
  return JSON.stringify({choices: [{finish_reason: 'stop', message: {content}}]});
}
async function read(req: IncomingMessage): Promise<string> {
  let body = ''; for await (const part of req) body += part; return body;
}
async function listen(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<{server: Server; port: number; close: () => Promise<void>}> {
  const sockets = new Set<Socket>();
  const server = createServer(handler);
  server.on('connection', socket => {sockets.add(socket); socket.on('close', () => sockets.delete(socket));});
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {server, port: (server.address() as {port: number}).port, close: () => new Promise(resolve => {
    for (const socket of sockets) socket.destroy();
    server.close(() => resolve());
  })};
}
function captureLogger(): {logger: Logger; events: {event: string; fields?: LogFields}[]} {
  const events: {event: string; fields?: LogFields}[] = [];
  const push = (event: string, fields?: LogFields) => events.push({event, fields});
  return {events, logger: {info: push, warn: push, error: push}};
}
function provider(port: number, overrides: Partial<ModelConfig> = {}, hooks?: ModelClientHooks, logger?: Logger) {
  return new ChatCompletionsProvider({
    baseUrl: `http://127.0.0.1:${port}/v1`, model: 'stub-model', apiKey, timeoutMs: 1000,
    maxAttempts: 3, retryBaseMs: 10, retryMaxMs: 40, repairAttempts: 3, ...overrides,
  }, logger, hooks);
}
function assertNoSecrets(value: unknown): void {
  const text = JSON.stringify(value);
  assert.equal(text.includes(apiKey), false);
  assert.equal(text.includes(novel), false);
}

test('provider accepts fenced JSON, leading prose, and trailing commas', async () => {
  const payloads = [
    '```json\n' + JSON.stringify(analysis) + '\n```',
    '下面是分析：\n' + JSON.stringify(analysis) + '\n完毕',
    '{"summary":"渡口","characters":[],"locations":[],"worldRules":[],"uncertainties":[],}',
  ];
  let index = 0;
  const stub = await listen(async (req, res) => {
    await read(req);
    res.setHeader('content-type', 'application/json');
    res.end(envelope(payloads[index++]!));
  });
  try {
    const model = provider(stub.port, {repairAttempts: 1});
    for (let i = 0; i < payloads.length; i++) assert.deepEqual(await model.analyze(chunk, new AbortController().signal), analysis);
  } finally {await stub.close();}
});

test('truncated JSON fails specifically and is not repaired into a fake object', async () => {
  let calls = 0;
  const stub = await listen(async (req, res) => {
    calls++; await read(req);
    res.end(envelope('{"summary":"渡口","characters":['));
  });
  try {
    const model = provider(stub.port, {repairAttempts: 2, maxAttempts: 1});
    await assert.rejects(model.analyze(chunk, new AbortController().signal), (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, 'MODEL_TRUNCATED_RESPONSE');
      assert.equal((error.details as {path?: string; attempt?: number}).path, '$');
      assert.equal((error.details as {attempt?: number}).attempt, 2);
      assert.match(error.message, /截断/);
      assertNoSecrets(error.message);
      return true;
    });
    assert.equal(calls, 2);
  } finally {await stub.close();}
});

test('429 honors Retry-After instead of the shorter backoff', async () => {
  const delays: number[] = [];
  let calls = 0;
  const stub = await listen(async (req, res) => {
    await read(req); calls++;
    if (calls === 1) {res.writeHead(429, {'retry-after': '2', 'content-type': 'text/plain'}); res.end(novel + apiKey); return;}
    res.end(envelope(JSON.stringify(analysis)));
  });
  try {
    const model = provider(stub.port, {retryBaseMs: 10, retryMaxMs: 40}, {sleep: async ms => {delays.push(ms);}, random: () => 0.5});
    assert.deepEqual(await model.analyze(chunk, new AbortController().signal), analysis);
    assert.deepEqual(delays, [2000]);
    assert.equal(calls, 2);
  } finally {await stub.close();}
});

test('HTTP 500 is retried with backoff and the upstream body is not copied into the error', async () => {
  const delays: number[] = [];
  const {logger, events} = captureLogger();
  let calls = 0;
  const stub = await listen(async (req, res) => {
    calls++; await read(req);
    res.statusCode = 500; res.end(`${apiKey} ${novel}`);
  });
  try {
    const model = provider(stub.port, {maxAttempts: 3, retryBaseMs: 10, retryMaxMs: 40}, {sleep: async ms => {delays.push(ms);}, random: () => 0.5}, logger);
    await assert.rejects(model.analyze(chunk, new AbortController().signal), (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, 'MODEL_HTTP_ERROR');
      const details = error.details as {status?: number; attempt?: number};
      assert.equal(details.status, 500);
      assert.equal(details.attempt, 3);
      assert.match(error.message, /500/);
      assertNoSecrets(String(error));
      return true;
    });
    assert.equal(calls, 3);
    assert.deepEqual(delays, [10, 20]);
    assertNoSecrets(events);
  } finally {await stub.close();}
});

test('timeouts are retried and a later response can succeed', async () => {
  let calls = 0;
  const stub = await listen(async (req, res) => {
    calls++; await read(req);
    if (calls === 1) return;
    res.end(envelope(JSON.stringify(analysis)));
  });
  try {
    const model = provider(stub.port, {timeoutMs: 80, maxAttempts: 2, retryBaseMs: 0, retryMaxMs: 0, repairAttempts: 1});
    assert.equal((await model.analyze(chunk, new AbortController().signal)).summary, '渡口');
    assert.equal(calls, 2);
  } finally {await stub.close();}
});

test('schema errors are sent back and a corrected response is accepted', async () => {
  const bodies: {messages: {content: string}[]}[] = [];
  const stub = await listen(async (req, res) => {
    const body = JSON.parse(await read(req)); bodies.push(body);
    const content = bodies.length === 1
      ? {summary: '', characters: [], locations: [], worldRules: [], uncertainties: []}
      : analysis;
    res.end(envelope(JSON.stringify(content)));
  });
  try {
    const model = provider(stub.port, {repairAttempts: 3, maxAttempts: 1});
    assert.equal((await model.analyze(chunk, new AbortController().signal)).summary, '渡口');
    assert.equal(bodies.length, 2);
    const repair = bodies[1].messages.at(-1)?.content ?? '';
    assert.match(repair, /SCHEMA_VALIDATION_FAILED/);
    assert.match(repair, /summary/);
    assert.equal(repair.includes(novel), false);
    assert.equal(repair.includes(apiKey), false);
  } finally {await stub.close();}
});

test('permanent schema failure reports the field path and attempt without secrets', async () => {
  const {logger, events} = captureLogger();
  let calls = 0;
  const stub = await listen(async (req, res) => {
    calls++; await read(req);
    res.end(envelope(JSON.stringify({summary: '', characters: [], locations: [], worldRules: [], uncertainties: []})));
  });
  try {
    const model = provider(stub.port, {repairAttempts: 2, maxAttempts: 1}, undefined, logger);
    await assert.rejects(model.analyze(chunk, new AbortController().signal), (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, 'SCHEMA_VALIDATION_FAILED');
      const details = error.details as {path?: string; attempt?: number};
      assert.equal(details.path, 'summary');
      assert.equal(details.attempt, 2);
      assert.match(error.message, /summary/);
      assertNoSecrets(String(error));
      return true;
    });
    assert.equal(calls, 2);
    assert.equal(events.some(event => event.event === 'model.output.rejected' && event.fields?.path === 'summary'), true);
    assertNoSecrets(events);
  } finally {await stub.close();}
});

test('authentication failures are not retried and do not echo credentials', async () => {
  let calls = 0;
  const stub = await listen(async (req, res) => {
    calls++; await read(req); res.statusCode = 401; res.end(apiKey + novel);
  });
  try {
    const model = provider(stub.port, {maxAttempts: 3});
    await assert.rejects(model.analyze(chunk, new AbortController().signal), (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.match(error.message, /401/);
      assertNoSecrets(String(error));
      return true;
    });
    assert.equal(calls, 1);
  } finally {await stub.close();}
});
