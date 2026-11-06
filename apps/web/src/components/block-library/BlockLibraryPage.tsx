import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  type BlockLibraryView, type CatalogDataMap, type CatalogEntry, type CatalogKind, type FunTag,
} from '@novel-game/contracts';
import { WorkspaceHeader } from '../studio/WorkspaceHeader';
import { Notice } from '../Notice';
import { useI18n } from '../../lib/i18n';
import { errorMessage } from '../../lib/api';
import { deleteCatalogEntry, loadBlockLibrary, upsertCatalogEntry } from '../../lib/block-library-api';
import {
  catalogEntryDescription, catalogEntryTitle, copyForCustom, filterCatalogEntries,
} from '../../lib/block-library-utils';
import { CatalogDetails } from './CatalogDetails';

const TABS: {kind: CatalogKind; label: string}[] = [
  {kind: 'block', label: '积木'}, {kind: 'fun-profile', label: '爽感画像'},
  {kind: 'stat-template', label: '数值模板'}, {kind: 'simulation-strategy', label: '模拟策略'},
];
const FUN_TAGS: (FunTag | 'all')[] = ['all', 'pressure-release', 'growth', 'warmth', 'healing-routine', 'grinding', 'collection', 'mystery'];

interface EditorDraft {
  id: string;
  version: string;
  label: string;
  description: string;
  body: string;
  expectedVersion: number;
  isNew: boolean;
  returnId: string;
}

function entriesFor<K extends CatalogKind>(view: BlockLibraryView | null, kind: K): CatalogEntry<K>[] {
  if (!view) return [];
  switch (kind) {
    case 'block': return view.blocks as CatalogEntry<K>[];
    case 'fun-profile': return view.funProfiles as CatalogEntry<K>[];
    case 'stat-template': return view.statTemplates as CatalogEntry<K>[];
    case 'simulation-strategy': return view.simulationStrategies as CatalogEntry<K>[];
  }
}

function makeDraft<K extends CatalogKind>(entry: CatalogEntry<K>, entries: readonly CatalogEntry<K>[], isNew: boolean): EditorDraft {
  const source = isNew ? copyForCustom(entry, entries) : entry.data;
  const {id, version, label = '', blurb = '', description = '', ...body} = source as CatalogDataMap[K] & {blurb?: string; description?: string};
  return {
    id, version: String(version), label, description: blurb || description,
    body: JSON.stringify(body, null, 2), expectedVersion: isNew ? 0 : entry.version, isNew, returnId: entry.id,
  };
}

