import type { ActInput, GameRevision, SessionView } from '@novel-game/contracts';
import type { SessionState } from '../domain/session-state.js';

export interface RevisionReader { getRevision(id: string): GameRevision }
export interface SessionRepository {
  insert(state: SessionState): void;
  get(id: string): SessionState | undefined;
  list(): SessionState[];
  act(id: string, input: ActInput, transition: (current: SessionState) => { state: SessionState; response: SessionView }): SessionView;
}
