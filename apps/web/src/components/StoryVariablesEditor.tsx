import { useEffect, useRef, useState } from 'react';
import type { GameContent, VariableValue } from '@novel-game/contracts';
import { useI18n } from '../lib/i18n';
import { defaultVariableValue, parseStoryValue, removeStoryVariable, renameStoryVariable, variableIsReferenced, variableNameError, type VariableType } from '../lib/story-editor';
import { Notice } from './Notice';

export function StoryValueInput({ value, type = typeof value as VariableType, onChange, label }: { value: VariableValue; type?: VariableType; onChange: (value: VariableValue) => void; label: string }) {
  const { t } = useI18n();
  const [raw, setRaw] = useState(String(value));
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const accepted = useRef(value);
  useEffect(() => {
    if (value !== accepted.current) { setRaw(String(value)); setError(null); accepted.current = value; }
  }, [value]);
  useEffect(() => { input.current?.setCustomValidity(error ? t(error) : ''); }, [error, t]);
  function edit(next: string) {
    setRaw(next);
    try { const parsed = parseStoryValue(type, next); accepted.current = parsed; setError(null); onChange(parsed); }
    catch (e) { setError(e instanceof Error ? e.message : '请输入有效值。'); }
  }
  return <label>{label}{type === 'boolean' ? <select value={String(value)} onChange={e => edit(e.target.value)}><option value="false">{t('假')}</option><option value="true">{t('真')}</option></select> : <input ref={input} value={raw} inputMode={type === 'number' ? 'decimal' : undefined} maxLength={type === 'string' ? 2000 : undefined} aria-invalid={!!error} onChange={e => edit(e.target.value)} />}{error && <span className="hint" role="alert">{t(error)}</span>}</label>;
}

function VariableRow({ name, value, content, update, report }: { name: string; value: VariableValue; content: GameContent; update: (content: GameContent) => void; report: (error: string | null) => void }) {
  const { t } = useI18n();
  const [nameText, setNameText] = useState(name);
  const [nameError, setNameError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { setNameText(name); setNameError(null); }, [name]);
  useEffect(() => { input.current?.setCustomValidity(nameError ? t(nameError) : ''); }, [nameError, t]);
  return <div className="choice-editor stack"><div className="field-row">
    <label>{t('变量名')}<input ref={input} value={nameText} maxLength={80} required aria-invalid={!!nameError} onChange={e => {
      const next = e.target.value; setNameText(next);
      const error = variableNameError(next, content.variables ?? {}, name); setNameError(error); report(error);
      if (!error) update(renameStoryVariable(content, name, next));
    }} /></label>
    <label>{t('类型')}<select value={typeof value} onChange={e => {
      if (variableIsReferenced(content, name)) { report('此变量正被选项规则引用，请先移除相关规则再更改类型。'); return; }
      report(null); update({ ...content, variables: { ...content.variables, [name]: defaultVariableValue(e.target.value as VariableType) } });
    }}><option value="number">{t('数值')}</option><option value="string">{t('文本')}</option><option value="boolean">{t('布尔')}</option></select></label>
    <StoryValueInput key={`${name}:${typeof value}`} value={value} label={t('初始值')} onChange={next => update({ ...content, variables: { ...content.variables, [name]: next } })} />
  </div><button type="button" className="quiet small danger" onClick={() => {
    try { update(removeStoryVariable(content, name)); report(null); } catch (e) { report(e instanceof Error ? e.message : '无法删除变量。'); }
  }}>{t('删除变量')}</button></div>;
}

export function StoryVariablesEditor({ content, update }: { content: GameContent; update: (content: GameContent) => void }) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [type, setType] = useState<VariableType>('number');
  const [initialValue, setInitialValue] = useState<VariableValue>(0);
  const [error, setError] = useState<string | null>(null);
  return <fieldset><legend>{t('故事变量')}</legend><p className="hint">{t('设置数值、文本或布尔变量，让选择产生不同后果。重命名会同步更新规则引用。')}</p>
    <Notice text={error ? t(error) : null} />
    {Object.entries(content.variables ?? {}).map(([name, value]) => <VariableRow key={name} name={name} value={value} content={content} update={update} report={setError} />)}
    <div className="field-row"><label>{t('新变量名')}<input value={name} maxLength={80} onChange={e => setName(e.target.value)} placeholder={t('例如 trust')} /></label>
      <label>{t('新变量类型')}<select value={type} onChange={e => { const next = e.target.value as VariableType; setType(next); setInitialValue(defaultVariableValue(next)); }}><option value="number">{t('数值')}</option><option value="string">{t('文本')}</option><option value="boolean">{t('布尔')}</option></select></label>
      <StoryValueInput key={type} type={type} value={initialValue} label={t('新变量初始值')} onChange={setInitialValue} />
    </div><button type="button" className="small" onClick={e => {
      if (!e.currentTarget.form?.reportValidity()) return;
      const error = variableNameError(name, content.variables ?? {}); setError(error);
      if (!error) { update({ ...content, variables: { ...content.variables, [name]: initialValue } }); setName(''); setInitialValue(defaultVariableValue(type)); }
    }}>{t('＋ 添加变量')}</button>
  </fieldset>;
}
