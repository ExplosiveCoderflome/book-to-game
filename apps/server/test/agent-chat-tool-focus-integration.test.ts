import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import express from 'express';
import { z } from 'zod';
import { createWorldFromIdeaInputSchema } from '@novel-game/contracts';
import { createWorkbench } from '../src/app/workbench.js';
import { createCommands } from '../src/app/commands/index.js';
import { apiRouter } from '../src/adapters/http/routes.js';
import { mcpRouter } from '../src/adapters/mcp/router.js';
import { openDatabase } from '../src/platform/database.js';
import { createModelSettings } from '../src/platform/create-model-settings.js';
import { content } from './helpers/open-fixture.js';

async function request(app: express.Express, url: string, body: unknown) {
  const req = new IncomingMessage(new Socket()); req.method = 'POST'; req.url = url;
  req.headers = {host: 'localhost', 'content-type': 'application/json', accept: 'application/json, text/event-stream'};
  req.rawHeaders = Object.entries(req.headers).flatMap(([key, value]) => [key, String(value)]);
  Object.assign(req, {body});
  const res = new ServerResponse(req); let text = '';
  const decode = (chunk: unknown) => chunk instanceof Uint8Array ? Buffer.from(chunk).toString('utf8') : String(chunk);
  await new Promise<void>((resolve, reject) => {
    res.write = ((chunk: unknown) => {text += decode(chunk); return true;}) as typeof res.write;
    res.end = ((chunk?: unknown) => {if (chunk) text += decode(chunk); resolve(); queueMicrotask(() => res.emit('close')); return res;}) as typeof res.end;
    app(req as express.Request, res as express.Response, reject);
  });
  const data = text.split(String.fromCharCode(10)).find(line => line.startsWith('data: '));
  const payload = data ? data.slice(6) : text;
  return {status: res.statusCode, body: JSON.parse(payload)};
}

test('focused real Pi: discovery creates only an author card, confirms once, resets focus and validates committed revision', async t => {
  const db = openDatabase(':memory:'); const bodies: any[] = [];
  const w = createWorkbench(db, createModelSettings(db, '/tmp/opencode', {baseUrl: 'http://localhost/v1', model: 'focus-integration', apiKey: '', timeoutMs: 3000}), undefined, {dataDir: '/tmp/opencode'});
  const mock = t.mock.method(globalThis, 'fetch', async (_input: unknown, init?: RequestInit) => {
    const input = JSON.parse(String(init?.body)); bodies.push(input);
    const step = bodies.length;
    const names = ['discover_agent_tools', 'select_agent_tools', 'create_world_from_idea', 'discover_agent_tools', 'select_agent_tools', 'validate_world_draft'];
    const current = w.worlds.list()[0];
    const args = step === 2 ? {names: ['create_world_from_idea']} : step === 3 ? {requestId: 'c7ac2d8f-a2cd-45df-8f65-7125b71cd99a', title: 'Focused trial', idea: 'A crossing trial', content: content()}
      : step === 5 ? {names: ['validate_world_draft']} : step === 6 ? {id: current!.id} : {};
    const delta = step <= 6 ? {role: 'assistant', tool_calls: [{index: 0, id: `focused-create-${step}`, type: 'function', function: {name: names[step - 1], arguments: JSON.stringify(args)}}]} : {role: 'assistant', content: 'Validated'};
    const separator = String.fromCharCode(10, 10);
    return new Response([JSON.stringify({choices: [{index: 0, delta, finish_reason: null}]}), JSON.stringify({choices: [{index: 0, delta: {}, finish_reason: step <= 6 ? 'tool_calls' : 'stop'}]}), '[DONE]', ''].map(s => s ? `data: ${s}` : '').join(separator), {headers: {'Content-Type': 'text/event-stream'}});
  });
  try {
    const chat = w.agentChat.create();
    const pending = await w.agentChat.send({id: chat.id, requestId: 'focused-create-intent', text: 'Create a trial'});
    assert.equal(bodies.length, 3); assert.equal(pending.actions.length, 1);
    assert.equal(pending.actions[0]!.toolName, 'create_world_from_idea'); assert.equal(pending.actions[0]!.status, 'pending');
    assert.equal(w.worlds.list().length, 0); assert.equal(w.sources.list().length, 0);
    assert.deepEqual(bodies[2].tools.find((t: any) => t.function.name === 'create_world_from_idea').function.parameters, z.toJSONSchema(createWorldFromIdeaInputSchema, {unrepresentable: 'any', reused: 'ref'}));
    const done = await w.agentChat.decide({id: chat.id, actionId: pending.actions[0]!.id, decision: 'confirm'});
    assert.equal(done.actions[0]!.status, 'succeeded'); assert.equal(w.worlds.list().length, 1); assert.equal(w.sources.list().length, 1);
    assert.deepEqual(bodies[3].tools.map((t: any) => t.function.name), ['discover_agent_tools', 'select_agent_tools']);
    assert.ok(done.messages.some(m => m.role === 'tool' && m.toolName === 'validate_world_draft' && JSON.parse(m.content).valid === true));
    assert.deepEqual(done.messages.slice(0, pending.messages.length - 1), pending.messages.slice(0, -1));
    await w.agentChat.decide({id: chat.id, actionId: pending.actions[0]!.id, decision: 'confirm'});
    assert.equal(bodies.length, 7); assert.equal(w.worlds.list().length, 1); assert.equal(w.worlds.listRevisions().length, 0);
    t.diagnostic(JSON.stringify({focusedCreateRequestBytes: bodies.map(b => Buffer.byteLength(JSON.stringify(b))), authorCards: done.actions.length, worlds: w.worlds.list().length}));
  } finally {mock.mock.restore(); db.close();}
});

