/**
 * S1 preflight (§6.6 lint, §6.7 sim, C9, D7, acceptance ⑦): pure lint/sim, then the same commands over HTTP and MCP.
 */
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { gameContentSchema, worldContentSchema, type WorldContent, type WorldRevision } from '@novel-game/contracts';
import { lintStory, lintWorld } from '@novel-game/rules/preflight';
import { simulateWorld } from '@novel-game/play-runtime/sim';
import { openDatabase } from '../src/platform/database.js';
import { createWorkbench } from '../src/app/workbench.js';
import { createApp } from '../src/adapters/http/app.js';
import { createModelSettings } from '../src/platform/create-model-settings.js';
import { generationProvenance } from '../src/modules/generation/application/runner.js';

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../../../fixtures/s1/${name}`, import.meta.url), 'utf8'));
const gold = (): WorldContent => worldContentSchema.parse(fixture('shoudeng.batch2.content.json'));
const rev = (content: WorldContent): WorldRevision => ({id: 'rev', draftId: 'd', sourceId: 's', content, version: 1, createdAt: '2026-10-28T00:00:00Z'});

test('lint: gold sample (batch 2; batch 1 too) has 0 errors; batch tier shortfalls are warnings', () => {
  const report = lintWorld(gold(), {draftVersion: 3});
  assert.equal(report.blocking, true);
  assert.equal(report.errors, 0, report.issues.filter(i => i.severity === 'error').map(i => i.message).join('\n'));
  assert.equal(report.draftVersion, 3);
  assert.ok(report.issues.some(i => i.category === 'volume' && /分批交付中/.test(i.message)));
  for (const id of ['G2-count', 'G3', 'G7', 'G8-structure']) assert.ok(report.checks.some(c => c.id === id), id);
  assert.equal(lintWorld(worldContentSchema.parse(fixture('shoudeng.batch1.content.json'))).errors, 0, 'batch 1 regression fixture');
  assert.match(report.checks.find(c => c.id === 'G3')!.measured, /不足：/, 'G3 names the under-gated resources');
});

test('lint: 雾渡 (mock-generated story) reports template sentences and too-short text', () => {
  const report = lintStory(gameContentSchema.parse(fixture('wudu.story-draft.json')));
  assert.equal(report.blocking, false);
  const banned = report.issues.filter(i => i.ruleId === 'text.banned-phrase');
  const short = report.issues.filter(i => i.ruleId === 'text.too-short');
  assert.ok(banned.length >= 5, `banned ${banned.length}`);
  assert.ok(short.length >= 5, `short ${short.length}`);
  assert.ok(banned.some(i => /气氛紧绷|每个选择都有代价/.test(i.message)));
  assert.ok(report.issues.some(i => i.category === 'volume' && i.severity === 'error'));
  assert.equal(report.checks.find(c => c.id === 'G7')?.pass, false);
});

test('lint: a banned phrase or a dangling reference in an S1 world is an error', () => {
  const world = gold();
  world.storylets![0]!.text = `${world.storylets![0]!.text}气氛紧绷。`;
  delete world.storylets![0]!.textVariants;
  world.storylets![1]!.choices[0]!.effects.push({kind: 'resource', resourceId: 'nope', delta: 1});
  world.storylets![2]!.choices[0]!.text += '每个选择都有代价。';
  const report = lintWorld(world);
  assert.ok(report.issues.some(i => i.ruleId === 'text.banned-phrase' && i.target?.kind === 'choice'), 'choice result text is checked for banned phrases');
  assert.ok(report.issues.some(i => i.ruleId === 'text.banned-phrase' && i.severity === 'error'));
  assert.ok(report.issues.some(i => i.ruleId === 's1.unknown-resource' && i.severity === 'error' && /nope/.test(i.message)));
});

test('sim: deterministic per seed, no dead ends, reports every strategy and G-checks', async () => {
  const a = await simulateWorld(rev(gold()), {seeds: 6, now: '2026-10-28T00:00:00Z'});
  const b = await simulateWorld(rev(gold()), {seeds: 6, now: '2026-10-28T00:00:00Z'});
  assert.deepEqual({...a, durationMs: 0}, {...b, durationMs: 0});
  assert.deepEqual(a.strategies.map(s => s.id), ['random', 'greedy-xiuwei', 'greedy-lingshi', 'modao', 'merchant', 'lazy']);
  assert.equal(a.deadEnds, 0);
  for (const s of a.strategies) {
    const total = Object.values(a.endingRates[s.id]!).reduce((n, v) => n + v, 0);
    assert.ok(Math.abs(total - 1) < 1e-9, `${s.id} rates sum to 1`);
    assert.ok(a.medians[s.id]!.decisions > 0);
  }
  assert.ok(a.endingRates.modao!.rumo! > 0.5, 'chasing 心魔 ends in 入魔');
  assert.ok((a.endingRates.merchant!.wanbao ?? 0) > 0.5, '跑商 reaches 万宝楼东家 (back-chained from the 2700 灵石 gate)');
  assert.deepEqual(a.checks.map(c => c.id), ['G1', 'G2', 'G4', 'G6', 'G8']);
  assert.ok(a.resourceBands.xiuwei!.points.length === 5);
  assert.ok(a.cards.neverDrawn.length < gold().storylets!.length);
});

test('provenance: model ids starting with mock are stamped as mock', () => {
  assert.deepEqual(generationProvenance('mock-btg'), {generator: 'mock', model: 'mock-btg', source: 'runner'});
  assert.deepEqual(generationProvenance('deepseek-chat'), {generator: 'llm', model: 'deepseek-chat', source: 'runner'});
  assert.deepEqual(generationProvenance(undefined), {generator: 'llm', source: 'runner'});
});

async function server(opts: {allowMockPublish?: boolean; before?: (db: ReturnType<typeof openDatabase>, dir: string) => void} = {}) {
  const db = openDatabase(':memory:');
  const dir = mkdtempSync(path.join(tmpdir(), 's1-preflight-'));
  opts.before?.(db, dir);
  const workbench = createWorkbench(db, createModelSettings(db, dir, {baseUrl: 'https://api.example.test/v1', model: '', apiKey: '', timeoutMs: 90000}), undefined, {allowMockPublish: opts.allowMockPublish, dataDir: dir});
  const token = 's1-preflight-token';
  const http = createApp(workbench, {token, allowedOrigins: []}).listen(0, '127.0.0.1');
  await once(http, 'listening');
  const url = `http://127.0.0.1:${(http.address() as {port: number}).port}`;
  const request = async (p: string, method = 'GET', body?: unknown) => {
    const res = await fetch(url + p, {method, headers: {'Content-Type': 'application/json'}, ...(body === undefined ? {} : {body: JSON.stringify(body)})});
    return {status: res.status, body: await res.json() as any};
  };
  const sourceRes = await request('/api/sources', 'POST', {title: '寿灯', filename: 'shoudeng.txt', contentBase64: Buffer.from('第一章 寿灯\n祠堂里三千盏魂灯。').toString('base64')});
  const sourceId = sourceRes.body.id as string; const chapterId = sourceRes.body.chapters[0].id as string;
  const goldFor = (): WorldContent => ({...gold(), sourceChapterIds: [chapterId]});
  return {url, token, request, sourceId, goldFor, workbench, close: async () => { await new Promise<void>(r => http.close(() => r())); db.close(); rmSync(dir, {recursive: true, force: true}); }};
}

