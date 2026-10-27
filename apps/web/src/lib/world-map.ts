import type { CellKey, HexGeometry, WorldContent, WorldMap } from '@novel-game/contracts';
import { WORLD_MAP_MAX_COLS, WORLD_MAP_MAX_ROWS, WORLD_MAP_SCHEMA_VERSION } from '@novel-game/contracts';
import { hexInBounds, parseCellKey } from '@novel-game/rules';

/** Pure authoring helpers for the optional map layer. Never touches actions/edges. */
export function createEmptyMap(cols = 16, rows = 10, orientation: HexGeometry['orientation'] = 'pointy'): WorldMap {
  return {
    mapSchemaVersion: WORLD_MAP_SCHEMA_VERSION,
    geometry: { kind: 'hex', orientation, cols: clamp(cols, 1, WORLD_MAP_MAX_COLS), rows: clamp(rows, 1, WORLD_MAP_MAX_ROWS), size: 28 },
    layers: {},
    pois: [],
  };
}

/** Resize keeps POIs; out-of-bounds ones stay and surface as validation errors (no silent drop). */
export function resizeMap(map: WorldMap, cols: number, rows: number): WorldMap {
  return { ...map, geometry: { ...map.geometry, cols: clamp(cols, 1, WORLD_MAP_MAX_COLS), rows: clamp(rows, 1, WORLD_MAP_MAX_ROWS) } };
}

/** Bind (or move) a location's POI to a cell. One POI per location. */
export function bindLocationToCell(map: WorldMap, locationId: string, cell: CellKey): WorldMap {
  const a = parseCellKey(cell);
  if (!a || !hexInBounds(map.geometry, a)) return map;
  const rest = map.pois.filter(p => p.locationId !== locationId);
  const prev = map.pois.find(p => p.locationId === locationId);
  return { ...map, pois: [...rest, { ...prev, locationId, anchor: { cell } }] };
}

export function unbindLocation(map: WorldMap, locationId: string): WorldMap {
  return { ...map, pois: map.pois.filter(p => p.locationId !== locationId) };
}

export function withMap(content: WorldContent, map: WorldMap | undefined): WorldContent {
  const next = { ...content };
  if (map) next.map = map; else delete next.map;
  return next;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(Number.isFinite(n) ? n : lo)));
}
