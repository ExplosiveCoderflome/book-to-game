import assert from 'node:assert/strict';
import { test } from 'node:test';
import { streamSimple } from '@mariozechner/pi-ai';
import type { AgentChatMessage } from '@novel-game/contracts';
import { AgentChatCompletionsModel, CHAT_CONTEXT_TARGET_BYTES, toPiMessage, workingMessages } from '../src/platform/model/agent-chat.js';
import { ChatTokenBudget, estimateChatTokens } from '../src/platform/model/agent-chat-budget.js';
import { emptyUsage } from '../src/platform/model/agent-chat.js';
import { AgentChatService, SqliteChatRepository, type ChatRunHooks, type ChatTool } from '../src/modules/agent/index.js';
import { openDatabase } from '../src/platform/database.js';

const now = '2026-11-10T00:00:00.000Z';
const initial: AgentChatMessage[] = [{id: 'intent', role: 'user', content: '保留原有剧情；继续只读 draft-cost。', createdAt: now}];
const config = {baseUrl: 'http://localhost/v1', model: 'offline-cost-test', apiKey: 'test-cost-secret-never-log', timeoutMs: 3000};
const hooks = (): ChatRunHooks => ({maxRounds: 24, startTurn() {}, assistant() {}, execute: async () => ({content: '{}', proposed: false}), toolResult() {}});
const tool: ChatTool = {name: 'read_world_draft', description: '只读草稿', parameters: {type: 'object', properties: {}}, requiresConfirmation: false, validate: () => ({}), prepare: () => ({summary: ''}), execute: () => ({})};
function response(call?: string, usage?: object) {
  const delta = call ? {role: 'assistant', tool_calls: [{index: 0, id: call, type: 'function', function: {name: tool.name, arguments: '{}'}}]} : {role: 'assistant', content: '检查完毕。'};
  return new Response([JSON.stringify({choices: [{index: 0, delta, finish_reason: null}]}), JSON.stringify({choices: [{index: 0, delta: {}, finish_reason: call ? 'tool_calls' : 'stop'}], ...(usage ? {usage} : {})}), '[DONE]', ''].map(s => s ? `data: ${s}` : '').join('\n\n'), {headers: {'Content-Type': 'text/event-stream'}});
}
function history(count: number) {
  const items = [...initial];
  for (let i = 0; i < (count - 2) / 2; i++) items.push(
    {id: `a${i}`, role: 'assistant', content: '', toolCalls: [{id: `c${i}`, name: tool.name, arguments: {id: 'draft-cost', path: 'storylets'}}], createdAt: now},
    {id: `t${i}`, role: 'tool', toolCallId: `c${i}`, toolName: tool.name, content: JSON.stringify({id: 'draft-cost', version: 13, marker: `receipt-${i}`, body: '故事正文'.repeat(48)}), createdAt: now});
  items.push({id: 'confirmation', role: 'user', content: '确认执行：已执行卡，仅继续检查。', createdAt: now});
  assert.equal(items.length, count); return items;
}

test('cost: actual SDK context is bounded at 200/620/2000 messages even within ONE intent; recent pairs and recovery survive', async t => {
  const bodies: any[] = []; const sizes: number[] = [];
  const mock = t.mock.method(globalThis, 'fetch', async (url: unknown, init?: RequestInit) => {
    assert.equal(String(url), 'http://localhost/v1/chat/completions', 'offline only');
    sizes.push(Buffer.byteLength(String(init?.body))); bodies.push(JSON.parse(String(init?.body))); return response();
  });
  for (const count of [200, 620, 2000]) {
    const messages = history(count); const before = JSON.stringify(messages);
    await new AgentChatCompletionsModel(config).run(messages, [tool], AbortSignal.timeout(10000), {...hooks(), recovery: () => ({id: 'chat-cost', actions: [{id: 'uncertain-cost', callId: 'old-call', toolName: 'edit_world_summary', arguments: {id: 'draft-cost', version: 13}, summary: '必须先查询，不可重试', status: 'uncertain', createdAt: now, updatedAt: now}]})});
    const body = bodies.at(-1); const text = JSON.stringify(body.messages);
    assert.equal(JSON.stringify(messages), before, 'durable history is never compacted');
    assert.ok(sizes.at(-1)! <= CHAT_CONTEXT_TARGET_BYTES);
    assert.ok(body.messages.some((m: any) => m.role === 'user' && m.content === initial[0]!.content));
    assert.match(text, /确认执行：已执行卡/); assert.match(text, /uncertain-cost/); assert.match(text, /draft-cost/); assert.match(text, /currentDraftReference/); assert.match(text, /版本为历史观察/);
    assert.equal(body.messages.some((m: any) => m.tool_call_id === 'c0'), false);
    const last = (count - 2) / 2 - 1;
    assert.deepEqual(body.messages.filter((m: any) => m.role === 'tool').map((m: any) => m.tool_call_id), Array.from({length: 4}, (_, i) => `c${last - 3 + i}`));
    for (const receipt of body.messages.filter((m: any) => m.role === 'tool')) assert.ok(body.messages.some((m: any) => m.tool_calls?.some((call: any) => call.id === receipt.tool_call_id)));
    assert.equal(body.max_tokens, 8192);
  }
  assert.ok(Math.max(...sizes) - Math.min(...sizes) < 128, 'payload does not grow with transcript length');
  t.diagnostic(JSON.stringify({messages: [200, 620, 2000], requestBytes: sizes, targetBytes: CHAT_CONTEXT_TARGET_BYTES})); mock.mock.restore();
});

