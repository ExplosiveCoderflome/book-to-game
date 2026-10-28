import { randomBytes, randomUUID } from 'node:crypto';
import { adventureActSchema, type AdventureActInput, type AdventureView, type BuildingLibrary, type ItemCatalog } from '@novel-game/contracts';
import { advanceAdventure, createAdventureState, projectAdventure } from '@novel-game/play-runtime';
import { AppError } from '../../../shared/errors.js';
import type { AdventureRepository, RevisionReader } from './ports.js';

export type AdventureCatalogReaders = {
  buildingLibrary?: () => BuildingLibrary | undefined;
  itemCatalog?: () => ItemCatalog | undefined;
};

/** Clock + id source (injectable for parity tests; defaults are production). */
export type AdventureRuntimeDeps = { newId?: () => string; now?: () => string; /** S1 RNG seed source (crypto by default). */ newSeed?: () => number };

export class AdventureService {
  private readonly newId: () => string;
  private readonly newSeed: () => number;
  private readonly now: () => string;
  constructor(
    private readonly repository: AdventureRepository,
    private readonly revisionReader: RevisionReader,
    private readonly catalogs: AdventureCatalogReaders = {},
    deps: AdventureRuntimeDeps = {},
  ) {
    this.newId = deps.newId ?? randomUUID;
    this.newSeed = deps.newSeed ?? (() => randomBytes(4).readUInt32LE(0));
    this.now = deps.now ?? (() => new Date().toISOString());
  }

  private catalogOpts() {
    return {
      buildingLibrary: this.catalogs.buildingLibrary?.(),
      itemCatalog: this.catalogs.itemCatalog?.(),
    };
  }

  start(input: { worldRevisionId: string }): AdventureView {
    const revision = this.revisionReader.getRevision(input.worldRevisionId);
    const state = createAdventureState(revision, this.newId(), this.now(), this.catalogOpts(), this.newSeed());
    const response = projectAdventure(state, revision, this.catalogOpts());
    this.repository.insert(state);
    return response;
  }

  get(id: string): AdventureView {
    const state = this.repository.get(id);
    if (!state) throw new AppError('SESSION_NOT_FOUND', '冒险存档不存在', 404);
    return projectAdventure(state, this.revisionReader.getRevision(state.worldRevisionId), this.catalogOpts());
  }

  list(): AdventureView[] {
    return this.repository.list().map(state =>
      projectAdventure(state, this.revisionReader.getRevision(state.worldRevisionId), this.catalogOpts()));
  }

  act(id: string, input: AdventureActInput): AdventureView {
    const action = adventureActSchema.parse(input);
    const opts = this.catalogOpts();
    return this.repository.act(id, action, current => {
      const revision = this.revisionReader.getRevision(current.worldRevisionId);
      const state = advanceAdventure(current, action, revision.content, this.now(), opts);
      return { state, response: projectAdventure(state, revision, opts) };
    });
  }
}
