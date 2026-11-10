import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { z } from 'zod';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createWorldFromIdeaInputSchema, worldContentSchema, type AgentChatConversation } from '@novel-game/contracts';
import { createWorkbench } from '../src/app/workbench.js';
import { openDatabase } from '../src/platform/database.js';
import { createModelSettings } from '../src/platform/create-model-settings.js';
import { createApp } from '../src/adapters/http/app.js';
import { streamChatReply } from './helpers/agent-pi.js';

test('agent conversation: real provider protocol, shared tools, author confirmation, HTTP/MCP history and replay', async () => {
  let calls = 0;
  const provider = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const input = JSON.parse(raw); calls++;
    const result = calls === 1 ? {content: '先查草稿。', tool_calls: [{id: 'list-1', type: 'function', function: {name: 'list_world_drafts', arguments: '{}'}}]}
      : calls === 2 ? (() => {
        const rows = JSON.parse(input.messages.at(-1).content);
        return {content: '找到测试草稿，建议修改标题，请确认。', tool_calls: [{id: 'edit-1', type: 'function', function: {name: 'edit_world_summary', arguments: JSON.stringify({id: rows[0].id, version: rows[0].version, title: '对话修改后的标题'})}}]};
      })() : {content: '已按确认修改标题，草稿为新版本。'};
    assert.equal(input.stream, true); streamChatReply(res, result);
  }).listen(0, '127.0.0.1'); await once(provider, 'listening');
  const dir = mkdtempSync(path.join(tmpdir(), 'btg-agent-chat-test-'));
  const db = openDatabase(path.join(dir, 'workbench.sqlite'));
  const w = createWorkbench(db, createModelSettings(db, dir, {baseUrl: `http://127.0.0.1:${(provider.address() as {port: number}).port}/v1`, model: 'local-chat-test', apiKey: '', timeoutMs: 3000}), undefined, {dataDir: dir});
  const source = w.sources.importFile({title: '对话测试', filename: 'test.txt', bytes: Buffer.from('第一章\n原作证据。')});
  const content = worldContentSchema.parse(JSON.parse(readFileSync(new URL('../../../fixtures/s1/route-coverage.engine.json', import.meta.url), 'utf8')));
  content.sourceChapterIds = [source.chapters[0]!.id]; const draft = w.worlds.create({sourceId: source.id, content});
  const token = 'chat-integration-test-access-code';
  const server = createApp(w, {token, allowedOrigins: []}).listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as {port: number}).port}`;
  const client = new Client({name: 'agent-chat-integration', version: '1.0.0'});
  const post = (url: string, body: unknown) => fetch(base + url, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
  try {
    const emptyEdit = await fetch(`${base}/api/worlds/drafts/${draft.id}/summary`, {method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({version: 1})});
    assert.equal(emptyEdit.status, 400, 'empty edits must not create a new world version');
    const response = await post('/api/agent/chats', {}); assert.equal(response.status, 200);
    const chat = await response.json() as AgentChatConversation;
    const sent = await post(`/api/agent/chats/${chat.id}/messages`, {requestId: 'first-message', text: '把草稿标题改一下'});
    assert.equal(sent.status, 200, await sent.clone().text());
    const pending = await sent.json() as AgentChatConversation;
    assert.equal(calls, 2); assert.equal(pending.actions[0]!.toolName, 'edit_world_summary');
    assert.equal(pending.actions[0]!.status, 'pending'); assert.equal(w.worlds.get(draft.id).version, 1);
    await client.connect(new StreamableHTTPClientTransport(new URL(base + '/mcp'), {requestInit: {headers: {Authorization: `Bearer ${token}`}}}));
    const tools = (await client.listTools()).tools;
    assert.ok(tools.some(t => t.name === 'get_agent_chat'));
    const observed = await client.callTool({name: 'get_agent_chat', arguments: {id: chat.id}});
    assert.equal(observed.isError, undefined);
    const confirmed = await post(`/api/agent/chats/${chat.id}/actions/${pending.actions[0]!.id}`, {decision: 'confirm'});
    assert.equal(confirmed.status, 200);
    const done = await confirmed.json() as AgentChatConversation;
    assert.equal(done.actions[0]!.status, 'succeeded'); assert.equal(w.worlds.get(draft.id).version, 2);
    assert.equal(w.worlds.get(draft.id).content.title, '对话修改后的标题');
    await client.callTool({name: 'decide_agent_action', arguments: {id: chat.id, actionId: pending.actions[0]!.id, decision: 'confirm'}});
    assert.equal(calls, 3); assert.equal(w.worlds.get(draft.id).version, 2);
    assert.equal(w.worlds.listRevisions().length, 0);
  } finally {
    await client.close(); await new Promise<void>(r => server.close(() => r())); await new Promise<void>(r => provider.close(() => r())); db.close();
    assert.ok(path.resolve(dir).startsWith(path.resolve(tmpdir()) + path.sep + 'btg-agent-chat-test-')); rmSync(dir, {recursive: true, force: true});
  }
});

test('agent conversation: idea discovery reaches real create confirmation beyond eight Pi turns and resumes validation', async t => {
  const content = worldContentSchema.parse(JSON.parse(readFileSync(new URL('../../../fixtures/s1/route-coverage.engine.json', import.meta.url), 'utf8')));
  let calls = 0; const bodies: any[] = [];
  const provider = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const input = JSON.parse(raw); bodies.push(input); calls++;
    const call = (name: string, args: unknown, suffix = '') => ({id: `idea-${calls}${suffix}`, type: 'function', function: {name, arguments: JSON.stringify(args)}});
    const result = calls === 1 ? {tool_calls: ['runtime_info', 'list_game_dev_skills', 'list_sources', 'list_blocks', 'list_genre_recipes', 'list_fun_profiles'].map((name, i) => call(name, {}, `-${i}`))}
      : calls === 2 ? {tool_calls: ['project-brief', 'world-building', 'pacing-balance', 'quality-review'].map((skillId, i) => call('load_game_dev_skill', {skillId}, `-${i}`))}
      : calls < 10 ? {tool_calls: [call('list_world_drafts', {})]}
      : calls === 10 ? {tool_calls: [call('create_world_from_idea', {requestId: '52ec36d8-3c91-41f6-9b59-1b7c5057647c', title: '本地协议验收想法', idea: '三条路线的文字试炼', content})]}
      : calls === 11 ? (() => {
        const receipt = input.messages.find((m: any) => m.role === 'tool' && m.tool_call_id === 'idea-10');
        const draft = JSON.parse(receipt.content);
        return {tool_calls: [call('validate_world_draft', {id: draft.id})]};
      })() : {content: '创建回执与校验结果已保存。'};
    streamChatReply(res, result);
  }).listen(0, '127.0.0.1'); await once(provider, 'listening');
  const dir = mkdtempSync(path.join(tmpdir(), 'btg-agent-chat-test-'));
  const db = openDatabase(':memory:');
  const w = createWorkbench(db, createModelSettings(db, dir, {baseUrl: `http://127.0.0.1:${(provider.address() as {port: number}).port}/v1`, model: 'local-chat-test', apiKey: '', timeoutMs: 3000}), undefined, {dataDir: dir});
  try {
    const chat = w.agentChat.create();
    const pending = await w.agentChat.send({id: chat.id, requestId: 'idea-request', text: '从想法搭建三条路线的文字试炼'});
    assert.equal(calls, 10); assert.equal(w.worlds.list().length, 0);
    assert.equal(pending.actions.length, 1); assert.equal(pending.actions[0]!.toolName, 'create_world_from_idea');
    assert.equal(pending.actions[0]!.status, 'pending');
    assert.equal(pending.messages.some(m => m.role === 'tool' && m.content.includes('CHAT_TOOL_DENIED')), false);
    const advertised = bodies[0].tools.find((tool: any) => tool.function.name === 'create_world_from_idea');
    assert.deepEqual(advertised.function.parameters, z.toJSONSchema(createWorldFromIdeaInputSchema, {unrepresentable: 'any', reused: 'ref'}));
    const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
    const ranked = bodies[0].tools.map((tool: any) => ({name: tool.function.name, bytes: bytes(tool)}))
      .sort((a: {bytes: number}, b: {bytes: number}) => b.bytes - a.bytes).slice(0, 5);
    t.diagnostic(JSON.stringify({event: 'chat.test.payload_size', toolCount: bodies[0].tools.length,
      toolsBytes: bytes(bodies[0].tools), initialRequestBytes: bytes(bodies[0]), beforeCreateRequestBytes: bytes(bodies[9]), largestTools: ranked}));
    const done = await w.agentChat.decide({id: chat.id, actionId: pending.actions[0]!.id, decision: 'confirm'});
    assert.equal(done.actions[0]!.status, 'succeeded', done.actions[0]!.result);
    assert.equal(w.worlds.list().length, 1); assert.equal(calls, 12);
    assert.ok(done.messages.some(m => m.role === 'tool' && m.toolName === 'validate_world_draft' && JSON.parse(m.content).valid === true));
    assert.equal(bodies[1].messages.filter((m: any) => m.role === 'tool').length, 6);
    await w.agentChat.decide({id: chat.id, actionId: pending.actions[0]!.id, decision: 'confirm'});
    assert.equal(w.worlds.list().length, 1); assert.equal(calls, 12);
    assert.equal(w.worlds.listRevisions().length, 0);
  } finally {
    await new Promise<void>(resolve => provider.close(() => resolve())); db.close();
    rmSync(dir, {recursive: true, force: true});
  }
});

