import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { AdventureView, SourceDocument, WorldRevision } from '@novel-game/contracts';
import { openDatabase } from '../src/platform/database.js';
import { createModelSettings } from '../src/platform/create-model-settings.js';
import { createWorkbench } from '../src/app/workbench.js';
import { createApp } from '../src/adapters/http/app.js';
import { ChatCompletionsProvider } from '../src/platform/model/chat-completions.js';
import { ferryWorld } from '../../../examples/ferry-world.js';

const token = 'open-adventure-integration-token';
const sourceBytes = readFileSync(new URL('../../../examples/sealed-harbor.txt', import.meta.url));
async function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), 'open-adventure-integration-'));
  const db = openDatabase(path.join(dir, 'workbench.sqlite'));
  const settings = createModelSettings(db, dir, {baseUrl: 'https://api.example.test/v1', model: '', apiKey: '', timeoutMs: 2000});
  const w = createWorkbench(db, settings);
  const server = createApp(w, {token, allowedOrigins: []}).listen(0, '127.0.0.1'); await once(server, 'listening');
  const url = `http://127.0.0.1:${(server.address() as {port: number}).port}`;
  async function request(route: string, method = 'GET', body?: unknown) {
    const response = await fetch(url + route, {method, headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
      ...(body === undefined ? {} : {body: JSON.stringify(body)})});
    const value = await response.json(); assert.equal(response.ok, true, JSON.stringify(value)); return value;
  }
  return {db, w, settings, url, request, close: async () => {await new Promise<void>(r => server.close(() => r())); db.close(); rmSync(dir, {recursive: true, force: true});}};
}
test('real MCP and HTTP publish selected novel slice and play three persistent strategies without exposing secrets', async () => {
  const f = await fixture(); const client = new Client({name: 'open-client', version: '1.0.0'});
  try {
    const source: SourceDocument = await f.request('/api/sources', 'POST', {title: '封港前', filename: 'harbor.txt', contentBase64: sourceBytes.toString('base64')});
    await client.connect(new StreamableHTTPClientTransport(new URL(f.url + '/mcp'), {requestInit: {headers: {Authorization: `Bearer ${token}`}}}));
    const tools = await client.listTools(); assert.ok(tools.tools.some(t => t.name === 'act_adventure'));
    const content = ferryWorld({...source, chapters: source.chapters.slice(0, 2)});
    const created = await client.callTool({name: 'create_world_draft', arguments: {sourceId: source.id, content}});
    assert.notEqual(created.isError, true, JSON.stringify(created)); const draft = (created.structuredContent as any).result;
    assert.equal((await f.request(`/api/worlds/drafts/${draft.id}/validate`, 'POST', {})).valid, true);
    const published = await client.callTool({name: 'publish_world_draft', arguments: {id: draft.id, version: draft.version}});
    assert.notEqual(published.isError, true, JSON.stringify(published)); const revision = (published.structuredContent as any).result as WorldRevision;
    const routes = [
      {ids: ['visit-warehouse', 'collect-timber', 'return-dock', 'repair-boat', 'boat-cross'], ending: 'quiet-crossing', consequence: 'trusted'},
      {ids: ['visit-warehouse', 'read-ledger', 'return-dock', 'visit-gate', 'negotiate'], ending: 'named-crossing', consequence: 'exposed'},
      {ids: ['visit-warehouse', 'promise-help', 'caravan-cross'], ending: 'promised-crossing', consequence: 'debt'},
    ];
    for (const route of routes) {
      let session: AdventureView = await f.request('/api/adventures', 'POST', {worldRevisionId: revision.id});
      assert.doesNotMatch(JSON.stringify(session), /北城管事|knownFactIds|initialValue|availableWhen|targetSceneId/);
      let firstInput: any; let firstResult: AdventureView | undefined;
      for (const actionId of route.ids) {
        const input = {actionId, expectedTurn: session.turn, requestId: crypto.randomUUID()};
        const result = await client.callTool({name: 'act_adventure', arguments: {id: session.id, ...input}});
        assert.notEqual(result.isError, true, JSON.stringify(result)); session = (result.structuredContent as any).result;
        if (!firstInput) {firstInput = input; firstResult = session;}
      }
      assert.equal(session.ending?.id, route.ending); assert.equal(session.ended, true);
      assert.ok(session.facts.some(fact => fact.id === route.consequence && fact.value));
      assert.deepEqual(await f.request(`/api/adventures/${session.id}`), session);
      assert.deepEqual(await f.request(`/api/adventures/${session.id}/actions`, 'POST', firstInput), firstResult);
      assert.equal(session.history.filter(entry => entry.text.includes('第一次钟声')).length, route.ids.length >= 5 ? 1 : 0);
    }
  } finally {await client.close(); await f.close();}
});
test('selected novel chapters traverse real model HTTP, recover generation failure and create only a world draft', async () => {
  const f = await fixture(); let analyzeCalls = 0; let failWorld = true; let analyzedText = '';
  const source = f.w.sources.importFile({title: '封港前', filename: 'harbor.txt', bytes: sourceBytes});
  const selected = {...source, chapters: source.chapters.slice(0, 2)}; const content = ferryWorld(selected);
  const provider = createServer(async (req, res) => {
    let body = ''; for await (const part of req) body += part;
    const data = JSON.parse(JSON.parse(body).messages[1].content); let value: unknown;
    if (data.paragraphs) {
      analyzeCalls++; analyzedText += JSON.stringify(data.paragraphs);
      const {chapterId, paragraphId} = data.paragraphs[0];
      value = {summary: '封港前护送证人过河', characters: [], locations: [{name: '渡口', description: '小船漏水', evidence: [{chapterId, paragraphId}]}], worldRules: [], uncertainties: []};
    } else {
      assert.deepEqual(data.plan.chapterIds, selected.chapters.map(c => c.id));
      if (failWorld) {res.writeHead(503); res.end('test interruption'); return;}
      value = content;
    }
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({choices: [{message: {content: JSON.stringify(value)}}]}));
  }).listen(0, '127.0.0.1'); await once(provider, 'listening');
  try {
    f.settings.save({baseUrl: `http://127.0.0.1:${(provider.address() as {port: number}).port}/v1`, model: 'test-world', timeoutMs: 2000, expectedRevision: 0});
    const job = await f.request('/api/jobs', 'POST', {sourceId: source.id, requestId: crypto.randomUUID(), mode: 'open',
      chapterIds: selected.chapters.map(c => c.id), playerRole: '护送证人的抄写员', canonPolicy: 'faithful', direction: '三种策略过河'});
    const runner = f.w.createRunner(new ChatCompletionsProvider(f.settings.resolve()));
    await runner.runOnce(); assert.equal(f.w.jobs.get(job.id).status, 'failed');
    assert.equal(f.w.worlds.list().length, 0); failWorld = false;
    await f.request(`/api/jobs/${job.id}/retry`, 'POST', {}); await runner.runOnce();
    const finished = f.w.jobs.get(job.id); assert.equal(finished.status, 'succeeded'); assert.equal(analyzeCalls, 1);
    assert.doesNotMatch(analyzedText, /数月以后|另一座城/); assert.equal(f.w.games.list().length, 0);
    const draft = f.w.worlds.get(finished.draftId!); assert.deepEqual(draft.content.sourceChapterIds, selected.chapters.map(c => c.id));
    assert.equal(f.w.worlds.validate(draft.id).valid, true);
  } finally {await new Promise<void>(r => provider.close(() => r())); await f.close();}
});
