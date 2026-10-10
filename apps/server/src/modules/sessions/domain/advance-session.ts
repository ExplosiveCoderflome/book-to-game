import type { ActInput, GameRevision } from '@novel-game/contracts';
import { AppError } from '../../../shared/errors.js';
import { findScene } from './project-session.js';
import type { SessionState } from './session-state.js';

export function advanceSession(state: SessionState, input: ActInput, revision: GameRevision, now: string): SessionState {
  if (state.turn !== input.expectedTurn) throw new AppError('SESSION_TURN_CONFLICT', '存档已推进，请刷新后再行动', 409);
  if (state.ended) throw new AppError('SESSION_ENDED', '本次游戏已经结束', 409);
  const current = findScene(revision, state.sceneId);
  const choice = current.choices.find(choice => choice.id === input.choiceId);
  if (!choice) throw new AppError('UNKNOWN_CHOICE', '当前场景没有此选项', 400);
  const next = findScene(revision, choice.targetSceneId);
  const turn = state.turn + 1;
  return { ...state, sceneId: next.id, turn, ended: next.ending !== undefined, updatedAt: now,
    history: [...state.history, { turn, sceneId: next.id, choiceLabel: choice.label, text: next.text }] };
}
