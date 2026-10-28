import { forwardRef, memo, useImperativeHandle, useMemo, useRef } from 'react';
import { hexToPixel, parseCellKey } from '@novel-game/rules';
import { layerCells, layerCentroids, layerPalette, type MapLayerKind } from '../../../lib/world-map-edit';
import { labelWorldSize, type HexRendererHandle, type HexRendererProps, type HexView } from './renderer';
import { cellBorders, type BorderSeg, type HexTopology } from './topology';
import type { WorldMap } from '@novel-game/contracts';

function colorsOf(map: WorldMap, kind: MapLayerKind) { return new Map(layerPalette(map, kind).map(p => [p.id, p.color])); }
function borders(topo: HexTopology, values: Record<string, string>, colors: Map<string, string>): BorderSeg[] {
  const out: BorderSeg[] = []; for (const c of topo.cells) out.push(...cellBorders(c, values, colors)); return out;
}
const transformOf = (v: HexView) => `translate(${v.x} ${v.y}) scale(${v.zoom})`;

/** Terrain + grid. Re-renders only when terrain/pois/mode/selection change (not on pan/zoom). */
const Cells = memo(function Cells({ topo, terrain, terrainColors, poiCells, faded, selected, drop }: {
  topo: HexTopology; terrain: Record<string, string>; terrainColors: Map<string, string>; poiCells: Set<string>; faded: boolean; selected: Set<string>; drop: string | null;
}) {
  return <>{topo.cells.map(cell => { const fill = terrainColors.get(terrain[cell.key]);
    return <polygon key={cell.key} data-cell={cell.key} points={cell.points}
      className={`hex${drop === cell.key ? ' drop' : ''}${selected.has(cell.key) ? ' selected' : ''}${poiCells.has(cell.key) ? ' has-poi' : ''}`}
      style={fill ? { fill, opacity: faded ? 0.55 : 1 } : undefined} />; })}</>;
});
const Fills = memo(function Fills({ topo, values, colors, opacity }: { topo: HexTopology; values: Record<string, string>; colors: Map<string, string>; opacity: number }) {
  return <>{topo.cells.map(cell => { const col = colors.get(values[cell.key]); return col ? <polygon key={cell.key} points={cell.points} fill={col} fillOpacity={opacity} stroke="none" /> : null; })}</>;
});
const Lines = memo(function Lines({ segs, width, dash }: { segs: BorderSeg[]; width: number; dash?: string }) {
  return <>{segs.map((e, i) => <line key={i} x1={e.a.x} y1={e.a.y} x2={e.b.x} y2={e.b.y} stroke={e.color} strokeWidth={width} strokeDasharray={dash} strokeLinecap="round" />)}</>;
});

/** Play overlay: fog veil, reachable rings, player marker. Purely presentational. */
const PlayLayer = memo(function PlayLayer({ topo, play, size }: { topo: HexTopology; play: NonNullable<HexRendererProps['state']['play']>; size: number }) {
  const player = play.playerCell ? topo.byKey.get(play.playerCell) : undefined;
  return <g className="map-play" pointerEvents="none" data-testid="map-play-layer">
    {play.hiddenCells && <g className="map-fog" data-testid="map-fog">{topo.cells.filter(c => play.hiddenCells!.has(c.key)).map(c => <polygon key={c.key} data-fog={c.key} points={c.points} fill="#1d1f24" fillOpacity={0.86} stroke="#1d1f24" strokeWidth={1} />)}</g>}
    {play.reachableCells.map(k => { const c = topo.byKey.get(k); return c ? <polygon key={k} data-reachable={k} points={c.points} fill="#f5c542" fillOpacity={0.18} stroke="#d99a00" strokeWidth={3} strokeDasharray="5 3" /> : null; })}
    {player && <g data-testid="map-player" data-cell={player.key} transform={`translate(${player.c.x} ${player.c.y})`}>
      <circle r={size * 0.62} fill="none" stroke="#e5484d" strokeWidth={3} opacity={0.5} />
      <path d={`M0 ${-size * 0.95} L${size * 0.32} ${-size * 0.45} L0 ${-size * 0.3} L${-size * 0.32} ${-size * 0.45} Z`} fill="#e5484d" stroke="#fff" strokeWidth={1.5} />
      <circle r={size * 0.2} fill="#e5484d" stroke="#fff" strokeWidth={2} />
    </g>}
  </g>;
});

