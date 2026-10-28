import { lazy, Suspense, useMemo, useRef, useState, type DragEvent } from 'react';
import { MAP_SIZE_PRESETS, MAP_TEMPLATES, getMapTemplate, mapSizePreset } from '@novel-game/contracts';
import { mapIdOf, parseCellKey, validateWorldMap, worldMaps } from '@novel-game/rules';
import { useI18n } from '../../lib/i18n';
import { applyMapTemplate, createEmptyMap, resizeMap, resizeMapEdge, setPoiVenueType, unbindLocation, type MapEdge } from '../../lib/world-map';
import { layerPalette } from '../../lib/world-map-edit';
import { MapLayerPalette } from '../MapLayerPalette';
import type { MapEditorProps } from './registry';
import { SvgHexRenderer } from './hex/SvgHexRenderer';
import { preferredHexRenderer, setPreferredHexRenderer, webglAvailable, type HexRendererHandle, type HexRendererId } from './hex/renderer';
import { DND_TYPE, useHexMapController, type HexTool } from './hex/useHexMapController';

const MODE_LABEL: Record<'poi' | 'terrain' | 'faction' | 'region', string> = { poi: '地点', terrain: '地形', faction: '势力', region: '区域' };
/** Pixi (and pixi.js itself) is only fetched when the WebGL renderer is actually used. */
const PixiHexRenderer = lazy(() => import('./hex/PixiHexRenderer').then(m => ({ default: m.PixiHexRenderer })));
const RENDERERS = { pixi: PixiHexRenderer, svg: SvgHexRenderer } as const;
const EDGE_LABEL: Record<MapEdge, string> = { left: '左', right: '右', top: '上', bottom: '下' };

/** Optional hex map layer for a world. Spatial view only: never creates movement edges.
 *  Shell (chrome/tray/legend/status) + renderer-agnostic controller + swappable renderer (Pixi default, SVG fallback). */
