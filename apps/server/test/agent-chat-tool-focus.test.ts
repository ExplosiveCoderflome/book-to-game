import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AgentToolFocus, FOCUS_CATALOG, FOCUS_SELECT } from '../src/platform/model/agent-tool-focus.js';
import { AgentChatCompletionsModel } from '../src/platform/model/agent-chat.js';
import { createWorkbench } from '../src/app/workbench.js';
import { createCommands } from '../src/app/commands/index.js';
import { createAgentChatTools } from '../src/app/agent-chat-tools.js';
import { openDatabase } from '../src/platform/database.js';
import { createModelSettings } from '../src/platform/create-model-settings.js';

test('tool focus: complete real 78 inventory, every exact schema selectable, atomic invalid selection and bounded metadata', () => {
  const db = openDatabase(':memory:');
  try {
    const w = createWorkbench(db, createModelSettings(db, '/tmp/opencode', {baseUrl: 'http://localhost/v1', model: 'focus-test', apiKey: '', timeoutMs: 3000}), undefined, {dataDir: '/tmp/opencode'});
    const tools = createAgentChatTools(createCommands(w), w);
    const definitions = tools.map(t => ({name: t.name, description: t.description + (t.requiresConfirmation ? '【必须由作者确认后才执行】' : ''), parameters: t.parameters as any}));
    const focus = new AgentToolFocus(tools, definitions);
    assert.equal(tools.length, 78); assert.equal(tools.filter(t => !t.requiresConfirmation).length, 41); assert.equal(tools.filter(t => t.requiresConfirmation).length, 37);
    assert.equal(focus.enabled, true); assert.equal(focus.next().length, 2);
    const inventory = JSON.parse(focus.invoke(FOCUS_CATALOG, {}));
    assert.equal(inventory.complete, true); assert.equal(inventory.total, 78);
    assert.deepEqual(inventory.inventory.map((t: any) => t.name), tools.map(t => t.name));
    assert.equal(JSON.stringify(inventory).includes('parameters'), false);
    for (const tool of definitions) {
      assert.equal(JSON.parse(focus.invoke(FOCUS_SELECT, {names: [tool.name]})).status, 'selected_for_next_request');
      const selected = focus.next();
      assert.equal(selected.find(t => t.name === tool.name), tool, 'exact untouched original definition object');
      assert.equal(focus.available(tool.name), true);
    }
    const before = focus.next();
    for (const args of [{names: ['unknown']}, {names: ['decide_agent_action']}, {names: ['create_agent_chat']}, {names: definitions.slice(0, 9).map(t => t.name)}, {names: ['runtime_info', 'runtime_info']}, {names: ['runtime_info'], method: 'execute'}, null]) {
      assert.equal(JSON.parse(focus.invoke(FOCUS_SELECT, args)).error, 'CHAT_TOOL_FOCUS_INVALID');
      assert.deepEqual(focus.next(), before);
    }
    assert.equal(JSON.parse(focus.invoke(FOCUS_SELECT, {names: ['create_world_from_idea', 'propose_world_reshape', 'confirm_world_reshape']})).error, 'CHAT_TOOL_FOCUS_INVALID');
    assert.deepEqual(focus.next(), before);
    for (let i = 0; i < 3; i++) assert.deepEqual(JSON.parse(focus.invoke(FOCUS_CATALOG, {})).inventory, inventory.inventory);
    assert.equal(JSON.parse(focus.invoke(FOCUS_SELECT, {names: []})).status, 'selected_for_next_request');
    assert.equal(focus.next().length, 2);
    const small = new AgentToolFocus(tools.slice(0, 1), definitions.slice(0, 1));
    assert.equal(small.enabled, false); assert.deepEqual(small.next(), definitions.slice(0, 1));
  } finally {db.close();}
});

