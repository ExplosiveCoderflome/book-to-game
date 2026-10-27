import type { CellKey, HexGeometry, WorldMap } from '@novel-game/contracts';

/** Pure hex math (axial coords, Red Blob Games conventions) + map validation. No UI, no IO. */
export interface Axial { q: number; r: number }

export const cellKey = (c: Axial): CellKey => `${c.q},${c.r}`;
export function parseCellKey(key: string): Axial | null {
  const m = /^(-?\d+),(-?\d+)$/.exec(key);
  return m ? { q: Number(m[1]), r: Number(m[2]) } : null;
}

/** Rectangular map stored as offset (col,row) → axial ("odd-r" for pointy, "odd-q" for flat). */
export function offsetToAxial(g: Pick<HexGeometry, 'orientation'>, col: number, row: number): Axial {
  if (g.orientation === 'pointy') return { q: col - (row - (row & 1)) / 2, r: row };
  return { q: col, r: row - (col - (col & 1)) / 2 };
}
export function axialToOffset(g: Pick<HexGeometry, 'orientation'>, a: Axial): { col: number; row: number } {
  if (g.orientation === 'pointy') return { col: a.q + (a.r - (a.r & 1)) / 2, row: a.r };
  return { col: a.q, row: a.r + (a.q - (a.q & 1)) / 2 };
}
export function hexInBounds(g: HexGeometry, a: Axial): boolean {
  const { col, row } = axialToOffset(g, a);
  return col >= 0 && row >= 0 && col < g.cols && row < g.rows;
}
export function listHexCells(g: HexGeometry): Axial[] {
  const out: Axial[] = [];
  for (let row = 0; row < g.rows; row++) for (let col = 0; col < g.cols; col++) out.push(offsetToAxial(g, col, row));
  return out;
}
export function hexToPixel(g: HexGeometry, a: Axial): { x: number; y: number } {
  const s = g.size, r3 = Math.sqrt(3);
  return g.orientation === 'pointy'
    ? { x: s * (r3 * a.q + (r3 / 2) * a.r), y: s * 1.5 * a.r }
    : { x: s * 1.5 * a.q, y: s * ((r3 / 2) * a.q + r3 * a.r) };
}
export function hexCorners(g: HexGeometry, center: { x: number; y: number }): { x: number; y: number }[] {
  const off = g.orientation === 'pointy' ? 30 : 0;
  return Array.from({ length: 6 }, (_, i) => {
    const ang = (Math.PI / 180) * (60 * i - off);
    return { x: center.x + g.size * Math.cos(ang), y: center.y + g.size * Math.sin(ang) };
  });
}
export function hexDistance(a: Axial, b: Axial): number {
  return (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2;
}

export type WorldMapIssueCode = 'poi_missing_location' | 'poi_out_of_bounds' | 'poi_duplicate_location' | 'poi_cell_shared' | 'location_unbound'
  | 'layer_unknown_terrain' | 'layer_unknown_faction' | 'layer_unknown_region' | 'layer_cell_out_of_bounds' | 'layer_duplicate_id';
export interface WorldMapIssue { level: 'error' | 'warning'; code: WorldMapIssueCode; message: string; locationId?: string; cell?: CellKey }

/** Validate POI bindings against the location graph. Map never adds edges; it only reports. */
export function validateWorldMap(map: WorldMap, locationIds: readonly string[]): WorldMapIssue[] {
  const issues: WorldMapIssue[] = [];
  const known = new Set(locationIds);
  const bound = new Set<string>();
  const cells = new Map<string, string>();
  for (const poi of map.pois) {
    const { locationId } = poi; const cell = poi.anchor.cell;
    if (!known.has(locationId)) issues.push({ level: 'error', code: 'poi_missing_location', locationId, cell, message: `地图标记指向不存在的地点：${locationId}` });
    if (bound.has(locationId)) issues.push({ level: 'error', code: 'poi_duplicate_location', locationId, cell, message: `地点在地图上被重复标记：${locationId}` });
    bound.add(locationId);
    const a = parseCellKey(cell);
    if (!a || !hexInBounds(map.geometry, a)) issues.push({ level: 'error', code: 'poi_out_of_bounds', locationId, cell, message: `地图标记超出地图范围：${locationId} @ ${cell}` });
    const other = cells.get(cell);
    if (other && other !== locationId) issues.push({ level: 'warning', code: 'poi_cell_shared', locationId, cell, message: `多个地点共用同一格 ${cell}：${other}、${locationId}` });
    cells.set(cell, locationId);
  }
  issues.push(...validateMapLayers(map));
  for (const id of locationIds) if (!bound.has(id)) issues.push({ level: 'warning', code: 'location_unbound', locationId: id, message: `地点尚未放到地图上：${id}` });
  return issues;
}

/** Terrain/faction layer checks: referenced ids exist in palette/faction list; cells in bounds; ids unique. */
export function validateMapLayers(map: WorldMap): WorldMapIssue[] {
  const issues: WorldMapIssue[] = [];
  const layers = map.layers ?? {};
  const NOUN = { terrain: '地形', faction: '势力', region: '区域' } as const;
  const CODE = { terrain: 'layer_unknown_terrain', faction: 'layer_unknown_faction', region: 'layer_unknown_region' } as const;
  const check = (kind: 'terrain' | 'faction' | 'region', ids: string[], cells: Record<string, string>) => {
    const noun = NOUN[kind];
    const known = new Set<string>();
    for (const i of ids) {
      if (known.has(i)) issues.push({ level: 'error', code: 'layer_duplicate_id', message: `${noun} id 重复：${i}` });
      known.add(i);
    }
    for (const [cell, ref] of Object.entries(cells)) {
      const a = parseCellKey(cell);
      if (!a || !hexInBounds(map.geometry, a)) issues.push({ level: 'warning', code: 'layer_cell_out_of_bounds', cell, message: `${noun}格超出地图范围：${cell}` });
      if (!known.has(ref)) issues.push({ level: 'error', code: CODE[kind], cell, message: `格 ${cell} 引用了未定义的${noun}：${ref}` });
    }
  };
  if (layers.terrain) check('terrain', layers.terrain.palette.map(p => p.id), layers.terrain.cells);
  if (layers.factions) check('faction', layers.factions.factions.map(f => f.id), layers.factions.cells);
  if (layers.regions) check('region', layers.regions.regions.map(r => r.id), layers.regions.cells);
  return issues;
}
