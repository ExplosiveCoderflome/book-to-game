import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type PointerEvent as ReactPointerEvent, type RefObject, type WheelEvent as ReactWheelEvent } from 'react';
import type { WorldMap } from '@novel-game/contracts';
import { cellKey, hexInBounds, parseCellKey } from '@novel-game/rules';
import { cellsInRadius, floodFill, layerCells, layerPalette, paintCells, pixelToHex, pushHistory, redoHistory, undoHistory, type MapHistory, type MapLayerKind } from '../../../lib/world-map-edit';
import { bindLocationToCell } from '../../../lib/world-map';
import type { MapEditorProps } from '../registry';
import { readMapHistory, writeMapHistory } from '../history-store';
import type { HexEditMode, HexRenderState, HexRendererHandle, HexView } from './renderer';
import { buildHexTopology } from './topology';

export type HexTool = 'brush' | 'fill' | 'erase' | 'pick';
export const DND_TYPE = 'application/x-btg-location';

/**
 * Renderer-agnostic hex editor controller: tools, palette selection, strokes, undo, hit-testing,
 * pan/zoom (kept in a ref, pushed imperatively to the renderer — never React state).
 */
export function useHexMapController({ content, selectedLocationId, onSelectLocation, onMapChange, readOnly = false, historyKey }: MapEditorProps,
  viewportRef: RefObject<HTMLDivElement | null>, rendererRef: RefObject<HexRendererHandle | null>, zoomLabelRef: RefObject<HTMLSpanElement | null>) {
  const map = content.map;
  const [mode, setMode] = useState<HexEditMode>('poi');
  const [tool, setTool] = useState<HexTool>('brush');
  const [brush, setBrush] = useState(1);
  const [active, setActive] = useState<Record<MapLayerKind, string | null>>({ terrain: null, faction: null, region: null });
  const [hist, setHistState] = useState<MapHistory>(() => readMapHistory(historyKey));
  const histRef = useRef(hist);
  const setHist = useCallback((u: MapHistory | ((h: MapHistory) => MapHistory)) => {
    const next = typeof u === 'function' ? u(histRef.current) : u; histRef.current = next; writeMapHistory(historyKey, next); setHistState(next);
  }, [historyKey]);
  useEffect(() => { const h = readMapHistory(historyKey); histRef.current = h; setHistState(h); }, [historyKey]);
  const [cursorCell, setCursorCell] = useState<string | null>(null);
  const [dropCell, setDropCell] = useState<string | null>(null);
  const [selectedCell, setSelectedCell] = useState<string | null>(null);
  const [autoFit, setAutoFit] = useState(true);
  /** Stroke-local map: painting updates only the editor; WorldsPanel gets one commit on pointer-up. */
  const [strokeMap, setStrokeMap] = useState<WorldMap | null>(null);
  const stroke = useRef<{ before: WorldMap | undefined; map: WorldMap } | null>(null);
  const view = useRef<HexView>({ x: 0, y: 0, zoom: 1 });
  const panDrag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean; click: boolean } | null>(null);
  const live = useRef<WorldMap | undefined>(map);
  const lastCoalesce = useRef<{ key: string; at: number } | null>(null);
  if (!stroke.current) live.current = map;
  const shown = strokeMap ?? map;

  const geometry = map?.geometry;
  const topo = useMemo(() => (geometry ? buildHexTopology(geometry) : null), [geometry?.kind, geometry?.cols, geometry?.rows, geometry?.size, geometry?.orientation]); // eslint-disable-line react-hooks/exhaustive-deps

  const applyView = useCallback((v: HexView) => {
    view.current = v; rendererRef.current?.applyView(v);
    if (zoomLabelRef.current) zoomLabelRef.current.textContent = `${Math.round(v.zoom * 100)}%`;
  }, [rendererRef, zoomLabelRef]);
  const fit = useCallback(() => {
    const el = viewportRef.current; if (!el || !topo) return;
    const W = el.clientWidth, H = el.clientHeight; if (W < 40 || H < 40) return;
    const b = topo.bounds; const pad = 20, statusH = 40;
    const z = Math.max(0.15, Math.min(3, Math.min((W - pad * 2) / b.w, (H - pad - statusH) / b.h)));
    applyView({ zoom: z, x: (W - b.w * z) / 2 - b.minX * z, y: pad + (H - pad - statusH - b.h * z) / 2 - b.minY * z });
    setAutoFit(true);
  }, [topo, viewportRef, applyView]);
  useLayoutEffect(() => { if (autoFit) fit(); }, [fit, autoFit, mode]);
  useEffect(() => {
    const el = viewportRef.current; if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => { if (autoFit) fit(); });
    ro.observe(el); return () => ro.disconnect();
  }, [fit, autoFit, map !== undefined]); // eslint-disable-line react-hooks/exhaustive-deps

  const commit = useCallback((next: WorldMap | undefined, coalesceKey?: string) => {
    if (next === live.current) return;
    const now = Date.now(); const lc = lastCoalesce.current;
    const merge = coalesceKey && lc && lc.key === coalesceKey && now - lc.at < 1200;
    if (!merge) setHist(h => pushHistory(h, live.current));
    lastCoalesce.current = coalesceKey ? { key: coalesceKey, at: now } : null;
    live.current = next; onMapChange(next);
  }, [onMapChange, setHist]);
  const undo = useCallback(() => { const r = undoHistory(hist, live.current); if (!r) return; setHist(r.h); lastCoalesce.current = null; live.current = r.map; onMapChange(r.map); }, [hist, onMapChange, setHist]);
  const redo = useCallback(() => { const r = redoHistory(hist, live.current); if (!r) return; setHist(r.h); lastCoalesce.current = null; live.current = r.map; onMapChange(r.map); }, [hist, onMapChange, setHist]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
      if (mod) return;
      const k = e.key.toLowerCase();
      if (k === 'f') { fit(); return; }
      if (mode === 'poi') return;
      if (k === 'b') setTool('brush'); else if (k === 'g') setTool('fill'); else if (k === 'e') setTool('erase'); else if (k === 'i') setTool('pick');
      else if (k === '[') setBrush(b => Math.max(1, b - 1)); else if (k === ']') setBrush(b => Math.min(3, b + 1));
    }
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, mode, fit]);

  const layerMode = mode !== 'poi';
  const activeId = map && layerMode ? active[mode] ?? layerPalette(map, mode)[0]?.id ?? null : null;

  function cellAt(clientX: number, clientY: number): string | null {
    const el = viewportRef.current; if (!el || !map) return null;
    const rect = el.getBoundingClientRect(); const v = view.current;
    const a = pixelToHex(map.geometry, (clientX - rect.left - v.x) / v.zoom, (clientY - rect.top - v.y) / v.zoom);
    return hexInBounds(map.geometry, a) ? cellKey(a) : null;
  }
  function applyTool(key: string) {
    const cur = stroke.current?.map ?? live.current; if (!cur || !layerMode) return;
    const kind = mode as MapLayerKind;
    if (tool === 'pick') { const v = layerCells(cur, kind)[key]; if (v) { setActive(s => ({ ...s, [kind]: v })); setTool('brush'); } return; }
    if (tool === 'fill') { commit(floodFill(cur, kind, key, activeId)); return; }
    const a = parseCellKey(key); if (!a || !stroke.current) return;
    const value = tool === 'erase' ? null : activeId; if (tool === 'brush' && !value) return;
    const next = paintCells(cur, kind, cellsInRadius(cur.geometry, a, brush - 1), value);
    if (next !== cur) { stroke.current.map = next; setStrokeMap(next); }
  }
  function endStroke() {
    const s = stroke.current; if (!s) return; stroke.current = null; setStrokeMap(null);
    if (s.map !== s.before) { setHist(h => pushHistory(h, s.before)); lastCoalesce.current = null; live.current = s.map; onMapChange(s.map); }
  }
  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if ((e.target as Element).closest('.world-map-legend,.world-map-status')) return;
    const wantsPan = e.button === 1 || e.altKey || e.button === 2;
    const key = cellAt(e.clientX, e.clientY);
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
    if (layerMode && !readOnly && !wantsPan && e.button === 0 && key) {
      if ((tool === 'brush' || tool === 'erase') && live.current) stroke.current = { before: live.current, map: live.current };
      applyTool(key); return;
    }
    panDrag.current = { x: e.clientX, y: e.clientY, vx: view.current.x, vy: view.current.y, moved: false, click: !layerMode && !wantsPan && e.button === 0 };
  }
  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const d = panDrag.current;
    if (d) {
      const dx = e.clientX - d.x, dy = e.clientY - d.y;
      if (!d.moved && Math.hypot(dx, dy) < 4) return;
      if (!d.moved) { d.moved = true; setAutoFit(false); }
      applyView({ ...view.current, x: d.vx + dx, y: d.vy + dy }); return;
    }
    const key = cellAt(e.clientX, e.clientY);
    if (layerMode && key !== cursorCell) setCursorCell(key);
    if (stroke.current && key) applyTool(key);
  }
  function onPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    const d = panDrag.current; panDrag.current = null;
    if (d && d.click && !d.moved && map) {
      const poi = (e.target as Element | null)?.closest?.('[data-poi]')?.getAttribute('data-poi');
      const key = (e.target as Element | null)?.closest?.('[data-cell]')?.getAttribute('data-cell') ?? cellAt(e.clientX, e.clientY);
      if (poi) { setSelectedCell(map.pois.find(p => p.locationId === poi)?.anchor.cell ?? null); onSelectLocation(poi); }
      else if (key) { setSelectedCell(key); const ids = map.pois.filter(p => p.anchor.cell === key); if (ids[0]) onSelectLocation(ids[0].locationId); }
    }
    endStroke();
  }
  function onWheel(e: ReactWheelEvent<HTMLDivElement>) {
    const el = viewportRef.current; if (!el) return;
    const rect = el.getBoundingClientRect(); const mx = e.clientX - rect.left, my = e.clientY - rect.top; const v = view.current;
    const nz = Math.max(0.15, Math.min(4, v.zoom * (e.deltaY < 0 ? 1.1 : 0.9)));
    applyView({ zoom: nz, x: mx - (mx - v.x) * (nz / v.zoom), y: my - (my - v.y) * (nz / v.zoom) }); setAutoFit(false);
  }
  const dropTarget = (e: DragEvent) => (e.target as Element | null)?.closest?.('[data-cell]')?.getAttribute('data-cell') ?? cellAt(e.clientX, e.clientY);
  function onDragOver(e: DragEvent<HTMLDivElement>) { if (readOnly) return; const k = dropTarget(e); if (!k) return; e.preventDefault(); if (k !== dropCell) setDropCell(k); }
  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault(); setDropCell(null);
    const id = e.dataTransfer.getData(DND_TYPE); const key = dropTarget(e);
    if (!id || !key || readOnly || !map) return;
    commit(bindLocationToCell(map, id, key)); onSelectLocation(id); setSelectedCell(key);
  }
  const brushCells = useMemo(() => {
    const a = layerMode && (tool === 'brush' || tool === 'erase') && cursorCell && map ? parseCellKey(cursorCell) : null;
    return a && map ? cellsInRadius(map.geometry, a, brush - 1).filter(k => { const p = parseCellKey(k); return p && hexInBounds(map.geometry, p); }) : [];
  }, [layerMode, tool, cursorCell, brush, map?.geometry]); // eslint-disable-line react-hooks/exhaustive-deps
  const titles = useMemo(() => new Map(content.locations.map(l => [l.id, l.title])), [content.locations]);
  const selectedPoiCell = map?.pois.find(p => p.locationId === selectedLocationId)?.anchor.cell;
  const selKey = !layerMode ? [selectedCell, selectedPoiCell].filter((k): k is string => !!k).join('|') : '';
  const selectedCells = useMemo(() => (selKey ? [...new Set(selKey.split('|'))] : []), [selKey]);
  const renderState = useMemo<HexRenderState | null>(() => (shown && topo ? {
    map: shown, topo, mode, titles, initialLocationId: content.initialLocationId, selectedLocationId, selectedCells, dropCell, brushCells,
  } : null), [shown, topo, mode, titles, content.initialLocationId, selectedLocationId, selectedCells, dropCell, brushCells]);

  return {
    map, shown, topo, mode, setMode, tool, setTool, brush, setBrush, active, setActive, activeId, hist, undo, redo, commit, fit, autoFit,
    cursorCell, setCursorCell, selectedCell, selectedPoiCell, layerMode, renderState, view,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp, onPointerLeave: () => setCursorCell(null), onWheel, onDragOver, onDragLeave: () => setDropCell(null), onDrop },
  };
}
