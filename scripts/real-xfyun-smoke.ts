import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { ferryWorld } from '../examples/ferry-world.js';
import { createWorkbench } from '../apps/server/src/app/workbench.js';
import { createModelSettings } from '../apps/server/src/platform/create-model-settings.js';
import { XFYUN_BASE_URL, XFYUN_MODEL } from '../apps/server/src/platform/config.js';
import { openDatabase } from '../apps/server/src/platform/database.js';
import { ChatCompletionsProvider, type ModelConfig } from '../apps/server/src/platform/model/chat-completions.js';

const apiKey = process.env.XFYUN_API_KEY?.trim() ?? '';
if (!apiKey) throw new Error('请先通过 XFYUN_API_KEY 提供讯飞 Key；不要写入文件。');
const runs = integerEnv('XFYUN_SMOKE_RUNS', 5, 1, 20);
const timeoutMs = integerEnv('XFYUN_SMOKE_TIMEOUT_MS', 120_000, 1_000, 300_000);
const config: ModelConfig = {baseUrl: XFYUN_BASE_URL, model: XFYUN_MODEL, apiKey, timeoutMs,
  maxAttempts: 1, repairAttempts: 1};
const provider = new ChatCompletionsProvider(config);

type RunResult<T> = {run: number; durationMs: number; ok: true; value: T}
  | {run: number; durationMs: number; ok: false; error: string};

async function measured<T>(run: number, operation: () => Promise<T>): Promise<RunResult<T>> {
  const started = performance.now();
  try {
    const value = await operation();
    return {run, durationMs: Math.round(performance.now() - started), ok: true, value};
  } catch (error) {
    return {run, durationMs: Math.round(performance.now() - started), ok: false, error: safeError(error)};
  }
}

const npcEnvelope = z.object({choices: z.array(z.object({
  message: z.object({content: z.string().nullable().optional()}),
  finish_reason: z.string().optional(),
})).min(1)});

async function npcDialogue(playerText: string): Promise<string> {
  const response = await fetch(`${XFYUN_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}`},
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({model: XFYUN_MODEL, stream: false, max_tokens: 1000, messages: [
      {role: 'system', content: `你是文字游戏《封港前的渡口》中的船夫，正在渡口与护送证人的抄写员交谈。
小船漏水，只有玩家先找来修船材料并帮忙修船，你才愿意送他们过河。你珍惜旧船，说话朴实、谨慎。
只写船夫亲口说的中文对白，2–4句，不要旁白、选项、JSON或规则说明。不得发明新地点、物品、事实或结局，不得泄露守卫与北城管事的秘密。`},
      {role: 'user', content: `玩家对你说：“${playerText}”\n请以船夫身份回应。`},
    ]}),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`XFYUN HTTP ${response.status}`);
  }
  const data = npcEnvelope.parse(await response.json());
  const text = data.choices[0]!.message.content?.trim();
  if (!text) throw new Error('NPC 响应没有文本内容');
  return text;
}

async function agentEditRun(workbench: ReturnType<typeof createWorkbench>, sourceId: string,
  source: Parameters<typeof ferryWorld>[0], run: number, staleGuard: boolean) {
  const title = `讯飞真实改世界 ${run}`;
  const targetTitle = `${title}·已确认`;
  const content = ferryWorld(source);
  content.title = title;
  const draft = workbench.worlds.create({sourceId, content});
  const chat = workbench.agentChat.create();
  const pending = await workbench.agentChat.send({id: chat.id, requestId: `xfyun-agent-${run}`, text:
    `请先用 list_world_drafts 找到标题完全等于「${title}」的草稿，再用 read_world_draft 读取其摘要和 version。
然后只调用 edit_world_summary，把该草稿标题改为「${targetTitle}」，其余字段不要改。
必须先取得真实 id 和 version；不要使用其他工具，不要调用任何发布操作，也不要代替作者确认。
作者确认后不要再调用工具，只根据工具回执简短总结结果。`});

  const automaticTools: string[] = [];
  for (const message of pending.messages) {
    if (message.role === 'tool' && message.toolName && message.toolName !== 'edit_world_summary' && !automaticTools.includes(message.toolName)) {
      automaticTools.push(message.toolName);
    }
  }
  assert.ok(automaticTools.length >= 1 && automaticTools.length <= 2, `自动工具数量异常：${automaticTools.join(',')}`);
  assert.ok(automaticTools.every(name => name === 'list_world_drafts' || name === 'read_world_draft'),
    `调用了预期外自动工具：${automaticTools.join(',')}`);
  const action = pending.actions.find(item => item.status === 'pending');
  assert.ok(action, '真模型没有生成待确认操作');
  assert.equal(pending.actions.length, 1);
  assert.equal(action.toolName, 'edit_world_summary');
  assert.equal(action.arguments.id, draft.id);
  assert.equal(action.arguments.version, draft.version);
  assert.equal(action.arguments.title, targetTitle);
  assert.equal(action.guard, String(draft.version));
  assert.equal(workbench.worlds.get(draft.id).version, draft.version, '确认前草稿被修改');
  assert.equal(workbench.worlds.get(draft.id).content.title, title, '确认前标题被修改');

  if (staleGuard) {
    const latest = workbench.worlds.get(draft.id);
    workbench.worlds.update(draft.id, {version: latest.version,
      content: {...latest.content, adaptationNotes: `${latest.content.adaptationNotes}\n版本守卫测试。`}});
    const blocked = await workbench.agentChat.decide({id: chat.id, actionId: action.id, decision: 'confirm'});
    const failed = blocked.actions.find(item => item.id === action.id);
    assert.equal(failed?.status, 'failed');
    assert.match(failed?.result ?? '', /CHAT_ACTION_STALE/);
    assert.equal(workbench.worlds.get(draft.id).content.title, title, '过期确认仍然修改了标题');
    return {automaticTools, confirmation: 'stale_blocked' as const, followUpCompleted: true,
      pendingSummary: action.summary, guard: action.guard, worldVersion: workbench.worlds.get(draft.id).version,
      assistantText: assistantText(blocked.messages)};
  }

  const done = await workbench.agentChat.decide({id: chat.id, actionId: action.id, decision: 'confirm'});
  const succeeded = done.actions.find(item => item.id === action.id);
  assert.equal(succeeded?.status, 'succeeded');
  assert.equal(workbench.worlds.get(draft.id).version, draft.version + 1);
  assert.equal(workbench.worlds.get(draft.id).content.title, targetTitle);
  assert.equal(workbench.worlds.listRevisions().length, 0, '改世界不应自动发布');
  return {automaticTools, confirmation: 'succeeded' as const,
    followUpCompleted: !done.messages.some(message => message.role === 'assistant' && message.content.includes('这一轮请求未完成')),
    pendingSummary: action.summary, guard: action.guard, worldVersion: workbench.worlds.get(draft.id).version,
    assistantText: assistantText(done.messages)};
}