test('tool focus: every real tool schema reaches actual native SDK advertisements unchanged, without schema receipts', async t => {
  const db = openDatabase(':memory:');
  const w = createWorkbench(db, createModelSettings(db, '/tmp/opencode', {baseUrl: 'http://localhost/v1', model: 'focus-all', apiKey: '', timeoutMs: 3000}), undefined, {dataDir: '/tmp/opencode'});
  const tools = createAgentChatTools(createCommands(w), w);
  const batches: string[][] = []; let batch: string[] = []; let size = 2;
  for (const tool of tools) {
    const definitionBytes = Buffer.byteLength(JSON.stringify({name: tool.name, description: tool.description + (tool.requiresConfirmation ? '【必须由作者确认后才执行】' : ''), parameters: tool.parameters}));
    if (batch.length === 8 || size + definitionBytes + 1 > 128 * 1024) {batches.push(batch); batch = []; size = 2;}
    batch.push(tool.name); size += definitionBytes + 1;
  }
  if (batch.length) batches.push(batch);
  let requests = 0; const seen = new Set<string>();
  const mock = t.mock.method(globalThis, 'fetch', async (_input: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    const expected = requests ? batches[requests - 1]! : [];
    assert.deepEqual(body.tools.slice(2).map((t: any) => t.function.name), tools.filter(t => expected.includes(t.name)).map(t => t.name));
    for (const native of body.tools.slice(2)) {
      const tool = tools.find(t => t.name === native.function.name)!; seen.add(tool.name);
      assert.deepEqual(native.function.parameters, tool.parameters);
      assert.equal(native.function.description, tool.description + (tool.requiresConfirmation ? '【必须由作者确认后才执行】' : ''));
    }
    const next = batches[requests++];
    const delta = next ? {role: 'assistant', tool_calls: [{index: 0, id: `all-${requests}`, type: 'function', function: {name: FOCUS_SELECT, arguments: JSON.stringify({names: next})}}]} : {role: 'assistant', content: 'All available'};
    const separator = String.fromCharCode(10, 10);
    return new Response([JSON.stringify({choices: [{index: 0, delta, finish_reason: null}]}), JSON.stringify({choices: [{index: 0, delta: {}, finish_reason: next ? 'tool_calls' : 'stop'}]}), '[DONE]', ''].map(s => s ? `data: ${s}` : '').join(separator), {headers: {'Content-Type': 'text/event-stream'}});
  });
  try {
    const model = new AgentChatCompletionsModel({baseUrl: 'http://localhost/v1', model: 'focus-all', apiKey: '', timeoutMs: 3000});
    await model.run([{id: 'all', role: 'user', content: 'Inspect all available tools', createdAt: '2026-11-10T00:00:00Z'}], tools, AbortSignal.timeout(10000), {maxRounds: 24, startTurn() {}, assistant() {},
      execute: async () => {assert.fail('Metadata must not execute any business command');},
      toolResult: (_call, receipt) => {assert.equal(JSON.parse(receipt).status, 'selected_for_next_request'); assert.equal(receipt.includes('parameters'), false);}});
    assert.equal(seen.size, 78); assert.equal(requests, batches.length + 1);
    t.diagnostic(JSON.stringify({allOriginalSchemasAdvertised: seen.size, nativeRequests: requests, focusBatches: batches.length}));
  } finally {mock.mock.restore(); db.close();}
});

