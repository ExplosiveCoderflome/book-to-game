import type { SqliteDatabase } from '../platform/database.js';
import { SourceService, SqliteSourceRepository } from '../modules/sources/index.js';
import { GameService, SqliteGameRepository } from '../modules/games/index.js';
import { SessionService, SqliteSessionRepository } from '../modules/sessions/index.js';
import { GenerationRunner, JobService, SqliteJobRepository, type GenerationProvider } from '../modules/generation/index.js';
import { AppError } from '../shared/errors.js';
import type { ModelListInput, ModelSettingsInput } from '@novel-game/contracts';
import type { ModelSettingsService } from '../modules/model-settings/index.js';
import { ModelConnectionProbe } from '../platform/model/connection-probe.js';
import { WorldService, SqliteWorldRepository } from '../modules/worlds/index.js';
import { AdventureService, SqliteAdventureRepository } from '../modules/adventure-sessions/index.js';
import type { Logger } from '../shared/logger.js';

export function createWorkbench(db: SqliteDatabase, modelSettings: ModelSettingsService, logger?: Logger, options?: {repairAttempts?: number}) {
  const sources = new SourceService(new SqliteSourceRepository(db));
  const games = new GameService(new SqliteGameRepository(db), sources);
  const sessions = new SessionService(new SqliteSessionRepository(db), games);
  const worlds = new WorldService(new SqliteWorldRepository(db), sources);
  const adventures = new AdventureService(new SqliteAdventureRepository(db), worlds);
  const jobsRepository = new SqliteJobRepository(db);
  const jobs = new JobService(jobsRepository, sources, () => modelSettings.get().configured);
  const createRunner = (provider: GenerationProvider) => new GenerationRunner(jobsRepository, sources, provider, input => {
    const draft = games.create(input);
    const validation = games.validate(draft.id);
    if (!validation.valid) throw validationFailure('INVALID_GENERATED_GAME', '改编草稿未通过校验：', validation.errors);
    return draft;
  }, input => {
    const draft = worlds.create(input);
    const validation = worlds.validate(draft.id);
    if (!validation.valid) throw validationFailure('INVALID_GENERATED_WORLD', '世界草案未通过校验：', validation.errors);
    return draft;
  }, logger, options?.repairAttempts ?? 3);
  const probe = new ModelConnectionProbe();
  const testModelConnection = (input: ModelSettingsInput) => probe.test(modelSettings.forTest(input));
  const listModels = (input: ModelListInput) => probe.list(modelSettings.forList(input));
  return {sources, games, sessions, worlds, adventures, jobs, createRunner, modelSettings, testModelConnection, listModels,
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
