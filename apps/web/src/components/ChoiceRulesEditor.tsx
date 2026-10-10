import type { Choice, StoryCondition, StoryEffect, VariableValue } from '@novel-game/contracts';
import { useRef } from 'react';
import { useI18n } from '../lib/i18n';
import { StoryValueInput } from './StoryVariablesEditor';

type Rule = StoryCondition | StoryEffect;
const operationLabels: Record<Rule['type'], string> = { 'variable.equals': '等于', 'variable.gte': '大于或等于', 'variable.set': '设置为', 'variable.increment': '增加（负数为减少）' };

export function ChoiceRulesEditor({ choice, variables, update }: { choice: Choice; variables: Record<string, VariableValue>; update: (choice: Choice) => void }) {
  const { t } = useI18n();
  const rowIds = useRef({ conditions: [] as string[], effects: [] as string[] });
  function commit(kind: 'conditions' | 'effects', rules: Rule[], removedIndex?: number) {
    if (removedIndex !== undefined) rowIds.current[kind].splice(removedIndex, 1);
    update(kind === 'conditions' ? { ...choice, conditions: rules as StoryCondition[] } : { ...choice, effects: rules as StoryEffect[] });
  }
  return <>{(['conditions', 'effects'] as const).map(kind => {
    const rules: Rule[] = choice[kind] ?? [];
    const defaultType = kind === 'conditions' ? 'variable.equals' : 'variable.set';
    const numericType = kind === 'conditions' ? 'variable.gte' : 'variable.increment';
    const title = kind === 'conditions' ? '显示条件（全部满足才显示）' : '选择效果（依次执行）';
    const replace = (index: number, rule: Rule) => commit(kind, rules.map((current, i) => i === index ? rule : current));
    return <fieldset key={kind}><legend>{t(title)}</legend>{rules.map((rule, index) => {
      const numeric = typeof variables[rule.variable] === 'number';
      const missing = !Object.hasOwn(variables, rule.variable);
      return <div className="choice-editor stack" key={rowIds.current[kind][index] ??= crypto.randomUUID()}><div className="field-row">
        <label>{t('规则变量')}<select value={rule.variable} required onChange={e => replace(index, { type: defaultType, variable: e.target.value, value: variables[e.target.value]! })}>
          {missing && <option value={rule.variable}>{t('{name}（不存在）', { name: rule.variable })}</option>}{Object.keys(variables).map(name => <option key={name} value={name}>{name}</option>)}
        </select></label>
        <label>{t('操作')}<select value={rule.type} disabled={missing} onChange={e => {
          const type = e.target.value as Rule['type'];
          replace(index, type === numericType ? { type, variable: rule.variable, value: typeof rule.value === 'number' ? rule.value : 0 } : { type: defaultType, variable: rule.variable, value: variables[rule.variable]! });
        }}><option value={defaultType}>{t(operationLabels[defaultType])}</option>{(numeric || rule.type === numericType) && <option value={numericType} disabled={!numeric}>{t(operationLabels[numericType])}</option>}</select></label>
        <StoryValueInput key={`${rule.variable}:${rule.type}:${typeof rule.value}`} value={rule.value} label={t('规则值')} onChange={value => {
          if ((rule.type === 'variable.gte' || rule.type === 'variable.increment') && typeof value !== 'number') return;
          replace(index, { ...rule, value } as Rule);
        }} />
      </div>{missing && <p className="hint" role="alert">{t('此规则引用的变量不存在，请选择已有变量或移除规则。')}</p>}
      <button type="button" className="quiet small danger" aria-label={t('移除第 {index} 条规则', { index: index + 1 })} onClick={() => commit(kind, rules.filter((_, i) => i !== index), index)}>{t('移除规则')}</button></div>;
    })}<button type="button" className="small" disabled={rules.length >= 20 || Object.keys(variables).length === 0} onClick={() => {
      const variable = Object.keys(variables)[0]!;
      commit(kind, [...rules, { type: defaultType, variable, value: variables[variable]! }]);
    }}>{t(kind === 'conditions' ? '＋ 添加条件' : '＋ 添加效果')}</button>{Object.keys(variables).length === 0 && <p className="hint">{t('先添加故事变量，再设置条件与效果。')}</p>}</fieldset>;
  })}</>;
}
