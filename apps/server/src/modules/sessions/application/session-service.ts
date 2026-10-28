import { randomUUID } from 'node:crypto';
import { actSchema, type ActInput, type SessionView } from '@novel-game/contracts';
import { advanceSession, createSessionState, projectSession } from '@novel-game/play-runtime';
import { AppError } from '../../../shared/errors.js';
import type { SessionRepository, RevisionReader } from './ports.js';

/** Clock + id source (injectable for parity tests; defaults are production). */
export type ServiceRuntimeDeps = { newId?: () => string; now?: () => string };

export class SessionService {
  private readonly newId: () => string;
  private readonly now: () => string;
  constructor(private readonly repository: SessionRepository, private readonly revisionReader: RevisionReader, deps: ServiceRuntimeDeps = {}) {
    this.newId = deps.newId ?? randomUUID;
    this.now = deps.now ?? (() => new Date().toISOString());
  }
  start(input: { gameRevisionId: string }): SessionView {
    const revision = this.revisionReader.getRevision(input.gameRevisionId);
    const state = createSessionState(revision, this.newId(), this.now());
    this.repository.insert(state);
    return projectSession(state, revision);
  }
  get(id: string): SessionView {
    const state = this.repository.get(id);
    if (!state) throw new AppError('SESSION_NOT_FOUND', '存档不存在', 404);
    return projectSession(state, this.revisionReader.getRevision(state.gameRevisionId));
  }
  list(): SessionView[] {
    return this.repository.list().map(state => projectSession(state, this.revisionReader.getRevision(state.gameRevisionId)));
  }
  act(id: string, input: ActInput): SessionView {
    const action = actSchema.parse(input);
    return this.repository.act(id, action, current => {
      const revision = this.revisionReader.getRevision(current.gameRevisionId);
      const state = advanceSession(current, action, revision, this.now());
      return { state, response: projectSession(state, revision) };
    });
  }
}
