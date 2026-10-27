import type { CellKey, HexGeometry, WorldMap } from '@novel-game/contracts';
import { cellKey, hexInBounds, parseCellKey, type Axial } from '@novel-game/rules';

/**
 * Pure map-layer editing ops (terrain + faction share one code path via `MapLayerKind`).
 * Never touches POIs' location ids, actions or edges. All return a new WorldMap.
 */
export type MapLayerKind = 'terrain' | 'faction';
export interface PaletteEntry { id: string; label: string; color: string }

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
  return (kind === 'terrain' ? map.layers?.terrain?.cells : map.layers?.factions?.cells) ?? {};
}
export function layerPalette(map: WorldMap, kind: MapLayerKind): PaletteEntry[] {
  return kind === 'terrain'
    ? (map.layers?.terrain?.palette ?? []).map(p => ({ id: p.id, label: p.label, color: p.color }))
    : (map.layers?.factions?.factions ?? []).map(f => ({ id: f.id, label: f.name, color: f.color }));
}

function withCells(map: WorldMap, kind: MapLayerKind, cells: Record<string, string>): WorldMap {
  const layers = { ...(map.layers ?? {}) };
  if (kind === 'terrain') layers.terrain = { palette: layers.terrain?.palette ?? [], cells };
  else layers.factions = { factions: layers.factions?.factions ?? [], cells };
  return { ...map, layers };
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
  return changed ? withCells(map, kind, next) : map;
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
  const existing = new Set(layerPalette(map, kind).map(p => p.id));
  let n = existing.size + 1; let id = `${kind}_${n}`;
  while (existing.has(id)) id = `${kind}_${++n}`;
  const color = PRESET[existing.size % PRESET.length];
  const layers = { ...(map.layers ?? {}) };
  if (kind === 'terrain') layers.terrain = { palette: [...(layers.terrain?.palette ?? []), { id, label, color }], cells: layers.terrain?.cells ?? {} };
  else layers.factions = { factions: [...(layers.factions?.factions ?? []), { id, name: label, color }], cells: layers.factions?.cells ?? {} };
  return { map: { ...map, layers }, id };
}

/** Label/colour edits only — ids are stable (no silent rename migration). */
export function updatePaletteEntry(map: WorldMap, kind: MapLayerKind, id: string, patch: { label?: string; color?: string }): WorldMap {
  const layers = { ...(map.layers ?? {}) };
  if (kind === 'terrain' && layers.terrain) {
    layers.terrain = { ...layers.terrain, palette: layers.terrain.palette.map(p => p.id === id ? { ...p, ...(patch.label !== undefined ? { label: patch.label } : {}), ...(patch.color ? { color: patch.color } : {}) } : p) };
  } else if (kind === 'faction' && layers.factions) {
    layers.factions = { ...layers.factions, factions: layers.factions.factions.map(f => f.id === id ? { ...f, ...(patch.label !== undefined ? { name: patch.label } : {}), ...(patch.color ? { color: patch.color } : {}) } : f) };
  } else return map;
  return { ...map, layers };
}

/**
 * Delete a palette entry. Cells using it are explicitly reassigned to `reassignTo`
 * (another id) or cleared (null) — the caller must have asked the author first.
 */
export function deletePaletteEntry(map: WorldMap, kind: MapLayerKind, id: string, reassignTo: string | null): WorldMap {
  const cells = layerCells(map, kind);
  const nextCells: Record<string, string> = {};
  for (const [k, v] of Object.entries(cells)) {
    if (v !== id) nextCells[k] = v;
    else if (reassignTo && reassignTo !== id) nextCells[k] = reassignTo;
  }
  const layers = { ...(map.layers ?? {}) };
  if (kind === 'terrain' && layers.terrain) layers.terrain = { palette: layers.terrain.palette.filter(p => p.id !== id), cells: nextCells };
  else if (kind === 'faction' && layers.factions) layers.factions = { factions: layers.factions.factions.filter(f => f.id !== id), cells: nextCells };
  else return map;
  return { ...map, layers };
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
