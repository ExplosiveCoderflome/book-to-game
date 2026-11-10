import assert from 'node:assert/strict';
import { test } from 'node:test';
import { z } from 'zod';
import { worldContentSchema, type AgentChatMessage } from '@novel-game/contracts';
import { createWorkbench } from '../src/app/workbench.js';
import { createCommands } from '../src/app/commands/index.js';
import { createAgentChatTools } from '../src/app/agent-chat-tools.js';
import { openDatabase } from '../src/platform/database.js';
import { createModelSettings } from '../src/platform/create-model-settings.js';
import { AgentChatCompletionsModel, CHAT_REQUEST_BYTES, toPiMessage, workingMessages } from '../src/platform/model/agent-chat.js';

test('context lifecycle: new intent retires old full schema; current reread and discovery remain exact in actual SDK payload', async t => {
  const schema = JSON.stringify(z.toJSONSchema(worldContentSchema));
  assert.equal(schema.length, 206773);
  const now = '2026-11-10T00:00:00.000Z';
  const history: AgentChatMessage[] = [
    {id: 'old-intent', role: 'user', content: '读取世界结构', createdAt: now},
    {id: 'old-call', role: 'assistant', content: '', toolCalls: [{id: 'old-schema', name: 'get_world_schema', arguments: {}}], createdAt: now},
    {id: 'old-receipt', role: 'tool', toolCallId: 'old-schema', toolName: 'get_world_schema', content: schema, createdAt: now},
    {id: 'old-answer', role: 'assistant', content: '结构已读，等待下一项意图。', createdAt: now},
    {id: 'new-intent', role: 'user', content: '新意图：重新读取结构，再列出原作。', createdAt: now},
  ];
  const original = JSON.stringify(history);
  const selected = workingMessages(history.map(toPiMessage));
  assert.equal(selected.some(m => m.role === 'toolResult' && m.toolCallId === 'old-schema'), false, 'old giant schema must not be mandatory forever');
  assert.equal(selected.some(m => m.role === 'assistant' && m.content.some(p => p.type === 'toolCall' && p.id === 'old-schema')), false, 'omit only whole packets');
  const confirming = [...history.slice(0, -1), {id: 'confirmation', role: 'user' as const, content: '确认执行：上一张卡', createdAt: now}];
  assert.ok(workingMessages(confirming.map(toPiMessage)).some(m => m.role === 'toolResult' && m.toolCallId === 'old-schema'), 'confirmation is not a new intent boundary');
  const db = openDatabase(':memory:');
  const settings = createModelSettings(db, '/tmp/opencode', {baseUrl: 'http://localhost/v1', model: 'context-test', apiKey: '', timeoutMs: 3000});
  const w = createWorkbench(db, settings, undefined, {dataDir: '/tmp/opencode'});
  const tools = createAgentChatTools(createCommands(w), w);
  type Payload = {tools: Array<{function: {name: string; parameters: unknown}}>; messages: Array<{role: string; content?: string; tool_call_id?: string; tool_calls?: Array<{id: string}>}>};
  const bodies: Payload[] = [];
  const fetchMock = t.mock.method(globalThis, 'fetch', async (_input: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Payload; bodies.push(body);
    const name = bodies.length === 1 ? 'discover_agent_tools' : bodies.length === 2 ? 'select_agent_tools' : bodies.length === 3 ? 'get_world_schema' : 'list_sources';
    const delta = bodies.length <= 4 ? {role: 'assistant', tool_calls: [{index: 0, id: bodies.length <= 2 ? `focus-${bodies.length}` : `current-${bodies.length - 2}`, type: 'function', function: {name, arguments: bodies.length === 2 ? JSON.stringify({names: ['get_world_schema', 'list_sources']}) : '{}'}}]} : {role: 'assistant', content: '已读取完整结构与目录。'};
    const frames = [{id: 'context-test', choices: [{index: 0, delta, finish_reason: null}]}, {id: 'context-test', choices: [{index: 0, delta: {}, finish_reason: bodies.length <= 4 ? 'tool_calls' : 'stop'}]}];
    const separator = String.fromCharCode(10, 10);
    return new Response([...frames.map(frame => `data: ${JSON.stringify(frame)}`), 'data: [DONE]', ''].join(separator), {headers: {'Content-Type': 'text/event-stream'}});
  });
  try {
    const receipts: string[] = [];
    const model = new AgentChatCompletionsModel({baseUrl: 'http://localhost/v1', model: 'context-test', apiKey: '', timeoutMs: 3000});
    await model.run(history, tools, AbortSignal.timeout(10000), {maxRounds: 8, startTurn() {}, assistant() {},
      execute: async call => ({content: call.name === 'get_world_schema' ? schema : '[]', proposed: false}),
      toolResult: (_call, content) => receipts.push(content)});
    assert.equal(bodies.length, 5); assert.equal(receipts[2], schema);
    const inventory = JSON.parse(receipts[0]!);
    assert.equal(inventory.complete, true); assert.deepEqual(inventory.inventory.map((t: any) => t.name), tools.map(t => t.name));
    for (const [index, body] of bodies.entries()) {
      assert.equal(body.tools.length, index < 2 ? 2 : 4);
      if (index >= 2) for (const tool of tools.filter(t => ['get_world_schema', 'list_sources'].includes(t.name)))
        assert.deepEqual(body.tools.find(t => t.function.name === tool.name)!.function.parameters, tool.parameters);
      assert.equal(body.messages.some(m => m.tool_call_id === 'old-schema'), false);
      assert.ok(body.messages.some(m => m.content === history.at(-1)!.content));
      if (index > 2) {
        assert.equal(body.messages.find(m => m.tool_call_id === 'current-1')?.content, schema);
        assert.ok(body.messages.some(m => m.tool_calls?.some(c => c.id === 'current-1')));
      }
      if (index === 4) {
        assert.equal(body.messages.find(m => m.tool_call_id === 'current-2')?.content, '[]');
        assert.ok(body.messages.some(m => m.tool_calls?.some(c => c.id === 'current-2')));
      }
      const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
      const {tools: definitions, messages: packets, ...envelope} = body;
      assert.ok(bytes(body) <= CHAT_REQUEST_BYTES);
      t.diagnostic(JSON.stringify({request: index + 1, requestBytes: bytes(body), toolsBytes: bytes(definitions), systemBytes: bytes(packets.filter(m => m.role === 'system')), workingMessagesBytes: bytes(packets.filter(m => m.role !== 'system')), envelopeBytes: bytes(envelope), schemaChars: schema.length, schemaReceiptJsonBytes: bytes(schema), parameterSchemaBytes: definitions.reduce((n, d) => n + bytes(d.function.parameters), 0), largestTools: definitions.map(d => ({name: d.function.name, bytes: bytes(d)})).sort((a, b) => b.bytes - a.bytes).slice(0, 3)}));
    }
    assert.equal(JSON.stringify(history), original, 'durable input is untouched');
  } finally {fetchMock.mock.restore(); db.close();}
});
