import type { GameRevision } from '@novel-game/contracts';
import { findScene } from './project-session.js';
import type { SessionState } from './session-state.js';

/** Fresh story save pinned to a revision (pure; caller supplies id + clock). */
export function createSessionState(revision: GameRevision, id: string, now: string): SessionState {
  const scene = findScene(revision, revision.content.startSceneId);
  return { id, gameRevisionId: revision.id, sceneId: scene.id, turn: 0,
    ended: scene.ending !== undefined, variables: {...revision.content.variables ?? {}},
    history: [{ turn: 0, sceneId: scene.id, text: scene.text }], createdAt: now, updatedAt: now };
}
