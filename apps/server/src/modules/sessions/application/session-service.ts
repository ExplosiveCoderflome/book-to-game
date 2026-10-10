import { randomUUID } from 'node:crypto';
import { actSchema, type ActInput, type SessionView } from '@novel-game/contracts';
import { AppError } from '../../../shared/errors.js';
import { findScene, projectSession } from '../domain/project-session.js';
import { advanceSession } from '../domain/advance-session.js';
import type { SessionState } from '../domain/session-state.js';
import type { SessionRepository, RevisionReader } from './ports.js';

export class SessionService {
  constructor(private readonly repository: SessionRepository, private readonly revisionReader: RevisionReader) {}
  start(input: { gameRevisionId: string }): SessionView {
    const revision = this.revisionReader.getRevision(input.gameRevisionId);
    const scene = findScene(revision, revision.content.startSceneId);
    const now = new Date().toISOString();
    const state: SessionState = { id: randomUUID(), gameRevisionId: revision.id, sceneId: scene.id, turn: 0,
      ended: scene.ending !== undefined, history: [{ turn: 0, sceneId: scene.id, text: scene.text }], createdAt: now, updatedAt: now };
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
      const state = advanceSession(current, action, revision, new Date().toISOString());
      return { state, response: projectSession(state, revision) };
    });
  }
}