test('cost: recent-turn tuning retains whole multi-call batches; confirmation is not a new intent', () => {
  const messages = history(200);
  const selected = workingMessages(messages.map(toPiMessage), {recentTurns: 2});
  assert.deepEqual(selected.filter(m => m.role === 'toolResult').map(m => m.toolCallId), ['c97', 'c98']);
  assert.ok(selected.some(m => m.content === initial[0]!.content));
  const paired: AgentChatMessage[] = [...initial, {id: 'batch', role: 'assistant', content: '', toolCalls: [{id: 'one', name: tool.name, arguments: {}}, {id: 'two', name: tool.name, arguments: {}}], createdAt: now}, ...['one', 'two'].map(id => ({id, role: 'tool' as const, toolCallId: id, toolName: tool.name, content: '{}', createdAt: now}))];
  assert.equal(workingMessages(paired.map(toPiMessage), {recentTurns: 1}).filter(m => m.role === 'toolResult').length, 2);
});

test('cost: insufficient initial token budget stops BEFORE any request or tool execution', async t => {
  let requests = 0; let executed = 0;
  t.mock.method(globalThis, 'fetch', async () => {requests++; return response();});
  await assert.rejects(new AgentChatCompletionsModel({...config, chatRunTokenBudget: 1000}).run(initial, [tool], AbortSignal.timeout(10000), {...hooks(), execute: async () => {executed++; return {content: '{}', proposed: false};}}), {code: 'CHAT_RUN_TOKEN_BUDGET'});
  assert.equal(requests, 0); assert.equal(executed, 0);
});

test('cost: returned usage is accumulated across rounds and prevents the NEXT request; receipts stay intact', async t => {
  let requests = 0; let executed = 0; const receipts: string[] = [];
  t.mock.method(globalThis, 'fetch', async () => {requests++; return response('usage-call', {prompt_tokens: 19000, completion_tokens: 10, total_tokens: 19010});});
  const model = new AgentChatCompletionsModel({...config, chatRunTokenBudget: 20000, chatMaxOutputTokens: 256});
  await assert.rejects(model.run(initial, [tool], AbortSignal.timeout(10000), {...hooks(), execute: async () => {executed++; return {content: '{"id":"draft-cost","version":13}', proposed: false};}, toolResult: (_call, content) => receipts.push(content)}), {code: 'CHAT_RUN_TOKEN_BUDGET'});
  assert.equal(requests, 1); assert.equal(executed, 1); assert.deepEqual(receipts, ['{"id":"draft-cost","version":13}']);
  // A new user run gets a fresh budget, not historic cumulative usage.
  requests = 0; t.mock.method(globalThis, 'fetch', async () => {requests++; return response(undefined, {prompt_tokens: 12, completion_tokens: 2, total_tokens: 14});});
  await model.run(initial, [], AbortSignal.timeout(10000), hooks()); assert.equal(requests, 1);
});

