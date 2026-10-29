import type { SqliteDatabase } from '../platform/database.js';
import { SourceService, SqliteSourceRepository } from '../modules/sources/index.js';
import { GameService, SqliteGameRepository } from '../modules/games/index.js';
import { SessionService, SqliteSessionRepository } from '../modules/sessions/index.js';
import { GenerationRunner, JobService, JsonlModelLogReader, ProvenanceTracer, SqliteJobRepository, type GenerationProvider } from '../modules/generation/index.js';
import { AppError } from '../shared/errors.js';
import { productionInputSchema, type ModelListInput, type ModelSettingsInput, type ProductionInput } from '@novel-game/contracts';
import type { ModelSettingsService } from '../modules/model-settings/index.js';
import { BuildingImageService, BuildingLibraryService, SqliteBuildingLibraryRepository, createBuildingImageProvider } from '../modules/building-library/index.js';
import { ItemCatalogService, SqliteItemCatalogRepository } from '../modules/item-catalog/index.js';
import path from 'node:path';
import { ModelConnectionProbe } from '../platform/model/connection-probe.js';
import { WorldService, SqliteWorldRepository } from '../modules/worlds/index.js';
import { PreflightService, SqlitePreflightRepository } from '../modules/preflight/index.js';
import { AdventureService, SqliteAdventureRepository } from '../modules/adventure-sessions/index.js';
import { AgentChatService, AgentRepairService, SqliteChatRepository, SqliteDecisionRepository, SqliteRepairRepository } from '../modules/agent/index.js';
import { AgentChatCompletionsModel } from '../platform/model/agent-chat.js';
import { createAgentChatTools } from './agent-chat-tools.js';
import { createCommands } from './commands/index.js';
import type { Logger } from '../shared/logger.js';
import { ChatCompletionsProvider } from '../platform/model/chat-completions.js';
import { ExportService, FsMediaReader, FsPlayerTemplateReader, FsWindowsPlayerReader } from '../modules/exports/index.js';

