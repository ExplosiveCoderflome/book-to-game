import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdtempSync, rmSync} from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {test} from 'node:test';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type {AgentChatConversation} from '@novel-game/contracts';
import {createWorkbench} from '../src/app/workbench.js';
import {openDatabase} from '../src/platform/database.js';
import {createModelSettings} from '../src/platform/create-model-settings.js';
import {createApp} from '../src/adapters/http/app.js';
import {SqliteWorldRepository} from '../src/modules/worlds/index.js';
import {content} from './helpers/open-fixture.js';
import {streamChatReply} from './helpers/agent-pi.js';

test('MCP cannot decide a fresh reshape pending action; trusted author HTTP confirms the same action once', async () => {
  let calls = 0;
  const advertised: string[][] = [];
  let reshapeArgs: Record<string, unknown>;
  const provider = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {tools: {function: {name: string}}[]};
    advertised.push(body.tools.map(tool => tool.function.name));
    calls++;
    const name = calls === 1 ? 'discover_agent_tools' : calls === 2 ? 'select_agent_tools' : 'confirm_world_reshape';
    const args = calls === 1 ? {} : calls === 2 ? {names: ['confirm_world_reshape']} : reshapeArgs;
    streamChatReply(res, calls <= 3 ? {tool_calls: [{id: calls === 3 ? 'reshape-pending' : `reshape-focus-${calls}`, type: 'function',
      function: {name, arguments: JSON.stringify(args)}}]} : {content: '作者确认已完成。'});
  }).listen(0, '127.0.0.1');
  await once(provider, 'listening');
  const dir = mkdtempSync(path.join(tmpdir(), 'btg-mcp-author-boundary-'));
  const db = openDatabase(path.join(dir, 'workbench.sqlite'));
  const w = createWorkbench(db, createModelSettings(db, dir, {
    baseUrl: `http://127.0.0.1:${(provider.address() as {port: number}).port}/v1`,
    model: 'local-boundary-test', apiKey: '', timeoutMs: 3000,
  }), undefined, {dataDir: dir});
  const source = w.sources.importFile({title: '边界测试', filename: 'test.txt', bytes: Buffer.from('第一章\n渡口原作。')});
  const initial = content(); initial.sourceChapterIds = [source.chapters[0]!.id];
  const draft = w.worlds.create({sourceId: source.id, content: initial});
  const candidate = structuredClone(draft.content);
  candidate.actions.find(action => action.id === 'to_market')!.effects = [{kind: 'move', locationId: 'gate'}];
  const input = {worldId: draft.id, expectedVersion: draft.version, content: candidate};
  const proposal = w.worlds.proposeReshape(input);
  reshapeArgs = {...input, diffHash: proposal.diffHash};
  const repository = new SqliteWorldRepository(db);
  const token = 'isolated-mcp-author-boundary-token';
  const server = createApp(w, {token, allowedOrigins: []}).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as {port: number}).port}`;
  const client = new Client({name: 'model-boundary-test', version: '1.0.0'});
  // The existing author HTTP entry point is trusted. Sharing its Bearer is not proof of a physical human.
  const post = (url: string, body: unknown) => fetch(base + url, {method: 'POST',
    headers: {'Content-Type': 'application/json', Authorization: `Bearer ${token}`}, body: JSON.stringify(body)});
  const snapshot = () => ({world: w.worlds.get(draft.id), baseline: w.worlds.getPreservationBaseline(draft.id),
    receipt: repository.getReshapeReceipt(proposal.diffHash)});
  try {
    const created = await post('/api/agent/chats', {}); assert.equal(created.status, 200);
    const chat = await created.json() as AgentChatConversation;
    const response = await post(`/api/agent/chats/${chat.id}/messages`, {requestId: 'fresh-reshape', text: '请提议重塑'});
    assert.equal(response.status, 200, await response.clone().text());
    const pending = await response.json() as AgentChatConversation;
    const action = pending.actions[0]!;
    assert.equal(action.toolName, 'confirm_world_reshape'); assert.equal(action.status, 'pending');
    assert.equal(pending.actions.length, 1);
    assert.deepEqual(action.arguments, reshapeArgs);
    assert.equal(action.guard, `${draft.version}:${proposal.diffHash}`);
    assert.deepEqual(advertised.slice(0, 2), [
      ['discover_agent_tools', 'select_agent_tools'], ['discover_agent_tools', 'select_agent_tools'],
    ]);
    assert.deepEqual(advertised[2], ['discover_agent_tools', 'select_agent_tools', 'confirm_world_reshape']);
    const metadata = pending.messages.filter(message => message.role === 'tool' &&
      ['discover_agent_tools', 'select_agent_tools'].includes(message.toolName ?? ''));
    assert.deepEqual(metadata.map(message => message.toolName), ['discover_agent_tools', 'select_agent_tools']);
    const inventory = JSON.parse(metadata[0]!.content);
    assert.equal(inventory.complete, true);
    assert.ok(inventory.inventory.some((tool: {name: string}) => tool.name === 'confirm_world_reshape'));
    const selection = JSON.parse(metadata[1]!.content);
    assert.equal(selection.status, 'selected_for_next_request');
    assert.deepEqual(selection.focus, ['confirm_world_reshape']);
    assert.equal(calls, 3); assert.equal(w.worlds.get(draft.id).version, 1);
    const before = snapshot(); assert.equal(before.receipt, undefined);
    await client.connect(new StreamableHTTPClientTransport(new URL(base + '/mcp'), {
      requestInit: {headers: {Authorization: `Bearer ${token}`}},
    }));
    const tools = (await client.listTools()).tools;
    assert.equal(tools.some(tool => tool.name === 'decide_agent_action'), false);
    assert.ok(tools.some(tool => tool.name === 'get_agent_chat'));
    const listed = await client.callTool({name: 'list_agent_chats', arguments: {}});
    assert.equal(listed.isError, undefined);
    const observed = await client.callTool({name: 'get_agent_chat', arguments: {id: chat.id}});
    assert.equal(observed.isError, undefined);
    assert.deepEqual((observed.structuredContent as {result: AgentChatConversation}).result, pending);
    for (const decision of ['confirm', 'reject']) {
      for (const flags of [{}, {authorConfirmed: true, authorization: {author: true}, body: {confirm: true}}]) {
        const denied = await client.callTool({name: 'decide_agent_action',
          arguments: {id: chat.id, actionId: action.id, decision, ...flags}});
        assert.equal(denied.isError, true, 'unadvertised author command must also reject direct calls');
        assert.match(JSON.stringify(denied.content), /Tool decide_agent_action not found/);
        assert.deepEqual(snapshot(), before);
        assert.deepEqual(w.agentChat.get(chat.id), pending);
      }
    }
    const direct = await client.callTool({name: 'confirm_world_reshape', arguments: reshapeArgs});
    assert.equal(direct.isError, true); assert.deepEqual(snapshot(), before);
    assert.deepEqual(w.agentChat.get(chat.id), pending); assert.equal(calls, 3);
    const confirmed = await post(`/api/agent/chats/${chat.id}/actions/${action.id}`, {decision: 'confirm'});
    assert.equal(confirmed.status, 200, await confirmed.clone().text());
    const done = await confirmed.json() as AgentChatConversation;
    assert.equal(done.actions[0]!.id, action.id);
    assert.equal(done.actions[0]!.status, 'succeeded', done.actions[0]!.result);
    assert.equal(w.worlds.get(draft.id).version, 2);
    assert.deepEqual(w.worlds.get(draft.id).content, candidate);
    assert.equal(w.worlds.getPreservationBaseline(draft.id)!.version, 2);
    assert.ok(repository.getReshapeReceipt(proposal.diffHash)); assert.equal(calls, 4);
    assert.deepEqual(advertised[3], ['discover_agent_tools', 'select_agent_tools']);
    const saved = snapshot();
    const replay = await post(`/api/agent/chats/${chat.id}/actions/${action.id}`, {decision: 'confirm'});
    assert.equal(replay.status, 200); assert.deepEqual(await replay.json(), done);
    assert.deepEqual(snapshot(), saved); assert.equal(calls, 4);
    const readBack = await client.callTool({name: 'get_agent_chat', arguments: {id: chat.id}});
    assert.equal(readBack.isError, undefined);
    assert.deepEqual((readBack.structuredContent as {result: AgentChatConversation}).result, done);
  } finally {
    await client.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await new Promise<void>(resolve => provider.close(() => resolve()));
    db.close(); rmSync(dir, {recursive: true, force: true});
  }
});