export function BlockLibraryPage({token}: {token: string}) {
  const {t} = useI18n();
  const [view, setView] = useState<BlockLibraryView | null>(null);
  const [kind, setKind] = useState<CatalogKind>('block');
  const [selectedId, setSelectedId] = useState('');
  const [query, setQuery] = useState('');
  const [funTag, setFunTag] = useState<FunTag | 'all'>('all');
  const [draft, setDraft] = useState<EditorDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await loadBlockLibrary(token);
      setView(next); setError(null);
      setSelectedId(current => current || next.blocks[0]?.id || '');
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setLoading(false); }
  }, [token]);
  useEffect(() => { void refresh(); }, [refresh]);

  const entries = entriesFor(view, kind);
  const filtered = useMemo(() => filterCatalogEntries(entries, query, kind === 'block' ? funTag : 'all'), [entries, query, kind, funTag]);
  const selected = entries.find(entry => entry.id === selectedId);
  const templateEntry = selected ?? filtered[0] ?? entries[0];
  const errorCount = view?.issues.filter(issue => issue.severity === 'error').length ?? 0;

  function changeKind(next: CatalogKind) {
    setKind(next); setDraft(null); setError(null); setNote(null); setQuery(''); setFunTag('all');
    setSelectedId(entriesFor(view, next)[0]?.id ?? '');
  }
  function selectEntry(entry: CatalogEntry) {
    setSelectedId(entry.id); setDraft(null); setError(null); setNote(null);
  }
  function startCopy() {
    if (!templateEntry) return;
    setDraft(makeDraft(templateEntry, entries, true)); setError(null); setNote(null);
  }
  function startEdit() {
    if (!selected || selected.origin !== 'custom') return;
    setDraft(makeDraft(selected, entries, false)); setError(null); setNote(null);
  }

  async function save() {
    if (!draft || busy) return;
    let body: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(draft.body);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('object expected');
      body = parsed as Record<string, unknown>;
    } catch {
      setError(t('高级定义必须是有效的 JSON 对象，请检查逗号、引号与括号。')); return;
    }
    setBusy(true); setError(null); setNote(null);
    try {
      const descriptive = kind === 'block' || kind === 'stat-template' ? {blurb: draft.description.trim()} : {description: draft.description.trim()};
      const data = {...body, id: draft.id.trim(), version: Number(draft.version), label: draft.label.trim(), ...descriptive} as CatalogDataMap[typeof kind];
      const saved = await upsertCatalogEntry(token, kind, data, draft.expectedVersion);
      const next = await loadBlockLibrary(token);
      setView(next); setSelectedId(saved.id); setDraft(null);
      setNote(t('已保存自定义条目：{name}', {name: saved.data.label ?? saved.id}));
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }

  async function remove() {
    if (!selected || selected.origin !== 'custom' || busy) return;
    if (!window.confirm(t('确定删除自定义条目「{name}」吗？被引用的条目会被服务端保护。', {name: catalogEntryTitle(selected)}))) return;
    setBusy(true); setError(null); setNote(null);
    try {
      const next = await deleteCatalogEntry(token, kind, selected.id, selected.version);
      setView(next); setSelectedId(''); setDraft(null); setNote(t('已删除自定义条目。'));
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }

  return <section className="work-section block-library-page">
    <WorkspaceHeader title="积木库" description="集中维护积木、爽感画像、数值模板与模拟策略。内置定义只读；复制为自定义后，以 version 和引用检查保护既有作品。">
      <button type="button" className="quiet" disabled={loading || busy} onClick={() => void refresh()}>{t('重新载入')}</button>
      <button type="button" className="primary" disabled={!templateEntry || busy} onClick={startCopy}>{t('以当前为模板新建')}</button>
    </WorkspaceHeader>
    <Notice text={error} /><Notice text={note} kind="success" />

    <div className="block-library-tabs" role="tablist" aria-label={t('目录类型')}>
      {TABS.map(tab => <button type="button" role="tab" key={tab.kind} aria-selected={kind === tab.kind} className={kind === tab.kind ? 'active' : ''} onClick={() => changeKind(tab.kind)}>
        {t(tab.label)}<span>{entriesFor(view, tab.kind).length}</span>
      </button>)}
    </div>

    <div className="block-library-toolbar">
      <label className="block-library-search"><span className="sr-only">{t('搜索目录')}</span><input value={query} maxLength={80} placeholder={t('搜索名称、说明或 id…')} onChange={event => setQuery(event.target.value)} /></label>
      {kind === 'block' && <label><span>{t('体验标签')}</span><select value={funTag} onChange={event => setFunTag(event.target.value as FunTag | 'all')}>{FUN_TAGS.map(tag => <option key={tag} value={tag}>{tag === 'all' ? t('全部体验标签') : tag}</option>)}</select></label>}
      <span className="hint">{t('{count} 个条目', {count: filtered.length})}</span>
      <span className={`block-library-lint-summary${errorCount ? ' has-errors' : ''}`}>{errorCount ? t('lint：{count} 个错误', {count: errorCount}) : t('lint：无错误')}</span>
    </div>

    <div className="block-library-workspace">
      <div className="block-library-list" aria-busy={loading}>
        {loading && <div className="block-library-state" role="status">{t('正在读取积木库…')}</div>}
        {!loading && !filtered.length && <div className="block-library-state"><strong>{t('没有匹配的条目')}</strong><p>{t('调整搜索或过滤条件，也可以以现有条目为模板新建。')}</p></div>}
        {!loading && filtered.map(entry => <button type="button" key={entry.id} className={`block-library-list-item${selected?.id === entry.id && !draft ? ' selected' : ''}`} aria-pressed={selected?.id === entry.id && !draft} onClick={() => selectEntry(entry)}>
          <span className="block-library-list-top"><span className={`block-library-origin ${entry.origin}`}>{entry.origin === 'builtin' ? t('内置') : t('自定义')}</span><small>v{entry.version}</small></span>
          <strong>{catalogEntryTitle(entry)}</strong><code>{entry.id}</code><p>{catalogEntryDescription(entry)}</p>
        </button>)}
      </div>

      <aside className="block-library-inspector">
        {draft ? <div className="block-library-editor">
          <header><div><span className="eyebrow">{draft.isNew ? t('复制为自定义') : t('编辑自定义')}</span><h2>{draft.label || draft.id}</h2></div><button type="button" className="quiet small" disabled={busy} onClick={() => {setDraft(null); setSelectedId(draft.returnId);}}>{t('取消')}</button></header>
          <div className="block-library-form-grid">
            <label><span>id</span><input value={draft.id} disabled={busy || !draft.isNew} maxLength={40} onChange={event => setDraft({...draft, id: event.target.value})} /><small>{draft.isNew ? t('小写字母开头，可用数字、-、_') : t('已有条目的 id 不可改名')}</small></label>
            <label><span>version</span><input type="number" min={1} step={1} value={draft.version} disabled={busy} onChange={event => setDraft({...draft, version: event.target.value})} /><small>{t('结构性修改必须递增版本')}</small></label>
            <label className="wide"><span>{t('名称')}</span><input value={draft.label} disabled={busy} maxLength={80} onChange={event => setDraft({...draft, label: event.target.value})} /></label>
            <label className="wide"><span>{t('说明')}</span><textarea rows={2} value={draft.description} disabled={busy} maxLength={1000} onChange={event => setDraft({...draft, description: event.target.value})} /></label>
            <label className="wide"><span>{t('高级定义（JSON）')}</span><textarea className="block-library-json" rows={18} value={draft.body} disabled={busy} spellCheck={false} onChange={event => setDraft({...draft, body: event.target.value})} /><small>{t('保存时会执行 zod 契约与跨目录 lint；失败不会写入。')}</small></label>
          </div>
          <div className="block-library-editor-actions"><button type="button" className="primary" disabled={busy || !draft.id.trim() || !draft.label.trim() || !draft.description.trim() || !Number.isInteger(Number(draft.version)) || Number(draft.version) < 1} onClick={() => void save()}>{busy ? t('保存中…') : draft.isNew ? t('创建自定义条目') : t('保存修改')}</button></div>
        </div> : selected ? <>
          <CatalogDetails kind={kind} entry={selected} />
          <div className="block-library-detail-actions">
            <button type="button" className="primary" onClick={selected.origin === 'builtin' ? startCopy : startEdit}>{selected.origin === 'builtin' ? t('复制为自定义') : t('编辑自定义')}</button>
            {selected.origin === 'custom' && <button type="button" className="danger quiet" disabled={busy} onClick={() => void remove()}>{t('删除自定义')}</button>}
          </div>
          {selected.origin === 'builtin' && <p className="hint">{t('内置条目不会直接被覆盖；这里会创建一个带新 id 的自定义副本。')}</p>}
        </> : !loading && <div className="block-library-state"><strong>{t('选择一个目录条目')}</strong><p>{t('查看参数、组合约束、验收指标与版本信息。')}</p></div>}
      </aside>
    </div>

    <section className="block-library-lint" aria-live="polite"><h2>{t('目录 lint 诊断')}</h2>
      {!view?.issues.length && <p className="hint">{t('当前目录没有诊断；保存时仍会重新检查全部跨目录引用。')}</p>}
      {!!view?.issues.length && <ul>{view.issues.slice(0, 20).map((issue, index) => <li key={`${issue.ruleId}-${issue.id ?? index}`} className={issue.severity}><strong>{issue.severity === 'error' ? t('错误') : t('警告')}</strong><span>{issue.message}</span><code>{issue.ruleId}</code></li>)}</ul>}
    </section>
  </section>;
}
