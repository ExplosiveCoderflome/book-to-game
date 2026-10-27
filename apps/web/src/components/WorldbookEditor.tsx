import type { GameContent, WorldbookConstraint, WorldbookEntry, WorldbookEntryKind } from '@novel-game/contracts';
import { useI18n } from '../lib/i18n';
import { Notice } from './Notice';

const kinds: { value: WorldbookEntryKind; label: string }[] = [
  { value: 'lore', label: 'lore · 软设定' },
  { value: 'rule', label: 'rule · 硬规则' },
  { value: 'power', label: 'power · 战力' },
  { value: 'upgrade', label: 'upgrade · 升级' },
];

function blankEntry(): WorldbookEntry {
  return {
    id: `wb-${crypto.randomUUID().slice(0, 8)}`,
    title: '',
    keys: [],
    content: '',
    kind: 'rule',
    scope: { type: 'global' },
    constraints: [],
  };
}

function updateEntry(content: GameContent, entryId: string, patch: Partial<WorldbookEntry>): GameContent {
  const entries = (content.worldbook?.entries ?? []).map(entry => entry.id === entryId ? { ...entry, ...patch } : entry);
  return { ...content, worldbook: { entries } };
}

function constraintSummary(c: WorldbookConstraint, t: (k: string, p?: Record<string, string | number>) => string): string {
  if (c.type === 'forbid_choice_tags') return t('禁止标签：{tags}', { tags: c.tags.join(', ') });
  if (c.type === 'gate_tagged_choices') {
    const range = [c.min !== undefined ? `≥${c.min}` : '', c.max !== undefined ? `≤${c.max}` : ''].filter(Boolean).join(' ');
    return t('门控 {tags} · {variable} {range}', { tags: c.tags.join(', '), variable: c.variable, range });
  }
  if (c.type === 'cap_variable_increment') return t('增量上限 {variable} ≤ {max}', { variable: c.variable, max: c.maxDelta });
  if (c.type === 'require_min_variable') {
    return t('最低要求 {tags} · {variable} ≥ {min}', { tags: c.tags.join(', '), variable: c.variable, min: c.min });
  }
  if (c.type === 'require_max_variable') {
    return t('最高限制 {tags} · {variable} ≤ {max}', { tags: c.tags.join(', '), variable: c.variable, max: c.max });
  }
  if (c.type === 'spend_on_choice') {
    return t('消耗 {tags} · {variable} −{amount}', { tags: c.tags.join(', '), variable: c.variable, amount: c.amount });
  }
  if (c.type === 'one_path_lock') {
    return t('路径锁定：曾选 {when} → 禁止 {forbid}', { when: c.whenTags.join(', '), forbid: c.forbidTags.join(', ') });
  }
  const steps = c.steps.map(s => `≥${s.threshold}:{${s.tags.join(',')}}`).join(' · ');
  return t('升级阶梯 {variable} {steps}', { variable: c.variable, steps });
}