export function createWorkbench(db: SqliteDatabase, modelSettings: ModelSettingsService, logger?: Logger, options?: {repairAttempts?: number; dataDir?: string; playerTemplatePath?: string; windowsPlayerPath?: string; exportSecrets?: () => string[]; exportMaxBytes?: number; allowMockPublish?: boolean}) {
  const sources = new SourceService(new SqliteSourceRepository(db));
  const allowMockPublish = options?.allowMockPublish ?? allowMockPublishFromEnv();
  const jobsRepository = new SqliteJobRepository(db);
  const agentDecisions = new SqliteDecisionRepository(db);
  // S1 ⑦: legacy drafts without a stamp are traced from their generation run (job.model, else worker/api logs).
  const tracer = new ProvenanceTracer(jobsRepository, new JsonlModelLogReader(path.join(options?.dataDir ?? 'data', 'logs')));
  const traceProvenance = (draftId: string) => tracer.trace(draftId);
  const games = new GameService(new SqliteGameRepository(db), sources, {allowMockPublish, traceProvenance});
  const sessions = new SessionService(new SqliteSessionRepository(db), games);
  let itemCatalogRef: ItemCatalogService | undefined;
  const buildingLibrary = new BuildingLibraryService(
    new SqliteBuildingLibraryRepository(db),
    () => itemCatalogRef?.itemIds() ?? new Set(),
  );
  const itemCatalog = new ItemCatalogService(new SqliteItemCatalogRepository(db), () => buildingLibrary.get().library.assets);
  itemCatalogRef = itemCatalog;
  const mediaDir = path.join(options?.dataDir ?? 'data', 'building-images');
  const imageProviders = createBuildingImageProvider(process.env);
  const buildingImages = new BuildingImageService(buildingLibrary, imageProviders.provider, mediaDir, imageProviders.svg);
  const worlds = new WorldService(new SqliteWorldRepository(db), sources, () => buildingLibrary.assetIds(), {allowMockPublish, traceProvenance});
  const adventures = new AdventureService(new SqliteAdventureRepository(db), worlds, {
    buildingLibrary: () => buildingLibrary.get().library,
    itemCatalog: () => itemCatalog.get().catalog,
  });
  const preflight = new PreflightService(new SqlitePreflightRepository(db), {world: id => worlds.get(id), story: id => games.get(id)});
  const agentRepairs = new AgentRepairService({worlds, preflight, repository: new SqliteRepairRepository(db),
    atomic: operation => db.transaction(operation).immediate()});
  const jobs = new JobService(jobsRepository, sources, () => modelSettings.get().configured);
  const createProductionJob = (input: ProductionInput) => {
    const data = productionInputSchema.parse(input);
    if (!modelSettings.get().configured) throw new AppError('MODEL_NOT_CONFIGURED', '请先在模型设置中配置生成模型', 503);
    return db.transaction(() => {
      const existing = jobsRepository.findByRequestId(data.requestId);
      const brief = data.brief;
      const sourceId = data.sourceId ?? existing?.sourceId ?? sources.importFile({
        title: brief.title, filename: 'production-brief.txt', encoding: 'utf8',
        bytes: Buffer.from(`${brief.title}\n\n${brief.setting}\n\n玩家身份：${brief.playerRole}\n创作目标：${brief.goal}\n基调：${brief.tone}`, 'utf8'),
      }).id;
      return jobs.create({sourceId, requestId: data.requestId, mode: 'open', playerRole: brief.playerRole,
        canonPolicy: 'faithful', direction: brief.goal, productionBrief: brief});
    }).immediate();
  };
  const createRunner = (provider: GenerationProvider) => new GenerationRunner(jobsRepository, sources, provider, input => {
    const draft = games.create(input);
    const validation = games.validate(draft.id);
    if (!validation.valid) throw validationFailure('INVALID_GENERATED_GAME', '改编草稿未通过校验：', validation.errors);
    return draft;
  }, input => {
    const draft = worlds.create(input, {trusted: true});
    const validation = worlds.validate(draft.id);
    if (!validation.valid) throw validationFailure('INVALID_GENERATED_WORLD', '世界草案未通过校验：', validation.errors);
    return draft;
  }, logger, options?.repairAttempts ?? 3);
  const probe = new ModelConnectionProbe();
  const testModelConnection = (input: ModelSettingsInput) => probe.test(modelSettings.forTest(input));
  const listModels = (input: ModelListInput) => probe.list(modelSettings.forList(input));
  /** Interactive AI (extend/fill/propose/narrate): shared construction for command handlers. */
  const createPlayProvider = () => {
    const endpoint = modelSettings.resolve();
    return new ChatCompletionsProvider({ ...endpoint, maxAttempts: 2, repairAttempts: 2 });
  };
  /** M1b-1: single-file HTML play package. Same engine as /api play; template prebuilt by `npm run build:player`. */
  const exporter = new ExportService({
    getGameRevision: id => games.getRevision(id),
    getWorldRevision: id => worlds.getRevision(id),
    buildingLibrary: () => buildingLibrary.get().library,
    itemCatalog: () => itemCatalog.get().catalog,
  }, new FsMediaReader(options?.dataDir ?? 'data'),
  new FsPlayerTemplateReader(options?.playerTemplatePath ?? process.env.BTG_PLAYER_TEMPLATE ?? path.resolve('apps/web/dist-player/btg-player-template.html')), {
    appVersion: '0.2.0',
    maxBytes: options?.exportMaxBytes,
    secrets: () => {
      const values = [process.env.LLM_API_KEY ?? '', process.env.APP_ACCESS_TOKEN ?? '', ...(options?.exportSecrets?.() ?? [])];
      try { values.push(modelSettings.resolve().apiKey); } catch { /* no key configured / unreadable */ }
      return values;
    },
  },
  // M1b-2: prebuilt Windows player (CI / Windows build); export just appends bytes, no Rust here.
  new FsWindowsPlayerReader(options?.windowsPlayerPath ?? process.env.BTG_WINDOWS_PLAYER ?? path.resolve('dist/player/btg-player-windows-x64.exe')));
  /** S1 ⑦ (a): idempotent startup migration — mark legacy mock drafts (traced or byte-identical copies). Never touches non-mock drafts. */
  const backfillProvenance = () => ({stories: games.backfillMockProvenance(), worlds: worlds.backfillMockProvenance()});
  let provenanceBackfill: ReturnType<typeof backfillProvenance> = {stories: [], worlds: []};
  try {
    provenanceBackfill = backfillProvenance();
    const n = provenanceBackfill.stories.length + provenanceBackfill.worlds.length;
    if (n) logger?.info('provenance.backfill', {stories: provenanceBackfill.stories.map(x => x.id), worlds: provenanceBackfill.worlds.map(x => x.id)});
  } catch (error) { logger?.error?.('provenance.backfill.failed', {message: error instanceof Error ? error.message : String(error)}); }
  const agentChat: AgentChatService = new AgentChatService({repository: new SqliteChatRepository(db),
    redact: text => {
      try {const key = modelSettings.resolve().apiKey; return key ? text.replaceAll(key, '[REDACTED]') : text;}
      catch {return text;}
    },
    model: () => {
      if (!modelSettings.get().configured) throw new AppError('MODEL_NOT_CONFIGURED', '请先在模型设置配置Agent使用的模型', 503);
      return new AgentChatCompletionsModel(modelSettings.resolve());
    },
    tools: () => createAgentChatTools(createCommands(workbench), (name, args) => {
      const labels: Record<string, string> = {retry_job: '恢复生成任务', cancel_job: '取消生成任务', rewrite_production_unit: '重写指定正文',
        edit_world_summary: '修改世界摘要', publish_world_draft: '发布世界版本', publish_draft: '发布分支游戏',
        create_generation_job: '创建改编任务', create_production_job: '创建角色扮演制作任务', apply_agent_repair: '应用修复候选', reject_agent_repair: '驳回修复候选'};
      const label = labels[name] ?? name;
      if (name === 'approve_saved_production_plan') {
        const job = jobs.get(String(args.id));
        if (job.updatedAt !== args.expectedUpdatedAt || job.status !== 'awaiting_review' || !job.productionState || job.productionState.approved) {
          throw new AppError('CHAT_ACTION_STALE', '任务已变化或不在待审阅状态，请重新读取规划', 409);
        }
        const plan = job.productionState.plan;
        return {summary: `确认「${plan.world.title}」当前玩法并开始正文生成：扮演${plan.world.playerRole}；${plan.world.storylets?.length ?? 0}张剧情卡、${plan.world.actions.length}个行动；路线：${plan.routes.map(r => r.name).join('、')}。将使用配置的模型产生费用，不发布游戏。`, guard: job.updatedAt};
      }
      if (['retry_job', 'cancel_job', 'rewrite_production_unit'].includes(name)) {
        const job = jobs.get(String(args.id));
        return {summary: `${label}：任务 ${job.id}（${job.status}，${job.stage}）`, guard: job.updatedAt};
      }
      if (['edit_world_summary', 'publish_world_draft'].includes(name)) {
        const draft = worlds.get(String(args.id));
        const fields: Record<string, string> = {title: '标题', premise: '背景', goal: '目标', adaptationNotes: '改编说明'};
        const changes = Object.entries(args).filter(([key]) => !['id', 'version'].includes(key))
          .map(([key, value]) => `${fields[key] ?? key}: ${JSON.stringify(draft.content[key as keyof typeof draft.content])} → ${JSON.stringify(value)}`).join('；');
        return {summary: `${label}：「${draft.content.title}」v${draft.version}${changes ? `；${changes}` : ''}`, guard: String(draft.version)};
      }
      if (name === 'publish_draft') {const draft = games.get(String(args.id)); return {summary: `发布「${draft.content.title}」v${draft.version}`, guard: String(draft.version)};}
      return {summary: `${label}：${JSON.stringify(args).slice(0, 1000)}`};
    }),
  });
  const workbench = {provenanceBackfill, backfillProvenance, sources, games, sessions, worlds, preflight, adventures, exporter, buildingLibrary, buildingImages, itemCatalog, jobs, agentDecisions, agentRepairs, agentChat, createProductionJob, createRunner, createPlayProvider, modelSettings, testModelConnection, listModels, mediaDir,
    get providerConfigured() {return modelSettings.get().configured;}};
  return workbench;
}
export type Workbench = ReturnType<typeof createWorkbench>;

