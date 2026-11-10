import assert from 'node:assert/strict';
import { test } from 'node:test';
import { z } from 'zod';
import * as agent from '../src/modules/agent/index.js';
import { openDatabase } from '../src/platform/database.js';
import { scriptedChat } from './helpers/agent-pi.js';
import { AppError } from '../src/shared/errors.js';

function setup() {
  assert.equal(typeof agent.AgentChatService, 'function', 'Agent must expose a conversational service, not only supervisor reports');
  const db = openDatabase(':memory:');
  const repository = new agent.SqliteChatRepository(db);
  let writes = 0, reads = 0, state = 'v1', modelCalls = 0;
  const received: any[] = [];
  const replies: any[] = [];
  let responder: ((messages: any[]) => Promise<any>) | undefined;
  const model = scriptedChat(async (messages: any[]) => {
    modelCalls++; received.push(structuredClone(messages));
    if (responder) return responder(messages);
    const reply = replies.shift(); if (reply instanceof Error) throw reply;
    return reply ?? {text: '已完成，根据工具回执回复。', calls: []};
  });
  const tool = (name: string, requiresConfirmation: boolean) => ({name, description: name, parameters: {type: 'object'}, requiresConfirmation,
    validate: (input: unknown) => z.object({id: z.string()}).parse(input),
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

test('agent chat: a confirmation stops the next turn and pairs every call in its batch', async () => {
  const s = setup(); try {
    s.replies.push({text: '先读取，再建议修改。', calls: [call('get_world_draft', 'read-first'), call('update_world_draft', 'write-first'),
      call('get_world_draft', 'read-after'), call('update_world_draft', 'write-after'), call('get_world_draft', 'read-last')]});
    const pending = await send(s);
    assert.deepEqual(s.counts(), {writes: 0, reads: 1, modelCalls: 1});
    assert.equal(pending.actions.length, 1);
    assert.equal(pending.actions[0]!.callId, 'write-first');
    const results = pending.messages.filter(message => message.role === 'tool');
    assert.deepEqual(results.map(message => message.toolCallId), ['read-first', 'write-first', 'read-after', 'write-after', 'read-last']);
    assert.match(results[2]!.content, /not_executed/);
    const restarted = new agent.AgentChatService(s.deps);
    const done = await restarted.decide({id: pending.id, actionId: pending.actions[0]!.id, decision: 'confirm'});
    assert.equal(done.actions[0]!.status, 'succeeded'); assert.equal(s.counts().writes, 1);
  } finally {s.db.close();}
});

test('agent chat: skill and catalog sized batches execute beyond four calls', async () => {
  const s = setup(); try {
    s.replies.push({text: '', calls: Array.from({length: 5}, (_, i) => call('get_world_draft', `excess-${i}`))});
    const result = await send(s);
    assert.equal(s.counts().reads, 5); assert.equal(result.messages.filter(m => m.role === 'tool').length, 5);
  } finally {s.db.close();}
});

test('agent chat: tool receipts are redacted before Pi sends the next model request', async () => {
  const s = setup(); try {
    const service = new agent.AgentChatService({...s.deps,
      redact: text => text.replaceAll('test-tool-credential', '[REDACTED]'),
      tools: () => s.deps.tools().map(tool => ({...tool, execute: () => ({value: 'test-tool-credential'})})),
    });
    s.replies.push({text: '', calls: [call('get_world_draft')]}, {text: '已读取', calls: []});
    const result = await service.send({id: s.conversation.id, requestId: '', text: '读取'});
    assert.ok(result.messages[0]!.requestId);
    assert.equal(JSON.stringify(s.received).includes('test-tool-credential'), false);
    assert.equal(JSON.stringify(result).includes('test-tool-credential'), false);
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

test('agent chat: invalid schema arguments return safe field guidance and flag identical retries', async () => {
  const s = setup(); try {
    s.respond(async () => ({text: '', calls: [{id: `bad-${s.counts().modelCalls}`, name: 'update_world_draft', arguments: {}}]}));
    const c = await send(s);
    const toolResults = c.messages.filter(m => m.role === 'tool');
    assert.ok(toolResults[0]!.content.includes('CHAT_INVALID_ARGS'));
    assert.ok(toolResults[0]!.content.includes('id'));
    assert.ok(toolResults[1]!.content.includes('参数与上次相同已失败'));
    assert.equal(s.counts().modelCalls, 24);
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
    const c = await send(s); assert.equal(c.status, 'idle'); assert.equal(s.counts().modelCalls, 24);
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

test('agent chat: discovery beyond eight rounds reaches confirmation and resumes the next guarded proposal', async () => {
  const s = setup(); try {
    s.respond(async () => s.counts().modelCalls <= 11
      ? {text: '', calls: [call('get_world_draft', `discovery-${s.counts().modelCalls}`)]}
      : {text: '', calls: [call('update_world_draft', `proposal-${s.counts().modelCalls}`)]});
    const pending = await send(s);
    assert.equal(s.counts().reads, 11); assert.equal(s.counts().writes, 0);
    assert.equal(pending.actions[0]!.status, 'pending');
    s.replies.push({text: '', calls: [call('get_world_draft', 'quality-check')]},
      {text: '', calls: [call('update_world_draft', 'publish-proposal')]});
    s.respond(async () => s.replies.shift() ?? {text: '回执已保存', calls: []});
    const next = await s.service.decide({id: pending.id, actionId: pending.actions[0]!.id, decision: 'confirm'});
    assert.equal(s.counts().writes, 1); assert.equal(s.counts().reads, 12);
    assert.deepEqual(next.actions.map(a => a.status), ['succeeded', 'pending']);
    await s.service.decide({id: next.id, actionId: next.actions[1]!.id, decision: 'confirm'});
    await s.service.decide({id: next.id, actionId: next.actions[1]!.id, decision: 'confirm'});
    assert.equal(s.counts().writes, 2);
  } finally {s.db.close();}
});

test('agent chat: interrupted confirmation receipt is recovered without replaying the write', async () => {
  const s = setup(); try {
    const model = s.deps.model(); let interrupted = false;
    const service = new agent.AgentChatService({...s.deps, model: () => ({
      run: (messages, tools, signal, hooks) => model.run(messages, tools, signal, {...hooks, toolResult: (call, content) => {
        if (!interrupted) {interrupted = true; throw new Error('receipt interrupted');}
        hooks.toolResult(call, content);
      }}),
    })});
    s.replies.push({text: '', calls: [call('update_world_draft', 'recover-write'), call('get_world_draft', 'recover-read')]});
    const pending = await service.send({id: s.conversation.id, requestId: 'interrupted', text: '修改草稿'});
    assert.equal(pending.status, 'idle'); assert.equal(pending.actions[0]!.status, 'pending');
    const receipts = pending.messages.filter(m => m.role === 'tool');
    assert.deepEqual(receipts.map(m => m.toolCallId), ['recover-write', 'recover-read']);
    assert.match(receipts[0]!.content, /awaiting_author_confirmation/);
    assert.match(receipts[1]!.content, /CHAT_INTERRUPTED/);
    const restarted = new agent.AgentChatService(s.deps);
    const done = await restarted.decide({id: pending.id, actionId: pending.actions[0]!.id, decision: 'confirm'});
    assert.equal(done.actions[0]!.status, 'succeeded');
    assert.ok(s.received.at(-1).some((m: any) => m.role === 'tool' && m.toolCallId === 'recover-write' && m.content.includes('真实标题')));
    await restarted.decide({id: done.id, actionId: done.actions[0]!.id, decision: 'confirm'});
    assert.equal(s.counts().writes, 1);
  } finally {s.db.close();}
});

test('agent chat: budget exhaustion saves every receipt and a fresh message can continue', async () => {
  const s = setup(); try {
    s.respond(async () => ({text: '', calls: Array.from({length: 20}, (_, i) => call('get_world_draft', `budget-${s.counts().modelCalls}-${i}`))}));
    const limited = await send(s);
    assert.equal(s.counts().reads, 128); assert.equal(limited.status, 'idle');
    assert.equal(limited.messages.filter(m => m.role === 'tool').length, 140);
    assert.match(limited.messages.at(-1)!.content, /上限/);
    s.respond(async () => ({text: '', calls: [call('update_world_draft', 'continue-write')]}));
    const continued = await send(s, 'continue-request', '继续创建');
    assert.equal(continued.actions[0]!.status, 'pending'); assert.equal(s.counts().writes, 0);
  } finally {s.db.close();}
});

test('agent chat: long Pi runs keep their lease and do not inherit a shorter whole-run deadline', async t => {
  const s = setup();
  t.mock.timers.enable({apis: ['Date', 'setTimeout', 'setInterval'], now: Date.now()});
  // Node mock timers do not control AbortSignal.timeout's internal timer.
  t.mock.method(AbortSignal, 'timeout', (ms: number) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), ms);
    return controller.signal;
  });
  let release!: () => void;
  const gate = new Promise<void>(resolve => {release = resolve;});
  let activeSignal!: AbortSignal;
  const service = new agent.AgentChatService({...s.deps, model: () => ({
    async run(_messages, _tools, signal, hooks) {
      activeSignal = signal; hooks.startTurn();
      await gate;
      hooks.assistant({text: '完整回复', calls: []}, true);
      return {limited: false};
    },
  })});
  try {
    const running = service.send({id: s.conversation.id, requestId: 'long-run', text: '继续生成'});
    t.mock.timers.tick(330_001);
    const prematurelyAborted = activeSignal.aborted;
    t.mock.timers.tick(300_000);
    const observed = service.get(s.conversation.id);
    release();
    const done = await running;
    assert.equal(prematurelyAborted, false, 'service must not truncate Pi before its streaming deadline');
    assert.equal(observed.status, 'running', 'an active model request must not be recovered as interrupted');
    assert.equal(done.status, 'idle');
    assert.match(done.messages.at(-1)!.content, /完整回复/);
    assert.equal(done.messages.some(m => /上一轮已中断/.test(m.content)), false);
    const version = done.version;
    t.mock.timers.tick(600_001);
    assert.equal(service.get(done.id).version, version, 'completed runs must stop renewing');
  } finally {release(); t.mock.timers.reset(); s.db.close();}
});

test('agent chat: lease ownership loss aborts Pi without overwriting the newer conversation', async t => {
  const s = setup();
  t.mock.timers.enable({apis: ['Date', 'setInterval'], now: Date.now()});
  let activeSignal!: AbortSignal;
  const service = new agent.AgentChatService({...s.deps, model: () => ({
    async run(_messages, _tools, signal, hooks) {
      activeSignal = signal; hooks.startTurn();
      await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), {once: true}));
      // Even a late callback from an aborted stream cannot use the stale owner.
      assert.throws(() => hooks.startTurn(), {code: 'CHAT_BUSY'});
      assert.throws(() => hooks.assistant({text: 'late reply', calls: []}, true), {code: 'CHAT_BUSY'});
      await assert.rejects(hooks.execute(call('get_world_draft', 'late-read')), {code: 'CHAT_BUSY'});
      assert.throws(() => hooks.toolResult(call('get_world_draft', 'late-read'), '{}'), {code: 'CHAT_BUSY'});
      return {limited: false};
    },
  })});
  try {
    const running = service.send({id: s.conversation.id, requestId: 'lease-loss', text: '检查草稿'});
    const newer = s.repository.get(s.conversation.id)!;
    newer.status = 'idle'; newer.leaseUntil = 0;
    const saved = s.repository.save(newer, newer.version);
    t.mock.timers.tick(200_001);
    await assert.rejects(running, {code: 'CHAT_BUSY'});
    assert.equal(activeSignal.aborted, true);
    assert.equal(s.counts().reads, 0);
    assert.deepEqual(s.repository.get(saved.id), saved);
    t.mock.timers.tick(600_001);
    assert.deepEqual(s.repository.get(saved.id), saved);
  } finally {t.mock.timers.reset(); s.db.close();}
});

test('agent chat: rule feedback is allowlisted and redacted, arbitrary error details remain private', async () => {
  const s = setup();
  let reads = 0;
  const service = new agent.AgentChatService({...s.deps,
    redact: text => text.replaceAll('test-validation-secret', '[REDACTED]'),
    tools: () => s.deps.tools().map(tool => ({...tool, execute: () => {
      if (++reads === 1) throw new AppError('INVALID_WORLD', 'private-message', 422, {
        valid: false, errors: ['missing location test-validation-secret'], warnings: ['check route'], privateField: 'private-detail',
      });
      throw new AppError('PROVIDER_FAILURE', 'private-message', 502, {errors: ['private-detail']});
    }})),
  });
  try {
    s.replies.push({text: '', calls: [call('get_world_draft', 'rule-error'), call('get_world_draft', 'provider-error')]},
      {text: '已收到校验反例', calls: []});
    const result = await service.send({id: s.conversation.id, requestId: 'safe-validation', text: '检查'});
    const receipts = result.messages.filter(m => m.role === 'tool').map(m => JSON.parse(m.content));
    assert.deepEqual(receipts[0].validation, {valid: false, errors: ['missing location [REDACTED]'], warnings: ['check route']});
    assert.equal(receipts[0].privateField, undefined); assert.equal(receipts[1].validation, undefined);
    assert.equal(/private-message|private-detail|test-validation-secret/.test(JSON.stringify(s.received)), false);
    assert.equal(/private-message|private-detail|test-validation-secret/.test(JSON.stringify(result)), false);
  } finally {s.db.close();}
});

test('agent chat: preservation-required returns static recoverable reshape hint without leaking details', async () => {
  const s = setup();
  const service = new agent.AgentChatService({...s.deps,
    redact: text => text.replaceAll('test-preservation-secret', '[REDACTED]'),
    tools: () => s.deps.tools().map(tool => ({...tool, execute: () => {
      throw new AppError('WORLD_PRESERVATION_REQUIRED', '检测到会损失既有玩法或正文的编辑，已原子拒绝。', 409,
        {baselineVersion: 13, baselineHash: '0'.repeat(64), removed: ['actions:dispatch', 'test-preservation-secret'],
          removedGameplay: ['actions:dispatch'], removedAnchors: ['actions:dispatch:text'], reduced: [], repetitive: []});
    }})),
  });
  try {
    s.replies.push({text: '', calls: [call('get_world_draft', 'preservation-error')]});
    const result = await service.send({id: s.conversation.id, requestId: 'safe-preservation', text: '组合写入'});
    const receipt = JSON.parse(result.messages.find(m => m.role === 'tool')!.content);
    assert.equal(receipt.error, 'WORLD_PRESERVATION_REQUIRED');
    assert.equal(typeof receipt.recovery, 'string');
    assert.match(receipt.recovery, /propose_world_reshape/);
    assert.match(receipt.recovery, /confirm_world_reshape/);
    assert.match(receipt.recovery, /diffHash/);
    assert.equal(receipt.baselineVersion, undefined);
    assert.equal(receipt.removed, undefined);
    assert.equal(/test-preservation-secret/.test(JSON.stringify(result)), false);
  } finally {s.db.close();}
});

test('agent chat: unknown error codes keep the generic redacted path', async () => {
  const s = setup();
  const service = new agent.AgentChatService({...s.deps,
    redact: text => text.replaceAll('test-unknown-secret', '[REDACTED]'),
    tools: () => s.deps.tools().map(tool => ({...tool, execute: () => {
      throw new AppError('UNKNOWN_GUARD', 'private-message test-unknown-secret', 409, {detail: 'private-detail'});
    }})),
  });
  try {
    s.replies.push({text: '', calls: [call('get_world_draft', 'unknown-error')]});
    const result = await service.send({id: s.conversation.id, requestId: 'safe-unknown', text: '检查'});
    const receipt = JSON.parse(result.messages.find(m => m.role === 'tool')!.content);
    assert.equal(receipt.error, 'UNKNOWN_GUARD');
    assert.equal(receipt.recovery, undefined);
    assert.equal(receipt.detail, undefined);
    assert.equal(/private-message|private-detail|test-unknown-secret/.test(JSON.stringify(result)), false);
  } finally {s.db.close();}
});

test('agent chat: confirmation summary ownership loss preserves the saved write and newer state', async t => {
  const s = setup();
  try {
    s.replies.push({text: '', calls: [call('update_world_draft')]});
    const pending = await send(s);
    t.mock.timers.enable({apis: ['Date', 'setInterval'], now: Date.now()});
    const service = new agent.AgentChatService({...s.deps, model: () => ({
      async run(_messages, _tools, signal, hooks) {
        hooks.startTurn();
        await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), {once: true}));
        return {limited: false};
      },
    })});
    const running = service.decide({id: pending.id, actionId: pending.actions[0]!.id, decision: 'confirm'});
    // Let the already-confirmed tool finish and the Pi summary acquire its lease.
    await new Promise<void>(resolve => setImmediate(resolve));
    const newer = s.repository.get(pending.id)!;
    assert.equal(newer.actions[0]!.status, 'succeeded');
    newer.status = 'idle'; newer.leaseUntil = 0;
    const saved = s.repository.save(newer, newer.version);
    t.mock.timers.tick(200_001);
    await assert.rejects(running, {code: 'CHAT_BUSY'});
    assert.deepEqual(s.repository.get(saved.id), saved);
    assert.equal(s.counts().writes, 1);
    await service.decide({id: saved.id, actionId: saved.actions[0]!.id, decision: 'confirm'});
    assert.equal(s.counts().writes, 1);
  } finally {t.mock.timers.reset(); s.db.close();}
});