export function WorldbookEditor({ content, update }: { content: GameContent; update: (content: GameContent) => void }) {
  const { t } = useI18n();
  const entries = content.worldbook?.entries ?? [];
  const variableNames = Object.keys(content.variables ?? {}).filter(name => typeof content.variables![name] === 'number');

  function addEntry() {
    update({ ...content, worldbook: { entries: [...entries, blankEntry()] } });
  }

  function removeEntry(id: string) {
    update({ ...content, worldbook: { entries: entries.filter(entry => entry.id !== id) } });
  }

  function pushConstraint(entry: WorldbookEntry, constraint: WorldbookConstraint) {
    update(updateEntry(content, entry.id, { constraints: [...(entry.constraints ?? []), constraint] }));
  }

  function addForbid(entry: WorldbookEntry) {
    pushConstraint(entry, {
      type: 'forbid_choice_tags',
      tags: ['combat'],
      message: t('世界书禁止此行动。'),
    });
  }

  function addGate(entry: WorldbookEntry) {
    const variable = variableNames[0];
    if (!variable) return;
    pushConstraint(entry, {
      type: 'gate_tagged_choices',
      tags: ['combat'],
      variable,
      min: 1,
      message: t('战力不足，无法执行。'),
    });
  }

  function addCap(entry: WorldbookEntry) {
    const variable = variableNames[0];
    if (!variable) return;
    pushConstraint(entry, {
      type: 'cap_variable_increment',
      variable,
      maxDelta: 1,
      message: t('单次提升已达世界书上限。'),
    });
  }

  function addRequireMin(entry: WorldbookEntry) {
    const variable = variableNames[0];
    if (!variable) return;
    pushConstraint(entry, {
      type: 'require_min_variable',
      tags: ['combat'],
      variable,
      min: 3,
      message: t('战力未达门槛，无法执行。'),
    });
  }

  function addRequireMax(entry: WorldbookEntry) {
    const variable = variableNames[0];
    if (!variable) return;
    pushConstraint(entry, {
      type: 'require_max_variable',
      tags: ['holy'],
      variable,
      max: 2,
      message: t('业力过高，此路已绝。'),
    });
  }

  function addSpend(entry: WorldbookEntry) {
    const variable = variableNames[0];
    if (!variable) return;
    pushConstraint(entry, {
      type: 'spend_on_choice',
      tags: ['cast'],
      variable,
      amount: 1,
      message: t('资源不足，无法施展。'),
    });
  }

  function addPathLock(entry: WorldbookEntry) {
    pushConstraint(entry, {
      type: 'one_path_lock',
      whenTags: ['path_evil'],
      forbidTags: ['path_holy'],
      message: t('已入邪途，正道选项永久封闭。'),
    });
  }

  function addLadder(entry: WorldbookEntry) {
    const variable = variableNames[0];
    if (!variable) return;
    pushConstraint(entry, {
      type: 'upgrade_ladder',
      variable,
      steps: [
        { threshold: 3, tags: ['skill_basic'] },
        { threshold: 8, tags: ['skill_advanced'] },
      ],
      message: t('修为未至，招式尚未解锁。'),
    });
  }

  return (
    <fieldset data-testid="worldbook-editor">
      <legend>{t('世界书')}</legend>
      <p className="hint">{t('世界书绑定战力/升级硬约束：门槛、消耗、路径锁定、升级阶梯与增量上限。不会偷偷改图边。')}</p>
      {entries.length === 0 && <Notice text={t('尚无条目。添加规则/战力/升级条目以限制玩家发挥、避免崩盘。')} />}
      {entries.map(entry => (
        <div className="choice-editor stack worldbook-entry" key={entry.id} data-testid="worldbook-entry">
          <div className="field-row">
            <label>{t('标题')}<input value={entry.title} maxLength={200} placeholder={t('例如 战力体系')} onChange={e => update(updateEntry(content, entry.id, { title: e.target.value }))} /></label>
            <label>{t('类型')}<select value={entry.kind} onChange={e => update(updateEntry(content, entry.id, { kind: e.target.value as WorldbookEntryKind }))}>
              {kinds.map(k => <option key={k.value} value={k.value}>{t(k.label)}</option>)}
            </select></label>
          </div>
          <label>{t('关键词（逗号分隔，供 AI 触发）')}<input value={(entry.keys ?? []).join(', ')} maxLength={400} onChange={e => {
            const keys = e.target.value.split(',').flatMap(part => part.split('，')).map(s => s.trim()).filter(Boolean).slice(0, 30);
            update(updateEntry(content, entry.id, { keys }));
          }} /></label>
          <label>{t('正文 / 规则说明')}<textarea rows={3} maxLength={4000} value={entry.content} onChange={e => update(updateEntry(content, entry.id, { content: e.target.value }))} /></label>
          <label>{t('作用范围')}<select value={entry.scope.type} onChange={e => {
            if (e.target.value === 'global') update(updateEntry(content, entry.id, { scope: { type: 'global' } }));
            else {
              const start = content.startSceneId || content.scenes[0]?.id;
              update(updateEntry(content, entry.id, { scope: { type: 'scenes', sceneIds: start ? [start] : [] } }));
            }
          }}>
            <option value="global">{t('全局')}</option>
            <option value="scenes">{t('指定场景')}</option>
          </select></label>
          {entry.scope.type === 'scenes' && (
            <div className="worldbook-scene-scope" data-testid="worldbook-scene-scope">
              {content.scenes.map(scene => (
                <label className="check-label" key={scene.id}>
                  <input type="checkbox" checked={entry.scope.type === 'scenes' && entry.scope.sceneIds.includes(scene.id)} onChange={e => {
                    if (entry.scope.type !== 'scenes') return;
                    const sceneIds = e.target.checked
                      ? [...entry.scope.sceneIds, scene.id]
                      : entry.scope.sceneIds.filter(id => id !== scene.id);
                    update(updateEntry(content, entry.id, { scope: { type: 'scenes', sceneIds: sceneIds.length ? sceneIds : [scene.id] } }));
                  }} />
                  {scene.title || scene.id}
                </label>
              ))}
            </div>
          )}
          <div className="stack">
            <strong className="eyebrow">{t('硬约束')}</strong>
            {(entry.constraints ?? []).length === 0 && <p className="hint">{t('无硬约束时仅作 lore/AI 上下文。')}</p>}
            {(entry.constraints ?? []).map((constraint, index) => (
              <div className="field-row" key={`${entry.id}-c-${index}`} data-testid="worldbook-constraint">
                <span className="hint">{constraintSummary(constraint, t)}</span>
                <button type="button" className="quiet small danger" onClick={() => {
                  const constraints = (entry.constraints ?? []).filter((_, i) => i !== index);
                  update(updateEntry(content, entry.id, { constraints }));
                }}>{t('移除')}</button>
              </div>
            ))}
            <div className="draft-action-cluster worldbook-constraint-actions">
              <button type="button" className="quiet small" onClick={() => addForbid(entry)}>{t('＋ 禁止标签')}</button>
              <button type="button" className="quiet small" disabled={!variableNames.length} onClick={() => addGate(entry)}>{t('＋ 变量门控')}</button>
              <button type="button" className="quiet small" disabled={!variableNames.length} onClick={() => addCap(entry)}>{t('＋ 增量上限')}</button>
              <button type="button" className="quiet small" disabled={!variableNames.length} onClick={() => addRequireMin(entry)}>{t('＋ 最低战力')}</button>
              <button type="button" className="quiet small" disabled={!variableNames.length} onClick={() => addRequireMax(entry)}>{t('＋ 最高限制')}</button>
              <button type="button" className="quiet small" disabled={!variableNames.length} onClick={() => addSpend(entry)}>{t('＋ 行动消耗')}</button>
              <button type="button" className="quiet small" onClick={() => addPathLock(entry)}>{t('＋ 路径锁定')}</button>
              <button type="button" className="quiet small" disabled={!variableNames.length} onClick={() => addLadder(entry)}>{t('＋ 升级阶梯')}</button>
            </div>
            {!variableNames.length && <p className="hint">{t('添加数值变量后可设置门控、消耗、阶梯与增量上限。')}</p>}
          </div>
          <button type="button" className="quiet small danger" onClick={() => removeEntry(entry.id)}>{t('删除条目')}</button>
        </div>
      ))}
      <button type="button" className="small" data-testid="worldbook-add-entry" onClick={addEntry}>{t('＋ 添加世界书条目')}</button>
    </fieldset>
  );
}
