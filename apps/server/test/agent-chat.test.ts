import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as agent from '../src/modules/agent/index.js';
import { openDatabase } from '../src/platform/database.js';

function setup() {
  assert.equal(typeof agent.AgentChatService, 'function', 'Agent must expose a conversational service, not only supervisor reports');
  const db = openDatabase(':memory:');
  const repository = new agent.SqliteChatRepository(db);
  let writes = 0, reads = 0, state = 'v1', modelCalls = 0;
  const received: any[] = [];
  const replies: any[] = [];
  let responder: ((messages: any[]) => Promise<any>) | undefined;
  const model = {respond: async (messages: any[]) => {
    modelCalls++; received.push(structuredClone(messages));
    if (responder) return responder(messages);
    const reply = replies.shift(); if (reply instanceof Error) throw reply;
    return reply ?? {text: '已完成，根据工具回执回复。', calls: []};
  }};
  const tool = (name: string, requiresConfirmation: boolean) => ({name, description: name, parameters: {type: 'object'}, requiresConfirmation,
    validate: (input: unknown) => {if (!input || typeof input !== 'object' || !('id' in input)) throw new Error('id required'); return {id: String((input as {id: unknown}).id)};},
    prepare: () => ({summary: '修改测试草稿 v1', guard: state}),
    execute: () => {if (requiresConfirmation) writes++; else reads++; return {id: 'draft-1', title: '工具中保存的真实标题', version: 2};}});
  const deps = {repository, model: () => model, tools: () => [tool('get_world_draft', false), tool('update_world_draft', true)]};
  const service = new agent.AgentChatService(deps);
  const conversation = service.create();
  return {db, repository, service, conversation, deps, replies, received,
    counts: () => ({writes, reads, modelCalls}), change: () => {state = 'v2';},
    respond: (fn: NonNullable<typeof responder>) => {responder = fn;}};
}
const call = (name: string, id = 'call-1') => ({id, name, arguments: {id: 'draft-1'}});
const send = (s: ReturnType<typeof setup>, requestId = 'request-1', text = '帮我检查草稿') => s.service.send({id: s.conversation.id, requestId, text});

test('agent chat: a saved conversation and history survive rebuilding the service', async () => {
  const s = setup(); try {
    s.replies.push({text: '你好，我可以帮助改编游戏。', calls: []});
    const result = await send(s);
    assert.equal(result.status, 'idle'); assert.equal(result.messages[0]!.role, 'user');
    assert.match(result.messages.at(-1)!.content, /帮助改编/);
    assert.deepEqual(new agent.AgentChatService(s.deps).get(result.id).messages, result.messages);
    assert.equal(s.service.list().length, 1);
  } finally {s.db.close();}
});

test('agent chat: a read tool executes and its actual result is sent back to the model', async () => {
  const s = setup(); try {
    s.replies.push({text: '我来读取草稿。', calls: [call('get_world_draft')]}, {text: '标题是工具中保存的真实标题。', calls: []});
    const result = await send(s);
    assert.deepEqual(s.counts(), {writes: 0, reads: 1, modelCalls: 2});
    assert.ok(s.received[1].some((m: any) => m.role === 'tool' && m.toolCallId === 'call-1' && m.content.includes('工具中保存的真实标题')));
    assert.match(result.messages.at(-1)!.content, /真实标题/);
  } finally {s.db.close();}
});

test('agent chat: writes wait for author confirmation, execute once and continue the conversation', async () => {
  const s = setup(); try {
    s.replies.push({text: '建议修改草稿。', calls: [call('update_world_draft')]});
    const proposed = await send(s);
    assert.equal(s.counts().writes, 0); assert.equal(proposed.actions[0]!.status, 'pending');
    assert.match(proposed.actions[0]!.summary, /测试草稿/);
    const result = await s.service.decide({id: proposed.id, actionId: proposed.actions[0]!.id, decision: 'confirm'});
    assert.equal(result.actions[0]!.status, 'succeeded'); assert.equal(s.counts().writes, 1);
    await s.service.decide({id: proposed.id, actionId: proposed.actions[0]!.id, decision: 'confirm'});
    await send(s);
    assert.equal(s.counts().writes, 1); assert.equal(s.counts().modelCalls, 2);
  } finally {s.db.close();}
});

test('agent chat: rejecting a proposed write never executes it', async () => {
  const s = setup(); try {
    s.replies.push({text: '', calls: [call('update_world_draft')]});
    const c = await send(s);
    const rejected = await s.service.decide({id: c.id, actionId: c.actions[0]!.id, decision: 'reject'});
    assert.equal(rejected.actions[0]!.status, 'rejected'); assert.equal(s.counts().writes, 0);
  } finally {s.db.close();}
});

test('agent chat: a discussion about a pending action cannot execute or replace it', async () => {
  const s = setup(); try {
    s.replies.push({text: '', calls: [call('update_world_draft')]});
    const first = await send(s);
    s.replies.push({text: '再次提议', calls: [call('update_world_draft', 'call-2')]}, {text: '仍需你点击确认。', calls: []});
    const next = await send(s, 'question-2', '解释一下这个操作');
    assert.equal(next.actions.length, 1); assert.equal(next.actions[0]!.id, first.actions[0]!.id); assert.equal(s.counts().writes, 0);
  } finally {s.db.close();}
});

