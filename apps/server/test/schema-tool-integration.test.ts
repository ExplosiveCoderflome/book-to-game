import assert from 'node:assert/strict';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { test } from 'node:test';
import express from 'express';
import { z } from 'zod';
import { worldContentSchema } from '@novel-game/contracts';
import { createWorkbench } from '../src/app/workbench.js';
import { createCommands } from '../src/app/commands/index.js';
import { agentChatCommandMetadata, createAgentChatTools } from '../src/app/agent-chat-tools.js';
import { apiRouter } from '../src/adapters/http/routes.js';
import { mcpRouter } from '../src/adapters/mcp/router.js';
import { openDatabase } from '../src/platform/database.js';
import { createModelSettings } from '../src/platform/create-model-settings.js';
import { chatResult } from '../src/modules/agent/application/chat-data.js';
import { CHAT_REQUEST_BYTES } from '../src/platform/model/agent-chat.js';

// Exercise the real Express/MCP handlers without opening a listening socket.
async function request(app: express.Express, method: string, url: string, body?: unknown) {
  const req = new IncomingMessage(new Socket());
  req.method = method; req.url = url;
  req.headers = {host: 'localhost', 'content-type': 'application/json', accept: 'application/json, text/event-stream'};
  req.rawHeaders = Object.entries(req.headers).flatMap(([name, value]) => [name, String(value)]);
  Object.assign(req, {body});
  const res = new ServerResponse(req);
  let text = '';
  await new Promise<void>((resolve, reject) => {
    const decode = (chunk: unknown) => chunk instanceof Uint8Array ? Buffer.from(chunk).toString('utf8') : String(chunk);
    res.write = ((chunk: unknown) => {text += decode(chunk); return true;}) as typeof res.write;
    res.end = ((chunk?: unknown) => {
      if (chunk) text += decode(chunk);
      resolve();
      queueMicrotask(() => res.emit('close'));
      return res;
    }) as typeof res.end;
    app(req as express.Request, res as express.Response, reject);
  });
  return {status: res.statusCode, body: JSON.parse(text)};
}