test('HTTP: lint / playtest / preflight round trip, reports stored per draft and marked stale after edits', async () => {
  const s = await server();
  try {
    const created = await s.request('/api/worlds/drafts', 'POST', {sourceId: s.sourceId, content: s.goldFor()});
    assert.equal(created.status, 200, JSON.stringify(created.body));
    const id = created.body.id as string;
    const lint = await s.request(`/api/worlds/drafts/${id}/lint`, 'POST', {});
    assert.equal(lint.status, 200); assert.equal(lint.body.errors, 0); assert.equal(lint.body.draftId, id); assert.equal(lint.body.draftVersion, 1);
    const sim = await s.request(`/api/worlds/drafts/${id}/playtest`, 'POST', {seeds: 4});
    assert.equal(sim.status, 200, JSON.stringify(sim.body)); assert.equal(sim.body.seeds, 4);
    assert.ok(sim.body.checks.some((c: any) => c.id === 'G3') && sim.body.checks.some((c: any) => c.id === 'G1'), 'lint rows merged');
    assert.equal((await s.request(`/api/worlds/drafts/${id}/playtest`, 'POST', {seeds: 9999})).status, 400);
    const stored = await s.request(`/api/worlds/drafts/${id}/preflight`);
    assert.equal(stored.body.lint.errors, 0); assert.equal(stored.body.playtest.seeds, 4); assert.deepEqual(stored.body.stale, {lint: false, playtest: false});
    await s.request(`/api/worlds/drafts/${id}`, 'PUT', {version: 1, content: s.goldFor()});
    assert.deepEqual((await s.request(`/api/worlds/drafts/${id}/preflight`)).body.stale, {lint: true, playtest: true});
    const published = await s.request(`/api/worlds/drafts/${id}/publish`, 'POST', {version: 2});
    assert.equal(published.status, 200, JSON.stringify(published.body));
    // Story lint over HTTP.
    const story = await s.request('/api/drafts', 'POST', {sourceId: s.sourceId, content: fixture('wudu.story-draft.json')});
    if (story.status === 200) {
      const report = await s.request(`/api/drafts/${story.body.id}/lint`, 'POST', {});
      assert.equal(report.status, 200); assert.ok(report.body.errors > 0); assert.equal(report.body.blocking, false);
    }
  } finally { await s.close(); }
});

