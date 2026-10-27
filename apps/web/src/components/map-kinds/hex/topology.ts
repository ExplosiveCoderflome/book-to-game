import type { WorldMap } from '@novel-game/contracts';
import { cellKey, hexCorners, hexToPixel, listHexCells } from '@novel-game/rules';

type Geometry = WorldMap['geometry'];
export interface Pt { x: number; y: number }
export interface TopoCell { key: string; c: Pt; corners: Pt[]; points: string; edges: { a: Pt; b: Pt; n: string | null }[] }
export interface HexTopology { geometry: Geometry; cells: TopoCell[]; byKey: Map<string, TopoCell>; bounds: { minX: number; minY: number; w: number; h: number } }
export interface BorderSeg { a: Pt; b: Pt; color: string }

const round = (v: number) => Math.round(v * 10) / 10;
/** Precomputed per-geometry hex topology: centers, corners, and each edge's neighbour (shared by all renderers). */
export function buildHexTopology(geometry: Geometry): HexTopology {
  const cells: TopoCell[] = listHexCells(geometry).map(a => {
    const c = hexToPixel(geometry, a);
    const corners = hexCorners(geometry, c).map(p => ({ x: round(p.x), y: round(p.y) }));
    return { key: cellKey(a), c, corners, points: corners.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '), edges: [] };
  });
  const edgeOwner = new Map<string, string[]>();
  const ek = (a: Pt, b: Pt) => { const s = `${a.x},${a.y}`, t = `${b.x},${b.y}`; return s < t ? `${s}|${t}` : `${t}|${s}`; };
  for (const cell of cells) cell.corners.forEach((a, i) => { const k = ek(a, cell.corners[(i + 1) % 6]); const o = edgeOwner.get(k) ?? []; o.push(cell.key); edgeOwner.set(k, o); });
  for (const cell of cells) cell.edges = cell.corners.map((a, i) => {
    const b = cell.corners[(i + 1) % 6]; const o = edgeOwner.get(ek(a, b)) ?? [];
    return { a, b, n: o.find(k => k !== cell.key) ?? null };
  });
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const cell of cells) for (const p of cell.corners) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
  const bounds = cells.length ? { minX, minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) } : { minX: 0, minY: 0, w: 1, h: 1 };
  return { geometry, cells, byKey: new Map(cells.map(c => [c.key, c])), bounds };
}

/** Border segments a single cell contributes: its edges where the neighbour has a different value (or map edge). */
export function cellBorders(cell: TopoCell, values: Record<string, string>, colorOf: Map<string, string>): BorderSeg[] {
  const v = values[cell.key]; const color = v && colorOf.get(v); if (!color) return [];
  return cell.edges.filter(e => !e.n || values[e.n] !== v).map(e => ({ a: e.a, b: e.b, color }));
}

/**
 * Incremental border cache: after a paint only the dirty cells and their neighbours are recomputed.
 * `update` returns true when any segment changed.
 */
export class BorderCache {
  private segs = new Map<string, BorderSeg[]>();
  private values: Record<string, string> = {};
  private colors = new Map<string, string>();
  constructor(private topo: HexTopology) {}
  /** Full rebuild (palette/geometry change). */
  reset(values: Record<string, string>, colorOf: Map<string, string>): void {
    this.values = values; this.colors = colorOf; this.segs.clear();
    for (const cell of this.topo.cells) { const s = cellBorders(cell, values, colorOf); if (s.length) this.segs.set(cell.key, s); }
  }
  /** Diff against the previous values and recompute only what changed. */
  update(values: Record<string, string>): boolean {
    if (values === this.values) return false;
    const prev = this.values; const dirty = new Set<string>();
    for (const cell of this.topo.cells) if (prev[cell.key] !== values[cell.key]) {
      dirty.add(cell.key); for (const e of cell.edges) if (e.n) dirty.add(e.n);
    }
    this.values = values;
    for (const k of dirty) { const cell = this.topo.byKey.get(k); if (!cell) continue; const s = cellBorders(cell, values, this.colors); if (s.length) this.segs.set(k, s); else this.segs.delete(k); }
    return dirty.size > 0;
  }
  all(): BorderSeg[] { const out: BorderSeg[] = []; for (const s of this.segs.values()) out.push(...s); return out; }
}

/** Keys whose value differs between two layer cell maps (over the topology). */
export function dirtyKeys(topo: HexTopology, prev: Record<string, string> | undefined, next: Record<string, string> | undefined): string[] {
  if (prev === next) return [];
  const out: string[] = []; for (const c of topo.cells) if (prev?.[c.key] !== next?.[c.key]) out.push(c.key);
  return out;
}
