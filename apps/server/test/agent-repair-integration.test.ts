import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { worldContentSchema, type AgentRepairCandidate } from '@novel-game/contracts';
import { openDatabase } from '../src/platform/database.js';
import { createModelSettings } from '../src/platform/create-model-settings.js';
import { createWorkbench } from '../src/app/workbench.js';
import { createApp } from '../src/adapters/http/app.js';

test('agent repair HTTP/MCP: persisted preview, confirmation, reports, replay and conflict share one use case', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'btg-agent-repair-test-'));
  const db = openDatabase(path.join(dir, 'workbench.sqlite'));
  const token = 'agent-repair-only-test-access-code';
  const w = createWorkbench(db, createModelSettings(db, dir, {baseUrl: 'http://127.0.0.1:1/v1', model: '', apiKey: '', timeoutMs: 1000}), undefined, {dataDir: dir});
  const server = createApp(w, {token, allowedOrigins: []}).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as {port: number}).port}`;
  const client = new Client({name: 'agent-repair-test', version: '1.0.0'});
  const request = (url: string, body?: unknown) => fetch(base + url, {method: body ? 'POST' : 'GET',
    headers: {'Content-Type': 'application/json'}, ...(body ? {body: JSON.stringify(body)} : {})});
  try {
    const source = w.sources.importFile({title: '三路测试', filename: 'test.txt', bytes: Buffer.from('第一章\n旧识与账簿。')});
    const content = worldContentSchema.parse(JSON.parse(readFileSync(new URL('../../../fixtures/s1/route-coverage.engine.json', import.meta.url), 'utf8')));
    content.sourceChapterIds = [source.chapters[0]!.id];
    const draft = w.worlds.create({sourceId: source.id, content});
    await w.preflight.playtestWorldDraft({id: draft.id, seeds: 40});
    const response = await request(`/api/worlds/drafts/${draft.id}/agent-repairs`, {version: 1, endingId: 'coop'});
    assert.equal(response.status, 200, await response.clone().text());
    const candidate = await response.json() as AgentRepairCandidate;
    assert.equal(candidate.preview.allowed, true); assert.equal(w.worlds.get(draft.id).version, 1);
    await client.connect(new StreamableHTTPClientTransport(new URL(base + '/mcp'), {requestInit: {headers: {Authorization: `Bearer ${token}`}}}));
    const tools = (await client.listTools()).tools;
    for (const name of ['create_agent_repair', 'list_agent_repairs', 'apply_agent_repair', 'reject_agent_repair']) assert.ok(tools.some(t => t.name === name));
    const applied = await client.callTool({name: 'apply_agent_repair', arguments: {id: candidate.id}});
    assert.equal(applied.isError, undefined, JSON.stringify(applied.content));
    assert.equal(w.worlds.get(draft.id).version, 2);
    const replay = await request(`/api/agent/repairs/${candidate.id}/apply`, {});
    assert.equal(replay.status, 200); assert.equal(w.worlds.get(draft.id).version, 2);
    const reports = w.preflight.getWorldPreflight(draft.id);
    assert.equal(reports.stale.lint, false); assert.equal(reports.stale.playtest, false);
    assert.equal(reports.playtest!.draftVersion, 2);
    assert.equal(w.worlds.listRevisions().length, 0);
    const list = await (await request(`/api/worlds/drafts/${draft.id}/agent-repairs`)).json() as {candidates: AgentRepairCandidate[]};
    assert.equal(list.candidates[0]!.status, 'applied');
    assert.equal((await request(`/api/agent/repairs/${candidate.id}/reject`, {})).status, 409);
  } finally {
    await client.close(); await new Promise<void>(resolve => server.close(() => resolve())); db.close();
    assert.ok(path.resolve(dir).startsWith(path.resolve(tmpdir()) + path.sep + 'btg-agent-repair-test-'));
    rmSync(dir, {recursive: true, force: true});
  }
});