test('tool focus: real SDK freezes each stream, denies hidden/stale/author-only calls and resets on continuation', async t => {
  const db = openDatabase(':memory:');
  const bodies: any[] = []; const executed: string[] = []; const receipts: any[] = [];
  const sequence = [
    [{name: FOCUS_CATALOG, arguments: {}}],
    [{name: FOCUS_SELECT, arguments: {names: ['list_sources']}}, {name: 'list_sources', arguments: {}}, {name: 'decide_agent_action', arguments: {}}],
    [{name: 'list_sources', arguments: {}}, {name: FOCUS_SELECT, arguments: {names: ['runtime_info']}}],
    [{name: 'list_sources', arguments: {}}, {name: 'runtime_info', arguments: {}}, {name: FOCUS_CATALOG, arguments: {}}],
    [],
    [{name: 'runtime_info', arguments: {}}],
    [],
    [{name: 'list_sources', arguments: {}}],
    [],
  ];
  const mock = t.mock.method(globalThis, 'fetch', async (_input: unknown, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    const calls = sequence[bodies.length - 1]!;
    const delta = calls.length ? {role: 'assistant', tool_calls: calls.map((c, i) => ({index: i, id: `focus-${bodies.length}-${i}`, type: 'function', function: {name: c.name, arguments: JSON.stringify(c.arguments)}}))} : {role: 'assistant', content: 'Done'};
    const separator = String.fromCharCode(10, 10);
    return new Response([JSON.stringify({choices: [{index: 0, delta, finish_reason: null}]}), JSON.stringify({choices: [{index: 0, delta: {}, finish_reason: calls.length ? 'tool_calls' : 'stop'}]}), '[DONE]', ''].map(s => s ? `data: ${s}` : '').join(separator), {headers: {'Content-Type': 'text/event-stream'}});
  });
  try {
    const w = createWorkbench(db, createModelSettings(db, '/tmp/opencode', {baseUrl: 'http://localhost/v1', model: 'focus-test', apiKey: '', timeoutMs: 3000}), undefined, {dataDir: '/tmp/opencode'});
    const tools = createAgentChatTools(createCommands(w), w);
    const model = new AgentChatCompletionsModel({baseUrl: 'http://localhost/v1', model: 'focus-test', apiKey: '', timeoutMs: 3000});
    const hooks = {maxRounds: 16, startTurn() {}, assistant() {}, execute: async (call: any) => {executed.push(call.name); return {content: '[]', proposed: false};}, toolResult: (call: any, content: string) => receipts.push({call, content})};
    const history = [{id: 'intent', role: 'user' as const, content: 'Discover tools', createdAt: '2026-11-10T00:00:00Z'}];
    await model.run(history, tools, AbortSignal.timeout(10000), hooks);
    assert.deepEqual(executed, ['list_sources', 'runtime_info']);
    assert.equal(receipts.filter(r => r.content.includes('CHAT_TOOL_UNAVAILABLE')).length, 3);
    assert.deepEqual(bodies[0].tools.map((t: any) => t.function.name), [FOCUS_CATALOG, FOCUS_SELECT]);
    assert.deepEqual(bodies[1].tools, bodies[0].tools);
    assert.equal(bodies[2].tools.at(-1).function.name, 'list_sources');
    assert.equal(bodies[3].tools.at(-1).function.name, 'runtime_info');
    await model.run([...history, {id: 'confirm', role: 'user', content: '确认执行：已执行卡', createdAt: history[0]!.createdAt}], tools, AbortSignal.timeout(10000), hooks);
    assert.deepEqual(bodies[5].tools, bodies[0].tools); assert.deepEqual(executed, ['list_sources', 'runtime_info']);
    await model.run([...history, {id: 'new-intent', role: 'user', content: 'A new intent', createdAt: history[0]!.createdAt}], tools, AbortSignal.timeout(10000), hooks);
    assert.deepEqual(bodies[7].tools, bodies[0].tools); assert.deepEqual(executed, ['list_sources', 'runtime_info']);
    const bytes = (v: unknown) => Buffer.byteLength(JSON.stringify(v));
    assert.ok(bytes(bodies[0].tools) < 4000);
    assert.ok(bytes(bodies[0]) < 12000);
    t.diagnostic(JSON.stringify({originalToolArrayBytes: 344840, focusedInitialToolArrayBytes: bytes(bodies[0].tools), initialRequestBytes: bytes(bodies[0]), requests: bodies.length, realExecutions: executed}));
  } finally {mock.mock.restore(); db.close();}
});

