import { SYSTEM_WAIT_ACTION_ID, type AdventureActInput, type WorldContent } from '@novel-game/contracts';
import { AppError } from '../../../shared/errors.js';
import type { AdventureState } from './adventure-state.js';
import { applyEffects, blockedReason, settle, visible } from './rules.js';
import { systemWait } from './system-actions.js';
export function advanceAdventure(current: AdventureState, input: AdventureActInput, world: WorldContent, now: string): AdventureState {
  if (current.turn !== input.expectedTurn) throw new AppError('SESSION_TURN_CONFLICT', '存档已推进，请刷新后再行动', 409);
  if (current.ending) throw new AppError('SESSION_ENDED', '冒险已结束', 409);
  const action = input.actionId === SYSTEM_WAIT_ACTION_ID ? systemWait(current.locationId) : world.actions.find(item => item.id === input.actionId);
  if (!action || !visible(action, current)) throw new AppError('INVALID_ACTION', '此行动当前不可用', 400);
  const reason = blockedReason(action, world, current);
  if (reason !== undefined) throw new AppError('ACTION_BLOCKED', reason, 400);
  const state = structuredClone(current);
  state.turn++; state.elapsed += action.timeCost; state.updatedAt = now;
  if (action.once) state.performedActionIds.push(action.id);
  applyEffects(action.effects, state);
  const text = [action.text, ...settle(world, state)].join('\n');
  state.history.push({turn: state.turn, elapsed: state.elapsed, actionLabel: action.label, text});
  return state;
}
