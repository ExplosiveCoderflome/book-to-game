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

export type WorldMapIssueCode = 'poi_unknown_venue' | 'poi_missing_location' | 'poi_out_of_bounds' | 'poi_duplicate_location' | 'poi_cell_shared' | 'location_unbound'
  | 'layer_unknown_terrain' | 'layer_unknown_faction' | 'layer_unknown_region' | 'layer_cell_out_of_bounds' | 'layer_duplicate_id'
  | 'fill_missing_location' | 'fill_unbound_location' | 'fill_duplicate_id' | 'fill_unbound_marker' | 'fill_marker_out_of_bounds' | 'fill_unknown_building';
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
  const venues = new Set((map.venueTypes ?? []).map(v => v.id));
  for (const poi of map.pois) if (poi.venueType && !venues.has(poi.venueType)) issues.push({ level: 'error', code: 'poi_unknown_venue', locationId: poi.locationId, cell: poi.anchor.cell, message: `地图标记的场所类型未定义：${poi.locationId} → ${poi.venueType}` });
  for (const id of locationIds) if (!bound.has(id)) issues.push({ level: 'warning', code: 'location_unbound', locationId: id, message: `地点尚未放到地图上：${id}` });
  issues.push(...validateMapFill(map, locationIds));
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

/** Structure lock + content-fill validation (M-fill-1). Pure; no IO. */

export function isStructureLocked(map: WorldMap): boolean {
  return map.structureLocked === true;
}

/** Fingerprint of hard-locked structure fields (size, POIs, terrain/region/faction ownership, venues, parent). */
export function structureFingerprint(map: WorldMap): string {
  return JSON.stringify({
    geometry: map.geometry,
    pois: map.pois,
    layers: map.layers ?? {},
    venueTypes: map.venueTypes ?? null,
    mapTemplate: map.mapTemplate ?? null,
    parent: map.parent ?? null,
  });
}

export function lockMapStructure(map: WorldMap, at = new Date().toISOString()): WorldMap {
  return { ...map, structureLocked: true, structureLockedAt: at };
}

export function unlockMapStructure(map: WorldMap): WorldMap {
  const next: WorldMap = { ...map };
  delete next.structureLocked;
  delete next.structureLockedAt;
  return next;
}

/**
 * Gate for map writes when structure is locked.
 * Allowed while locked: fill layer, fog, name, lock/unlock flags.
 * Refused: geometry/POI/layer ownership changes, map deletion.
 */
export function assertMapWriteAllowed(
  before: WorldMap | undefined,
  after: WorldMap | undefined,
): { ok: true } | { ok: false; reason: string } {
  if (!before?.structureLocked) return { ok: true };
  if (!after) return { ok: false, reason: '地图结构已锁定，请先解锁再删除地图' };
  if (structureFingerprint(before) === structureFingerprint(after)) return { ok: true };
  return { ok: false, reason: '地图结构已锁定：尺寸、地点绑定、地形/区域/势力归属不可改，请先解锁' };
}

export function validateMapFill(map: WorldMap, locationIds: readonly string[]): WorldMapIssue[] {
  const issues: WorldMapIssue[] = [];
  const fill = map.fill;
  if (!fill) return issues;
  const known = new Set(locationIds);
  const bound = new Set(map.pois.map(p => p.locationId));
  const seen = new Set<string>();
  for (const p of fill.placements) {
    if (seen.has(p.id)) issues.push({ level: 'error', code: 'fill_duplicate_id', message: `填充项 id 重复：${p.id}` });
    seen.add(p.id);
    if (!known.has(p.locationId)) {
      issues.push({ level: 'error', code: 'fill_missing_location', locationId: p.locationId, message: `填充项指向不存在的地点：${p.id} → ${p.locationId}` });
    } else if (!bound.has(p.locationId)) {
      issues.push({ level: 'warning', code: 'fill_unbound_location', locationId: p.locationId, message: `填充项地点尚未放到地图上：${p.id} → ${p.locationId}` });
    }
    if (p.buildingAssetId) {
      issues.push({ level: 'warning', code: 'fill_unknown_building', locationId: p.locationId, message: `填充项引用了建筑库资产（库尚未接入）：${p.id} → ${p.buildingAssetId}` });
    }
  }
  for (const m of fill.cellMarkers ?? []) {
    if (seen.has(m.id)) issues.push({ level: 'error', code: 'fill_duplicate_id', message: `填充标记 id 重复：${m.id}` });
    seen.add(m.id);
    const a = parseCellKey(m.cell);
    if (!a || !hexInBounds(map.geometry, a)) {
      issues.push({ level: 'warning', code: 'fill_marker_out_of_bounds', cell: m.cell, message: `格标记超出地图范围：${m.id} @ ${m.cell}` });
    }
    issues.push({ level: 'warning', code: 'fill_unbound_marker', cell: m.cell, message: `格标记未绑定地点（路上遇怪等预留）：${m.id}` });
  }
  return issues;
}