test('D7: lint errors block publishing an S1 world; legacy worlds are not blocked by lint', async () => {
  const s = await server();
  try {
    const bad = s.goldFor(); bad.storylets![0]!.text = '命运的齿轮开始转动。'; delete bad.storylets![0]!.textVariants;
    const id = (await s.request('/api/worlds/drafts', 'POST', {sourceId: s.sourceId, content: bad})).body.id;
    const res = await s.request(`/api/worlds/drafts/${id}/publish`, 'POST', {version: 1});
    assert.equal(res.status, 400); assert.equal(res.body.error.code, 'LINT_BLOCKED');
    assert.ok(res.body.error.details.lint.errors >= 1);
  } finally { await s.close(); }
});

test('⑦ mock-generated drafts cannot be published outside tests; provenance survives edits', async () => {
  const s = await server({allowMockPublish: false});
  try {
    const content = {...s.goldFor(), provenance: {generator: 'mock', model: 'mock-btg'}};
    const id = (await s.request('/api/worlds/drafts', 'POST', {sourceId: s.sourceId, content})).body.id;
    const { provenance: _drop, ...laundered } = content;
    await s.request(`/api/worlds/drafts/${id}`, 'PUT', {version: 1, content: laundered});
    const res = await s.request(`/api/worlds/drafts/${id}/publish`, 'POST', {version: 2});
    assert.equal(res.status, 403); assert.equal(res.body.error.code, 'MOCK_DRAFT_UNPUBLISHABLE');
    // A byte-identical copy (client drops the stamp) inherits the mark; a different world publishes.
    const copy = await s.request('/api/worlds/drafts', 'POST', {sourceId: s.sourceId, content: laundered});
    assert.equal(copy.body.content.provenance?.copiedFrom, id);
    assert.equal((await s.request(`/api/worlds/drafts/${copy.body.id}/publish`, 'POST', {version: 1})).body.error.code, 'MOCK_DRAFT_UNPUBLISHABLE');
    const spoofed = await s.request('/api/worlds/drafts', 'POST', {sourceId: s.sourceId, content: {...s.goldFor(), title: '寿灯（手写）', provenance: {generator: 'llm'}}});
    assert.equal(spoofed.body.content.provenance, undefined, 'clients cannot claim a non-mock provenance');
    assert.equal((await s.request(`/api/worlds/drafts/${spoofed.body.id}/publish`, 'POST', {version: 1})).status, 200);
  } finally { await s.close(); }
  const t = await server({allowMockPublish: true});
  try {
    const id = (await t.request('/api/worlds/drafts', 'POST', {sourceId: t.sourceId, content: {...t.goldFor(), provenance: {generator: 'mock'}}})).body.id;
    assert.equal((await t.request(`/api/worlds/drafts/${id}/publish`, 'POST', {version: 1})).status, 200);
  } finally { await t.close(); }
});

