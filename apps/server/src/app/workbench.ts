import type Database from 'better-sqlite3';
import { SourceService, SqliteSourceRepository } from '../modules/sources/index.js';
import { GameService, SqliteGameRepository } from '../modules/games/index.js';
import { SessionService, SqliteSessionRepository } from '../modules/sessions/index.js';
import { GenerationRunner, JobService, SqliteJobRepository, type GenerationProvider } from '../modules/generation/index.js';
import { AppError } from '../shared/errors.js';
import type { ModelSettingsInput } from '@novel-game/contracts';
import type { ModelSettingsService } from '../modules/model-settings/index.js';
import { ModelConnectionProbe } from '../platform/model/connection-probe.js';
import { WorldService, SqliteWorldRepository } from '../modules/worlds/index.js';
import { AdventureService, SqliteAdventureRepository } from '../modules/adventure-sessions/index.js';

export function createWorkbench(db: Database.Database, modelSettings: ModelSettingsService) {
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
    if (!validation.valid) throw new AppError('INVALID_GENERATED_GAME', `改编草稿未通过校验：${validation.errors.slice(0, 5).join('；')}。可重试设计步骤。`, 422);
    return draft;
  }, input => {
    const draft = worlds.create(input);
    const validation = worlds.validate(draft.id);
    if (!validation.valid) throw new AppError('INVALID_GENERATED_WORLD', `世界草案未通过校验：${validation.errors.slice(0, 5).join('；')}。可重试设计步骤。`, 422);
    return draft;
  });
  const probe = new ModelConnectionProbe();
  const testModelConnection = (input: ModelSettingsInput) => probe.test(modelSettings.forTest(input));
  return {sources, games, sessions, worlds, adventures, jobs, createRunner, modelSettings, testModelConnection,
    get providerConfigured() {return modelSettings.get().configured;}};
}
export type Workbench = ReturnType<typeof createWorkbench>;
