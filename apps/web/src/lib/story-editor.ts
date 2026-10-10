import { variableValueSchema, type GameContent, type VariableValue } from '@novel-game/contracts';

export type VariableType = 'string' | 'number' | 'boolean';
export const defaultVariableValue = (type: VariableType): VariableValue => type === 'number' ? 0 : type === 'boolean' ? false : '';

export function parseStoryValue(type: VariableType, input: string): VariableValue {
  if (type === 'number') {
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(input.trim())) throw new Error('请输入有效数值，空白或非法输入不会保存为 0。');
    const value = Number(input);
    if (!Number.isFinite(value)) throw new Error('请输入有限数值。');
    return value;
  }
  if (type === 'boolean') {
    if (input !== 'true' && input !== 'false') throw new Error('请选择真或假。');
    return input === 'true';
  }
  if (!variableValueSchema.safeParse(input).success) throw new Error('文本变量最多 2000 个字符。');
  return input;
}

export function variableNameError(name: string, variables: Record<string, VariableValue>, current?: string): string | null {
  if (!name.trim() || name.length > 80 || name !== name.trim()) return '变量名需为 1–80 个字符，首尾不能有空白。';
  if (name !== current && Object.hasOwn(variables, name)) return '此变量名已存在，请使用其他名称。';
  return null;
}

export function variableIsReferenced(content: GameContent, name: string): boolean {
  return content.scenes.some(scene => scene.choices.some(choice => [...(choice.conditions ?? []), ...(choice.effects ?? [])].some(rule => rule.variable === name)));
}

export function removeStoryVariable(content: GameContent, name: string): GameContent {
  if (variableIsReferenced(content, name)) throw new Error('此变量正被选项规则引用，请先移除相关条件与效果，再删除变量。');
  const { [name]: _removed, ...variables } = content.variables ?? {};
  return { ...content, variables };
}

export function renameStoryVariable(content: GameContent, from: string, to: string): GameContent {
  const error = variableNameError(to, content.variables ?? {}, from);
  if (error) throw new Error(error);
  if (from === to) return content;
  return {
    ...content,
    variables: Object.fromEntries(Object.entries(content.variables ?? {}).map(([name, value]) => [name === from ? to : name, value])),
    scenes: content.scenes.map(scene => ({ ...scene, choices: scene.choices.map(choice => ({
      ...choice,
      ...(choice.conditions ? { conditions: choice.conditions.map(rule => rule.variable === from ? { ...rule, variable: to } : rule) } : {}),
      ...(choice.effects ? { effects: choice.effects.map(rule => rule.variable === from ? { ...rule, variable: to } : rule) } : {}),
    })) })),
  };
}
