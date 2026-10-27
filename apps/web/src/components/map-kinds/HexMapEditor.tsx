import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react';
import type { WorldContent, WorldMap } from '@novel-game/contracts';
import { cellKey, hexCorners, hexInBounds, hexToPixel, listHexCells, parseCellKey, validateWorldMap } from '@novel-game/rules';
import { useI18n } from '../../lib/i18n';
import { bindLocationToCell, createEmptyMap, resizeMap, unbindLocation } from '../../lib/world-map';
import {
  cellsInRadius, floodFill, layerCentroids, layerCells, layerPalette, paintCells, pixelToHex, pushHistory, redoHistory, undoHistory,
  type MapHistory, type MapLayerKind,
} from '../../lib/world-map-edit';
import { MapLayerPalette } from '../MapLayerPalette';
import type { MapEditorProps } from './registry';

const DND_TYPE = 'application/x-btg-location';
const MODE_LABEL: Record<'poi' | MapLayerKind, string> = { poi: '地点', terrain: '地形', faction: '势力', region: '区域' };
type EditMode = 'poi' | MapLayerKind;
type Tool = 'brush' | 'fill' | 'erase' | 'pick';


/** Optional hex map layer for a world. Spatial view only: never creates movement edges. */
export function HexMapEditor({ content, selectedLocationId, onSelectLocation, onMapChange, readOnly = false }: MapEditorProps) {
  const { t } = useI18n();
  const map = content.map;
  const [draftSize, setDraftSize] = useState({ cols: 16, rows: 10 });
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [autoFit, setAutoFit] = useState(true);
  const [hoverCell, setHoverCell] = useState<string | null>(null);
  const [cursorCell, setCursorCell] = useState<string | null>(null);
  const [selectedCell, setSelectedCell] = useState<string | null>(null);
  const [mode, setMode] = useState<EditMode>('poi');
  const [tool, setTool] = useState<Tool>('brush');
  const [brush, setBrush] = useState(1);
  const [active, setActive] = useState<Record<MapLayerKind, string | null>>({ terrain: null, faction: null, region: null });
  const [hist, setHist] = useState<MapHistory>({ past: [], future: [] });
  const panDrag = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const stroke = useRef<{ before: WorldMap | undefined } | null>(null);
  const live = useRef<WorldMap | undefined>(map);
  const lastCoalesce = useRef<{ key: string; at: number } | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  if (!stroke.current) live.current = map;

  /** Single domain-level commit path for every map edit (undoable). */
  const commit = useCallback((next: WorldMap | undefined, coalesceKey?: string) => {
    if (next === live.current) return;
    const now = Date.now(); const lc = lastCoalesce.current;
    const merge = coalesceKey && lc && lc.key === coalesceKey && now - lc.at < 1200;
    if (!merge) setHist(h => pushHistory(h, live.current));
    lastCoalesce.current = coalesceKey ? { key: coalesceKey, at: now } : null;
    live.current = next; onMapChange(next);
  }, [onMapChange]);
  const undo = useCallback(() => { const r = undoHistory(hist, live.current); if (!r) return; setHist(r.h); lastCoalesce.current = null; live.current = r.map; onMapChange(r.map); }, [hist, onMapChange]);
  const redo = useCallback(() => { const r = redoHistory(hist, live.current); if (!r) return; setHist(r.h); lastCoalesce.current = null; live.current = r.map; onMapChange(r.map); }, [hist, onMapChange]);

  const titles = useMemo(() => new Map(content.locations.map(l => [l.id, l.title])), [content.locations]);
  const geometry = map?.geometry;
  const cells = useMemo(() => {
    if (!geometry) return [];
    return listHexCells(geometry).map(a => {
      const c = hexToPixel(geometry, a);
      const corners = hexCorners(geometry, c).map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`);
      return { key: cellKey(a), c, corners, points: corners.join(' ') };
    });
  }, [geometry]);
  const bounds = useMemo(() => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    if (!geometry) return { minX: 0, minY: 0, w: 1, h: 1 };
    for (const cell of cells) for (const p of hexCorners(geometry, cell.c)) {
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
    }
    return { minX, minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
  }, [cells, geometry]);

  const fit = useCallback(() => {
    const el = viewportRef.current; if (!el) return;
    const W = el.clientWidth, H = el.clientHeight; if (W < 40 || H < 40) return;
    const pad = 20, statusH = 40;
    const z = Math.max(0.15, Math.min(3, Math.min((W - pad * 2) / bounds.w, (H - pad - statusH) / bounds.h)));
    setZoom(z);
    setPan({ x: (W - bounds.w * z) / 2 - bounds.minX * z, y: pad + (H - pad - statusH - bounds.h * z) / 2 - bounds.minY * z });
    setAutoFit(true);
  }, [bounds]);
  useLayoutEffect(() => { if (autoFit) fit(); }, [fit, autoFit, mode]);
  useEffect(() => {
    const el = viewportRef.current; if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => { if (autoFit) fit(); });
    ro.observe(el); return () => ro.disconnect();
  }, [fit, autoFit, map !== undefined]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
      if (mod || mode === 'poi') return;
      const k = e.key.toLowerCase();
      if (k === 'b') setTool('brush'); else if (k === 'g') setTool('fill'); else if (k === 'e') setTool('erase'); else if (k === 'i') setTool('pick');
      else if (k === '[') setBrush(b => Math.max(1, b - 1)); else if (k === ']') setBrush(b => Math.min(3, b + 1));
      else if (k === 'f') fit();
    }
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, mode, fit]);

  const terrainColor = useMemo(() => {
    const tl = map?.layers?.terrain; const pal = new Map(tl?.palette.map(p => [p.id, p.color]) ?? []);
    return new Map(Object.entries(tl?.cells ?? {}).map(([k, v]) => [k, pal.get(v)]));
  }, [map]);
  const factionOf = useMemo(() => new Map(Object.entries(map?.layers?.factions?.cells ?? {})), [map]);
  const factionColor = useMemo(() => new Map(map?.layers?.factions?.factions.map(f => [f.id, f.color]) ?? []), [map]);
  /** Territory borders: hex edges whose two sides belong to different factions (or map edge). */
  const factionBorders = useMemo(() => {
    const edges = new Map<string, { a: string; b: string; cells: string[] }>();
    for (const cell of cells) cell.corners.forEach((a, i) => {
      const b = cell.corners[(i + 1) % 6]; const k = a < b ? `${a}|${b}` : `${b}|${a}`;
      const e = edges.get(k) ?? { a, b, cells: [] }; e.cells.push(cell.key); edges.set(k, e);
    });
    const out: { k: string; a: string; b: string; color: string }[] = [];
    for (const [k, e] of edges) {
      const fs = e.cells.map(c => factionOf.get(c));
      for (const f of fs) if (f && (fs.length < 2 || fs[0] !== fs[1])) { const color = factionColor.get(f); if (color) out.push({ k: `${k}#${f}`, a: e.a, b: e.b, color }); }
    }
    return out;
  }, [cells, factionOf, factionColor]);
  const regionOf = useMemo(() => new Map(Object.entries(map?.layers?.regions?.cells ?? {})), [map]);
  const regionColor = useMemo(() => new Map(map?.layers?.regions?.regions.map(r => [r.id, r.color]) ?? []), [map]);
  /** Region outlines: edges between cells of different regions (dashed, drawn under labels). */
  const regionBorders = useMemo(() => {
    const edges = new Map<string, { a: string; b: string; cells: string[] }>();
    for (const cell of cells) cell.corners.forEach((a, i) => {
      const b = cell.corners[(i + 1) % 6]; const k = a < b ? `${a}|${b}` : `${b}|${a}`;
      const e = edges.get(k) ?? { a, b, cells: [] }; e.cells.push(cell.key); edges.set(k, e);
    });
    const out: { k: string; a: string; b: string; color: string }[] = [];
    for (const [k, e] of edges) {
      const rs = e.cells.map(c => regionOf.get(c));
      for (const r of rs) if (r && (rs.length < 2 || rs[0] !== rs[1])) { const color = regionColor.get(r); if (color) out.push({ k: `${k}#${r}`, a: e.a, b: e.b, color }); }
    }
    return out;
  }, [cells, regionOf, regionColor]);
  const regionLabels = useMemo(() => {
    if (!map?.layers?.regions || !geometry) return [];
    const cents = layerCentroids(map, 'region', key => { const a = parseCellKey(key); return a ? hexToPixel(geometry, a) : null; });
    return map.layers.regions.regions.flatMap(r => { const c = cents.get(r.id); return c ? [{ id: r.id, name: r.name, color: r.color, x: c.x, y: c.y, n: c.n }] : []; });
  }, [map, geometry]);
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
            <button type="button" className="primary small" disabled={readOnly} data-testid="create-map" onClick={() => commit(createEmptyMap(draftSize.cols, draftSize.rows))}>{t('创建空白地图')}</button>
          </div>
        </div>
      </div>
    </div>;
  }

  const g = map.geometry;
  const layerMode = mode !== 'poi';
  const activeId = layerMode ? active[mode] ?? layerPalette(map, mode)[0]?.id ?? null : null;

  function cellAt(clientX: number, clientY: number): string | null {
    const el = viewportRef.current; if (!el) return null;
    const rect = el.getBoundingClientRect();
    const a = pixelToHex(g, (clientX - rect.left - pan.x) / zoom, (clientY - rect.top - pan.y) / zoom);
    return hexInBounds(g, a) ? cellKey(a) : null;
  }
  function applyTool(key: string) {
    const cur = live.current; if (!cur || !layerMode) return;
    const kind = mode as MapLayerKind;
    if (tool === 'pick') {
      const v = layerCells(cur, kind)[key];
      if (v) { setActive(s => ({ ...s, [kind]: v })); setTool('brush'); }
      return;
    }
    if (tool === 'fill') { commitStrokeless(floodFill(cur, kind, key, activeId)); return; }
    const a = parseCellKey(key); if (!a) return;
    const value = tool === 'erase' ? null : activeId;
    if (tool === 'brush' && !value) return;
    const next = paintCells(cur, kind, cellsInRadius(g, a, brush - 1), value);
    if (next !== cur) { live.current = next; onMapChange(next); }
  }
  function commitStrokeless(next: WorldMap) { stroke.current = null; commit(next); }

  function onDrop(e: DragEvent, key: string) {
    e.preventDefault(); setHoverCell(null);
    const id = e.dataTransfer.getData(DND_TYPE);
    if (!id || readOnly || !map) return;
    commit(bindLocationToCell(map, id, key));
    onSelectLocation(id); setSelectedCell(key);
  }
  function startDrag(e: DragEvent, id: string) { e.dataTransfer.setData(DND_TYPE, id); e.dataTransfer.effectAllowed = 'move'; }
  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    const wantsPan = e.button === 1 || e.altKey || e.button === 2;
    if (layerMode && !readOnly && !wantsPan && e.button === 0) {
      const key = cellAt(e.clientX, e.clientY);
      if (key) {
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
        if (tool === 'brush' || tool === 'erase') stroke.current = { before: live.current };
        applyTool(key);
        return;
      }
    }
    if (!layerMode && !wantsPan && (e.target as Element).closest('[data-cell],[data-poi]')) return;
    panDrag.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
  }
  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const key = cellAt(e.clientX, e.clientY);
    if (key !== cursorCell) setCursorCell(key);
    if (stroke.current && key) { applyTool(key); return; }
    const d = panDrag.current; if (!d) return;
    setAutoFit(false);
    setPan({ x: d.panX + e.clientX - d.x, y: d.panY + e.clientY - d.y });
  }
  function onPointerUp() {
    panDrag.current = null;
    const s = stroke.current; if (!s) return;
    stroke.current = null;
    if (live.current !== s.before) { setHist(h => pushHistory(h, s.before)); lastCoalesce.current = null; }
  }
  function onWheel(e: ReactWheelEvent<HTMLDivElement>) {
    const el = viewportRef.current; if (!el) return;
    const rect = el.getBoundingClientRect(); const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const nz = Math.max(0.15, Math.min(4, zoom * (e.deltaY < 0 ? 1.1 : 0.9)));
    setPan({ x: mx - (mx - pan.x) * (nz / zoom), y: my - (my - pan.y) * (nz / zoom) });
    setZoom(nz); setAutoFit(false);
  }
  const terrainLabel = (k: string) => { const tid = map.layers?.terrain?.cells[k]; return map.layers?.terrain?.palette.find(p => p.id === tid)?.label; };
  const regionName = (k: string) => { const rid = regionOf.get(k); return map.layers?.regions?.regions.find(r => r.id === rid)?.name; };
  const factionName = (k: string) => { const fid = factionOf.get(k); return map.layers?.factions?.factions.find(f => f.id === fid)?.name; };
  const shownCell = layerMode ? cursorCell : selectedPoiCell ?? selectedCell;
  const selCellPois = shownCell ? poiByCell.get(shownCell) ?? [] : [];
  const sel = shownCell ? parseCellKey(shownCell) : null;
  const brushPreview = brushPreviewPolys(layerMode && (tool === 'brush' || tool === 'erase') ? cursorCell : null, brush, g);
  const factionOpacity = mode === 'faction' ? 0.5 : 0.22;
  const labelSize = Math.max(10, Math.min(28, 12 / zoom));
  const toolDefs: { id: Tool; label: string; key: string }[] = [
    { id: 'brush', label: '画笔', key: 'B' }, { id: 'fill', label: '填充', key: 'G' }, { id: 'erase', label: '橡皮', key: 'E' }, { id: 'pick', label: '吸管', key: 'I' },
  ];

  return <div className="branch-canvas primary world-map-pane" data-testid="world-map-canvas">
    <div className="branch-canvas-chrome world-map-chrome">
      <div className="world-map-title"><h4>{t('世界地图')}</h4>
        <span className="world-map-chip">{t('六边形')} · {g.cols}×{g.rows}</span>
        <span className="world-map-chip">{t('已放置 {n}/{total}', { n: bound.size, total: content.locations.length })}</span>
      </div>
      <div className="branch-canvas-toolbar">
        <div className="map-seg" role="group" aria-label={t('撤销')}>
          <button type="button" className="small" data-testid="map-undo" disabled={!hist.past.length || readOnly} title="Ctrl+Z" onClick={undo}>↶ {t('撤销')}</button>
          <button type="button" className="small" data-testid="map-redo" disabled={!hist.future.length || readOnly} title="Ctrl+Shift+Z" onClick={redo}>↷ {t('重做')}</button>
        </div>
        <label className="inline">{t('列')}<input type="number" min={1} max={64} value={g.cols} disabled={readOnly} onChange={e => commit(resizeMap(map, Number(e.target.value), g.rows), 'resize')} /></label>
        <label className="inline">{t('行')}<input type="number" min={1} max={48} value={g.rows} disabled={readOnly} onChange={e => commit(resizeMap(map, g.cols, Number(e.target.value)), 'resize')} /></label>
        <button type="button" className={`small${autoFit ? ' active' : ''}`} data-testid="map-fit" title="F" onClick={fit}>⤢ {t('适配')}</button>
        <button type="button" className="small quiet" disabled={readOnly} onClick={() => { if (window.confirm(t('删除地图图层？地点与行动不受影响。（可撤销）'))) commit(undefined); }}>{t('删除地图')}</button>
      </div>
    </div>
    <div className="world-map-body">
      <aside className="world-map-tray" aria-label={t('地图工具')}>
        <div className="map-seg map-mode" role="tablist" aria-label={t('编辑图层')}>
          {(['poi', 'terrain', 'faction', 'region'] as const).map(m => <button key={m} type="button" role="tab" aria-selected={mode === m} data-testid={`map-mode-${m}`}
            className={`small${mode === m ? ' active' : ''}`} onClick={() => setMode(m)}>{t(MODE_LABEL[m])}</button>)}
        </div>
        {layerMode ? <>
          <div className="map-tools" role="toolbar" aria-label={t('工具')}>
            {toolDefs.map(d => <button key={d.id} type="button" data-testid={`map-tool-${d.id}`} className={`small${tool === d.id ? ' active' : ''}`} title={`${t(d.label)} (${d.key})`} onClick={() => setTool(d.id)}>
              <span className={`map-tool-icon ${d.id}`} aria-hidden />{t(d.label)}</button>)}
          </div>
          <div className="map-brush-size">
            <span className="world-map-tray-label">{t('笔刷')}</span>
            <div className="map-seg">
              {[1, 2, 3].map(n => <button key={n} type="button" data-testid={`map-brush-${n}`} className={`small${brush === n ? ' active' : ''}`} disabled={tool === 'fill' || tool === 'pick'} onClick={() => setBrush(n)}>{n}</button>)}
            </div>
            <span className="hint">{t('格半径 {n}', { n: brush - 1 })}</span>
          </div>
          <MapLayerPalette map={map} kind={mode} actions={content.actions} activeId={activeId} readOnly={readOnly}
            onActive={id => { setActive(s => ({ ...s, [mode]: id })); if (tool === 'erase' || tool === 'pick') setTool('brush'); }} onChange={commit} />
          <p className="hint map-tray-hint">{t('拖动涂抹；Alt/中键拖动平移；[ ] 调笔刷；Ctrl+Z 撤销。')}</p>
        </> : <>
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
                  ? <button type="button" className="quiet tiny" disabled={readOnly} title={t('从地图移除')} onClick={e => { e.stopPropagation(); commit(unbindLocation(map, l.id)); }}>×</button>
                  : <span className="tag">{t('未放置')}</span>}
              </li>;
            })}
          </ul>
        </>}
        {issues.length > 0 && <div className="world-map-issues" data-testid="world-map-issues">
          <p className="world-map-tray-label">{t('地图提示')} · {issues.length}</p>
          <ul>{issues.slice(0, 8).map((i, n) => <li key={n} className={i.level}>{i.message}</li>)}</ul>
        </div>}
      </aside>
      <div ref={viewportRef} className={`branch-canvas-viewport world-map-viewport${layerMode ? ` painting tool-${tool}` : ''}`} onPointerDown={onPointerDown} onPointerMove={onPointerMove}
        onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onPointerLeave={() => setCursorCell(null)} onWheel={onWheel} onContextMenu={e => layerMode && e.preventDefault()}>
        <svg className="branch-canvas-svg" width="100%" height="100%">
          <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
            {cells.map(cell => <polygon key={cell.key} data-cell={cell.key} points={cell.points}
              className={`hex${hoverCell === cell.key ? ' drop' : ''}${!layerMode && (selectedCell === cell.key || selectedPoiCell === cell.key) ? ' selected' : ''}${poiByCell.has(cell.key) ? ' has-poi' : ''}`}
              onClick={() => { if (layerMode) return; setSelectedCell(cell.key); const ids = poiByCell.get(cell.key); if (ids?.[0]) onSelectLocation(ids[0]); }}
              onDragOver={e => { if (!readOnly) { e.preventDefault(); setHoverCell(cell.key); } }}
              onDragLeave={() => setHoverCell(h => (h === cell.key ? null : h))}
              onDrop={e => onDrop(e, cell.key)}
              style={terrainColor.get(cell.key) ? { fill: terrainColor.get(cell.key), opacity: mode === 'faction' ? 0.55 : 1 } : undefined} />)}
            <g className="world-map-factions" pointerEvents="none">
              {cells.map(cell => { const f = factionOf.get(cell.key); const col = f && factionColor.get(f);
                return col ? <polygon key={cell.key} points={cell.points} fill={col} fillOpacity={factionOpacity} stroke="none" /> : null; })}
              {factionBorders.map(e => { const [x1, y1] = e.a.split(',').map(Number); const [x2, y2] = e.b.split(',').map(Number);
                return <line key={e.k} x1={x1} y1={y1} x2={x2} y2={y2} stroke={e.color} strokeWidth={mode === 'faction' ? 3 : 2.5} strokeLinecap="round" />; })}
            </g>
            {(regionLabels.length > 0 || mode === 'region') && <g className="world-map-regions" pointerEvents="none" data-testid="world-map-regions">
              {mode === 'region' && cells.map(cell => { const r = regionOf.get(cell.key); const col = r && regionColor.get(r);
                return col ? <polygon key={cell.key} points={cell.points} fill={col} fillOpacity={0.45} stroke="none" /> : null; })}
              {regionBorders.map(e => { const [x1, y1] = e.a.split(',').map(Number); const [x2, y2] = e.b.split(',').map(Number);
                return <line key={e.k} x1={x1} y1={y1} x2={x2} y2={y2} stroke={e.color} strokeWidth={mode === 'region' ? 2.5 : 1.6} strokeDasharray="6 4" strokeLinecap="round" />; })}
              {regionLabels.map(l => <text key={l.id} data-region-label={l.id} x={l.x} y={l.y} textAnchor="middle" dominantBaseline="middle" className="region-label"
                style={{ fontSize: Math.max(14, Math.min(40, g.size * 0.9 + Math.sqrt(l.n) * 1.5)), fill: '#2a2118', stroke: '#fffaf0', strokeWidth: 4, paintOrder: 'stroke', fontWeight: 700, letterSpacing: 2, opacity: mode === 'region' ? 0.95 : 0.7 }}>{l.name}</text>)}
            </g>}
            {brushPreview.length > 0 && <g className="map-brush-preview" pointerEvents="none">
              {brushPreview.map(p => <polygon key={p} points={p} />)}
            </g>}
            <g className={layerMode ? 'pois-passive' : ''}>
              {map.pois.map(p => {
                const a = parseCellKey(p.anchor.cell); if (!a) return null;
                const c = hexToPixel(g, a);
                const selected = p.locationId === selectedLocationId;
                const missing = !titles.has(p.locationId);
                const label = p.label ?? titles.get(p.locationId) ?? p.locationId;
                return <g key={p.locationId} data-poi={p.locationId} className={`poi${selected ? ' selected' : ''}${missing ? ' missing' : ''}${p.locationId === content.initialLocationId ? ' start' : ''}`}
                  transform={`translate(${c.x} ${c.y})`} onClick={() => { if (layerMode) return; setSelectedCell(p.anchor.cell); onSelectLocation(p.locationId); }}>
                  <circle r={g.size * 0.38} />
                  <text y={g.size * 0.38 + labelSize + 1} textAnchor="middle" style={{ fontSize: labelSize, strokeWidth: labelSize / 4 }}>{label.length > 8 ? `${label.slice(0, 8)}…` : label}</text>
                </g>;
              })}
            </g>
          </g>
        </svg>
        {!layerMode && (map.layers?.terrain || map.layers?.factions || map.layers?.regions) && <div className="world-map-legend" data-testid="world-map-legend">
          {map.layers?.terrain && <div><p className="world-map-tray-label">{t('地形')}</p>
            {map.layers.terrain.palette.map(p => <span key={p.id}><i style={{ background: p.color }} />{p.label}</span>)}</div>}
          {map.layers?.factions && <div><p className="world-map-tray-label">{t('势力')}</p>
            {map.layers.factions.factions.map(f => <span key={f.id}><i className="faction" style={{ background: `${f.color}38`, borderColor: f.color }} />{f.name}</span>)}</div>}
          {map.layers?.regions && <div><p className="world-map-tray-label">{t('区域')}</p>
            {map.layers.regions.regions.map(r => <span key={r.id}><i className="faction" style={{ background: 'transparent', borderColor: r.color, borderStyle: 'dashed' }} />{r.name}</span>)}</div>}
        </div>}
        <div className="world-map-status">
          {sel ? <span>{t('格')} {shownCell} · q {sel.q} · r {sel.r}{shownCell && terrainLabel(shownCell) ? ` · ${terrainLabel(shownCell)}` : ''}{shownCell && factionName(shownCell) ? ` · ${factionName(shownCell)}` : ''}{shownCell && regionName(shownCell) ? ` · ${regionName(shownCell)}` : ''}{selCellPois.length ? ` · ${selCellPois.map(id => titles.get(id) ?? id).join('、')}` : ''}</span>
            : <span>{t(layerMode ? '在地图上拖动涂抹；滚轮缩放。' : '点击格子或标记查看；滚轮缩放，拖动空白处平移。')}</span>}
          <span>{Math.round(zoom * 100)}%</span>
        </div>
      </div>
    </div>
  </div>;
}

function brushPreviewPolys(cell: string | null, brush: number, g: WorldMap['geometry']): string[] {
  const a = cell ? parseCellKey(cell) : null; if (!a) return [];
  return cellsInRadius(g, a, brush - 1).map(k => {
    const c = hexToPixel(g, parseCellKey(k)!);
    return hexCorners(g, c).map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  });
}