test('focused reshape boundary: mocked native Pi prepares guarded card; real MCP denies author decision and HTTP confirms once', async t => {
  const db = openDatabase(':memory:');
  const w = createWorkbench(db, createModelSettings(db, '/tmp/opencode', {baseUrl: 'http://localhost/v1', model: 'focus-boundary', apiKey: '', timeoutMs: 3000}), undefined, {dataDir: '/tmp/opencode'});
  const source = w.sources.importFile({title: 'Boundary', filename: 'fixture.txt', bytes: Buffer.from('Chapter one. Crossing.')});
  const initial = content(); initial.sourceChapterIds = [source.chapters[0]!.id];
  const draft = w.worlds.create({sourceId: source.id, content: initial});
  const candidate = structuredClone(draft.content); candidate.actions.find(a => a.id === 'to_market')!.effects = [{kind: 'move', locationId: 'gate'}];
  const input = {worldId: draft.id, expectedVersion: draft.version, content: candidate};
  const proposal = w.worlds.proposeReshape(input); const args = {...input, diffHash: proposal.diffHash};
  let calls = 0;
  const mock = t.mock.method(globalThis, 'fetch', async (_input: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)); calls++;
    if (calls === 3) assert.ok(body.tools.some((t: any) => t.function.name === 'confirm_world_reshape'));
    const name = calls === 1 ? 'discover_agent_tools' : calls === 2 ? 'select_agent_tools' : 'confirm_world_reshape';
    const delta = calls <= 3 ? {role: 'assistant', tool_calls: [{index: 0, id: `reshape-focus-${calls}`, type: 'function', function: {name, arguments: JSON.stringify(calls === 1 ? {} : calls === 2 ? {names: ['confirm_world_reshape']} : args)}}]} : {role: 'assistant', content: 'Confirmed'};
    const separator = String.fromCharCode(10, 10);
    return new Response([JSON.stringify({choices: [{index: 0, delta, finish_reason: null}]}), JSON.stringify({choices: [{index: 0, delta: {}, finish_reason: calls <= 3 ? 'tool_calls' : 'stop'}]}), '[DONE]', ''].map(s => s ? `data: ${s}` : '').join(separator), {headers: {'Content-Type': 'text/event-stream'}});
  });
  try {
    const commands = createCommands(w); const app = express(); app.use('/api', apiRouter(commands)); app.use('/mcp', mcpRouter(commands));
    const chat = w.agentChat.create();
    const pending = await w.agentChat.send({id: chat.id, requestId: 'focused-reshape', text: 'Propose reshape'});
    const action = pending.actions[0]!; assert.equal(action.status, 'pending'); assert.equal(action.guard, `${draft.version}:${proposal.diffHash}`);
    for (const decision of ['confirm', 'reject']) {
      const denied = await request(app, '/mcp', {jsonrpc: '2.0', id: 1, method: 'tools/call', params: {name: 'decide_agent_action', arguments: {id: chat.id, actionId: action.id, decision, authorConfirmed: true}}});
      assert.equal(denied.body.result.isError, true); assert.match(JSON.stringify(denied.body), /not found/);
      assert.deepEqual(w.worlds.get(draft.id), draft); assert.deepEqual(w.agentChat.get(chat.id), pending);
    }
    const direct = await request(app, '/mcp', {jsonrpc: '2.0', id: 2, method: 'tools/call', params: {name: 'confirm_world_reshape', arguments: args}});
    assert.equal(direct.body.result.isError, true); assert.equal(calls, 3);
    const confirmed = await request(app, `/api/agent/chats/${chat.id}/actions/${action.id}`, {decision: 'confirm'});
    assert.equal(confirmed.status, 200); assert.equal(confirmed.body.actions[0].status, 'succeeded');
    assert.equal(w.worlds.get(draft.id).version, 2); assert.deepEqual(w.worlds.get(draft.id).content, candidate);
    assert.equal(w.worlds.getPreservationBaseline(draft.id)!.version, 2);
    const replay = await request(app, `/api/agent/chats/${chat.id}/actions/${action.id}`, {decision: 'confirm'});
    assert.deepEqual(replay.body, confirmed.body); assert.equal(calls, 4); assert.equal(w.worlds.get(draft.id).version, 2);
  } finally {mock.mock.restore(); db.close();}
});
