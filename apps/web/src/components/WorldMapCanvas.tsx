import { useMemo, useRef, useState, type DragEvent, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react';
import type { WorldContent, WorldMap } from '@novel-game/contracts';
import { cellKey, hexCorners, hexToPixel, listHexCells, parseCellKey, validateWorldMap } from '@novel-game/rules';
import { useI18n } from '../lib/i18n';
import { bindLocationToCell, createEmptyMap, resizeMap, unbindLocation } from '../lib/world-map';

const DND_TYPE = 'application/x-btg-location';

interface Props {
  content: WorldContent;
  selectedLocationId?: string;
  onSelectLocation: (locationId: string) => void;
  /** Called with the next map (undefined = remove map layer). Caller persists via the world save path. */
  onMapChange: (map: WorldMap | undefined) => void;
  readOnly?: boolean;
}

/** Optional hex map layer for a world. Spatial view only: never creates movement edges. */
export function WorldMapCanvas({ content, selectedLocationId, onSelectLocation, onMapChange, readOnly = false }: Props) {
  const { t } = useI18n();
  const map = content.map;
  const [draftSize, setDraftSize] = useState({ cols: 16, rows: 10 });
  const [pan, setPan] = useState({ x: 40, y: 40 });
  const [zoom, setZoom] = useState(1);
  const [hoverCell, setHoverCell] = useState<string | null>(null);
  const [selectedCell, setSelectedCell] = useState<string | null>(null);
  const panDrag = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);

  const titles = useMemo(() => new Map(content.locations.map(l => [l.id, l.title])), [content.locations]);
  const cells = useMemo(() => {
    if (!map) return [];
    return listHexCells(map.geometry).map(a => {
      const c = hexToPixel(map.geometry, a);
      return { key: cellKey(a), c, points: hexCorners(map.geometry, c).map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ') };
    });
  }, [map]);
  const poiByCell = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const p of map?.pois ?? []) m.set(p.anchor.cell, [...(m.get(p.anchor.cell) ?? []), p.locationId]);
    return m;
  }, [map]);
  const issues = useMemo(() => (map ? validateWorldMap(map, content.locations.map(l => l.id)) : []), [map, content.locations]);
  const bound = useMemo(() => new Set(map?.pois.map(p => p.locationId) ?? []), [map]);
  const problemLocations = useMemo(() => new Set(issues.filter(i => i.level === 'error').map(i => i.locationId)), [issues]);
  const selectedPoiCell = map?.pois.find(p => p.locationId === selectedLocationId)?.anchor.cell;

  if (!map) {
    return <div className="branch-canvas primary world-map-pane" data-testid="world-map-canvas">
      <div className="branch-canvas-chrome"><div><h4>{t('世界地图')}</h4><p className="hint">{t('可选图层：六边形格 + 地点标记。没有地图的世界照常可玩。')}</p></div></div>
      <div className="branch-canvas-viewport world-map-empty">
        <div className="branch-canvas-empty-card">
          <strong>{t('尚未创建地图')}</strong>
          <p>{t('地图只做空间解释，移动仍由地点图中的行动决定。')}</p>
          <div className="world-map-size">
            <label>{t('列')}<input type="number" min={1} max={64} value={draftSize.cols} onChange={e => setDraftSize(s => ({ ...s, cols: Number(e.target.value) }))} /></label>
            <label>{t('行')}<input type="number" min={1} max={48} value={draftSize.rows} onChange={e => setDraftSize(s => ({ ...s, rows: Number(e.target.value) }))} /></label>
            <button type="button" className="primary small" disabled={readOnly} data-testid="create-map" onClick={() => onMapChange(createEmptyMap(draftSize.cols, draftSize.rows))}>{t('创建空白地图')}</button>
          </div>
        </div>
      </div>
    </div>;
  }

  const g = map.geometry;
  function onDrop(e: DragEvent, key: string) {
    e.preventDefault(); setHoverCell(null);
    const id = e.dataTransfer.getData(DND_TYPE);
    if (!id || readOnly || !map) return;
    onMapChange(bindLocationToCell(map, id, key));
    onSelectLocation(id); setSelectedCell(key);
  }
  function startDrag(e: DragEvent, id: string) { e.dataTransfer.setData(DND_TYPE, id); e.dataTransfer.effectAllowed = 'move'; }
  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if ((e.target as Element).closest('[data-cell],[data-poi]')) return;
    panDrag.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const d = panDrag.current; if (!d) return;
    setPan({ x: d.panX + e.clientX - d.x, y: d.panY + e.clientY - d.y });
  }
  function onWheel(e: ReactWheelEvent<HTMLDivElement>) { setZoom(z => Math.max(0.3, Math.min(3, z * (e.deltaY < 0 ? 1.1 : 0.9)))); }
  const shownCell = selectedPoiCell ?? selectedCell;
  const selCellPois = shownCell ? poiByCell.get(shownCell) ?? [] : [];
  const sel = shownCell ? parseCellKey(shownCell) : null;

  return <div className="branch-canvas primary world-map-pane" data-testid="world-map-canvas">
    <div className="branch-canvas-chrome world-map-chrome">
      <div className="world-map-title"><h4>{t('世界地图')}</h4>
        <span className="world-map-chip">{t('六边形')} · {g.cols}×{g.rows}</span>
        <span className="world-map-chip">{t('已放置 {n}/{total}', { n: bound.size, total: content.locations.length })}</span>
      </div>
      <div className="branch-canvas-toolbar">
        <label className="inline">{t('列')}<input type="number" min={1} max={64} value={g.cols} disabled={readOnly} onChange={e => onMapChange(resizeMap(map, Number(e.target.value), g.rows))} /></label>
        <label className="inline">{t('行')}<input type="number" min={1} max={48} value={g.rows} disabled={readOnly} onChange={e => onMapChange(resizeMap(map, g.cols, Number(e.target.value)))} /></label>
        <button type="button" className="small" onClick={() => { setPan({ x: 40, y: 40 }); setZoom(1); }}>{t('复位视图')}</button>
        <button type="button" className="small quiet" disabled={readOnly} onClick={() => { if (window.confirm(t('删除地图图层？地点与行动不受影响。'))) onMapChange(undefined); }}>{t('删除地图')}</button>
      </div>
    </div>
    <div className="world-map-body">
      <aside className="world-map-tray" aria-label={t('地点')}>
        <p className="world-map-tray-label">{t('拖动地点到格子上绑定')}</p>
        <ul>
          {content.locations.map(l => {
            const isBound = bound.has(l.id);
            return <li key={l.id} draggable={!readOnly} onDragStart={e => startDrag(e, l.id)} data-testid={`map-tray-${l.id}`}
              className={`${isBound ? 'bound' : 'unbound'}${l.id === selectedLocationId ? ' selected' : ''}${problemLocations.has(l.id) ? ' problem' : ''}`}
              onClick={() => onSelectLocation(l.id)}>
              <span className="dot" />
              <span className="name">{l.title}</span>
              {isBound
                ? <button type="button" className="quiet tiny" disabled={readOnly} title={t('从地图移除')} onClick={e => { e.stopPropagation(); onMapChange(unbindLocation(map, l.id)); }}>×</button>
                : <span className="tag">{t('未放置')}</span>}
            </li>;
          })}
        </ul>
        {issues.length > 0 && <div className="world-map-issues" data-testid="world-map-issues">
          <p className="world-map-tray-label">{t('地图提示')} · {issues.length}</p>
          <ul>{issues.slice(0, 8).map((i, n) => <li key={n} className={i.level}>{i.message}</li>)}</ul>
        </div>}
      </aside>
      <div className="branch-canvas-viewport world-map-viewport" onPointerDown={onPointerDown} onPointerMove={onPointerMove}
        onPointerUp={() => { panDrag.current = null; }} onWheel={onWheel}>
        <svg className="branch-canvas-svg" width="100%" height="100%">
          <g transform={`translate(${pan.x + g.size} ${pan.y + g.size}) scale(${zoom})`}>
            {cells.map(cell => <polygon key={cell.key} data-cell={cell.key} points={cell.points}
              className={`hex${hoverCell === cell.key ? ' drop' : ''}${selectedCell === cell.key || selectedPoiCell === cell.key ? ' selected' : ''}${poiByCell.has(cell.key) ? ' has-poi' : ''}`}
              onClick={() => { setSelectedCell(cell.key); const ids = poiByCell.get(cell.key); if (ids?.[0]) onSelectLocation(ids[0]); }}
              onDragOver={e => { if (!readOnly) { e.preventDefault(); setHoverCell(cell.key); } }}
              onDragLeave={() => setHoverCell(h => (h === cell.key ? null : h))}
              onDrop={e => onDrop(e, cell.key)} />)}
            {map.pois.map(p => {
              const a = parseCellKey(p.anchor.cell); if (!a) return null;
              const c = hexToPixel(g, a);
              const selected = p.locationId === selectedLocationId;
              const missing = !titles.has(p.locationId);
              const label = p.label ?? titles.get(p.locationId) ?? p.locationId;
              return <g key={p.locationId} data-poi={p.locationId} className={`poi${selected ? ' selected' : ''}${missing ? ' missing' : ''}${p.locationId === content.initialLocationId ? ' start' : ''}`}
                transform={`translate(${c.x} ${c.y})`} onClick={() => { setSelectedCell(p.anchor.cell); onSelectLocation(p.locationId); }}>
                <circle r={g.size * 0.38} />
                <text y={g.size * 0.38 + 13} textAnchor="middle">{label.length > 8 ? `${label.slice(0, 8)}…` : label}</text>
              </g>;
            })}
          </g>
        </svg>
        <div className="world-map-status">
          {sel ? <span>{t('格')} {shownCell} · q {sel.q} · r {sel.r}{selCellPois.length ? ` · ${selCellPois.map(id => titles.get(id) ?? id).join('、')}` : ''}</span>
            : <span>{t('点击格子或标记查看；滚轮缩放，拖动空白处平移。')}</span>}
          <span>{Math.round(zoom * 100)}%</span>
        </div>
      </div>
    </div>
  </div>;
}
