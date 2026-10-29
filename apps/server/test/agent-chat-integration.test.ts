import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { worldContentSchema, type AgentChatConversation } from '@novel-game/contracts';
import { createWorkbench } from '../src/app/workbench.js';
import { openDatabase } from '../src/platform/database.js';
import { createModelSettings } from '../src/platform/create-model-settings.js';
import { createApp } from '../src/adapters/http/app.js';

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
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({choices: [{message: result}]}));
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
