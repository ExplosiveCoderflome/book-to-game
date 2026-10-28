import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BUILDING_KIND_COLOR, BUILDING_KIND_LABEL, MAP_FILL_KINDS,
  type BuildingAsset, type BuildingLibrary, type MapFillKind,
} from '@novel-game/contracts';
import { useI18n } from '../../lib/i18n';
import {
  createBuildingAsset, deleteBuildingAsset, loadBuildingLibrary, updateBuildingAsset,
} from '../../lib/building-library-api';
import { RequestError } from '../../lib/api';

type Props = {
  token: string;
  /** Highlight / filter by kind when placing. */
  filterKind?: MapFillKind | 'all';
  selectedId?: string;
  onSelect?: (asset: BuildingAsset | null) => void;
  onLibraryChange?: (library: BuildingLibrary, revision: number) => void;
  /** Compact embed inside map fill tray. */
  compact?: boolean;
  readOnly?: boolean;
  /** Open the dedicated building-library workspace (top-level page). */
  onOpenFullLibrary?: () => void;
};

/**
 * Compact picker / shortcut dock for map fill.
 * Full create/edit lives on BuildingLibraryPage — use onOpenFullLibrary to jump there.
 */
export function BuildingLibraryPanel({
  token, filterKind = 'all', selectedId, onSelect, onLibraryChange, compact, readOnly, onOpenFullLibrary,
}: Props) {
  const { t } = useI18n();
  const [library, setLibrary] = useState<BuildingLibrary | null>(null);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftKind, setDraftKind] = useState<MapFillKind>('shop');
  const [draftLabel, setDraftLabel] = useState('');
  const [addToLibrary, setAddToLibrary] = useState(true);
  const [editId, setEditId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');

  const accept = useCallback((view: { library: BuildingLibrary; revision: number }) => {
    setLibrary(view.library);
    setRevision(view.revision);
    onLibraryChange?.(view.library, view.revision);
  }, [onLibraryChange]);

  const refresh = useCallback(async () => {
    try {
      accept(await loadBuildingLibrary(token));
      setError(null);
    } catch (e) {
      setError(e instanceof RequestError ? e.message : String(e));
    }
  }, [token, accept]);

  useEffect(() => { void refresh(); }, [refresh]);

  const assets = useMemo(() => {
    const list = library?.assets ?? [];
    if (filterKind === 'all') return list;
    return list.filter(a => a.kind === filterKind);
  }, [library, filterKind]);

  async function onCreate() {
    if (!addToLibrary || readOnly || busy) return;
    const label = draftLabel.trim();
    if (!label) return;
    setBusy(true); setError(null);
    try {
      const view = await createBuildingAsset(token, {
        kind: draftKind, label, expectedRevision: revision,
        color: BUILDING_KIND_COLOR[draftKind],
      });
      accept(view);
      setDraftLabel('');
      onSelect?.(view.asset);
    } catch (e) {
      setError(e instanceof RequestError ? e.message : String(e));
      if (e instanceof RequestError && e.code === 'BUILDING_LIBRARY_CONFLICT') await refresh();
    } finally { setBusy(false); }
  }

  async function onDelete(id: string) {
    if (readOnly || busy) return;
    if (!window.confirm(t('从建筑库删除此资产？地图上的引用会保留并由校验标错。'))) return;
    setBusy(true); setError(null);
    try {
      accept(await deleteBuildingAsset(token, id, revision));
      if (selectedId === id) onSelect?.(null);
    } catch (e) {
      setError(e instanceof RequestError ? e.message : String(e));
      if (e instanceof RequestError && e.code === 'BUILDING_LIBRARY_CONFLICT') await refresh();
    } finally { setBusy(false); }
  }

  async function onRename(id: string) {
    if (readOnly || busy || !editLabel.trim()) return;
    setBusy(true); setError(null);
    try {
      accept(await updateBuildingAsset(token, id, { label: editLabel.trim() }, revision));
      setEditId(null);
    } catch (e) {
      setError(e instanceof RequestError ? e.message : String(e));
      if (e instanceof RequestError && e.code === 'BUILDING_LIBRARY_CONFLICT') await refresh();
    } finally { setBusy(false); }
  }

  return <div className={`building-library-panel${compact ? ' compact' : ''}`} data-testid="building-library-panel">
    <div className="building-library-head">
      <p className="world-map-tray-label">{t('建筑库')}</p>
      <span className="hint" data-testid="building-library-count">{t('{n} 项', { n: library?.assets.length ?? 0 })}</span>
    </div>
    {onOpenFullLibrary && (
      <button type="button" className="small building-library-open-full"
        data-testid="building-library-open-full"
        onClick={onOpenFullLibrary}>
        {t('打开建筑库')}
      </button>
    )}
    {error && <p className="hint error" data-testid="building-library-error">{error}</p>}
    {!readOnly && <div className="building-library-create" data-testid="building-library-create">
      <label className="inline">{t('种类')}
        <select data-testid="building-library-kind" value={draftKind} disabled={busy}
          onChange={e => setDraftKind(e.target.value as MapFillKind)}>
          {MAP_FILL_KINDS.map(k => <option key={k} value={k}>{t(BUILDING_KIND_LABEL[k])}</option>)}
        </select>
      </label>
      <label className="inline">{t('名称')}
        <input data-testid="building-library-label" value={draftLabel} maxLength={80} disabled={busy}
          placeholder={t('如：杂货铺')} onChange={e => setDraftLabel(e.target.value)} />
      </label>
      <label className="inline small">
        <input type="checkbox" data-testid="building-library-add-check" checked={addToLibrary}
          disabled={busy} onChange={e => setAddToLibrary(e.target.checked)} />
        {t('加入库')}
      </label>
      <button type="button" className="small primary" data-testid="building-library-create-btn"
        disabled={busy || !addToLibrary || !draftLabel.trim()} onClick={() => void onCreate()}>
        {t('新建入库')}
      </button>
      <p className="hint">{compact
        ? t('此处快捷入库与挑选；完整编辑请打开建筑库。')
        : t('同名自动变为「原名 · 2」，不会覆盖已有资产。')}</p>
    </div>}
    <ul className="building-library-list" data-testid="building-library-list">
      {assets.length === 0 && <li className="empty">{t('库中暂无建筑')}</li>}
      {assets.map(a => <li key={a.id}
        className={selectedId === a.id ? 'selected' : ''}
        data-testid={`building-asset-${a.id}`}
        onClick={() => onSelect?.(a)}>
        {a.imageUrl
          ? <img className="thumb" src={a.imageUrl} alt="" />
          : <span className="swatch" style={{ background: a.color ?? BUILDING_KIND_COLOR[a.kind] }} aria-hidden />}
        <span className={`map-fill-kind ${a.kind}`}>{t(BUILDING_KIND_LABEL[a.kind])}</span>
        {editId === a.id
          ? <input className="building-rename" data-testid="building-rename-input" value={editLabel} maxLength={80}
              onClick={e => e.stopPropagation()}
              onChange={e => setEditLabel(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void onRename(a.id); if (e.key === 'Escape') setEditId(null); }} />
          : <span className="name">{a.label}</span>}
        <span className="hint">v{a.version}</span>
        {!readOnly && !compact && <span className="building-asset-actions" onClick={e => e.stopPropagation()}>
          {editId === a.id
            ? <button type="button" className="tiny" data-testid={`building-rename-save-${a.id}`} disabled={busy} onClick={() => void onRename(a.id)}>{t('保存')}</button>
            : <button type="button" className="quiet tiny" data-testid={`building-rename-${a.id}`} disabled={busy}
                onClick={() => { setEditId(a.id); setEditLabel(a.label); }}>{t('改名')}</button>}
          <button type="button" className="quiet tiny" data-testid={`building-delete-${a.id}`} disabled={busy}
            title={t('删除')} onClick={() => void onDelete(a.id)}>×</button>
        </span>}
      </li>)}
    </ul>
  </div>;
}
