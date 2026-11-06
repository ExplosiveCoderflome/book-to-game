import {performance} from 'node:perf_hooks';
import {existsSync, readFileSync, renameSync, writeFileSync} from 'node:fs';
import {ChatCompletionsProvider} from '../apps/server/src/platform/model/chat-completions.js';
import {runStagedProductionPlan, validateStagedProductionPlan, type PlanPart} from '../apps/server/src/modules/generation/index.js';
import {productionBriefSchema, type ProductionPlanningState, type SourceDocument} from '@novel-game/contracts';

const apiKey = process.env.RELAY4_API_KEY?.trim();
if (!apiKey) throw new Error('RELAY4_API_KEY is required');
const checkpointPath = process.env.PLAN_SMOKE_CHECKPOINT || '/workspace/dsh-runs/split-smoke-checkpoint.json';
type PartTiming = {key: string; durationMs: number};
type SmokeCheckpoint = {version: 1; state: ProductionPlanningState; timings: PartTiming[]; elapsedMs: number};
const restored = existsSync(checkpointPath) ? JSON.parse(readFileSync(checkpointPath, 'utf8')) as SmokeCheckpoint : undefined;
if (restored && (restored.version !== 1 || !Array.isArray(restored.state?.completed) || !restored.state.parts || !Array.isArray(restored.timings))) {
  throw new Error('Invalid plan smoke checkpoint');
}
const resumedPartCount = restored?.state.completed.length ?? 0;
const skeletonOnly = process.env.PLAN_SMOKE_SKELETON_ONLY === '1';
if (skeletonOnly && restored?.state.completed.includes('skeleton')) throw new Error('Skeleton-only smoke requires a fresh checkpoint path');
const priorDurationMs = restored?.elapsedMs ?? 0;
const timings: PartTiming[] = restored?.timings ?? [];
let savedState: ProductionPlanningState = restored?.state ?? {completed: [], parts: {}};
const started = performance.now();
const elapsedMs = () => priorDurationMs + Math.round(performance.now() - started);
function persistCheckpoint(): void {
  const temporary = `${checkpointPath}.tmp`;
  writeFileSync(temporary, JSON.stringify({version: 1, state: savedState, timings, elapsedMs: elapsedMs()} satisfies SmokeCheckpoint), {encoding: 'utf8', mode: 0o600});
  renameSync(temporary, checkpointPath);
}
if (resumedPartCount) console.log(JSON.stringify({event: 'plan_checkpoint.resumed', completed: resumedPartCount, priorDurationMs}));
let requestBytes = 0;
const provider = new ChatCompletionsProvider({
  baseUrl: 'https://aihub.top/v1', model: 'gpt-6.1-sol', apiKey,
  timeoutMs: 90_000,
  streamIdleTimeoutMs: Number(process.env.LLM_STREAM_IDLE_TIMEOUT_MS || 120_000),
  streamTotalTimeoutMs: Number(process.env.LLM_STREAM_TOTAL_TIMEOUT_MS || 600_000),
  maxAttempts: 3, repairAttempts: 1,
}, {info(event, fields) {
  if (event === 'model.request.started') {
    requestBytes = Number(fields?.requestBytes || 0);
    console.log(JSON.stringify({event, operation: fields?.operation, requestBytes, streaming: fields?.streaming, timeoutMs: fields?.timeoutMs}));
  }
}, warn(event) {console.log(JSON.stringify({event}));}, error(event, fields) {console.log(JSON.stringify({event, ...fields}));}});
const brief = productionBriefSchema.parse({title: '渡口规划连通性检查', tier: 'S', playerRole: '受托送信的旅人', goal: '在封港前找到安全渡河路线',
  tone: '写实、克制、重视人物抉择', setting: '原创古代渡口，商旅、船户和巡检共同受封港时限影响，彼此立场不同并争夺有限船位。',
  direction: '设计短篇、可执行的多路线冒险，输出完整结构化规划。使用紧凑JSON；正文只写简短写作意图；保持25张卡与必要规则，不添加可选扩展，不输出长篇正文。'});
const chapterId = 'smoke-ferry-c1';
const analysis = {summary: '用于生成规划冒烟的原创渡口背景。', characters: [], locations: [], worldRules: [{text: '模型输出须遵循规划 JSON 结构。', evidence: []}], uncertainties: [],
  coverage: {chapterIds: [chapterId], totalChapters: 1}};
const source: SourceDocument = {id: 'smoke', title: '渡口设定', filename: 'smoke.txt', encoding: 'utf8', chapterCount: 1, charCount: 0,
  createdAt: new Date().toISOString(), chapters: [{id: chapterId, index: 0, title: '渡口', paragraphs: []}]};
let state: ProductionPlanningState | null | undefined;
try {
  state = await runStagedProductionPlan({analysis: analysis as any, brief, chapterIds: [chapterId], source, state: restored?.state,
    batchSize: Number(process.env.PRODUCTION_PLAN_BATCH_SIZE) || 4,
    signal: AbortSignal.timeout(3_600_000), save(next) {
      savedState = structuredClone(next);
      persistCheckpoint();
      console.log(JSON.stringify({event: 'plan_checkpoint.saved', completed: savedState.completed.length, hasPlan: Boolean(savedState.plan), elapsedMs: elapsedMs()}));
      return !skeletonOnly;
    }, async write(part: PlanPart, feedback) {
      const at = performance.now();
      const value = await provider.planProductionPart!(analysis as any, brief, [chapterId], part, AbortSignal.timeout(600_000), feedback);
      const durationMs = Math.round(performance.now() - at); timings.push({key: part.key, durationMs});
      console.log(JSON.stringify({event: 'plan_part.completed', key: part.key, durationMs}));
      return value;
    }});
} catch (error) {
  persistCheckpoint();
  const e = error as {code?: string; message?: string; details?: {path?: string}};
  console.error(JSON.stringify({ok: false, code: e.code ?? 'PLAN_FAILED', path: e.details?.path, completed: savedState.completed.length,
    elapsedMs: elapsedMs(), message: e.message?.slice(0, 500)}));
  process.exitCode = 1;
}
if (process.exitCode) process.exit();
if (skeletonOnly) {
  if (!savedState.skeleton || savedState.completed.length !== 1) throw new Error('skeleton smoke did not checkpoint');
  console.log(JSON.stringify({ok: true, operation: 'plan_production_skeleton', provider: 'aihub/RELAY4', model: 'gpt-6.1-sol', durationMs: elapsedMs(),
    partCount: 1, callCount: timings.length, resumedPartCount, timings, schemaAndRules: 'skeleton passed'}));
} else {
  if (!state?.plan) throw new Error('staged plan did not complete');
  validateStagedProductionPlan(state.plan, brief, source);
  savedState = state;
  persistCheckpoint();
  const durationMs = elapsedMs();
  console.log(JSON.stringify({ok: true, operation: 'plan_production_staged', provider: 'aihub/RELAY4', model: 'gpt-6.1-sol', durationMs,
    partCount: new Set(timings.map(timing => timing.key)).size, callCount: timings.length, resumedPartCount, timings,
    routeCount: state.plan.routes.length, locationCount: state.plan.world.locations.length,
    actionCount: state.plan.world.actions.length, schemaAndRules: 'passed'}));
}
