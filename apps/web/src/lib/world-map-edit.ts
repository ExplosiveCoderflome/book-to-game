import type { CellKey, HexGeometry, WorldMap } from '@novel-game/contracts';
import { cellKey, hexInBounds, parseCellKey, type Axial } from '@novel-game/rules';

/**
 * Pure map-layer editing ops (terrain + faction share one code path via `MapLayerKind`).
 * Never touches POIs' location ids, actions or edges. All return a new WorldMap.
 */
export type MapLayerKind = 'terrain' | 'faction' | 'region';
export const MAP_LAYER_KINDS: readonly MapLayerKind[] = ['terrain', 'faction', 'region'];
export interface PaletteEntry { id: string; label: string; color: string }

type Layers = NonNullable<WorldMap['layers']>;
/**
 * One accessor per paintable layer: every editing op below is generic over this table,
 * so adding a layer = one entry here (+ schema), not new code paths.
 */
interface LayerAccess {
  cells(l: Layers): Record<string, string> | undefined;
  palette(l: Layers): PaletteEntry[];
  write(l: Layers, palette: PaletteEntry[], cells: Record<string, string>): Layers;
}
const ACCESS: Record<MapLayerKind, LayerAccess> = {
  terrain: {
    cells: l => l.terrain?.cells,
    palette: l => (l.terrain?.palette ?? []).map(p => ({ id: p.id, label: p.label, color: p.color })),
    write: (l, pal, cells) => {
      const prev = new Map((l.terrain?.palette ?? []).map(p => [p.id, p]));
      return { ...l, terrain: { palette: pal.map(p => ({ ...prev.get(p.id), id: p.id, label: p.label, color: p.color })), cells } };
    },
  },
  faction: {
    cells: l => l.factions?.cells,
    palette: l => (l.factions?.factions ?? []).map(f => ({ id: f.id, label: f.name, color: f.color })),
    write: (l, pal, cells) => {
      const prev = new Map((l.factions?.factions ?? []).map(f => [f.id, f]));
      return { ...l, factions: { factions: pal.map(p => ({ ...prev.get(p.id), id: p.id, name: p.label, color: p.color })), cells } };
    },
  },
  region: {
    cells: l => l.regions?.cells,
    palette: l => (l.regions?.regions ?? []).map(r => ({ id: r.id, label: r.name, color: r.color })),
    write: (l, pal, cells) => {
      const prev = new Map((l.regions?.regions ?? []).map(r => [r.id, r]));
      return { ...l, regions: { regions: pal.map(p => ({ ...prev.get(p.id), id: p.id, name: p.label, color: p.color })), cells } };
    },
  },
};

const DIRS: Axial[] = [{ q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 }, { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 }];
export function hexNeighbors(a: Axial): Axial[] { return DIRS.map(d => ({ q: a.q + d.q, r: a.r + d.r })); }

/** All in-bounds cells within `radius` steps (radius 0 = the cell itself). */
export function cellsInRadius(g: HexGeometry, center: Axial, radius: number): CellKey[] {
  const out: CellKey[] = [];
  for (let dq = -radius; dq <= radius; dq++) {
    for (let dr = Math.max(-radius, -dq - radius); dr <= Math.min(radius, -dq + radius); dr++) {
      const a = { q: center.q + dq, r: center.r + dr };
      if (hexInBounds(g, a)) out.push(cellKey(a));
    }
  }
  return out;
}

/** Inverse of hexToPixel with cube rounding (Red Blob Games). */
export function pixelToHex(g: HexGeometry, x: number, y: number): Axial {
  const s = g.size, r3 = Math.sqrt(3);
  const fq = g.orientation === 'pointy' ? ((r3 / 3) * x - y / 3) / s : ((2 / 3) * x) / s;
  const fr = g.orientation === 'pointy' ? ((2 / 3) * y) / s : ((-1 / 3) * x + (r3 / 3) * y) / s;
  const fs = -fq - fr;
  let q = Math.round(fq), r = Math.round(fr); const sr = Math.round(fs);
  const dq = Math.abs(q - fq), dr = Math.abs(r - fr), ds = Math.abs(sr - fs);
  if (dq > dr && dq > ds) q = -r - sr; else if (dr > ds) r = -q - sr;
  return { q: q + 0, r: r + 0 };
}

export function layerCells(map: WorldMap, kind: MapLayerKind): Record<string, string> {
  return ACCESS[kind].cells(map.layers ?? {}) ?? {};
}
export function layerPalette(map: WorldMap, kind: MapLayerKind): PaletteEntry[] {
  return ACCESS[kind].palette(map.layers ?? {});
}
function writeLayer(map: WorldMap, kind: MapLayerKind, palette: PaletteEntry[], cells: Record<string, string>): WorldMap {
  return { ...map, layers: ACCESS[kind].write(map.layers ?? {}, palette, cells) };
}

