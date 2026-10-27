import { randomUUID } from 'node:crypto';
import { adventureActSchema, type AdventureActInput, type AdventureView } from '@novel-game/contracts';
import { AppError } from '../../../shared/errors.js';
import type { AdventureState } from '../domain/adventure-state.js';
import { advanceAdventure } from '../domain/advance-adventure.js';
import { projectAdventure } from '../domain/project-adventure.js';
import { settle } from '../domain/rules.js';
import type { AdventureRepository, RevisionReader } from './ports.js';
export class AdventureService {
  constructor(private readonly repository: AdventureRepository, private readonly revisionReader: RevisionReader) {}
  start(input: {worldRevisionId: string}): AdventureView {
    const revision = this.revisionReader.getRevision(input.worldRevisionId); const world = revision.content; const now = new Date().toISOString();
    const state: AdventureState = {schemaVersion: 1, id: randomUUID(), worldRevisionId: revision.id,
      turn: 0, elapsed: 0, locationId: world.initialLocationId,
      facts: Object.fromEntries(world.facts.map(fact => [fact.id, fact.initialValue])),
      knownFactIds: world.facts.filter(fact => fact.playerKnown).map(fact => fact.id),
      resources: { ...(world.resources ?? {}) },
      takenTags: [],
      npcs: Object.fromEntries(world.npcs.map(npc => [npc.id, {locationId: npc.initialLocationId, knownFactIds: [...npc.knownFactIds]}])),
      performedActionIds: [], triggeredEventIds: [], history: [], createdAt: now, updatedAt: now};
    const publicEvents = settle(world, state);
    const location = world.locations.find(item => item.id === state.locationId);
    if (!location) throw new AppError('INVALID_WORLD_STATE', '世界开局地点不存在', 500);
    state.history.push({turn: 0, elapsed: 0, text: [location.text, ...publicEvents].join('\n')});
    const response = projectAdventure(state, revision); this.repository.insert(state); return response;
  }
  get(id: string): AdventureView {
    const state = this.repository.get(id); if (!state) throw new AppError('SESSION_NOT_FOUND', '冒险存档不存在', 404);
    return projectAdventure(state, this.revisionReader.getRevision(state.worldRevisionId));
  }
  list(): AdventureView[] {return this.repository.list().map(state => projectAdventure(state, this.revisionReader.getRevision(state.worldRevisionId)));}
  act(id: string, input: AdventureActInput): AdventureView {
    const action = adventureActSchema.parse(input);
    return this.repository.act(id, action, current => {
      const revision = this.revisionReader.getRevision(current.worldRevisionId);
      const state = advanceAdventure(current, action, revision.content, new Date().toISOString());
      return {state, response: projectAdventure(state, revision)};
    });
  }
}
