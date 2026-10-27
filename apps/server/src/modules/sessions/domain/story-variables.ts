import type { Choice, StoryEffect, VariableValue, Worldbook } from '@novel-game/contracts';
import {
  reachApplyEffects,
  reachChoiceAvailable,
  worldbookBlockReason,
  worldbookIncrementCap,
  worldbookSpendsForChoice,
} from '@novel-game/contracts';
import { AppError } from '../../../shared/errors.js';

/** Pure variable conditions — authority lives in contracts.reachability. */
export function choiceAvailable(choice: Choice, variables: Record<string, VariableValue>): boolean {
  return reachChoiceAvailable(choice, variables);
}

/** Variable conditions + worldbook hard rules. */
export function choiceAllowed(
  choice: Choice,
  variables: Record<string, VariableValue>,
  sceneId: string,
  worldbook: Worldbook | undefined,
  takenTags: readonly string[] = [],
): { ok: true } | { ok: false; reason: string } {
  if (!choiceAvailable(choice, variables)) {
    return { ok: false, reason: '当前变量条件未满足，此选项不可用' };
  }
  const blocked = worldbookBlockReason(choice, sceneId, variables, worldbook, takenTags);
  if (blocked) return { ok: false, reason: blocked };
  return { ok: true };
}

/**
 * Apply choice effects. Pure set/increment come from contracts; worldbook
 * only wraps increment caps and spend_on_choice deductions.
 */
export function applyChoiceEffects(
  choice: Choice,
  current: Record<string, VariableValue>,
  worldbook?: Worldbook,
  sceneId?: string,
): Record<string, VariableValue> {
  const effects = cappedEffects(choice.effects ?? [], worldbook);
  const applied = reachApplyEffects({ effects }, current);
  if (!applied) {
    throw new AppError('INVALID_VARIABLE_STATE', failureMessage(effects, current), 409);
  }
  const variables = { ...applied };
  if (sceneId && worldbook) {
    for (const spend of worldbookSpendsForChoice(choice, sceneId, worldbook)) {
      const previous = variables[spend.variable];
      if (typeof previous !== 'number' || !Number.isFinite(previous)) {
        throw new AppError('INVALID_VARIABLE_STATE', '存档变量与游戏规则不一致，无法执行此选项', 409);
      }
      const nextValue = previous - spend.amount;
      if (!Number.isFinite(nextValue)) {
        throw new AppError('INVALID_VARIABLE_STATE', '变量运算超出有限数字范围，无法执行此选项', 409);
      }
      variables[spend.variable] = nextValue;
    }
  }
  return variables;
}

function failureMessage(
  effects: StoryEffect[],
  current: Record<string, VariableValue>,
): string {
  const typedOk = effects.every(effect => {
    if (!Object.hasOwn(current, effect.variable)) return false;
    const previous = current[effect.variable];
    if (typeof previous !== typeof effect.value) return false;
    if (effect.type === 'variable.increment' && typeof previous !== 'number') return false;
    return true;
  });
  return typedOk
    ? '变量运算超出有限数字范围，无法执行此选项'
    : '存档变量与游戏规则不一致，无法执行此选项';
}

/** Worldbook extension: clamp increment deltas before pure apply. */
function cappedEffects(effects: StoryEffect[], worldbook: Worldbook | undefined): StoryEffect[] {
  if (!worldbook) return effects;
  return effects.map(effect => {
    if (effect.type !== 'variable.increment') return effect;
    const cap = worldbookIncrementCap(effect.variable, worldbook);
    if (cap === undefined || Math.abs(effect.value) <= cap) return effect;
    return { ...effect, value: effect.value > 0 ? cap : -cap };
  });
}