function assistantText(messages: Array<{role: string; content: string}>): string[] {
  return messages.filter(message => message.role === 'assistant' && message.content.trim())
    .map(message => message.content).slice(-3);
}

function stats(results: Array<RunResult<unknown>>) {
  const durations = results.map(result => result.durationMs);
  const failures = results.filter(result => !result.ok).length;
  return {runs: results.length, failures, failureRate: Number((failures / results.length).toFixed(3)),
    durationMs: {min: Math.min(...durations), max: Math.max(...durations),
      average: Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length)}};
}

function integerEnv(name: string, fallback: number, min: number, max: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} 必须是 ${min}–${max} 的整数`);
  return value;
}

function safeError(error: unknown): string {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return text.replaceAll(apiKey, '[REDACTED]').slice(0, 800);
}

const dir = mkdtempSync(path.join(tmpdir(), 'xf1-real-smoke-'));
const db = openDatabase(path.join(dir, 'workbench.sqlite'));
const workbench = createWorkbench(db, createModelSettings(db, dir, config), undefined, {dataDir: dir});
const startedAt = new Date().toISOString();
let narrative: Array<RunResult<string>> = [];
let npc: Array<RunResult<string>> = [];
let agent: Array<RunResult<Awaited<ReturnType<typeof agentEditRun>>>> = [];
try {
  const source = workbench.sources.importFile({title: '讯飞渡口原作', filename: 'xfyun-smoke.txt', bytes: Buffer.from(
    '第一章 封港\n天黑前港口将封锁。抄写员必须带着证人抵达对岸，渡口的小船正在漏水。\n船夫珍惜旧船，只有修好船才愿意出航。',
  )});
  const world = ferryWorld(source);
  const dock = world.locations.find(location => location.id === world.initialLocationId)!;
  const choices = world.actions.filter(action => action.locationId === dock.id).map(action => ({id: action.id, label: action.label}));
  const playerQuestions = ['这船还能过河吗？', '我可以先赊账吗？', '为什么一定要修船？', '证人很着急，请你帮帮忙。', '我去哪里找修船材料？'];

  for (let run = 1; run <= runs; run++) {
    const result = await measured(run, () => provider.narrate({sceneTitle: dock.title, sceneText: dock.text,
      choices, variables: {timber: false, trusted: false},
      worldbookSnippets: [{title: '当前目标', content: world.goal, kind: 'rule'}]},
    AbortSignal.timeout(timeoutMs)).then(output => output.narration));
    narrative.push(result);
    console.error(`[xfyun] 旁白 ${run}/${runs}: ${result.ok ? '成功' : '失败'} ${result.durationMs}ms`);
  }
  for (let run = 1; run <= runs; run++) {
    const result = await measured(run, () => npcDialogue(playerQuestions[(run - 1) % playerQuestions.length]!));
    npc.push(result);
    console.error(`[xfyun] NPC ${run}/${runs}: ${result.ok ? '成功' : '失败'} ${result.durationMs}ms`);
  }
  for (let run = 1; run <= runs; run++) {
    const result = await measured(run, () => agentEditRun(workbench, source.id, source, run, run === 1));
    agent.push(result);
    console.error(`[xfyun] Agent ${run}/${runs}: ${result.ok ? '成功' : '失败'} ${result.durationMs}ms`);
  }
} finally {
  db.close();
  assert.ok(path.resolve(dir).startsWith(path.resolve(tmpdir()) + path.sep + 'xf1-real-smoke-'));
  rmSync(dir, {recursive: true, force: true});
}

const results = {model: XFYUN_MODEL, baseUrl: XFYUN_BASE_URL, startedAt, finishedAt: new Date().toISOString(),
  narrative, npc, agent,
  summary: {narrative: stats(narrative), npc: stats(npc), agent: stats(agent),
    agentFollowUpFailures: agent.filter(result => result.ok && !result.value.followUpCompleted).length,
    staleGuardVerified: agent.some(result => result.ok && result.value.confirmation === 'stale_blocked')}};
const serialized = JSON.stringify(results, null, 2);
if (process.env.XFYUN_SMOKE_OUTPUT) writeFileSync(path.resolve(process.env.XFYUN_SMOKE_OUTPUT), `${serialized}\n`, 'utf8');
console.log(serialized);
if ([...narrative, ...npc, ...agent].some(result => !result.ok)) process.exitCode = 1;