test('tool focus contract: selection takes effect next model turn within the same run, not next user message', async t => {
  const db = openDatabase(':memory:');
  try {
    const w = createWorkbench(db, createModelSettings(db, '/tmp/opencode', {baseUrl: 'http://localhost/v1', model: 'focus-contract', apiKey: '', timeoutMs: 3000}), undefined, {dataDir: '/tmp/opencode'});
    const tools = createAgentChatTools(createCommands(w), w);
    const definitions = tools.map(t => ({name: t.name, description: t.description + (t.requiresConfirmation ? '【必须由作者确认后才执行】' : ''), parameters: t.parameters as any}));
    const focus = new AgentToolFocus(tools, definitions);
    // Selection is a single instance mutation: applying it then calling next()
    // immediately within the same run must advertise the selected tool — the
    // decisive same-run counterexample seen in the real trace (select -> read).
    const receipt = JSON.parse(focus.invoke(FOCUS_SELECT, {names: ['read_world_draft']}));
    assert.equal(receipt.status, 'selected_for_next_request');
    assert.deepEqual(receipt.focus, ['read_world_draft']);
    assert.match(receipt.message, /next model turn/);
    assert.match(receipt.message, /same run/);
    assert.match(receipt.message, /do not end your turn or wait for a new user message/);
    const advertised = focus.next();
    assert.deepEqual(advertised.map(d => d.name).slice(2), ['read_world_draft']);
    assert.equal(focus.available('read_world_draft'), true);
    // Discovery is read-only and must not clear the selection.
    assert.equal(JSON.parse(focus.invoke(FOCUS_CATALOG, {})).nextFocus[0], 'read_world_draft');
    assert.equal(focus.available('read_world_draft'), true);
    assert.equal(focus.enabled, true);
    assert.equal(focus.next().find(d => d.name === 'read_world_draft')!.parameters, definitions.find(d => d.name === 'read_world_draft')!.parameters, 'exact original schema, not a summary');
    // A new AgentToolFocus instance (a new run/user message) is a fresh empty selection.
    const fresh = new AgentToolFocus(tools, definitions);
    assert.equal(fresh.available('read_world_draft'), false);
    assert.deepEqual(fresh.next().map(d => d.name), [FOCUS_CATALOG, FOCUS_SELECT]);
    assert.match(fresh.instructions(), /same run/);
    assert.match(fresh.instructions(), /do not wait for a new user message/);
    assert.match(fresh.instructions(), /after each new user message/);
    assert.match(fresh.meta.find(m => m.name === FOCUS_SELECT)!.description, /same run/);
    assert.match(fresh.denied(), /same run/);
  } finally {db.close();}
});

test('tool focus contract: real SDK continues tool work after select in one run and resets on new author continuation', async t => {
  const db = openDatabase(':memory:');
  const bodies: any[] = []; const executed: string[] = []; const denied: string[] = [];
  // Mirrors trace 437->439: select, then the business read on the NEXT model turn
  // of the SAME run (no user message in between). Must NOT be denied.
  const responses = [
    // run A: select -> read -> read -> done
    [{name: FOCUS_SELECT, arguments: {names: ['read_world_draft']}}],
    [{name: 'read_world_draft', arguments: {path: 'locations'}}],
    [{name: 'read_world_draft', arguments: {path: 'endings'}}],
    [],
    // run B (continuation): business read on a fresh (empty) focus -> must be denied, then done
    [{name: 'read_world_draft', arguments: {path: 'locations'}}],
    [],
  ];
  let responseIndex = 0;
  const mock = t.mock.method(globalThis, 'fetch', async (_input: unknown, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    const calls = responses[responseIndex++] ?? [];
    const delta = calls.length ? {role: 'assistant', tool_calls: calls.map((c, i) => ({index: i, id: `contract-${responseIndex}-${i}`, type: 'function', function: {name: c.name, arguments: JSON.stringify(c.arguments)}}))} : {role: 'assistant', content: 'Done'};
    const separator = String.fromCharCode(10, 10);
    return new Response([JSON.stringify({choices: [{index: 0, delta, finish_reason: null}]}), JSON.stringify({choices: [{index: 0, delta: {}, finish_reason: calls.length ? 'tool_calls' : 'stop'}]}), '[DONE]', ''].map(s => s ? `data: ${s}` : '').join(separator), {headers: {'Content-Type': 'text/event-stream'}});
  });
  try {
    const w = createWorkbench(db, createModelSettings(db, '/tmp/opencode', {baseUrl: 'http://localhost/v1', model: 'focus-contract', apiKey: '', timeoutMs: 3000}), undefined, {dataDir: '/tmp/opencode'});
    const tools = createAgentChatTools(createCommands(w), w);
    const model = new AgentChatCompletionsModel({baseUrl: 'http://localhost/v1', model: 'focus-contract', apiKey: '', timeoutMs: 3000});
    const hooks = {maxRounds: 16, startTurn() {}, assistant() {}, execute: async (call: any) => {executed.push(call.name); return {content: '[]', proposed: false};}, toolResult: (_call: any, content: string) => {if (content.includes('CHAT_TOOL_UNAVAILABLE')) denied.push(content);}};
    const history = [{id: 'intent', role: 'user' as const, content: 'Read world draft', createdAt: '2026-11-10T00:00:00Z'}];
    await model.run(history, tools, AbortSignal.timeout(10000), hooks);
    assert.deepEqual(executed, ['read_world_draft', 'read_world_draft'], 'selection must apply to the next model turn in the SAME run without a user message');
    assert.equal(denied.length, 0);
    assert.deepEqual(bodies[0].tools.map((t: any) => t.function.name), [FOCUS_CATALOG, FOCUS_SELECT]);
    assert.equal(bodies[1].tools.at(-1).function.name, 'read_world_draft');
    // A new user/author continuation is a fresh run: focus resets, select is gone,
    // so the business read is denied (same-turn denial preserved).
    const beforeExecuted = executed.length;
    await model.run([...history, {id: 'continuation', role: 'user', content: '确认执行：已执行卡', createdAt: history[0]!.createdAt}], tools, AbortSignal.timeout(10000), hooks);
    assert.equal(executed.length, beforeExecuted, 'no history replay of the previous run selection');
    assert.deepEqual(bodies[4].tools.map((t: any) => t.function.name), [FOCUS_CATALOG, FOCUS_SELECT], 'focus resets to meta-only on a new run');
    assert.equal(denied.length, 1, 'unselected business tool is denied on the fresh run');
    t.diagnostic(JSON.stringify({sameRunSelectThenRead: true, resetOnContinuation: true, executed, denied, requests: bodies.length}));
  } finally {mock.mock.restore(); db.close();}
});

