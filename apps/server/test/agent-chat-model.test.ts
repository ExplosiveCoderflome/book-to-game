import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { test } from 'node:test';
const providerModule = await import('../src/platform/model/agent-chat.js').catch(() => ({AgentChatCompletionsModel: undefined}));

test('agent chat model: native tool calls and results round trip over HTTP using the configured endpoint', async () => {
  assert.ok(providerModule.AgentChatCompletionsModel, 'a real provider adapter is required for chat');
  const bodies: any[] = [];
  const server = createServer(async (req, res) => {
    assert.equal(req.url, '/v1/chat/completions'); assert.equal(req.headers.authorization, 'Bearer test-agent-key');
    let raw = ''; for await (const chunk of req) raw += chunk;
    bodies.push(JSON.parse(raw)); res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({choices: [{message: bodies.length === 1 ? {content: null, tool_calls: [{id: 'call-real', type: 'function', function: {name: 'list_sources', arguments: '{}'}}]} : {content: '当前有一本测试原作。'}}]}));
  }).listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const adapter = new providerModule.AgentChatCompletionsModel({baseUrl: `http://127.0.0.1:${(server.address() as {port: number}).port}/v1`, model: 'test-agent-model', apiKey: 'test-agent-key', timeoutMs: 2000});
    const messages: any[] = [{id: 'm1', role: 'user', content: '列出原作', createdAt: ''}];
    const tool: any = {name: 'list_sources', description: 'list sources', parameters: {type: 'object', properties: {}}, requiresConfirmation: false};
    const first = await adapter.respond(messages, [tool], new AbortController().signal);
    assert.deepEqual(first.calls[0], {id: 'call-real', name: 'list_sources', arguments: {}});
    messages.push({id: 'm2', role: 'assistant', content: '', toolCalls: first.calls}, {id: 'm3', role: 'tool', toolCallId: 'call-real', content: '[{"title":"测试原作"}]'});
    const second = await adapter.respond(messages, [tool], new AbortController().signal);
    assert.match(second.text, /测试原作/);
    assert.equal(bodies[0].model, 'test-agent-model');
    assert.equal(bodies[1].messages.at(-1).tool_call_id, 'call-real');
    assert.equal(bodies[1].messages.at(-2).tool_calls[0].function.arguments, '{}');
    assert.equal(JSON.stringify(bodies).includes('test-agent-key'), false, 'key belongs only in Authorization');
  } finally {await new Promise<void>(r => server.close(() => r()));}
});

test('agent chat model: provider failures and malformed tool payloads never echo upstream secrets', async () => {
  assert.ok(providerModule.AgentChatCompletionsModel);
  let badStatus = true;
  const server = createServer((_req, res) => {
    if (badStatus) {res.writeHead(401); res.end('sensitive-provider-body test-agent-key');}
    else {res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({choices: [{message: {content: null, tool_calls: [{id: 'x', type: 'function', function: {name: 'retry_job', arguments: 'not-json'}}]}}]}));}
  }).listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const adapter = new providerModule.AgentChatCompletionsModel({baseUrl: `http://127.0.0.1:${(server.address() as {port: number}).port}`, model: 'test', apiKey: 'test-agent-key', timeoutMs: 2000});
    await assert.rejects(adapter.respond([], [], new AbortController().signal), error => !/sensitive-provider-body|test-agent-key/.test(String(error)) && /401/.test(String(error)));
    badStatus = false;
    await assert.rejects(adapter.respond([], [], new AbortController().signal), {code: 'CHAT_MODEL_INVALID_RESPONSE'});
  } finally {await new Promise<void>(r => server.close(() => r()));}
});