/** Set (value) or clear (null) the given cells. Returns the same map object if nothing changed. */
export function paintCells(map: WorldMap, kind: MapLayerKind, keys: CellKey[], value: string | null): WorldMap {
  const cur = layerCells(map, kind);
  let changed = false;
  const next = { ...cur };
  for (const k of keys) {
    if (value === null) { if (k in next) { delete next[k]; changed = true; } }
    else if (next[k] !== value) { next[k] = value; changed = true; }
  }
  return changed ? writeLayer(map, kind, layerPalette(map, kind), next) : map;
}

/** Flood fill the contiguous region sharing the start cell's value (unset counts as a value). */
export function floodFill(map: WorldMap, kind: MapLayerKind, start: CellKey, value: string | null): WorldMap {
  const a0 = parseCellKey(start);
  if (!a0 || !hexInBounds(map.geometry, a0)) return map;
  const cells = layerCells(map, kind);
  const target = cells[start];
  if ((target ?? null) === value) return map;
  const seen = new Set<string>([start]);
  const queue: Axial[] = [a0];
  const region: CellKey[] = [];
  while (queue.length) {
    const a = queue.shift()!; region.push(cellKey(a));
    for (const n of hexNeighbors(a)) {
      const k = cellKey(n);
      if (seen.has(k) || !hexInBounds(map.geometry, n) || cells[k] !== target) continue;
      seen.add(k); queue.push(n);
    }
  }
  return paintCells(map, kind, region, value);
}

export function countUsage(map: WorldMap, kind: MapLayerKind, id: string): number {
  return Object.values(layerCells(map, kind)).filter(v => v === id).length;
}

const PRESET = ['#c9b37e', '#7fa86a', '#6c8fb8', '#a3836a', '#b07cc6', '#d98b5f', '#5fa8a0', '#9aa05a'];
export function addPaletteEntry(map: WorldMap, kind: MapLayerKind, label: string): { map: WorldMap; id: string } {
  const pal = layerPalette(map, kind);
  const existing = new Set(pal.map(p => p.id));
  let n = existing.size + 1; let id = `${kind}_${n}`;
  while (existing.has(id)) id = `${kind}_${++n}`;
  const color = PRESET[existing.size % PRESET.length];
  return { map: writeLayer(map, kind, [...pal, { id, label, color }], layerCells(map, kind)), id };
}

/** Label/colour edits only — ids are stable (no silent rename migration). */
export function updatePaletteEntry(map: WorldMap, kind: MapLayerKind, id: string, patch: { label?: string; color?: string }): WorldMap {
  const pal = layerPalette(map, kind);
  if (!pal.some(p => p.id === id)) return map;
  const next = pal.map(p => p.id === id ? { ...p, ...(patch.label !== undefined ? { label: patch.label } : {}), ...(patch.color ? { color: patch.color } : {}) } : p);
  return writeLayer(map, kind, next, layerCells(map, kind));
}

/**
 * Delete a palette entry. Cells using it are explicitly reassigned to `reassignTo`
 * (another id) or cleared (null) — the caller must have asked the author first.
 */
export function deletePaletteEntry(map: WorldMap, kind: MapLayerKind, id: string, reassignTo: string | null): WorldMap {
  const pal = layerPalette(map, kind);
  if (!pal.some(p => p.id === id)) return map;
  const nextCells: Record<string, string> = {};
  for (const [k, v] of Object.entries(layerCells(map, kind))) {
    if (v !== id) nextCells[k] = v;
    else if (reassignTo && reassignTo !== id) nextCells[k] = reassignTo;
  }
  return writeLayer(map, kind, pal.filter(p => p.id !== id), nextCells);
}

/** Centroid (pixel space, caller supplies cell→pixel) of each painted id — used for region labels. */
export function layerCentroids(map: WorldMap, kind: MapLayerKind, toPixel: (cell: CellKey) => { x: number; y: number } | null): Map<string, { x: number; y: number; n: number }> {
  const acc = new Map<string, { x: number; y: number; n: number }>();
  for (const [cell, id] of Object.entries(layerCells(map, kind))) {
    const p = toPixel(cell); if (!p) continue;
    const a = acc.get(id) ?? { x: 0, y: 0, n: 0 }; a.x += p.x; a.y += p.y; a.n++; acc.set(id, a);
  }
  for (const a of acc.values()) { a.x /= a.n; a.y /= a.n; }
  return acc;
}

/** Bounded snapshot history (domain-level: WorldMap | undefined values). */
export interface MapHistory { past: (WorldMap | undefined)[]; future: (WorldMap | undefined)[] }
export const HISTORY_LIMIT = 100;
export function pushHistory(h: MapHistory, before: WorldMap | undefined): MapHistory {
  return { past: [...h.past, before].slice(-HISTORY_LIMIT), future: [] };
}
export function undoHistory(h: MapHistory, current: WorldMap | undefined): { h: MapHistory; map: WorldMap | undefined } | null {
  if (!h.past.length) return null;
  return { h: { past: h.past.slice(0, -1), future: [current, ...h.future] }, map: h.past[h.past.length - 1] };
}
export function redoHistory(h: MapHistory, current: WorldMap | undefined): { h: MapHistory; map: WorldMap | undefined } | null {
  if (!h.future.length) return null;
  return { h: { past: [...h.past, current], future: h.future.slice(1) }, map: h.future[0] };
}
