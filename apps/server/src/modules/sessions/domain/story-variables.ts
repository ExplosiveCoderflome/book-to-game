import type { Choice, VariableValue } from '@novel-game/contracts';
import { AppError } from '../../../shared/errors.js';

export function choiceAvailable(choice: Choice, variables: Record<string, VariableValue>): boolean {
  return (choice.conditions ?? []).every(condition => {
    if (!Object.hasOwn(variables, condition.variable)) return false;
    const current = variables[condition.variable];
    return condition.type === 'variable.equals' ? current === condition.value
      : typeof current === 'number' && Number.isFinite(current) && current >= condition.value;
  });
}

export function applyChoiceEffects(choice: Choice, current: Record<string, VariableValue>): Record<string, VariableValue> {
  const variables = {...current};
  for (const effect of choice.effects ?? []) {
    const previous = variables[effect.variable];
    if (!Object.hasOwn(variables, effect.variable) || typeof previous !== typeof effect.value ||
      (effect.type === 'variable.increment' && typeof previous !== 'number')) {
      throw new AppError('INVALID_VARIABLE_STATE', '存档变量与游戏规则不一致，无法执行此选项', 409);
    }
    const value = effect.type === 'variable.increment' ? (previous as number) + effect.value : effect.value;
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new AppError('INVALID_VARIABLE_STATE', '变量运算超出有限数字范围，无法执行此选项', 409);
    }
    variables[effect.variable] = value;
  }
  return variables;
}
