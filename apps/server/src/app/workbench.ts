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
import { SqliteDecisionRepository } from '../modules/agent/index.js';
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
  return {provenanceBackfill, backfillProvenance, sources, games, sessions, worlds, preflight, adventures, exporter, buildingLibrary, buildingImages, itemCatalog, jobs, agentDecisions, createProductionJob, createRunner, createPlayProvider, modelSettings, testModelConnection, listModels, mediaDir,
    get providerConfigured() {return modelSettings.get().configured;}};
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
