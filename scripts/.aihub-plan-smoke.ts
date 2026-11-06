import {performance} from 'node:perf_hooks';
import {ChatCompletionsProvider} from '../apps/server/src/platform/model/chat-completions.js';

const apiKey = process.env.RELAY3_API_KEY?.trim();
if (!apiKey) throw new Error('RELAY3_API_KEY is required');
const provider = new ChatCompletionsProvider({
  baseUrl: 'https://aihub.top/v1', model: 'gpt-6-astra', apiKey,
  timeoutMs: 90_000,
  streamIdleTimeoutMs: Number(process.env.LLM_STREAM_IDLE_TIMEOUT_MS || 30_000),
  streamTotalTimeoutMs: Number(process.env.LLM_STREAM_TOTAL_TIMEOUT_MS || 600_000),
  maxAttempts: 1, repairAttempts: 1,
});
const started = performance.now();
const brief = {title: '渡口规划连通性检查', tier: 'S' as const, playerRole: '受托送信的旅人', goal: '在封港前找到安全渡河路线',
  tone: '写实、克制、重视人物抉择', setting: '原创古代渡口；商旅、船户和巡检共同受封港时限影响。', direction: '设计短篇、可执行的多路线冒险，输出完整结构化规划。'};
const analysis = {summary: '用于生成规划冒烟的原创渡口背景。', characters: [], locations: [], worldRules: [{text: '模型输出须遵循规划 JSON 结构。', evidence: []}], uncertainties: [],
  coverage: {chapterIds: [], totalChapters: 0}};
const plan = await provider.planProduction(analysis, brief, [], AbortSignal.timeout(660_000));
const durationMs = Math.round(performance.now() - started);
console.log(JSON.stringify({ok: true, operation: 'plan_production', model: 'gpt-6-astra', durationMs,
  routeCount: plan.routes.length, locationCount: plan.world.locations.length, actionCount: plan.world.actions.length}));
