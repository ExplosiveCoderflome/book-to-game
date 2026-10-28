import {
  actSchema, adventureActSchema,
  type ActInput, type AdventureActInput, type AdventureView, type GameRevision, type SessionView, type WorldRevision,
} from '@novel-game/contracts';
import { AppError } from '../errors.js';
import { RUNTIME_VERSION } from '../version.js';
import type { SessionState } from '../story/session-state.js';
import { advanceSession } from '../story/advance-session.js';
import { projectSession } from '../story/project-session.js';
import { createSessionState } from '../story/start-session.js';
import type { AdventureState } from '../adventure/adventure-state.js';
import { advanceAdventure, type AdvanceAdventureOptions } from '../adventure/advance-adventure.js';
import { projectAdventure } from '../adventure/project-adventure.js';
import { createAdventureState } from '../adventure/start-adventure.js';
import type { PackageCatalogSnapshot } from '../package/format.js';
import type { SaveStore } from './save-store.js';
import {
  SAVE_EVENT_LIMIT, SAVE_FORMAT_VERSION, classifySave,
  type SaveRecord, type SaveSlot,
} from './save-record.js';

/** Same verbs as the HTTP port (slice §5.6) so player pages do not care where play runs. */
export interface PlayPort<R, V, A> {
  listRevisions(): R[];
  start(revisionId: string): V;
  list(): V[];
  get(id: string): V;
  act(id: string, input: A): V;
}

export interface LocalPlayPort<R, V, A> extends PlayPort<R, V, A> {
  /** All saves in this package partition, including greyed (old / corrupt) ones. Newest first. */
  slots(): SaveSlot<V>[];
}

export type LocalPortDeps = {
  packageId: string;
  store: SaveStore;
  newId: () => string;
  /** S1 RNG seed source (package: crypto.getRandomValues). Absent → derived from the save id. */
  newSeed?: () => number;
  now?: () => string;
  eventLimit?: number;
  runtimeVersion?: string;
  /** Optional: lets a guarded store report "only in memory" per save. */
  isUnsaved?: (id: string) => boolean;
};

type EngineState = SessionState | AdventureState;

/**
 * Local repository with the SAME semantics as the SQLite repositories:
 * replay by requestId (REQUEST_ID_CONFLICT on different input), SESSION_TURN_CONFLICT on stale expectedTurn.
 */
class LocalRepository<S extends EngineState, V> {
  constructor(private readonly deps: LocalPortDeps, private readonly revisionId: string) {}

  private expected() {
    return { packageId: this.deps.packageId, revisionId: this.revisionId, runtimeVersion: this.deps.runtimeVersion ?? RUNTIME_VERSION };
  }

  insert(state: S): void {
    const record: SaveRecord<S> = {
      saveFormatVersion: SAVE_FORMAT_VERSION, packageId: this.deps.packageId, revisionId: this.revisionId,
      runtimeVersion: this.deps.runtimeVersion ?? RUNTIME_VERSION, state, events: [],
    };
    this.deps.store.write(state.id, JSON.stringify(record));
  }

  record(id: string): SaveRecord<S> {
    const raw = this.deps.store.read(id);
    if (raw === null) throw new AppError('SESSION_NOT_FOUND', '存档不存在', 404);
    const classified = classifySave<S & { createdAt: string; updatedAt: string }>(raw, this.expected());
    if (!classified.ok) {
      throw classified.blockedReason === 'old-version'
        ? new AppError('SAVE_INCOMPATIBLE', '存档来自旧版本，无法继续', 409, { saveId: id })
        : new AppError('SAVE_CORRUPT', '存档已损坏，无法继续', 409, { saveId: id });
    }
    return classified.record as SaveRecord<S>;
  }

  get(id: string): S | undefined {
    try { return this.record(id).state; } catch (error) {
      if (error instanceof AppError && error.code === 'SESSION_NOT_FOUND') return undefined;
      throw error;
    }
  }