function validationFailure(code: string, prefix: string, errors: string[]): AppError {
  const issues = errors.slice(0, 8).map(message => ({path: validationPath(message), message}));
  return new AppError(code, `${prefix}${errors.slice(0, 5).join('；')}。可重试设计步骤。`, 422, {path: issues[0]?.path, issues});
}
function validationPath(message: string): string {
  const unreachable = message.match(/场景不可达：(\S+)/);
  if (unreachable) return `scenes.${unreachable[1]}`;
  const target = message.match(/选择目标不存在：(\S+)/);
  if (target) return `choices.targetSceneId.${target[1]}`;
  const evidence = message.match(/证据不存在：(\S+)/);
  if (evidence) return `evidence.${evidence[1]}`;
  const scene = message.match(/场景 ([^\s：]+)/);
  if (scene) return `scenes.${scene[1]}`;
  return 'content';
}

/** S1 ⑦: tests (vitest / NODE_ENV=test) and explicit e2e fixtures (BTG_ALLOW_MOCK_PUBLISH=1) may publish mock drafts. */
function allowMockPublishFromEnv(): boolean {
  return process.env.NODE_ENV === 'test' || !!process.env.VITEST || !!process.env.NODE_TEST_CONTEXT || process.env.BTG_ALLOW_MOCK_PUBLISH === '1';
}
