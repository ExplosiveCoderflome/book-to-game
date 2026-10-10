import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request as httpRequest, createServer } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { GameContent } from '@novel-game/contracts';
import { openDatabase } from '../src/platform/database.js';
import { createWorkbench } from '../src/app/workbench.js';
import { createApp } from '../src/adapters/http/app.js';
import { createModelSettings } from '../src/platform/create-model-settings.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const token = 'integration-test-access-token';
async function fixture() {
  const db = openDatabase(':memory:');
  const dir = mkdtempSync(path.join(tmpdir(), 'transport-model-'));
  const workbench = createWorkbench(db, createModelSettings(db, dir, {baseUrl: 'https://api.example.test/v1', model: '', apiKey: '', timeoutMs: 90000}));
  const server = createApp(workbench, {token, allowedOrigins: ['http://127.0.0.1:5173']}).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${(server.address() as {port: number}).port}`;
  const request = (path: string, method = 'GET', body?: unknown) => fetch(url + path, {
    method, headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
    ...(body === undefined ? {} : {body: JSON.stringify(body)}),
  });
  return {db, server, url, request, close: async () => {await new Promise<void>(r => server.close(() => r())); db.close(); rmSync(dir, {recursive: true, force: true});}};
}
test('Web API allows local requests without a token, while MCP keeps token protection', async () => {
  const f = await fixture();
  try {
    assert.equal((await fetch(f.url + '/api/sources')).status, 200);
    assert.equal((await fetch(f.url + '/mcp')).status, 401);
    const invalidHostStatus = await new Promise<number>(resolve => {
      httpRequest(f.url + '/api/sources', {headers: {Host: 'evil.example', Authorization: `Bearer ${token}`}}, response => {
        response.resume(); resolve(response.statusCode!);
      }).end();
    });
    assert.equal(invalidHostStatus, 403);
    assert.equal((await fetch(f.url + '/api/sources', {headers: {Origin: 'https://evil.example', Authorization: `Bearer ${token}`}})).status, 403);
    assert.equal((await f.request('/api/jobs', 'POST', {sourceId: 'x', requestId: crypto.randomUUID()})).status, 503);
    assert.equal((await f.request('/api/sources', 'POST', {title: 'bad', filename: 'bad.txt', contentBase64: '%%%'})).status, 400);
  } finally { await f.close(); }
});
test('real MCP client and HTTP share source, draft, revision and idempotent gameplay state', async () => {
  const f = await fixture();
  const client = new Client({name: 'integration-client', version: '1.0.0'});
  const transport = new StreamableHTTPClientTransport(new URL(f.url + '/mcp'), {requestInit: {headers: {Authorization: `Bearer ${token}`}}});
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    assert.ok(tools.tools.some(t => t.name === 'import_text_source'));
    const imported = await client.callTool({name: 'import_text_source', arguments: {title: '雾渡', text: '第一章 渡口\n雾里有两条船。\n第二章 决定\n白船向城，黑船向山。'}});
    assert.equal(imported.isError, undefined);
    const source = (imported.structuredContent as any).result;
    const missingChapter = await client.callTool({name: 'read_source', arguments: {id: source.id, chapterId: 'missing'}});
    assert.equal(missingChapter.isError, true);
    assert.equal((missingChapter.structuredContent as any).error.code, 'CHAPTER_NOT_FOUND');
    assert.equal((await (await f.request('/api/sources')).json()).length, 1);
    const evidence = [{chapterId: source.chapters[0].id, paragraphId: source.chapters[0].paragraphs[0].id}];
    const content: GameContent = {title: '雾渡', mode: 'story', premise: '决定你的航向', adaptationNotes: '示例短篇改编', startSceneId: 'start', scenes: [
      {id: 'start', title: '渡口', text: '你会选择哪条船？', origin: 'source', evidence,
        choices: [{id: 'white', label: '登白船', targetSceneId: 'city'}, {id: 'black', label: '登黑船', targetSceneId: 'hill'}]},
      {id: 'city', title: '城灯', text: '城灯照亮归途。', origin: 'adapted', evidence: [], choices: [], ending: '抵达城中'},
      {id: 'hill', title: '山火', text: '山中尚有新路。', origin: 'adapted', evidence: [], choices: [], ending: '进入山林'},
    ]};
    const draft = await (await f.request('/api/drafts', 'POST', {sourceId: source.id, content})).json();
    const published = await client.callTool({name: 'publish_draft', arguments: {id: draft.id, version: draft.version}});
    assert.notEqual(published.isError, true);
    const revision = (published.structuredContent as any).result;
    const session = await (await f.request('/api/sessions', 'POST', {gameRevisionId: revision.id})).json();
    assert.equal(session.scene.choices[0].targetSceneId, undefined);
    const input = {choiceId: 'white', expectedTurn: 0, requestId: crypto.randomUUID()};
    const result = await client.callTool({name: 'act_session', arguments: {id: session.id, ...input}});
    const played = (result.structuredContent as any).result;
    const replay = await (await f.request(`/api/sessions/${session.id}/actions`, 'POST', input)).json();
    assert.equal(played.ended, true); assert.deepEqual(replay, played);
    const validation = await client.callTool({name: 'validate_draft', arguments: {id: 'missing'}});
    assert.equal(validation.isError, true);
    assert.equal((validation.structuredContent as any).error.code, 'DRAFT_NOT_FOUND');
  } finally { await client.close(); await f.close(); }
});

test('HTTP and MCP model settings stay redacted, test without saving and update runtime immediately', async () => {
  const f = await fixture();
  const seen: string[] = [];
  const provider = createServer((req, res) => {
    seen.push(`${req.method} ${req.url} ${req.headers.authorization}`);
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({data: [{id: 'test-model'}]}));
  }).listen(0, '127.0.0.1');
  await once(provider, 'listening');
  const client = new Client({name: 'settings-client', version: '1.0.0'});
  try {
    assert.equal((await fetch(f.url + '/api/settings/model')).status, 200);
    const settingsView = await f.request('/api/settings/model');
    assert.equal(settingsView.status, 200); assert.match(settingsView.headers.get('x-request-id') ?? '', /^[0-9a-f-]{36}$/);
    const input = {baseUrl: `http://127.0.0.1:${(provider.address() as {port: number}).port}/v1`, model: 'test-model',
      apiKey: 'test-key-not-a-real-secret', timeoutMs: 2000, expectedRevision: 0};
    const probe = await f.request('/api/settings/model/test', 'POST', input);
    assert.equal(probe.status, 200); assert.equal((await probe.json()).modelAvailable, true);
    assert.deepEqual(seen, ['GET /v1/models Bearer test-key-not-a-real-secret']);
    const models = await f.request('/api/settings/model/models', 'POST', {
      baseUrl: input.baseUrl, apiKey: input.apiKey, timeoutMs: input.timeoutMs, expectedRevision: 0,
    });
    assert.equal(models.status, 200); assert.deepEqual((await models.json()).models, ['test-model']);
    assert.deepEqual(seen, ['GET /v1/models Bearer test-key-not-a-real-secret', 'GET /v1/models Bearer test-key-not-a-real-secret']);
    assert.equal((await (await f.request('/api/settings/model')).json()).revision, 0);
    const response = await f.request('/api/settings/model', 'PUT', input);
    assert.equal(response.status, 200);
    const saved = await response.json();
    assert.equal(saved.hasApiKey, true); assert.equal(saved.revision, 1);
    assert.equal(JSON.stringify(saved).includes(input.apiKey), false); assert.equal(saved.apiKey, undefined);
    assert.equal((await (await f.request('/api/runtime')).json()).providerConfigured, true);
    await client.connect(new StreamableHTTPClientTransport(new URL(f.url + '/mcp'), {requestInit: {headers: {Authorization: `Bearer ${token}`}}}));
    const result = await client.callTool({name: 'get_model_settings', arguments: {}});
    assert.deepEqual((result.structuredContent as any).result, saved);
    assert.equal(JSON.stringify(result).includes(input.apiKey), false);
    assert.equal((await f.request('/api/settings/model', 'PUT', input)).status, 409);
    const cleared = await client.callTool({name: 'save_model_settings', arguments: {
      ...input, baseUrl: 'https://api.example.test/v1', apiKey: '', clearApiKey: true, expectedRevision: 1,
    }});
    assert.notEqual(cleared.isError, true);
    assert.equal((await (await f.request('/api/runtime')).json()).providerConfigured, false);
  } finally {await client.close(); await f.close(); await new Promise<void>(r => provider.close(() => r()));}
});
