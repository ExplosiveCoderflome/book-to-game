import type { Choice, VariableValue, Worldbook } from '@novel-game/contracts';
import {
  worldbookBlockReason,
  worldbookIncrementCap,
  worldbookSpendsForChoice,
} from '@novel-game/contracts';
import { AppError } from '../../../shared/errors.js';

export function choiceAvailable(choice: Choice, variables: Record<string, VariableValue>): boolean {
  return (choice.conditions ?? []).every(condition => {
    if (!Object.hasOwn(variables, condition.variable)) return false;
    const current = variables[condition.variable];
    return condition.type === 'variable.equals' ? current === condition.value
      : typeof current === 'number' && Number.isFinite(current) && current >= condition.value;
  });
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

export function applyChoiceEffects(
  choice: Choice,
  current: Record<string, VariableValue>,
  worldbook?: Worldbook,
  sceneId?: string,
): Record<string, VariableValue> {
  const variables = {...current};
  for (const effect of choice.effects ?? []) {
    const previous = variables[effect.variable];
    if (!Object.hasOwn(variables, effect.variable) || typeof previous !== typeof effect.value ||
      (effect.type === 'variable.increment' && typeof previous !== 'number')) {
      throw new AppError('INVALID_VARIABLE_STATE', '存档变量与游戏规则不一致，无法执行此选项', 409);
    }
    let nextValue: VariableValue;
    if (effect.type === 'variable.increment') {
      let delta = effect.value;
      const cap = worldbookIncrementCap(effect.variable, worldbook);
      if (cap !== undefined && Math.abs(delta) > cap) {
        delta = delta > 0 ? cap : -cap;
      }
      nextValue = (previous as number) + delta;
    } else {
      nextValue = effect.value;
    }
    if (typeof nextValue === 'number' && !Number.isFinite(nextValue)) {
      throw new AppError('INVALID_VARIABLE_STATE', '变量运算超出有限数字范围，无法执行此选项', 409);
    }
    variables[effect.variable] = nextValue;
  }
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