/** SVG fallback/test renderer (jsdom-friendly, DOM-inspectable). */
export const SvgHexRenderer = memo(forwardRef<HexRendererHandle, HexRendererProps>(function SvgHexRenderer({ state, view }, ref) {
  const { map, topo, mode } = state; const g = map.geometry;
  const gRef = useRef<SVGGElement | null>(null); const svgRef = useRef<SVGSVGElement | null>(null);
  useImperativeHandle(ref, () => ({ applyView(v) {
    gRef.current?.setAttribute('transform', transformOf(v));
    svgRef.current?.style.setProperty('--map-label', `${labelWorldSize(v.zoom)}px`);
  } }), []);
  const terrain = map.layers?.terrain?.cells ?? {};
  const terrainColors = useMemo(() => colorsOf(map, 'terrain'), [map.layers?.terrain?.palette]); // eslint-disable-line react-hooks/exhaustive-deps
  const factions = layerCells(map, 'faction'); const regions = layerCells(map, 'region');
  const factionColors = useMemo(() => colorsOf(map, 'faction'), [map.layers?.factions?.factions]); // eslint-disable-line react-hooks/exhaustive-deps
  const regionColors = useMemo(() => colorsOf(map, 'region'), [map.layers?.regions?.regions]); // eslint-disable-line react-hooks/exhaustive-deps
  const factionSegs = useMemo(() => borders(topo, factions, factionColors), [topo, factions, factionColors]);
  const regionSegs = useMemo(() => borders(topo, regions, regionColors), [topo, regions, regionColors]);
  const poiCells = useMemo(() => new Set(map.pois.map(p => p.anchor.cell)), [map.pois]);
  const selected = useMemo(() => new Set(state.selectedCells), [state.selectedCells.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  const regionLabels = useMemo(() => {
    if (!map.layers?.regions) return [];
    const cents = layerCentroids(map, 'region', key => { const a = parseCellKey(key); return a ? hexToPixel(g, a) : null; });
    // Play fog: a region's label only shows once one of its cells is explored (no spatial spoilers).
    const hidden = state.play?.hiddenCells; const seen = hidden ? new Set(Object.entries(map.layers.regions.cells).filter(([k]) => !hidden.has(k)).map(([, r]) => r)) : undefined;
    return map.layers.regions.regions.flatMap(r => { const c = cents.get(r.id); return c && (!seen || seen.has(r.id)) ? [{ id: r.id, name: r.name, x: c.x, y: c.y, n: c.n }] : []; });
  }, [map.layers?.regions, g, state.play?.hiddenCells]); // eslint-disable-line react-hooks/exhaustive-deps
  const brush = state.brushCells.map(k => topo.byKey.get(k)?.points).filter((p): p is string => !!p);
  const layerMode = mode !== 'poi';
  return <svg ref={svgRef} className="branch-canvas-svg" width="100%" height="100%" data-renderer="svg" style={{ ['--map-label' as string]: `${labelWorldSize(view.zoom)}px` }}>
    <g ref={gRef} transform={transformOf(view)}>
      <Cells topo={topo} terrain={terrain} terrainColors={terrainColors} poiCells={poiCells} faded={mode === 'faction'} selected={selected} drop={state.dropCell} />
      <g className="world-map-factions" pointerEvents="none">
        <Fills topo={topo} values={factions} colors={factionColors} opacity={mode === 'faction' ? 0.5 : 0.22} />
        <Lines segs={factionSegs} width={mode === 'faction' ? 3 : 2.5} />
      </g>
      {(regionLabels.length > 0 || mode === 'region') && <g className="world-map-regions" pointerEvents="none" data-testid="world-map-regions">
        {mode === 'region' && <Fills topo={topo} values={regions} colors={regionColors} opacity={0.2} />}
        <Lines segs={regionSegs} width={mode === 'region' ? 2.5 : 1.6} dash="6 4" />
        {regionLabels.map(l => <text key={l.id} data-region-label={l.id} x={l.x} y={l.y} textAnchor="middle" dominantBaseline="middle" className="region-label"
          style={{ fontSize: Math.max(14, Math.min(40, g.size * 0.9 + Math.sqrt(l.n) * 1.5)), fill: '#2a2118', stroke: '#fffaf0', strokeWidth: 4, paintOrder: 'stroke', fontWeight: 700, letterSpacing: 2, opacity: mode === 'region' ? 0.95 : 0.7 }}>{l.name}</text>)}
      </g>}
      {brush.length > 0 && <g className="map-brush-preview" pointerEvents="none">{brush.map(p => <polygon key={p} points={p} />)}</g>}
      <g className={layerMode ? 'pois-passive' : ''}>
        {map.pois.map(p => {
          if (state.play?.hiddenCells?.has(p.anchor.cell)) return null;
          const a = parseCellKey(p.anchor.cell); if (!a) return null;
          const c = hexToPixel(g, a); const label = p.label ?? state.titles.get(p.locationId) ?? p.locationId;
          return <g key={p.locationId} data-poi={p.locationId} data-cell={p.anchor.cell}
            className={`poi${p.locationId === state.selectedLocationId ? ' selected' : ''}${!state.titles.has(p.locationId) ? ' missing' : ''}${p.locationId === state.initialLocationId ? ' start' : ''}`}
            transform={`translate(${c.x} ${c.y})`}>
            {p.feature === 'stronghold'
              ? <path className="stronghold-keep" data-stronghold={p.factionId ?? ''} style={{ fill: map.layers?.factions?.factions.find(f => f.id === p.factionId)?.color }}
                  d={(() => { const s = g.size * 0.36, t = s * 0.4; return `M${-s},${s} L${-s},${-s} L${-s + t},${-s} L${-s + t},${-s + t} L${-t / 2},${-s + t} L${-t / 2},${-s} L${t / 2},${-s} L${t / 2},${-s + t} L${s - t},${-s + t} L${s - t},${-s} L${s},${-s} L${s},${s} Z`; })()} />
              : <circle r={g.size * 0.38} />}
            <text y={g.size * 0.38 + 1} dy="1em" textAnchor="middle" style={{ fontSize: 'var(--map-label)', strokeWidth: 'calc(var(--map-label) / 4)' }}>{label.length > 8 ? `${label.slice(0, 8)}…` : label}</text>
          </g>;
        })}
      </g>
      {state.npcMarkers && state.npcMarkers.length > 0 && <g className="map-npcs" pointerEvents="none" data-testid="map-npcs">
        {state.npcMarkers.map((n, i) => { const a = parseCellKey(n.cell); if (!a || state.play?.hiddenCells?.has(n.cell)) return null; const c = hexToPixel(g, a);
          const dx = g.size * 0.42 + (i % 3) * 6; return <g key={`${n.cell}-${i}`} data-npc-marker={n.label} transform={`translate(${c.x + dx} ${c.y - g.size * 0.35})`}>
            <rect x={-3} y={-9} width={Math.min(84, 10 + n.label.length * 11)} height={16} rx={8} fill={n.color ?? '#2d2a26'} opacity={0.9} />
            <text x={4} y={3} fill="#fff" style={{ fontSize: 11, fontWeight: 600 }}>{n.label}</text></g>; })}
      </g>}
      {state.play && <PlayLayer topo={topo} play={state.play} size={g.size} />}
    </g>
  </svg>;
}));