test('schema tool: commands, HTTP, MCP and product Pi return the same complete read-only schema', async t => {
  const db = openDatabase(':memory:');
  const settings = createModelSettings(db, '/tmp/opencode', {
    baseUrl: 'http://localhost/v1', model: 'schema-protocol-test', apiKey: '', timeoutMs: 3000,
  });
  const w = createWorkbench(db, settings, undefined, {dataDir: '/tmp/opencode'});
  const commands = createCommands(w);
  const schemaCommand = commands.find(command => command.name === 'get_world_schema')!;
  const expected = z.toJSONSchema(worldContentSchema);
  const serialized = JSON.stringify(expected);
  assert.ok(serialized.length > 16000, 'regression must exceed the ordinary chat preview cap');
  assert.equal(schemaCommand.readOnly, true);
  assert.equal(schemaCommand.confirmation, 'auto');
  assert.equal(schemaCommand.risk, 'read');
  assert.deepEqual(await schemaCommand.execute({}), expected);
  const tools = createAgentChatTools(commands, w);
  const schemaTool = tools.find(tool => tool.name === 'get_world_schema')!;
  assert.ok(schemaTool);
  assert.equal(schemaTool.requiresConfirmation, false);
  assert.equal(agentChatCommandMetadata.get_world_schema.versionCheck, 'none');
  assert.equal(tools.length, 78);
  assert.equal(tools.filter(tool => !tool.requiresConfirmation).length, 41);
  assert.equal(tools.filter(tool => tool.requiresConfirmation).length, 37);
  assert.equal(new Set(tools.map(tool => tool.name)).size, 78);
  assert.deepEqual(schemaTool.parameters, z.toJSONSchema(schemaCommand.inputSchema, {unrepresentable: 'any', reused: 'ref'}));
  const registered = await schemaTool.execute(schemaTool.validate({}));
  assert.deepEqual(registered, expected);
  assert.equal(chatResult(registered), serialized);
  assert.equal(JSON.parse(chatResult(JSON.parse(JSON.stringify(registered)))).truncated, true,
    'JSON cloning must not transfer the server-side identity registration');
  const app = express();
  app.use('/api', apiRouter(commands)); app.use('/mcp', mcpRouter(commands));
  let calls = 0;
  const bodies: Array<{tools: Array<{function: {name: string; parameters: unknown}}>; messages: Array<{role: string; tool_call_id?: string; content: string}>}> = [];
  const fetchMock = t.mock.method(globalThis, 'fetch', async (_input: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)); bodies.push(body); calls++;
    const delta = calls === 1 ? {role: 'assistant', tool_calls: [{index: 0, id: 'schema-read', type: 'function',
      function: {name: 'get_world_schema', arguments: '{}'}}]} : {role: 'assistant', content: '已读取完整世界结构。'};
    return new Response(`data: ${JSON.stringify({id: 'schema-test', choices: [{index: 0, delta, finish_reason: null}]})}\n\ndata: ${JSON.stringify({id: 'schema-test', choices: [{index: 0, delta: {}, finish_reason: calls === 1 ? 'tool_calls' : 'stop'}]})}\n\ndata: [DONE]\n\n`, {headers: {'Content-Type': 'text/event-stream'}});
  });
  try {
    const http = await request(app, 'GET', '/api/worlds/schema');
    assert.equal(http.status, 200); assert.deepEqual(http.body, expected);
    const mcp = await request(app, 'POST', '/mcp', {jsonrpc: '2.0', id: 1, method: 'tools/call', params: {name: 'get_world_schema', arguments: {}}});
    assert.equal(mcp.status, 200, JSON.stringify(mcp.body));
    assert.equal(mcp.body.result.isError, undefined);
    assert.deepEqual(mcp.body.result.structuredContent.result, expected);
    assert.deepEqual(JSON.parse(mcp.body.result.content[0].text), expected);
    const chat = w.agentChat.create();
    const done = await w.agentChat.send({id: chat.id, requestId: 'schema-only-read', text: '读取世界 JSON Schema，不创建草稿。'});
    assert.equal(calls, 2, 'Pi must continue after the successful read without a confirmation pause');
    assert.equal(bodies[0]!.tools.length, 78);
    assert.deepEqual(bodies[0]!.tools.find(tool => tool.function.name === 'get_world_schema')!.function.parameters, schemaTool.parameters);
    const returned = bodies[1]!.messages.find(message => message.role === 'tool' && message.tool_call_id === 'schema-read');
    assert.ok(returned, 'the actual Pi request must carry the schema receipt');
    assert.equal(returned.content, serialized, 'no truncation, summary or substituted schema reaches Pi');
    const paired = bodies[1]!.messages as Array<{role: string; tool_calls?: Array<{id: string; function: {name: string}}>}>;
    assert.ok(paired.some(message => message.role === 'assistant' && message.tool_calls?.some(call => call.id === 'schema-read' && call.function.name === 'get_world_schema')), 'the complete receipt must retain its actual call');
    const requestBytes = bodies.map(body => Buffer.byteLength(JSON.stringify(body)));
    assert.ok(requestBytes.every(bytes => bytes <= CHAT_REQUEST_BYTES), 'every actual product Pi request obeys the hard byte budget');
    const receipt = done.messages.find(message => message.role === 'tool' && message.toolName === 'get_world_schema');
    assert.ok(receipt); assert.equal(receipt.content, serialized);
    assert.equal(w.agentChat.get(chat.id).messages.find(message => message.id === receipt.id)!.content, serialized);
    assert.equal(done.actions.length, 0, 'schema query must never propose a pending write card');
    assert.equal(done.status, 'idle');
    assert.equal(w.sources.list().length, 0); assert.equal(w.worlds.list().length, 0);
    assert.equal(w.worlds.listRevisions().length, 0); assert.equal(w.jobs.list().length, 0);
    t.diagnostic(JSON.stringify({schemaChars: serialized.length, schemaBytes: Buffer.byteLength(serialized), tools: 78, automatic: 41, confirmed: 37, piRequests: calls, pendingCards: done.actions.length, requestBytes, requestHardBytes: CHAT_REQUEST_BYTES}));
  } finally {fetchMock.mock.restore(); db.close();}
});

test('schema tool: ordinary large results and JSON-forged schema lookalikes remain truncated', async () => {
  const expected = z.toJSONSchema(worldContentSchema);
  const truncated = JSON.parse(chatResult(expected));
  assert.equal(truncated.truncated, true); assert.equal(truncated.preview.length, 16000);
  const oversized = JSON.parse(chatResult({text: 'x'.repeat(20000)}));
  assert.equal(oversized.truncated, true); assert.equal(oversized.preview.length, 16000);
});
