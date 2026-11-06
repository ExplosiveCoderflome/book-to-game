import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { test } from 'node:test';
import { AgentChatCompletionsModel } from '../src/platform/model/agent-chat.js';
import type { ChatRunHooks, ChatTool } from '../src/modules/agent/index.js';
import { scriptedChat, streamChatReply } from './helpers/agent-pi.js';

const messages = [{id: 'm1', role: 'user' as const, content: '列出原作', createdAt: new Date().toISOString()}];
const hooks = (): ChatRunHooks => ({maxRounds: 8, startTurn() {}, assistant() {},
  execute: async () => ({content: '[{"title":"测试原作"}]', proposed: false}), toolResult() {}});
test('agent chat model: Pi streams native calls, executes tools and feeds receipts to the configured endpoint', async () => {
  const bodies: any[] = [];
  const server = createServer(async (req, res) => {
    assert.equal(req.url, '/v1/chat/completions'); assert.equal(req.headers.authorization, 'Bearer test-agent-key');
    let raw = ''; for await (const chunk of req) raw += chunk;
    bodies.push(JSON.parse(raw));
    streamChatReply(res, bodies.length === 1 ? {content: null, tool_calls: [{id: 'call-real', type: 'function', function: {name: 'list_sources', arguments: '{}'}}]} : {content: '当前有一本测试原作。'});
  }).listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const adapter = new AgentChatCompletionsModel({baseUrl: `http://127.0.0.1:${(server.address() as {port: number}).port}/v1`, model: 'test-agent-model', apiKey: 'test-agent-key', timeoutMs: 2000});
    const tool: ChatTool = {name: 'list_sources', description: 'list sources', parameters: {type: 'object', properties: {}},
      requiresConfirmation: false, validate: () => ({}), prepare: () => ({summary: ''}), execute: () => []};
    const replies: string[] = []; const updates: string[] = []; let executed = 0;
    const callbacks = hooks();
    const result = await adapter.run(messages, [tool], AbortSignal.timeout(5000), {...callbacks,
      assistant(reply, final) {(final ? replies : updates).push(reply.text);},
      execute: async call => {executed++; assert.deepEqual(call, {id: 'call-real', name: 'list_sources', arguments: {}}); return callbacks.execute(call);}});
    assert.equal(result.limited, false); assert.equal(executed, 1);
    assert.match(replies.at(-1)!, /测试原作/); assert.ok(updates.some(text => text.includes('测试原作')));
    assert.equal(bodies[0].model, 'test-agent-model'); assert.equal(bodies[0].stream, true);
    assert.equal(bodies[1].messages.at(-1).tool_call_id, 'call-real');
    assert.equal(bodies[1].messages.at(-2).tool_calls[0].function.arguments, '{}');
    assert.equal(JSON.stringify(bodies).includes('test-agent-key'), false);
  } finally {await new Promise<void>(r => server.close(() => r()));}
});

test('agent chat model: provider failures never echo upstream bodies or credentials', async () => {
  const server = createServer((_req, res) => {res.writeHead(401); res.end('sensitive-provider-body test-agent-key');}).listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const adapter = new AgentChatCompletionsModel({baseUrl: `http://127.0.0.1:${(server.address() as {port: number}).port}`, model: 'test', apiKey: 'test-agent-key', timeoutMs: 2000});
    await assert.rejects(adapter.run(messages, [], AbortSignal.timeout(5000), hooks()), error =>
      (error as {code: string}).code === 'CHAT_MODEL_HTTP_ERROR' && !/sensitive-provider-body|test-agent-key/.test(JSON.stringify(error)));
  } finally {await new Promise<void>(r => server.close(() => r()));}
});

test('agent chat model: empty replies and duplicate call ids fail before any tool executes', async () => {
  const server = createServer((_req, res) => streamChatReply(res, {content: ''})).listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const adapter = new AgentChatCompletionsModel({baseUrl: `http://127.0.0.1:${(server.address() as {port: number}).port}/v1`, model: 'test', apiKey: 'test-agent-key', timeoutMs: 2000});
    let executions = 0;
    const callbacks = {...hooks(), execute: async () => {executions++; return {content: '{}', proposed: false};}};
    await assert.rejects(adapter.run(messages, [], AbortSignal.timeout(5000), callbacks), {code: 'CHAT_MODEL_INVALID_RESPONSE'});
    const duplicate = scriptedChat(async () => ({text: '', calls: [0, 1].map(() => ({id: 'duplicate', name: 'list_sources', arguments: {}}))}));
    const tool: ChatTool = {name: 'list_sources', description: 'list sources', parameters: {type: 'object', properties: {}},
      requiresConfirmation: false, validate: () => ({}), prepare: () => ({summary: ''}), execute: () => []};
    await assert.rejects(duplicate.run(messages, [tool], AbortSignal.timeout(5000), callbacks), {code: 'CHAT_MODEL_INVALID_RESPONSE'});
    assert.equal(executions, 0);
  } finally {await new Promise<void>(resolve => server.close(() => resolve()));}
});

import { redactProviderText, summarizeProviderFailure } from '../src/platform/model/agent-chat.js';

test('agent chat model: provider failure summaries redact secrets and keep status', () => {
  const secret = 'test-agent-key-super-secret';
  const raw = `401 {"error":{"message":"bad key ${secret}","type":"invalid_request_error","code":"invalid_api_key"}} Authorization: Bearer ${secret}`;
  const summary = summarizeProviderFailure(raw, [secret], 0);
  assert.equal(summary.httpStatus, 401);
  assert.equal(summary.errorType, 'invalid_request_error');
  assert.equal(summary.bodyPreview.includes(secret), false);
  assert.match(summary.bodyPreview, /REDACTED/);
  assert.equal(redactProviderText(`Bearer ${secret}`, [secret]).includes(secret), false);
});

test('agent chat model: failed provider responses log safely without leaking into AppError', async () => {
  const lines: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
  const server = createServer((_req, res) => {res.writeHead(400); res.end(JSON.stringify({error:{message:'tool schema rejected test-agent-key', type:'invalid_request_error'}}));}).listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const adapter = new AgentChatCompletionsModel({baseUrl: `http://127.0.0.1:${(server.address() as {port: number}).port}`, model: 'test', apiKey: 'test-agent-key', timeoutMs: 2000});
    await assert.rejects(adapter.run(messages, [], AbortSignal.timeout(5000), hooks()), error => {
      const text = JSON.stringify(error);
      return (error as {code: string}).code === 'CHAT_MODEL_HTTP_ERROR' && !/test-agent-key|tool schema rejected/.test(text);
    });
    const logged = lines.find(line => line.includes('agent.chat.model_error'));
    assert.ok(logged, 'expected model_error log line');
    assert.equal(logged!.includes('test-agent-key'), false);
    const parsed = JSON.parse(logged!);
    assert.equal(parsed.event, 'agent.chat.model_error');
    assert.ok(parsed.requestBytes >= 0);
    assert.ok(parsed.messageCount >= 0);
  } finally {
    console.error = original;
    await new Promise<void>(r => server.close(() => r()));
  }
});