test('tool focus: metadata shares original 128-call budget and model turn limits without business execution', async t => {
  const db = openDatabase(':memory:');
  const w = createWorkbench(db, createModelSettings(db, '/tmp/opencode', {baseUrl: 'http://localhost/v1', model: 'focus-budget', apiKey: '', timeoutMs: 3000}), undefined, {dataDir: '/tmp/opencode'});
  const tools = createAgentChatTools(createCommands(w), w);
  let requests = 0; let turns = 0; const receipts: string[] = [];
  const mock = t.mock.method(globalThis, 'fetch', async () => {
    requests++;
    const delta = {role: 'assistant', tool_calls: Array.from({length: 20}, (_, i) => ({index: i, id: `budget-${requests}-${i}`, type: 'function', function: {name: FOCUS_SELECT, arguments: JSON.stringify({names: []})}}))};
    const separator = String.fromCharCode(10, 10);
    return new Response([JSON.stringify({choices: [{index: 0, delta, finish_reason: null}]}), JSON.stringify({choices: [{index: 0, delta: {}, finish_reason: 'tool_calls'}]}), '[DONE]', ''].map(s => s ? `data: ${s}` : '').join(separator), {headers: {'Content-Type': 'text/event-stream'}});
  });
  try {
    const model = new AgentChatCompletionsModel({baseUrl: 'http://localhost/v1', model: 'focus-budget', apiKey: '', timeoutMs: 3000});
    const hooks = {maxRounds: 24, startTurn() {turns++;}, assistant() {}, execute: async () => {assert.fail('Metadata cannot reach business hooks');}, toolResult: (_call: unknown, receipt: string) => {receipts.push(receipt);}};
    const history = [{id: 'budget', role: 'user' as const, content: 'Select tools', createdAt: '2026-11-10T00:00:00Z'}];
    assert.equal((await model.run(history, tools, AbortSignal.timeout(10000), hooks)).limited, true);
    assert.equal(requests, 7); assert.equal(turns, 7); assert.equal(receipts.length, 140);
    assert.equal(receipts.filter(r => JSON.parse(r).status === 'selected_for_next_request').length, 128);
    assert.equal(receipts.filter(r => JSON.parse(r).reason === 'CHAT_TOOL_LIMIT').length, 12);
    requests = 0; turns = 0; receipts.length = 0;
    assert.equal((await model.run(history, tools, AbortSignal.timeout(10000), {...hooks, maxRounds: 2})).limited, true);
    assert.equal(requests, 2); assert.equal(turns, 2); assert.equal(receipts.length, 40);
  } finally {mock.mock.restore(); db.close();}
});
