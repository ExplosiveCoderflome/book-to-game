import type { Choice, StoryCondition, StoryEffect, VariableValue } from '@novel-game/contracts';
import { useRef } from 'react';
import { useI18n } from '../lib/i18n';
import { StoryValueInput } from './StoryVariablesEditor';

type Rule = StoryCondition | StoryEffect;
const operationLabels: Record<Rule['type'], string> = {
  'variable.equals': '等于',
  'variable.gte': '大于或等于',
  'variable.set': '设置为',
  'variable.increment': '增加（负数为减少）',
};

/** Dense instrument editor: conditions = gate, effects = cost. Logic unchanged. */
export function ChoiceRulesEditor({
  choice,
  variables,
  update,
}: {
  choice: Choice;
  variables: Record<string, VariableValue>;
  update: (choice: Choice) => void;
}) {
  const { t } = useI18n();
  const rowIds = useRef({ conditions: [] as string[], effects: [] as string[] });
  function commit(kind: 'conditions' | 'effects', rules: Rule[], removedIndex?: number) {
    if (removedIndex !== undefined) rowIds.current[kind].splice(removedIndex, 1);
    update(
      kind === 'conditions'
        ? { ...choice, conditions: rules as StoryCondition[] }
        : { ...choice, effects: rules as StoryEffect[] },
    );
  }
  const tagsText = (choice.tags ?? []).join(', ');
  const varNames = Object.keys(variables);

  return (
    <div className="choice-rules" data-testid="choice-rules-editor">
      <div className="choice-rules-section" data-testid="choice-tags-editor">
        <div className="choice-rules-section-head">
          <strong>{t('选项标签')}</strong>
          <span className="choice-rules-badge">{t('世界书')}</span>
        </div>
        <p className="hint">{t('逗号分隔。世界书可用标签禁止或门控选项，不会改图上的边。')}</p>
        <label className="choice-rules-field">
          <span className="choice-rules-field-label">{t('标签')}</span>
          <input
            value={tagsText}
            maxLength={200}
            placeholder={t('例如 combat, upgrade')}
            onChange={e => {
              const tags = e.target.value
                .split(',')
                .flatMap(part => part.split('，'))
                .map(s => s.trim())
                .filter(Boolean)
                .slice(0, 10);
              update({ ...choice, tags: tags.length ? tags : undefined });
            }}
          />
        </label>
      </div>

      {(['conditions', 'effects'] as const).map(kind => {
        const rules: Rule[] = choice[kind] ?? [];
        const defaultType = kind === 'conditions' ? 'variable.equals' : 'variable.set';
        const numericType = kind === 'conditions' ? 'variable.gte' : 'variable.increment';
        const title = kind === 'conditions' ? '显示条件' : '选择效果';
        const blurb = kind === 'conditions' ? '门控 · 全部满足才显示' : '代价 / 收益 · 依次执行';
        const badge = kind === 'conditions' ? 'gate' : 'cost';
        const replace = (index: number, rule: Rule) =>
          commit(
            kind,
            rules.map((current, i) => (i === index ? rule : current)),
          );
        return (
          <div className="choice-rules-section" key={kind} data-kind={kind}>
            <div className="choice-rules-section-head">
              <strong>{t(title)}</strong>
              <span className={`choice-rules-badge kind-${badge}`}>{t(blurb)}</span>
            </div>
            <div className="choice-rules-list">
              {rules.map((rule, index) => {
                const numeric = typeof variables[rule.variable] === 'number';
                const missing = !Object.hasOwn(variables, rule.variable);
                return (
                  <div
                    className="choice-rules-row"
                    key={(rowIds.current[kind][index] ??= crypto.randomUUID())}
                  >
                    <label className="choice-rules-cell">
                      <span className="choice-rules-field-label">{t('变量')}</span>
                      <select
                        value={rule.variable}
                        required
                        onChange={e =>
                          replace(index, {
                            type: defaultType,
                            variable: e.target.value,
                            value: variables[e.target.value]!,
                          })
                        }
                      >
                        {missing && (
                          <option value={rule.variable}>
                            {t('{name}（不存在）', { name: rule.variable })}
                          </option>
                        )}
                        {varNames.map(name => (
                          <option key={name} value={name}>
                            {name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="choice-rules-cell">
                      <span className="choice-rules-field-label">{t('操作')}</span>
                      <select
                        value={rule.type}
                        disabled={missing}
                        onChange={e => {
                          const type = e.target.value as Rule['type'];
                          replace(
                            index,
                            type === numericType
                              ? {
                                  type,
                                  variable: rule.variable,
                                  value: typeof rule.value === 'number' ? rule.value : 0,
                                }
                              : {
                                  type: defaultType,
                                  variable: rule.variable,
                                  value: variables[rule.variable]!,
                                },
                          );
                        }}
                      >
                        <option value={defaultType}>{t(operationLabels[defaultType])}</option>
                        {(numeric || rule.type === numericType) && (
                          <option value={numericType} disabled={!numeric}>
                            {t(operationLabels[numericType])}
                          </option>
                        )}
                      </select>
                    </label>
                    <div className="choice-rules-cell choice-rules-value">
                      <StoryValueInput
                        key={`${rule.variable}:${rule.type}:${typeof rule.value}`}
                        value={rule.value}
                        label={t('规则值')}
                        compact
                        onChange={value => {
                          if (
                            (rule.type === 'variable.gte' || rule.type === 'variable.increment') &&
                            typeof value !== 'number'
                          )
                            return;
                          replace(index, { ...rule, value } as Rule);
                        }}
                      />
                    </div>
                    <button
                      type="button"
                      className="quiet small danger choice-rules-remove"
                      aria-label={t('移除第 {index} 条规则', { index: index + 1 })}
                      onClick={() => commit(kind, rules.filter((_, i) => i !== index), index)}
                    >
                      {t('移除')}
                    </button>
                    {missing && (
                      <p className="hint choice-rules-alert" role="alert">
                        {t('此规则引用的变量不存在，请选择已有变量或移除规则。')}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="choice-rules-add">
              <button
                type="button"
                className="small"
                disabled={rules.length >= 20 || varNames.length === 0}
                onClick={() => {
                  const variable = varNames[0]!;
                  commit(kind, [...rules, { type: defaultType, variable, value: variables[variable]! }]);
                }}
              >
                {t(kind === 'conditions' ? '＋ 添加条件' : '＋ 添加效果')}
              </button>
              {varNames.length === 0 && (
                <p className="hint">{t('先添加故事变量，再设置条件与效果。')}</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