test('⑦ mock-generated STORY drafts (e.g. 雾渡) cannot be published outside tests; provenance survives edits', async () => {
  const wudu = fixture('wudu.story-draft.json');
  const s = await server({allowMockPublish: false});
  try {
    // The generation runner is the only writer of provenance; HTTP create ignores a client-sent one.
    const mock = s.workbench.games.create({sourceId: s.sourceId, content: wudu, provenance: generationProvenance('mock-btg')});
    assert.equal(mock.provenance?.generator, 'mock');
    const edited = await s.request(`/api/drafts/${mock.id}`, 'PUT', {version: 1, content: {...wudu, title: '雾渡 · 改过一笔'}});
    assert.equal(edited.status, 200, JSON.stringify(edited.body));
    assert.equal(edited.body.provenance?.generator, 'mock');
    const res = await s.request(`/api/drafts/${mock.id}/publish`, 'POST', {version: 2});
    assert.equal(res.status, 403); assert.equal(res.body.error.code, 'MOCK_DRAFT_UNPUBLISHABLE');
    // A client cannot claim a provenance; a copy of the ORIGINAL mock content inherits the mock mark (S1 ⑦ c).
    const original = s.workbench.games.create({sourceId: s.sourceId, content: wudu, provenance: generationProvenance('mock-btg')});
    const spoof = await s.request('/api/drafts', 'POST', {sourceId: s.sourceId, content: wudu, provenance: {generator: 'llm'}});
    assert.deepEqual(spoof.body.provenance, {generator: 'mock', model: 'mock-btg', source: 'copy', copiedFrom: original.id});
    assert.equal((await s.request(`/api/drafts/${spoof.body.id}/publish`, 'POST', {version: 1})).body.error.code, 'MOCK_DRAFT_UNPUBLISHABLE');
    const real = s.workbench.games.create({sourceId: s.sourceId, content: wudu, provenance: generationProvenance('deepseek-chat')});
    assert.equal((await s.request(`/api/drafts/${real.id}/publish`, 'POST', {version: 1})).status, 200);
  } finally { await s.close(); }
  const t = await server({allowMockPublish: true});
  try {
    const mock = t.workbench.games.create({sourceId: t.sourceId, content: wudu, provenance: generationProvenance('mock')});
    assert.equal((await t.request(`/api/drafts/${mock.id}/publish`, 'POST', {version: 1})).status, 200);
  } finally { await t.close(); }
});

/** A legacy store as it looked before S1 ⑦: 雾渡 story draft without provenance + its generation job (no model) + worker logs. */
function legacyStore(model: string | null) {
  return (db: ReturnType<typeof openDatabase>, dir: string) => {
    const wb = createWorkbench(db, createModelSettings(db, dir, {baseUrl: 'https://api.example.test/v1', model: '', apiKey: '', timeoutMs: 90000}), undefined, {allowMockPublish: true, dataDir: dir});
    const source = wb.sources.importFile({title: '雾渡', filename: 'wudu.txt', bytes: Buffer.from('第一章 雾渡\n渡口的小船漏了水。')});
    db.prepare('INSERT INTO game_drafts(id,source_id,version,data,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(LEGACY_ID, source.id, 1,
      JSON.stringify({id: LEGACY_ID, sourceId: source.id, content: fixture('wudu.story-draft.json'), version: 1, createdAt: '2026-10-27T04:16:17.265Z', updatedAt: '2026-10-27T04:16:17.265Z'}),
      '2026-10-27T04:16:17.265Z', '2026-10-27T04:16:17.265Z');
    const job = {id: LEGACY_JOB, requestId: 'r-legacy', sourceId: source.id, direction: '', mode: 'story', status: 'succeeded', stage: '草稿已生成', progress: 1,
      completedChunks: 1, totalChunks: 1, error: null, draftId: LEGACY_ID, analysis: null, checkpoints: [], createdAt: '2026-10-27T04:16:17.000Z', updatedAt: '2026-10-27T04:16:17.265Z'};
    db.prepare('INSERT INTO generation_jobs(id,request_id,fingerprint,status,payload) VALUES(?,?,?,?,?)').run(LEGACY_JOB, 'r-legacy', '{}', 'succeeded', JSON.stringify(job));
    if (model === null) return;
    mkdirSync(path.join(dir, 'logs'), {recursive: true});
    const line = (t: string, event: string, extra: object) => JSON.stringify({timestamp: `2026-10-27T04:16:${t}Z`, level: 'info', component: 'worker', event, pid: 105234, ...extra});
    writeFileSync(path.join(dir, 'logs', 'worker-2026-10-27.jsonl'), [
      line('10.000', 'model.request.started', {operation: 'analyze', model: 'deepseek-other-job', attempt: 1}), // earlier job, same pid: outside the window
      line('17.222', 'generation.started', {jobId: LEGACY_JOB}),
      line('17.224', 'model.request.started', {operation: 'analyze', model, attempt: 1}),
      line('17.258', 'model.request.completed', {operation: 'generate', model, attempt: 1}),
      line('17.265', 'generation.succeeded', {jobId: LEGACY_JOB}),
    ].join('\n') + '\n');
  };
}
const LEGACY_ID = '602c915c-1be9-41c4-9cc6-dfc6a43a684f'; const LEGACY_JOB = '6c73aeb1-b77b-4869-abfd-05d185aa0a5b';