test('agent conversation: failed real idea validation returns rule findings and a corrected confirmed proposal can recover', async () => {
  const content = worldContentSchema.parse(JSON.parse(readFileSync(new URL('../../../fixtures/s1/route-coverage.engine.json', import.meta.url), 'utf8')));
  let calls = 0; let findingReturned = false;
  const provider = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const input = JSON.parse(raw); calls++;
    if (calls === 2) {
      const receipt = input.messages.find((m: any) => m.role === 'tool' && m.tool_call_id === 'invalid-world');
      const result = JSON.parse(receipt.content);
      findingReturned = result.error === 'INVALID_WORLD' && result.validation?.valid === false
        && result.validation.errors.some((error: string) => error.includes('missing-start'));
    }
    streamChatReply(res, calls <= 2 ? {tool_calls: [{id: calls === 1 ? 'invalid-world' : 'repaired-world', type: 'function', function: {
      name: 'create_world_from_idea', arguments: JSON.stringify({requestId: calls === 1
        ? '9c030676-15f5-4ba6-a8c9-ccfabf470330' : 'f791d471-f46b-4f25-a337-69c03ed1a51e',
      title: '规则恢复测试', idea: '三条路线试炼', content: calls === 1 ? {...content, initialLocationId: 'missing-start'} : content}),
    }}]} : {content: '校验回执已保存。'});
  }).listen(0, '127.0.0.1'); await once(provider, 'listening');
  const dir = mkdtempSync(path.join(tmpdir(), 'btg-agent-chat-test-'));
  const db = openDatabase(':memory:');
  const w = createWorkbench(db, createModelSettings(db, dir, {baseUrl: `http://127.0.0.1:${(provider.address() as {port: number}).port}/v1`, model: 'local-chat-test', apiKey: '', timeoutMs: 3000}), undefined, {dataDir: dir});
  try {
    const chat = w.agentChat.create();
    const first = await w.agentChat.send({id: chat.id, requestId: 'invalid-idea', text: '创建小草稿'});
    assert.equal(first.actions[0]!.status, 'pending'); assert.equal(w.worlds.list().length, 0);
    const repaired = await w.agentChat.decide({id: chat.id, actionId: first.actions[0]!.id, decision: 'confirm'});
    assert.equal(repaired.actions[0]!.status, 'failed'); assert.equal(w.worlds.list().length, 0);
    const next = await w.agentChat.send({id: chat.id, requestId: 'repair-idea', text: '根据规则回执修正后再提议'});
    assert.equal(findingReturned, true, 'Pi must receive deterministic rule findings, not only a generic failure');
    assert.equal(next.actions[1]!.status, 'pending'); assert.equal(w.worlds.list().length, 0);
    const done = await w.agentChat.decide({id: chat.id, actionId: next.actions[1]!.id, decision: 'confirm'});
    assert.equal(done.actions[1]!.status, 'succeeded'); assert.equal(w.worlds.list().length, 1);
    assert.equal(w.worlds.validate(w.worlds.list()[0]!.id).valid, true);
    await w.agentChat.decide({id: done.id, actionId: next.actions[1]!.id, decision: 'confirm'});
    assert.equal(w.worlds.list().length, 1); assert.equal(calls, 3); assert.equal(w.worlds.listRevisions().length, 0);
  } finally {
    await new Promise<void>(resolve => provider.close(() => resolve())); db.close(); rmSync(dir, {recursive: true, force: true});
  }
});
