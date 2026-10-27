import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { MapViewerProps } from '../registry';
import { SvgHexRenderer } from './SvgHexRenderer';
import { buildHexTopology } from './topology';
import type { HexRenderState, HexRendererHandle, HexView } from './renderer';

/** Read-only hex viewer for play/preview. Reuses the SVG renderer (DOM-inspectable); never edits the map. */
export function HexMapViewer({ map, content, playerLocationId, reachableLocationIds, exploredCells, npcMarkers, onSelectLocation, height = 360 }: MapViewerProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const handle = useRef<HexRendererHandle | null>(null);
  const g = map.geometry;
  const topo = useMemo(() => buildHexTopology(g), [g.kind, g.cols, g.rows, g.size, g.orientation]); // eslint-disable-line react-hooks/exhaustive-deps
  const [view, setView] = useState<HexView>({ x: 0, y: 0, zoom: 1 });
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const fit = () => {
      const W = el.clientWidth, H = el.clientHeight; if (W < 40 || H < 40) return; const b = topo.bounds; const pad = 12;
      const z = Math.max(0.1, Math.min(3, Math.min((W - pad * 2) / b.w, (H - pad * 2) / b.h)));
      setView({ zoom: z, x: (W - b.w * z) / 2 - b.minX * z, y: (H - b.h * z) / 2 - b.minY * z });
    };
    fit(); if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(fit); ro.observe(el); return () => ro.disconnect();
  }, [topo]);
  const cellOf = useMemo(() => new Map(map.pois.map(p => [p.locationId, p.anchor.cell])), [map.pois]);
  const state: HexRenderState = useMemo(() => {
    const explored = exploredCells ? new Set(exploredCells) : undefined;
    const hidden = explored ? new Set(topo.cells.map(c => c.key).filter(k => !explored.has(k))) : undefined;
    return {
      map, topo, mode: 'poi', titles: new Map(content.locations.map(l => [l.id, l.title])),
      selectedLocationId: playerLocationId, selectedCells: [], dropCell: null, brushCells: [],
      play: {
        playerCell: playerLocationId ? cellOf.get(playerLocationId) : undefined,
        reachableCells: (reachableLocationIds ?? []).flatMap(id => { const c = cellOf.get(id); return c ? [c] : []; }),
        hiddenCells: hidden,
      },
      npcMarkers: npcMarkers?.flatMap(n => { const c = cellOf.get(n.locationId); return c ? [{ cell: c, label: n.label, color: n.color }] : []; }),
    };
  }, [map, topo, content.locations, playerLocationId, reachableLocationIds, exploredCells, npcMarkers, cellOf]);
  function click(e: React.MouseEvent) {
    if (!onSelectLocation) return;
    const poi = (e.target as Element).closest('[data-poi]')?.getAttribute('data-poi'); if (poi) onSelectLocation(poi);
  }
  return <div ref={ref} className="map-viewer" data-testid="map-viewer" style={{ height }} onClick={click}>
    <SvgHexRenderer ref={handle} state={state} view={view} />
  </div>;
}