test('⑦ legacy 雾渡 without a mark: startup backfill traces mock-btg from the run logs; publish and copies are refused; idempotent', async () => {
  const s = await server({allowMockPublish: false, before: legacyStore('mock-btg')});
  try {
    assert.deepEqual(s.workbench.provenanceBackfill.stories.map(x => x.id), [LEGACY_ID]);
    const legacy = (await s.request(`/api/drafts/${LEGACY_ID}`)).body;
    assert.deepEqual(legacy.provenance, {generator: 'mock', model: 'mock-btg', source: 'backfill'});
    assert.equal(legacy.version, 1, 'backfill does not bump the draft version');
    const res = await s.request(`/api/drafts/${LEGACY_ID}/publish`, 'POST', {version: 1});
    assert.equal(res.status, 403); assert.equal(res.body.error.code, 'MOCK_DRAFT_UNPUBLISHABLE');
    const copy = await s.request('/api/drafts', 'POST', {sourceId: legacy.sourceId, content: legacy.content});
    assert.equal(copy.body.provenance?.copiedFrom, LEGACY_ID);
    assert.equal((await s.request(`/api/drafts/${copy.body.id}/publish`, 'POST', {version: 1})).body.error.code, 'MOCK_DRAFT_UNPUBLISHABLE');
    assert.deepEqual(s.workbench.backfillProvenance(), {stories: [], worlds: []}, 'second run is a no-op');
  } finally { await s.close(); }
});

test('⑦ legacy story traced to a real model is left untouched and publishes; untraced + template sentences → LINT_BLOCKED', async () => {
  const real = await server({allowMockPublish: false, before: legacyStore('deepseek-v4-flash-0731')});
  try {
    assert.deepEqual(real.workbench.provenanceBackfill.stories, []);
    assert.equal((await real.request(`/api/drafts/${LEGACY_ID}`)).body.provenance, undefined, 'non-mock draft not modified');
    assert.equal((await real.request(`/api/drafts/${LEGACY_ID}/publish`, 'POST', {version: 1})).status, 200);
  } finally { await real.close(); }
  const untraced = await server({allowMockPublish: false, before: legacyStore(null)});
  try {
    assert.deepEqual(untraced.workbench.provenanceBackfill.stories, []);
    const res = await untraced.request(`/api/drafts/${LEGACY_ID}/publish`, 'POST', {version: 1});
    assert.equal(res.status, 400); assert.equal(res.body.error.code, 'LINT_BLOCKED');
    assert.equal(res.body.error.details.reason, 'UNTRACED_TEMPLATE_TEXT');
    assert.ok(res.body.error.details.lint.issues.every((i: any) => i.ruleId === 'text.banned-phrase'));
    // A hand-written draft with no template sentences still publishes without provenance.
    const clean = (await untraced.request('/api/drafts', 'POST', {sourceId: untraced.sourceId, content: cleanStory()})).body;
    assert.equal((await untraced.request(`/api/drafts/${clean.id}/publish`, 'POST', {version: 1})).status, 200);
  } finally { await untraced.close(); }
});
function cleanStory() {
  const w = gameContentSchema.parse(fixture('wudu.story-draft.json'));
  const scrub = (t: string) => t.replace(/气氛紧绷|每个选择都有代价|你来到「|结局将近|命运的齿轮/g, '');
  return JSON.parse(JSON.stringify(w), (_k, v) => typeof v === 'string' ? scrub(v) : v);
}

test('MCP: lint_world_draft / playtest_world_draft / get_world_preflight are exposed as tools', async () => {
  const s = await server();
  const client = new Client({name: 's1-preflight', version: '1.0.0'});
  const transport = new StreamableHTTPClientTransport(new URL(s.url + '/mcp'), {requestInit: {headers: {Authorization: `Bearer ${s.token}`}}});
  try {
    await client.connect(transport);
    const names = (await client.listTools()).tools.map(t => t.name);
    for (const n of ['lint_world_draft', 'playtest_world_draft', 'get_world_preflight', 'lint_draft']) assert.ok(names.includes(n), n);
    const id = (await s.request('/api/worlds/drafts', 'POST', {sourceId: s.sourceId, content: s.goldFor()})).body.id;
    const lint = await client.callTool({name: 'lint_world_draft', arguments: {id}});
    assert.equal(lint.isError, undefined); assert.equal((lint.structuredContent as any).result.errors, 0);
    const sim = await client.callTool({name: 'playtest_world_draft', arguments: {id, seeds: 2, strategies: ['random', 'lazy']}});
    assert.equal(sim.isError, undefined);
    assert.deepEqual((sim.structuredContent as any).result.strategies.map((x: any) => x.id), ['random', 'lazy']);
    const got = await client.callTool({name: 'get_world_preflight', arguments: {id}});
    assert.equal((got.structuredContent as any).result.playtest.seeds, 2);
  } finally { await client.close().catch(() => {}); await s.close(); }
});
