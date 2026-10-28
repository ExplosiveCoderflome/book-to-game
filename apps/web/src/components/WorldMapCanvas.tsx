import { Suspense, useMemo, useState } from 'react';
import type { WorldContent, WorldMap } from '@novel-game/contracts';
import { childMapOf, findMap, mapIdOf, mapPath, ROOT_MAP_ID } from '@novel-game/rules';
import { useI18n } from '../lib/i18n';
import { createSubMap, linkSubMapLocations, withMapById } from '../lib/world-map';
import { DEFAULT_MAP_KIND, mapKindEditor, type MapEditorProps } from './map-kinds';

type Props = MapEditorProps & {
  /** Whole-content writes (sub-maps, hierarchy links). Without it, only the root map is editable. */
  onContentChange?: (next: WorldContent) => void;
  /** Optional per-map preview transform (e.g. era territory snapshot) — editing is disabled while it is active. */
  previewMap?: (map: WorldMap) => WorldMap;
  toolbarExtra?: React.ReactNode;
};

/** Optional world map layer. Breadcrumb over root + sub-maps; dispatches to the editor registered for the grid kind. */
export function WorldMapCanvas({ onContentChange, previewMap, toolbarExtra, ...props }: Props) {
  const { t } = useI18n();
  const { content } = props;
  const [activeId, setActiveId] = useState(ROOT_MAP_ID);
  const active = activeId === ROOT_MAP_ID ? content.map : findMap(content, activeId);
  const mapId = active ? mapIdOf(active) : ROOT_MAP_ID;
  const path = useMemo(() => (active ? mapPath(content, mapId) : [{ mapId: ROOT_MAP_ID, name: '世界' }]), [content, mapId, active]);
  const sel = props.selectedLocationId;
  const selChild = sel ? childMapOf(content, sel) : undefined;
  const selOnActive = !!(sel && active?.pois.some(p => p.locationId === sel));
  const [note, setNote] = useState<string | null>(null);
  const kind = active?.geometry.kind ?? DEFAULT_MAP_KIND;
  const entry = mapKindEditor(kind);
  const shown = active && previewMap ? previewMap(active) : active;
  const viewContent = useMemo(() => ({ ...content, map: shown }), [content, shown]);
  function onMapChange(map: WorldMap | undefined) {
    if (mapId === ROOT_MAP_ID) { props.onMapChange(map); return; }
    if (!onContentChange) return;
    onContentChange(withMapById(content, mapId, map)); if (!map) setActiveId(path.at(-2)?.mapId ?? ROOT_MAP_ID);
  }
  function enter(locationId: string) {
    const child = childMapOf(content, locationId);
    if (child?.id) { setActiveId(child.id); return; }
    if (!onContentChange || !active) return;
    const r = createSubMap(content, mapId, locationId); onContentChange(r.content); setActiveId(r.mapId);
  }
  function onDoubleClick(e: React.MouseEvent) {
    const poi = (e.target as Element).closest?.('[data-poi]')?.getAttribute('data-poi');
    if (poi && childMapOf(content, poi)) enter(poi);
  }
  const bar = <div className="map-breadcrumb" data-testid="map-breadcrumb">
    <nav aria-label={t('地图层级')}>{path.map((p, i) => <span key={p.mapId}>
      {i > 0 && <span className="crumb-sep">›</span>}
      <button type="button" className={`crumb${p.mapId === mapId ? ' current' : ''}`} data-testid={`crumb-${p.mapId}`} onClick={() => setActiveId(p.mapId)}>{t(p.name)}</button>
    </span>)}</nav>
    <div className="map-breadcrumb-actions">
      {(content.subMaps?.length ?? 0) > 0 && <span className="hint">{t('子地图 {n}', { n: content.subMaps!.length })}</span>}
      {sel && selOnActive && (selChild
        ? <button type="button" className="small" data-testid="open-submap" onClick={() => enter(sel)}>↘ {t('进入子地图')}</button>
        : onContentChange && !props.readOnly && <button type="button" className="small" data-testid="create-submap" onClick={() => enter(sel)}>＋ {t('为此地点建子地图')}</button>)}
      {mapId !== ROOT_MAP_ID && onContentChange && !props.readOnly && <button type="button" className="small" data-testid="link-submap" onClick={() => { const r = linkSubMapLocations(content, mapId); setNote(t('已添加 {n} 条进出连线', { n: r.added })); if (r.added || r.content !== content) onContentChange(r.content); }}>⇄ {t('生成进出连线')}</button>}
      {mapId !== ROOT_MAP_ID && <button type="button" className="small quiet" data-testid="submap-up" onClick={() => setActiveId(path.at(-2)?.mapId ?? ROOT_MAP_ID)}>↖ {t('返回上层')}</button>}
      {toolbarExtra}
      {note && <span className="hint">{note}</span>}
    </div>
  </div>;
  if (!entry) return <div className="branch-canvas primary world-map-pane" data-testid="world-map-canvas"><p className="hint">{t('不支持的地图类型：{kind}', { kind })}</p></div>;
  return <div className="world-map-stack" onDoubleClick={onDoubleClick}>
    {(content.map || content.subMaps?.length) && bar}
    <Suspense fallback={<div className="branch-canvas primary world-map-pane" data-testid="world-map-loading"><p className="hint">{t('正在载入地图编辑器…')}</p></div>}>
      <entry.Editor key={mapId} {...props} content={viewContent} onMapChange={onMapChange} readOnly={props.readOnly || !!previewMap}
        historyKey={`${props.historyKey ?? 'world'}:${mapId}`} />
    </Suspense>
  </div>;
}
