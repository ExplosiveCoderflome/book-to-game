import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { AgentChatConversation } from '@novel-game/contracts';
import { createWorkbench } from '../src/app/workbench.js';
import { createCommands } from '../src/app/commands/index.js';
import { createAgentChatTools } from '../src/app/agent-chat-tools.js';
import { openDatabase } from '../src/platform/database.js';
import { createModelSettings } from '../src/platform/create-model-settings.js';
import { createApp } from '../src/adapters/http/app.js';
import { SqliteJobRepository } from '../src/modules/generation/index.js';
import { testProductionBrief as brief, testProductionPlan } from './helpers/production-plan.js';

test('agent production: native tools inspect a saved plan, author confirms via HTTP/MCP, worker resumes its first writing checkpoint', async () => {
  const requests: any[] = [];
  let jobId = '';
  const fn = (name: string, args: unknown) => ({id: `call-${requests.length}-${name}`, type: 'function', function: {name, arguments: JSON.stringify(args)}});
  const provider = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const input = JSON.parse(raw); requests.push(input);
    const last = input.messages.at(-1);
    let reply: unknown;
    if (last.role === 'user' && last.content === '审阅已有制作规划，然后开始写作') {
      reply = {content: '先读取当前任务。', tool_calls: [fn('read_job', {id: jobId})]};
    } else if (last.role === 'tool' && last.tool_call_id.endsWith('-read_job')) {
      reply = {content: '审阅人物、路线并检查规则。', tool_calls: [
        fn('read_job', {id: jobId, path: ['productionState', 'plan', 'bible']}),
        fn('read_job', {id: jobId, path: ['productionState', 'plan', 'routes']}),
        fn('check_job_plan', {id: jobId}),
      ].map((c, i) => ({...c, id: `${c.id}-${i}`}))};
    } else if (last.role === 'tool' && last.tool_call_id.includes('-check_job_plan')) {
      const checked = JSON.parse(last.content); assert.equal(checked.report.blocking, false);
      reply = {content: '规则无阻断问题；请确认使用模型生成正文。', tool_calls: [fn('approve_saved_production_plan', {id: jobId, expectedUpdatedAt: checked.updatedAt})]};
    } else reply = {content: '确认回执已保存，正文已排队，完成后再进行体检。'};
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({choices: [{message: reply}]}));
  }).listen(0, '127.0.0.1'); await once(provider, 'listening');
  // Route simulation is synchronous and can exceed Node's default 5s idle socket timeout.
  // Keep this local provider connection alive while the real checker runs in the same process.
  provider.keepAliveTimeout = 120000; provider.headersTimeout = 121000;
  const dir = mkdtempSync(path.join(tmpdir(), 'btg-agent-production-'));
  const db = openDatabase(path.join(dir, 'test.sqlite'));
  const w = createWorkbench(db, createModelSettings(db, dir, {baseUrl: `http://127.0.0.1:${(provider.address() as {port: number}).port}/v1`, model: 'test-agent', apiKey: '', timeoutMs: 30000}), undefined, {dataDir: dir});
  const source = w.sources.importFile({title: '引擎测试资料', filename: 'test.txt', bytes: Buffer.from('第一章\n灯亮了。')});
  const repository = new SqliteJobRepository(db), plan = testProductionPlan(source.chapters.map(c => c.id));
  const ready = () => {
    const job = w.jobs.create({sourceId: source.id, requestId: crypto.randomUUID(), direction: brief.goal, mode: 'open', playerRole: brief.playerRole, productionBrief: brief});
    repository.claim('test-plan-worker', Date.now(), 120000);
    repository.saveChunk(job.id, 'test-plan-worker', 0, {summary: '仅供Agent制作工作流测试的来源分析', characters: [], locations: [], worldRules: [], uncertainties: []});
    repository.saveProductionPlan(job.id, 'test-plan-worker', plan);
    return job.id;
  };
  const server = createApp(w, {token: 'production-test-access', allowedOrigins: []}).listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as {port: number}).port}`;
  const client = new Client({name: 'agent-production-test', version: '1.0'});
  const post = async (url: string, body: unknown) => {
    const response = await fetch(base + url, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
    assert.equal(response.status, 200, await response.clone().text()); return response.json();
  };
  const propose = async () => {
    const c = await post('/api/agent/chats', {}) as AgentChatConversation;
    return await post(`/api/agent/chats/${c.id}/messages`, {requestId: crypto.randomUUID(), text: '审阅已有制作规划，然后开始写作'}) as AgentChatConversation;
  };
  try {
    jobId = ready(); const before = w.jobs.get(jobId);
    const pending = await propose();
    assert.equal(pending.actions.length, 1, JSON.stringify(pending.messages)); assert.equal(pending.actions[0]!.status, 'pending');
    assert.equal(pending.actions[0]!.toolName, 'approve_saved_production_plan');
    assert.match(pending.actions[0]!.summary, /模型产生费用/);
    assert.deepEqual(w.jobs.get(jobId), before, 'review tools and proposal must not queue prose');
    assert.deepEqual(pending.actions[0]!.arguments, {id: jobId, expectedUpdatedAt: before.updatedAt});
    assert.ok(requests[2].messages.some((m: any) => m.role === 'tool' && m.content.includes(plan.bible.premise)));
    const listed = requests[0].tools.map((t: any) => t.function.name);
    assert.ok(listed.includes('read_world_draft')); assert.equal(listed.includes('get_world_draft'), false);
    assert.equal(listed.includes('approve_production_plan'), false, 'no full-world schema in chat approval tools');
    assert.ok(JSON.stringify(requests[0].tools.find((t: any) => t.function.name === 'approve_saved_production_plan')).length < 2000);

    await client.connect(new StreamableHTTPClientTransport(new URL(base + '/mcp'), {requestInit: {headers: {Authorization: 'Bearer production-test-access'}}}));
    const read = await client.callTool({name: 'read_job', arguments: {id: jobId, path: ['productionState', 'plan', 'bible']}});
    assert.equal(read.isError, undefined);
    const done = await post(`/api/agent/chats/${pending.id}/actions/${pending.actions[0]!.id}`, {decision: 'confirm'}) as AgentChatConversation;
    assert.equal(done.actions[0]!.status, 'succeeded'); assert.equal(w.jobs.get(jobId).status, 'queued');
    const count = requests.length;
    await client.callTool({name: 'decide_agent_action', arguments: {id: pending.id, actionId: pending.actions[0]!.id, decision: 'confirm'}});
    assert.equal(requests.length, count); assert.deepEqual(w.jobs.get(jobId).productionState!.plan, plan);

    let writes = 0;
    const runner = w.createRunner({modelName: 'mock-checkpoint',
      analyze: async () => {throw new Error('approved plan must not repeat analysis');},
      planProduction: async () => {throw new Error('approved plan must not be regenerated');},
      writeProductionUnit: async () => {
        if (++writes === 2) throw new Error('test interruption after checkpoint');
        return {texts: ['这是工作流测试的地点正文，用于验证已确认的规划能进入正文生成并保存检查点，不代表真实内容质量。'.repeat(8)], outcomes: {}};
      },
    });
    await runner.runOnce();
    assert.equal(w.jobs.get(jobId).status, 'failed'); assert.equal(writes, 2);
    assert.equal(Object.keys(w.jobs.get(jobId).productionState!.texts).length, 1);
    assert.deepEqual(w.jobs.get(jobId).productionState!.plan, plan);
    assert.equal(w.worlds.list().length, 0, 'interrupted prose must not produce or publish a game');

    jobId = ready(); const stale = await propose(); w.jobs.cancel(jobId);
    const blocked = await post(`/api/agent/chats/${stale.id}/actions/${stale.actions[0]!.id}`, {decision: 'confirm'}) as AgentChatConversation;
    assert.equal(blocked.actions[0]!.status, 'failed'); assert.equal(w.jobs.get(jobId).status, 'cancelled');
    assert.equal(w.jobs.get(jobId).productionState!.approved, false);

    const draft = w.worlds.create({sourceId: source.id, content: plan.world});
    const page = await post(`/api/worlds/drafts/${draft.id}/read`, {path: ['storylets'], limit: 2});
    assert.equal(page.version, 1); assert.equal(page.data.entries.length, 2);
    const exact = await client.callTool({name: 'read_world_draft', arguments: {id: draft.id, path: ['storylets', '0']}});
    assert.equal(exact.isError, undefined);
    const tools = createAgentChatTools(createCommands(w), () => ({summary: ''}));
    const readTool = tools.find(t => t.name === 'read_world_draft')!;
    const exactRead = await readTool.execute(readTool.validate({id: draft.id, path: ['storylets', '0']})) as any;
    assert.deepEqual(exactRead.data.value, draft.content.storylets![0]);
  } finally {
    await client.close(); await new Promise<void>(r => server.close(() => r())); await new Promise<void>(r => provider.close(() => r())); db.close();
    assert.ok(path.resolve(dir).startsWith(path.resolve(tmpdir()) + path.sep + 'btg-agent-production-')); rmSync(dir, {recursive: true, force: true});
  }
});