test('cost: absent usage still charges estimates; logs contain numeric metrics, never credentials or content', async t => {
  let requests = 0; let executed = 0; const logs: string[] = [];
  t.mock.method(console, 'info', (line: string) => {logs.push(line);});
  t.mock.method(globalThis, 'fetch', async () => response(`fallback-${++requests}`));
  await assert.rejects(new AgentChatCompletionsModel({...config, chatRunTokenBudget: 10000, chatMaxOutputTokens: 256}).run(initial, [tool], AbortSignal.timeout(10000), {...hooks(), execute: async () => {executed++; return {content: '{"id":"draft-cost","version":13}', proposed: false};}}), {code: 'CHAT_RUN_TOKEN_BUDGET'});
  assert.ok(requests >= 2 && requests <= 5); assert.equal(executed, requests);
  assert.doesNotMatch(logs.join(''), /test-cost-secret|draft-cost|保留原有剧情/);
  const usages = logs.map(s => JSON.parse(s)).filter(r => r.event === 'agent.chat.request_usage');
  assert.equal(usages.length, requests); assert.ok(usages.every(r => r.source === 'estimate' && r.tokens > 0 && r.requestBytes > 0));
  assert.ok(usages.at(-1).runTokens > usages[0].runTokens);
});

test('cost: unexpected usage overshoot fails closed BEFORE final calls persist or tools run', async t => {
  let executed = 0; let finalized = 0;
  t.mock.method(globalThis, 'fetch', async () => response('overshoot', {prompt_tokens: 50000, completion_tokens: 10, total_tokens: 50010}));
  await assert.rejects(new AgentChatCompletionsModel({...config, chatRunTokenBudget: 20000, chatMaxOutputTokens: 256}).run(initial, [tool], AbortSignal.timeout(10000), {...hooks(), assistant: (_reply, final) => {if (final) finalized++;}, execute: async () => {executed++; return {content: '{}', proposed: false};}}), {code: 'CHAT_RUN_TOKEN_BUDGET'});
  assert.equal(executed, 0); assert.equal(finalized, 0);
});

test('cost: actual SDK onPayload rechecks tokens and preserves AppError, not generic model error', async t => {
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => {requests++; return response();});
  const model = new AgentChatCompletionsModel({...config, chatRunTokenBudget: 20000, chatMaxOutputTokens: 256}, (model, context, options) => streamSimple(model, context, {...options, onPayload: (payload, m) => options?.onPayload?.({...payload as object, padding: 'x'.repeat(60000)}, m)}));
  await assert.rejects(model.run(initial, [], AbortSignal.timeout(10000), hooks()), {code: 'CHAT_RUN_TOKEN_BUDGET'});
  assert.equal(requests, 0);
});

test('cost: byte estimator and usage totals include cached input without assuming free caching', () => {
  assert.equal(estimateChatTokens(101), 51);
  const budget = new ChatTokenBudget(10000); budget.check(100, 256);
  const usage = {...emptyUsage(), input: 20, output: 5, cacheRead: 100, cacheWrite: 25, totalTokens: 150};
  const counted = budget.settle({role: 'assistant', content: [], api: 'openai-completions', provider: 'openai', model: 'test', usage, stopReason: 'stop', timestamp: 0});
  assert.equal(counted.tokens, 150); assert.equal(counted.source, 'usage');
});

test('cost: service stops idle with explicit budget notice and durable paired receipts, never corrupts actions', async t => {
  let requests = 0; let reads = 0;
  t.mock.method(globalThis, 'fetch', async () => {requests++; return response('service-read', {prompt_tokens: 19000, completion_tokens: 10, total_tokens: 19010});});
  const db = openDatabase(':memory:');
  try {
    const repository = new SqliteChatRepository(db);
    const model = new AgentChatCompletionsModel({...config, chatRunTokenBudget: 20000, chatMaxOutputTokens: 256});
    const deps = {repository, model: () => model, tools: () => [{...tool, execute: () => {reads++; return {id: 'draft-cost', version: 13};}}]};
    const service = new AgentChatService(deps); const chat = service.create();
    const done = await service.send({id: chat.id, requestId: 'budget-stop-request', text: initial[0]!.content});
    assert.equal(requests, 1); assert.equal(reads, 1); assert.equal(done.status, 'idle'); assert.equal(done.leaseUntil, 0);
    assert.equal(done.actions.length, 0);
    const receipts = done.messages.filter(m => m.role === 'tool'); assert.equal(receipts.length, 1);
    assert.equal(receipts[0]!.toolCallId, 'service-read'); assert.match(receipts[0]!.content, /draft-cost/);
    const final = done.messages.at(-1)!.content; assert.match(final, /CHAT_RUN_TOKEN_BUDGET/); assert.match(final, /不会自动重试/);
    assert.deepEqual(new AgentChatService(deps).get(done.id).messages, done.messages);
  } finally {db.close();}
});