  slots(project: (state: S) => V): SaveSlot<V>[] {
    const out: SaveSlot<V>[] = [];
    for (const id of this.deps.store.list()) {
      const classified = classifySave<S & { createdAt: string; updatedAt: string }>(this.deps.store.read(id), this.expected());
      const unsaved = this.deps.isUnsaved?.(id) ?? false;
      if (classified.ok) {
        const state = classified.record.state as S;
        try {
          out.push({ id, status: 'ok', view: project(state), createdAt: state.createdAt, updatedAt: state.updatedAt, turn: state.turn, unsaved });
        } catch {
          out.push({ id, status: 'blocked', blockedReason: 'corrupt', createdAt: state.createdAt, updatedAt: state.updatedAt, turn: state.turn, unsaved });
        }
      } else {
        out.push({ id, status: 'blocked', blockedReason: classified.blockedReason, createdAt: classified.createdAt, updatedAt: classified.updatedAt, turn: classified.turn, unsaved });
      }
    }
    // Same order as the SQLite list: updated_at DESC, id.
    return out.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '') || a.id.localeCompare(b.id));
  }

  act(id: string, requestId: string, canonical: string, expectedTurn: number, transition: (current: S) => { state: S; response: V }): V {
    const record = this.record(id);
    const replay = record.events.find(event => event.requestId === requestId);
    if (replay) {
      if (replay.input !== canonical) throw new AppError('REQUEST_ID_CONFLICT', '同一请求 ID 不能用于不同的行动', 409);
      return replay.response as V;
    }
    const { state, response } = transition(record.state);
    if (record.state.turn !== expectedTurn) throw new AppError('SESSION_TURN_CONFLICT', '存档已推进，请刷新后再行动', 409);
    const limit = this.deps.eventLimit ?? SAVE_EVENT_LIMIT;
    const events = [...record.events, { requestId, turn: state.turn, input: canonical, response }].slice(-limit);
    this.deps.store.write(id, JSON.stringify({ ...record, state, events }));
    return response;
  }
}

const isoNow = () => new Date().toISOString();

export type LocalStoryPort = LocalPlayPort<GameRevision, SessionView, ActInput>;
export type LocalAdventurePort = LocalPlayPort<WorldRevision, AdventureView, AdventureActInput>;

function requireRevision(revisionId: string, current: { id: string }) {
  if (revisionId !== current.id) throw new AppError('REVISION_NOT_FOUND', '版本不存在', 404);
}

export function createLocalStoryPort(revision: GameRevision, deps: LocalPortDeps): LocalStoryPort {
  const repo = new LocalRepository<SessionState, SessionView>(deps, revision.id);
  const now = deps.now ?? isoNow;
  const project = (state: SessionState) => projectSession(state, revision);
  return {
    listRevisions: () => [revision],
    start(revisionId) {
      requireRevision(revisionId, revision);
      const state = createSessionState(revision, deps.newId(), now());
      repo.insert(state);
      return project(state);
    },
    list: () => repo.slots(project).flatMap(slot => slot.status === 'ok' ? [slot.view] : []),
    slots: () => repo.slots(project),
    get(id) {
      const state = repo.get(id);
      if (!state) throw new AppError('SESSION_NOT_FOUND', '存档不存在', 404);
      return project(state);
    },
    act(id, raw) {
      const input = actSchema.parse(raw);
      const canonical = JSON.stringify({ choiceId: input.choiceId, expectedTurn: input.expectedTurn });
      return repo.act(id, input.requestId, canonical, input.expectedTurn, current => {
        const state = advanceSession(current, input, revision, now());
        return { state, response: project(state) };
      });
    },
  };
}

export function createLocalAdventurePort(
  revision: WorldRevision,
  catalogSnapshot: PackageCatalogSnapshot | undefined,
  deps: LocalPortDeps,
): LocalAdventurePort {
  const repo = new LocalRepository<AdventureState, AdventureView>(deps, revision.id);
  const now = deps.now ?? isoNow;
  const opts: AdvanceAdventureOptions = {
    buildingLibrary: catalogSnapshot?.buildingLibrary,
    itemCatalog: catalogSnapshot?.itemCatalog,
  };
  const project = (state: AdventureState) => projectAdventure(state, revision, opts);
  return {
    listRevisions: () => [revision],
    start(revisionId) {
      requireRevision(revisionId, revision);
      const state = createAdventureState(revision, deps.newId(), now(), opts, deps.newSeed?.());
      const response = project(state);
      repo.insert(state);
      return response;
    },
    list: () => repo.slots(project).flatMap(slot => slot.status === 'ok' ? [slot.view] : []),
    slots: () => repo.slots(project),
    get(id) {
      const state = repo.get(id);
      if (!state) throw new AppError('SESSION_NOT_FOUND', '冒险存档不存在', 404);
      return project(state);
    },
    act(id, raw) {
      const input = adventureActSchema.parse(raw);
      const canonical = JSON.stringify({ actionId: input.actionId, expectedTurn: input.expectedTurn });
      return repo.act(id, input.requestId, canonical, input.expectedTurn, current => {
        const state = advanceAdventure(current, input, revision.content, now(), opts);
        return { state, response: project(state) };
      });
    },
  };
}
