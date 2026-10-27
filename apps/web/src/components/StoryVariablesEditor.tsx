import { useEffect, useRef, useState } from 'react';
import {
  applyStatTemplateVariables,
  displayLabelForVariable,
  getStatTemplate,
  roleForVariable,
  type GameContent,
  type StatRole,
  type VariableValue,
} from '@novel-game/contracts';
import { useI18n } from '../lib/i18n';
import {
  defaultVariableValue,
  parseStoryValue,
  removeStoryVariable,
  renameStoryVariable,
  variableIsReferenced,
  variableNameError,
  type VariableType,
} from '../lib/story-editor';
import { Notice } from './Notice';
import { StatTemplateSelect, type StatTemplateSelectValue } from './StatTemplateSelect';

const ROLE_LABEL: Record<StatRole, string> = {
  resource: '资源',
  relationship: '关系',
  flag: '旗帜',
  progress: '进度',
  pressure: '压力',
};

export function StoryValueInput({
  value,
  type = typeof value as VariableType,
  onChange,
  label,
  compact,
}: {
  value: VariableValue;
  type?: VariableType;
  onChange: (value: VariableValue) => void;
  label: string;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const [raw, setRaw] = useState(String(value));
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const accepted = useRef(value);
  useEffect(() => {
    if (value !== accepted.current) {
      setRaw(String(value));
      setError(null);
      accepted.current = value;
    }
  }, [value]);
  useEffect(() => {
    input.current?.setCustomValidity(error ? t(error) : '');
  }, [error, t]);
  function edit(next: string) {
    setRaw(next);
    try {
      const parsed = parseStoryValue(type, next);
      accepted.current = parsed;
      setError(null);
      onChange(parsed);
    } catch (e) {
      setError(e instanceof Error ? e.message : '请输入有效值。');
    }
  }
  const control =
    type === 'boolean' ? (
      <select value={String(value)} aria-label={label} onChange={e => edit(e.target.value)}>
        <option value="false">{t('假')}</option>
        <option value="true">{t('真')}</option>
      </select>
    ) : (
      <input
        ref={input}
        value={raw}
        inputMode={type === 'number' ? 'decimal' : undefined}
        maxLength={type === 'string' ? 2000 : undefined}
        aria-label={label}
        aria-invalid={!!error}
        onChange={e => edit(e.target.value)}
      />
    );
  if (compact) {
    return (
      <span className="stat-editor-value">
        {control}
        {error && (
          <span className="hint" role="alert">
            {t(error)}
          </span>
        )}
      </span>
    );
  }
  return (
    <label>
      {label}
      {control}
      {error && (
        <span className="hint" role="alert">
          {t(error)}
        </span>
      )}
    </label>
  );
}

function VariableRow({
  name,
  value,
  content,
  update,
  report,
}: {
  name: string;
  value: VariableValue;
  content: GameContent;
  update: (content: GameContent) => void;
  report: (error: string | null) => void;
}) {
  const { t } = useI18n();
  const [nameText, setNameText] = useState(name);
  const [nameError, setNameError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const role = roleForVariable(name, content.statTemplateId, content.statTemplateVersion);
  const display = displayLabelForVariable(name, content.statTemplateId, content.statTemplateVersion);
  const showDisplay = display !== name;
  useEffect(() => {
    setNameText(name);
    setNameError(null);
  }, [name]);
  useEffect(() => {
    input.current?.setCustomValidity(nameError ? t(nameError) : '');
  }, [nameError, t]);
  return (
    <div className="stat-editor-row" data-testid="stat-editor-row" data-var={name}>
      <div className="stat-editor-identity">
        {showDisplay && <span className="stat-editor-display">{display}</span>}
        <input
          ref={input}
          className="stat-editor-name"
          value={nameText}
          maxLength={80}
          required
          aria-label={t('变量名')}
          aria-invalid={!!nameError}
          spellCheck={false}
          onChange={e => {
            const next = e.target.value;
            setNameText(next);
            const error = variableNameError(next, content.variables ?? {}, name);
            setNameError(error);
            report(error);
            if (!error) update(renameStoryVariable(content, name, next));
          }}
        />
        {nameError && (
          <span className="hint" role="alert">
            {t(nameError)}
          </span>
        )}
      </div>
      <div className="stat-editor-meta">
        {role ? (
          <span className={`stat-editor-chip role-${role}`} title={t(ROLE_LABEL[role])}>
            {t(ROLE_LABEL[role])}
          </span>
        ) : null}
        <select
          className="stat-editor-type"
          value={typeof value}
          aria-label={t('类型')}
          onChange={e => {
            if (variableIsReferenced(content, name)) {
              report('此变量正被选项规则引用，请先移除相关规则再更改类型。');
              return;
            }
            report(null);
            update({
              ...content,
              variables: { ...content.variables, [name]: defaultVariableValue(e.target.value as VariableType) },
            });
          }}
        >
          <option value="number">{t('数字')}</option>
          <option value="string">{t('文本')}</option>
          <option value="boolean">{t('布尔')}</option>
        </select>
      </div>
      <StoryValueInput
        key={`${name}:${typeof value}`}
        value={value}
        compact
        label={t('初始值')}
        onChange={next => update({ ...content, variables: { ...content.variables, [name]: next } })}
      />
      <button
        type="button"
        className="quiet small danger stat-editor-delete"
        aria-label={t('删除变量')}
        title={t('删除变量')}
        onClick={() => {
          try {
            update(removeStoryVariable(content, name));
            report(null);
          } catch (e) {
            report(e instanceof Error ? e.message : '无法删除变量。');
          }
        }}
      >
        {t('删除')}
      </button>
    </div>
  );
}

/** Universal stats editor for content.variables (+ optional template stamp). */
export function StatEditor({ content, update }: { content: GameContent; update: (content: GameContent) => void }) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [type, setType] = useState<VariableType>('number');
  const [initialValue, setInitialValue] = useState<VariableValue>(0);
  const [error, setError] = useState<string | null>(null);
  const [applyTemplateId, setApplyTemplateId] = useState<StatTemplateSelectValue>(
    (content.statTemplateId as StatTemplateSelectValue | undefined) ?? '',
  );
  const entries = Object.entries(content.variables ?? {});

  function applyTemplate() {
    const template = getStatTemplate(applyTemplateId);
    if (!template) {
      setError('请先选择要套用的数值模板。');
      return;
    }
    const nextVars = applyStatTemplateVariables(template, content.variables ?? {});
    update({
      ...content,
      variables: nextVars,
      statTemplateId: template.id,
      statTemplateVersion: template.version,
    });
    setError(null);
  }

  function addVariable() {
    const nextError = variableNameError(name, content.variables ?? {});
    setError(nextError);
    if (!nextError) {
      update({ ...content, variables: { ...content.variables, [name]: initialValue } });
      setName('');
      setInitialValue(defaultVariableValue(type));
    }
  }

  return (
    <section className="stat-editor" data-testid="stat-editor" aria-labelledby="stat-editor-title">
      <header className="stat-editor-header">
        <div className="stat-editor-heading">
          <h3 id="stat-editor-title">{t('数值')}</h3>
          <p className="hint">{t('共享状态基底：改这里的变量，选项条件/效果才能产生代价。重命名会同步规则引用。')}</p>
        </div>
        <div className="stat-editor-template" data-testid="stat-template-apply">
          <StatTemplateSelect
            value={applyTemplateId}
            onChange={setApplyTemplateId}
            testId="variables-stat-template"
            compact
            hideLabel
          />
          <button
            type="button"
            className="small"
            data-testid="apply-stat-template"
            disabled={!applyTemplateId}
            onClick={applyTemplate}
          >
            {t('套用模板')}
          </button>
          {content.statTemplateId && (
            <span className="stat-editor-stamp" title={t('当前戳记：{id} · v{version}', { id: content.statTemplateId, version: content.statTemplateVersion ?? '—' })}>
              {content.statTemplateId}
              <span className="stat-editor-stamp-ver">v{content.statTemplateVersion ?? '—'}</span>
            </span>
          )}
        </div>
      </header>

      <Notice text={error ? t(error) : null} />

      {entries.length === 0 ? (
        <div className="stat-editor-empty" data-testid="stat-editor-empty">
          <p>{t('还没有数值。套用上方题材模板灌入骨架，或在下方添加自定义变量。')}</p>
        </div>
      ) : (
        <div className="stat-editor-list" role="list">
          <div className="stat-editor-list-head" aria-hidden="true">
            <span>{t('名称')}</span>
            <span>{t('角色 / 类型')}</span>
            <span>{t('初始值')}</span>
            <span />
          </div>
          {entries.map(([varName, value]) => (
            <VariableRow
              key={varName}
              name={varName}
              value={value}
              content={content}
              update={update}
              report={setError}
            />
          ))}
        </div>
      )}

      <div className="stat-editor-add" data-testid="stat-editor-add">
        <input
          value={name}
          maxLength={80}
          placeholder={t('例如 trust')}
          aria-label={t('新变量名')}
          spellCheck={false}
          onChange={e => setName(e.target.value)}
        />
        <select
          value={type}
          aria-label={t('新变量类型')}
          onChange={e => {
            const next = e.target.value as VariableType;
            setType(next);
            setInitialValue(defaultVariableValue(next));
          }}
        >
          <option value="number">{t('数字')}</option>
          <option value="string">{t('文本')}</option>
          <option value="boolean">{t('布尔')}</option>
        </select>
        <StoryValueInput
          key={type}
          type={type}
          value={initialValue}
          compact
          label={t('新变量初始值')}
          onChange={setInitialValue}
        />
        <button type="button" className="small primary" onClick={addVariable}>
          {t('添加')}
        </button>
      </div>
    </section>
  );
}

/** @deprecated Prefer StatEditor — kept as alias for existing imports. */
export const StoryVariablesEditor = StatEditor;