test('agent chat: changed task guard blocks a previously proposed write', async () => {
  const s = setup(); try {
    s.replies.push({text: '', calls: [call('update_world_draft')]}); const c = await send(s); s.change();
    const result = await s.service.decide({id: c.id, actionId: c.actions[0]!.id, decision: 'confirm'});
    assert.equal(result.actions[0]!.status, 'failed'); assert.equal(s.counts().writes, 0);
    assert.ok(result.messages.some(m => /状态已变化/.test(m.content)));
  } finally {s.db.close();}
});

test('agent chat: unknown tools and invalid arguments are reported without executing', async () => {
  const s = setup(); try {
    s.replies.push({text: '', calls: [call('save_model_settings'), {id: 'invalid', name: 'update_world_draft', arguments: {}}]}, {text: '工具被拒绝。', calls: []});
    const c = await send(s);
    assert.equal(c.actions.length, 0); assert.equal(s.counts().writes, 0); assert.equal(s.counts().reads, 0);
    assert.ok(c.messages.some(m => m.role === 'tool' && /error/.test(m.content)));
  } finally {s.db.close();}
});

test('agent chat: the same request id with different text is rejected', async () => {
  const s = setup(); try {
    await send(s); await assert.rejects(send(s, 'request-1', '换个指令'), {code: 'CHAT_REQUEST_CONFLICT'});
    assert.equal(s.counts().modelCalls, 1);
  } finally {s.db.close();}
});

test('agent chat: concurrent requests cannot overwrite one another', async () => {
  const s = setup(); try {
    let release!: () => void; const gate = new Promise<void>(r => {release = r;});
    s.respond(async () => {await gate; return {text: '已读', calls: []};});
    const first = send(s);
    await assert.rejects(send(s, 'request-2'), {code: 'CHAT_BUSY'});
    assert.equal((await send(s)).status, 'running');
    release(); await first; assert.equal(s.counts().modelCalls, 1);
  } finally {s.db.close();}
});

test('agent chat: provider failure preserves the user message and releases the conversation', async () => {
  const s = setup(); try {
    s.replies.push(new Error('provider unavailable'));
    const c = await send(s); assert.equal(c.status, 'idle'); assert.equal(c.messages[0]!.content, '帮我检查草稿');
    assert.match(c.messages.at(-1)!.content, /未完成|失败/);
  } finally {s.db.close();}
});

test('agent chat: expired execution becomes uncertain and is never replayed', async () => {
  const s = setup(); try {
    s.replies.push({text: '', calls: [call('update_world_draft')]}); const c = await send(s);
    c.status = 'running'; c.leaseUntil = Date.now() - 1; c.actions[0]!.status = 'executing';
    s.repository.save(c, c.version);
    const recovered = new agent.AgentChatService(s.deps).get(c.id);
    assert.equal(recovered.status, 'idle'); assert.equal(recovered.actions[0]!.status, 'uncertain');
    await s.service.decide({id: c.id, actionId: c.actions[0]!.id, decision: 'confirm'});
    assert.equal(s.counts().writes, 0);
  } finally {s.db.close();}
});

test('agent chat: a tool loop stops at the per-turn model round limit', async () => {
  const s = setup(); try {
    s.respond(async () => ({text: '', calls: [call('get_world_draft', `loop-${s.counts().modelCalls}`)]}));
    const c = await send(s); assert.equal(c.status, 'idle'); assert.equal(s.counts().modelCalls, 4);
    assert.match(c.messages.at(-1)!.content, /上限/);
  } finally {s.db.close();}
});

test('agent chat: known credentials are redacted before history is stored or sent to the model', async () => {
  const s = setup(); try {
    const service = new agent.AgentChatService({...s.deps, redact: (text: string) => text.replaceAll('test-known-credential', '[REDACTED]')});
    await service.send({id: s.conversation.id, requestId: 'credential-1', text: '我的key是test-known-credential'});
    assert.equal(JSON.stringify(s.repository.get(s.conversation.id)).includes('test-known-credential'), false);
    assert.equal(JSON.stringify(s.received).includes('test-known-credential'), false);
    await service.send({id: s.conversation.id, requestId: 'credential-1', text: '我的key是test-known-credential'});
    assert.equal(s.counts().modelCalls, 1);
  } finally {s.db.close();}
});

test('agent chat: an ambiguous write failure is uncertain and cannot be executed again', async () => {
  const s = setup(); try {
    s.replies.push({text: '', calls: [call('update_world_draft')]}); const c = await send(s);
    const service = new agent.AgentChatService({...s.deps, tools: () => s.deps.tools().map(tool => tool.requiresConfirmation
      ? {...tool, execute: () => {tool.execute(); throw new Error('reply lost after write');}} : tool)});
    const result = await service.decide({id: c.id, actionId: c.actions[0]!.id, decision: 'confirm'});
    assert.equal(result.actions[0]!.status, 'uncertain');
    await service.decide({id: c.id, actionId: c.actions[0]!.id, decision: 'confirm'});
    assert.equal(s.counts().writes, 1);
  } finally {s.db.close();}
});

test('agent chat: a failed model summary does not misreport or repeat an already completed write', async () => {
  const s = setup(); try {
    s.replies.push({text: '', calls: [call('update_world_draft')]}, new Error('summary failed'));
    const c = await send(s);
    const result = await s.service.decide({id: c.id, actionId: c.actions[0]!.id, decision: 'confirm'});
    assert.equal(result.actions[0]!.status, 'succeeded'); assert.equal(s.counts().writes, 1);
    assert.match(result.messages.at(-1)!.content, /未完成/);
  } finally {s.db.close();}
});