export function HexMapEditor(props: MapEditorProps) {
  const { content, selectedLocationId, onSelectLocation, readOnly = false } = props;
  const { t } = useI18n();
  const [draftSize, setDraftSize] = useState({ cols: 16, rows: 10 });
  const [draftTemplate, setDraftTemplate] = useState('');
  const [templateNote, setTemplateNote] = useState<string | null>(null);
  const [rendererId, setRendererId] = useState<HexRendererId>(() => preferredHexRenderer());
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<HexRendererHandle | null>(null);
  const zoomRef = useRef<HTMLSpanElement | null>(null);
  const c = useHexMapController(props, viewportRef, rendererRef, zoomRef);
  const { map, mode, setMode, tool, setTool, brush, setBrush, setActive, activeId, hist, undo, redo, commit, fit, autoFit, cursorCell, selectedCell, selectedPoiCell, layerMode, renderState } = c;
  /** Locations already anchored on another map (root ↔ sub-maps) are not offered in this map's tray. */
  const placedElsewhere = useMemo(() => new Set(worldMaps(content).filter(m => mapIdOf(m) !== (map ? mapIdOf(map) : '')).flatMap(m => m.pois.map(p => p.locationId))), [content, map]);
  const titles = useMemo(() => new Map(content.locations.map(l => [l.id, l.title])), [content.locations]);
  const factionOf = useMemo(() => new Map(Object.entries(map?.layers?.factions?.cells ?? {})), [map?.layers?.factions]);
  const regionOf = useMemo(() => new Map(Object.entries(map?.layers?.regions?.cells ?? {})), [map?.layers?.regions]);
  const poiByCell = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const p of map?.pois ?? []) m.set(p.anchor.cell, [...(m.get(p.anchor.cell) ?? []), p.locationId]);
    return m;
  }, [map?.pois]);
  const issues = useMemo(() => (map ? validateWorldMap(map, content.locations.map(l => l.id)) : []), [map, content.locations]);
  const bound = useMemo(() => new Set(map?.pois.map(p => p.locationId) ?? []), [map?.pois]);
  const problemLocations = useMemo(() => new Set(issues.filter(i => i.level === 'error').map(i => i.locationId)), [issues]);

  if (!map) {
    return <div className="branch-canvas primary world-map-pane" data-testid="world-map-canvas">
      <div className="branch-canvas-chrome"><div><h4>{t('世界地图')}</h4><p className="hint">{t('可选图层：六边形格 + 地点标记。没有地图的世界照常可玩。')}</p></div></div>
      <div className="branch-canvas-viewport world-map-empty">
        <div className="branch-canvas-empty-card">
          <strong>{t('尚未创建地图')}</strong>
          <p>{t('地图只做空间解释，移动仍由地点图中的行动决定。')}</p>
          <div className="map-template-picker" data-testid="map-template-picker">
            <p className="world-map-tray-label">{t('题材模板（可选，不按小说自动判定）')}</p>
            <div className="map-template-cards">
              {[{ id: '', label: '空白', blurb: '不预设地形与势力，全部自己定义。' }, ...MAP_TEMPLATES].map(tp => <button key={tp.id || 'blank'} type="button" data-testid={`map-template-${tp.id || 'blank'}`}
                className={`map-template-card${draftTemplate === tp.id ? ' active' : ''}`}
                onClick={() => { setDraftTemplate(tp.id); const full = getMapTemplate(tp.id); if (full) { const p = mapSizePreset(full.defaultSize); setDraftSize({ cols: p.cols, rows: p.rows }); } }}>
                <strong>{t(tp.label)}</strong><span>{t(tp.blurb)}</span>
                {'terrain' in tp && <span className="map-template-swatches">{tp.terrain.map(x => <i key={x.id} title={x.label} style={{ background: x.color }} />)}</span>}
                {'hierarchy' in tp && <span className="hint">{tp.hierarchy.join(' › ')}</span>}
              </button>)}
            </div>
          </div>
          <div className="world-map-size">
            <div className="map-seg" role="group" aria-label={t('尺寸预设')}>
              {MAP_SIZE_PRESETS.map(p => <button key={p.id} type="button" data-testid={`map-size-${p.id}`} className={`small${draftSize.cols === p.cols && draftSize.rows === p.rows ? ' active' : ''}`}
                onClick={() => setDraftSize({ cols: p.cols, rows: p.rows })}>{t(p.label)} {p.cols}×{p.rows}</button>)}
            </div>
            <label>{t('列')}<input type="number" min={1} max={64} value={draftSize.cols} onChange={e => setDraftSize(s => ({ ...s, cols: Number(e.target.value) }))} /></label>
            <label>{t('行')}<input type="number" min={1} max={48} value={draftSize.rows} onChange={e => setDraftSize(s => ({ ...s, rows: Number(e.target.value) }))} /></label>
            <button type="button" className="primary small" disabled={readOnly} data-testid="create-map" onClick={() => {
              const blank = createEmptyMap(draftSize.cols, draftSize.rows); const tp = getMapTemplate(draftTemplate);
              commit(tp ? applyMapTemplate(blank, tp).map : blank);
            }}>{t(draftTemplate ? '按模板创建地图' : '创建空白地图')}</button>
          </div>
        </div>
      </div>
    </div>;
  }

  const g = map.geometry;
  const Renderer = RENDERERS[rendererId];

  function startDrag(e: DragEvent, id: string) { e.dataTransfer.setData(DND_TYPE, id); e.dataTransfer.effectAllowed = 'move'; }
  const terrainLabel = (k: string) => { const tid = map.layers?.terrain?.cells[k]; return map.layers?.terrain?.palette.find(p => p.id === tid)?.label; };
  const regionName = (k: string) => { const rid = regionOf.get(k); return map.layers?.regions?.regions.find(r => r.id === rid)?.name; };
  const factionName = (k: string) => { const fid = factionOf.get(k); return map.layers?.factions?.factions.find(f => f.id === fid)?.name; };
  const shownCell = layerMode ? cursorCell : selectedPoiCell ?? selectedCell;
  const selCellPois = shownCell ? poiByCell.get(shownCell) ?? [] : [];
  const sel = shownCell ? parseCellKey(shownCell) : null;
  const toolDefs: { id: HexTool; label: string; key: string }[] = [
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
        <details className="map-pop" data-testid="map-size-pop">
          <summary className="small">{t('尺寸')} {g.cols}×{g.rows}</summary>
          <div className="map-pop-body">
            <p className="world-map-tray-label">{t('预设')}</p>
            <div className="map-seg">{MAP_SIZE_PRESETS.map(p => <button key={p.id} type="button" className={`small${g.cols === p.cols && g.rows === p.rows ? ' active' : ''}`} data-testid={`map-preset-${p.id}`} disabled={readOnly}
              onClick={() => commit(resizeMap(map, p.cols, p.rows))}>{t(p.label)} {p.cols}×{p.rows}</button>)}</div>
            <div className="field-row">
              <label className="inline">{t('列')}<input type="number" min={1} max={64} value={g.cols} disabled={readOnly} onChange={e => commit(resizeMap(map, Number(e.target.value), g.rows), 'resize')} /></label>
              <label className="inline">{t('行')}<input type="number" min={1} max={48} value={g.rows} disabled={readOnly} onChange={e => commit(resizeMap(map, g.cols, Number(e.target.value)), 'resize')} /></label>
            </div>
            <p className="world-map-tray-label">{t('按边扩缩（左/上会平移已有内容）')}</p>
            <div className="map-edge-grid">
              {(['top', 'left', 'right', 'bottom'] as const).map(edge => <div key={edge} className={`map-edge ${edge}`}>
                <span>{t(EDGE_LABEL[edge])}</span>
                <button type="button" className="tiny" data-testid={`map-edge-${edge}-minus`} disabled={readOnly} onClick={() => commit(resizeMapEdge(map, edge, -1))}>−</button>
                <button type="button" className="tiny" data-testid={`map-edge-${edge}-plus`} disabled={readOnly} onClick={() => commit(resizeMapEdge(map, edge, 1))}>+</button>
              </div>)}
            </div>
          </div>
        </details>
        <details className="map-pop" data-testid="map-template-pop">
          <summary className="small">{t('模板')}{map.mapTemplate ? ` · ${t(getMapTemplate(map.mapTemplate.mapTemplateId)?.label ?? map.mapTemplate.mapTemplateId)}` : ''}</summary>
          <div className="map-pop-body">
            <p className="hint">{t('只补充缺少的地形/势力/区域/场所类型，不会改名或删除已有条目。')}</p>
            {MAP_TEMPLATES.map(tp => <button key={tp.id} type="button" className="small" disabled={readOnly} data-testid={`map-apply-${tp.id}`}
              onClick={() => { const r = applyMapTemplate(map, tp); setTemplateNote(t('已补充 {n} 项', { n: r.added })); if (r.added) commit(r.map); }}>{t(tp.label)}</button>)}
            {templateNote && <p className="hint">{templateNote}</p>}
          </div>
        </details>
        <select className="small" style={{ width: "auto" }} data-testid="map-renderer" value={rendererId} title={t('地图渲染器')} onChange={e => { const v = e.target.value as HexRendererId; setPreferredHexRenderer(v); setRendererId(v); }}>
          <option value="pixi" disabled={!webglAvailable()}>WebGL</option><option value="svg">SVG</option>
        </select>
        <label className="inline small map-fog-toggle" title={t('试玩时只显示已探索格（到访地点及周围一圈）')}><input type="checkbox" data-testid="map-fog-toggle" checked={map.fog === true} disabled={readOnly} onChange={e => commit({ ...map, fog: e.target.checked || undefined })} />{t('试玩迷雾')}</label>
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
          <MapLayerPalette map={map} kind={mode as Exclude<typeof mode, "poi">} actions={content.actions} activeId={activeId} readOnly={readOnly}
            onActive={id => { setActive(s => ({ ...s, [mode]: id })); if (tool === 'erase' || tool === 'pick') setTool('brush'); }} onChange={commit} />
          <p className="hint map-tray-hint">{t('拖动涂抹；Alt/中键拖动平移；[ ] 调笔刷；Ctrl+Z 撤销。')}</p>
        </> : <>
          <p className="world-map-tray-label">{t('拖动地点到格子上绑定')}</p>
          <ul>
            {content.locations.filter(l => !placedElsewhere.has(l.id)).map(l => {
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
          {selectedLocationId && bound.has(selectedLocationId) && (map.venueTypes?.length ?? 0) > 0 && <label className="map-venue">{t('场所类型')}
            <select data-testid="map-venue-type" disabled={readOnly} value={map.pois.find(p => p.locationId === selectedLocationId)?.venueType ?? ''}
              onChange={e => commit(setPoiVenueType(map, selectedLocationId, e.target.value || undefined))}>
              <option value="">{t('未指定')}</option>
              {map.venueTypes!.map(v => <option key={v.id} value={v.id}>{t(v.label)}</option>)}
            </select></label>}
        </>}
        {issues.length > 0 && <div className="world-map-issues" data-testid="world-map-issues">
          <p className="world-map-tray-label">{t('地图提示')} · {issues.length}</p>
          <ul>{issues.slice(0, 8).map((i, n) => <li key={n} className={i.level}>{i.message}</li>)}</ul>
        </div>}
      </aside>
      <div ref={viewportRef} className={`branch-canvas-viewport world-map-viewport${layerMode ? ` painting tool-${tool}` : ''}`} data-renderer={rendererId}
        {...c.handlers} onContextMenu={e => layerMode && e.preventDefault()}>
        {renderState && <Suspense fallback={null}><Renderer ref={rendererRef} state={renderState} view={c.view.current} /></Suspense>}
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
          <span ref={zoomRef}>{Math.round(c.view.current.zoom * 100)}%</span>
        </div>
      </div>
    </div>
  </div>;
}