test('agent chat: sustained small author-confirmed batches preserve full evidence beyond the former lifetime limit', async () => {
  const s = setup();
  try {
    const ids: string[] = [];
    for (let i = 0; i < 64; i++) {
      s.replies.push({text: '', calls: [call('update_world_draft', `sustained-${i}`)]});
      const pending = await send(s, `sustained-request-${i}`, `继续第${i}步`);
      const action = pending.actions.at(-1)!; ids.push(action.id);
      assert.equal(action.status, 'pending');
      const done = await s.service.decide({id: pending.id, actionId: action.id, decision: 'confirm'});
      assert.equal(done.actions.at(-1)!.status, 'succeeded');
    }
    const recovered = new agent.AgentChatService(s.deps).get(s.conversation.id);
    assert.ok(recovered.messages.length > 240); assert.equal(recovered.actions.length, 64);
    assert.ok(recovered.actions.every(action => action.guard === 'v1' && action.result?.includes('draft-1')));
    const before = s.counts();
    for (const actionId of ids) await s.service.decide({id: recovered.id, actionId, decision: 'confirm'});
    await send(s, 'sustained-request-0', '继续第0步');
    assert.deepEqual(s.counts(), before);
    assert.deepEqual(s.service.get(recovered.id), recovered);
    assert.throws(() => s.repository.save({...recovered, title: 'stale'}, recovered.version - 1), {code: 'CHAT_BUSY'});
    assert.deepEqual(s.service.get(recovered.id), recovered);
  } finally {s.db.close();}
});
