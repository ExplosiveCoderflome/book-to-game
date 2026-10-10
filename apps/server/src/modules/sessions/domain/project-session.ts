import type { GameRevision, Scene, SessionView } from '@novel-game/contracts';
import { AppError } from '../../../shared/errors.js';
import type { SessionState } from './session-state.js';

export function findScene(revision: GameRevision, sceneId: string): Scene {
  const scene = revision.content.scenes.find(scene => scene.id === sceneId);
  if (!scene) throw new AppError('INVALID_SESSION_STATE', '存档对应的场景不存在', 500);
  return scene;
}

export function projectSession(state: SessionState, revision: GameRevision): SessionView {
  const scene = findScene(revision, state.sceneId);
  return {
    id: state.id, gameRevisionId: state.gameRevisionId, turn: state.turn, ended: state.ended,
    scene: { id: scene.id, title: scene.title, text: scene.text,
      ...(scene.ending === undefined ? {} : { ending: scene.ending }),
      choices: scene.choices.map(choice => ({ id: choice.id, label: choice.label })) },
    history: state.history.map(entry => ({ ...entry })), createdAt: state.createdAt, updatedAt: state.updatedAt,
  };
}
