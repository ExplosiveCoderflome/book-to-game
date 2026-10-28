import type { CellKey, HexGeometry, WorldContent, WorldMap } from '@novel-game/contracts';
import { WORLD_MAP_MAX_COLS, WORLD_MAP_MAX_ROWS, WORLD_MAP_SCHEMA_VERSION } from '@novel-game/contracts';
import { axialToOffset, cellKey, hexInBounds, offsetToAxial, parseCellKey } from '@novel-game/rules';
import type { MapTemplate } from '@novel-game/contracts';

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

export type MapEdge = 'left' | 'right' | 'top' | 'bottom';
/** Grow (delta>0) or shrink (delta<0) on one side. Left/top shift every cell + POI by the offset so content stays put;
 *  cells pushed out of bounds are kept (validation warns), never silently dropped. */
export function resizeMapEdge(map: WorldMap, edge: MapEdge, delta: number): WorldMap {
  const g = map.geometry;
  const horiz = edge === 'left' || edge === 'right';
  const cols = clamp(g.cols + (horiz ? delta : 0), 1, WORLD_MAP_MAX_COLS), rows = clamp(g.rows + (horiz ? 0 : delta), 1, WORLD_MAP_MAX_ROWS);
  const applied = horiz ? cols - g.cols : rows - g.rows; if (!applied) return map;
  const resized = resizeMap(map, cols, rows);
  if (edge === 'right' || edge === 'bottom') return resized;
  return shiftMap(resized, edge === 'left' ? applied : 0, edge === 'top' ? applied : 0);
}

/** Shift all authored content by (dc, dr) offset cells. */
export function shiftMap(map: WorldMap, dc: number, dr: number): WorldMap {
  if (!dc && !dr) return map;
  const g = map.geometry;
  const move = (key: string): string => { const a = parseCellKey(key); if (!a) return key; const o = axialToOffset(g, a); return cellKey(offsetToAxial(g, o.col + dc, o.row + dr)); };
  const moveCells = (cells: Record<string, string>) => Object.fromEntries(Object.entries(cells).map(([k, v]) => [move(k), v]));
  const L = map.layers ?? {};
  return {
    ...map,
    layers: {
      ...(L.terrain ? { terrain: { ...L.terrain, cells: moveCells(L.terrain.cells) } } : {}),
      ...(L.factions ? { factions: { ...L.factions, cells: moveCells(L.factions.cells) } } : {}),
      ...(L.regions ? { regions: { ...L.regions, cells: moveCells(L.regions.cells) } } : {}),
    },
    pois: map.pois.map(p => ({ ...p, anchor: { cell: move(p.anchor.cell) } })),
  };
}

/** Apply a genre map template: only ADDS ids that are missing. Existing entries (labels/colors) are never renamed. */
export function applyMapTemplate(map: WorldMap, template: MapTemplate): { map: WorldMap; added: number } {
  const L = map.layers ?? {}; let added = 0;
  const merge = <T extends { id: string }>(have: T[], extra: T[]): T[] => { const ids = new Set(have.map(e => e.id)); const add = extra.filter(e => !ids.has(e.id)); added += add.length; return [...have, ...add]; };
  const terrain = { palette: merge(L.terrain?.palette ?? [], template.terrain.map(e => ({ id: e.id, label: e.label, color: e.color }))), cells: L.terrain?.cells ?? {} };
  const factions = { factions: merge(L.factions?.factions ?? [], template.factions.map(e => ({ id: e.id, name: e.label, color: e.color }))), cells: L.factions?.cells ?? {} };
  const regions = { regions: merge(L.regions?.regions ?? [], template.regions.map(e => ({ id: e.id, name: e.label, color: e.color }))), cells: L.regions?.cells ?? {} };
  const venueTypes = merge(map.venueTypes ?? [], template.venueTypes.map(v => ({ id: v.id, label: v.label })));
  const layers: WorldMap['layers'] = { ...L, terrain };
  if (factions.factions.length) layers.factions = factions;
  if (regions.regions.length) layers.regions = regions;
  return { map: { ...map, layers, venueTypes, mapTemplate: map.mapTemplate ?? { mapTemplateId: template.id, mapTemplateVersion: template.version } }, added };
}

/** Set (or clear) the optional venue type of a location's POI. */
export function setPoiVenueType(map: WorldMap, locationId: string, venueType: string | undefined): WorldMap {
  return { ...map, pois: map.pois.map(p => { if (p.locationId !== locationId) return p; const n = { ...p }; if (venueType) n.venueType = venueType; else delete n.venueType; return n; }) };
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

/* ---- Sub-maps (P3) — pure content transforms ---- */
const ROOT = 'root';
const safeId = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 70) || 'map';

/** Replace one map (root or sub) in content; undefined removes it (removing a sub-map also drops its descendants). */
export function withMapById(content: WorldContent, mapId: string, map: WorldMap | undefined): WorldContent {
  if (mapId === ROOT) return withMap(content, map);
  const subs = content.subMaps ?? [];
  if (map) return { ...content, subMaps: subs.map(m => (m.id === mapId ? map : m)) };
  const drop = new Set([mapId]); let grew = true;
  while (grew) { grew = false; for (const m of subs) if (m.id && m.parent && drop.has(m.parent.mapId) && !drop.has(m.id)) { drop.add(m.id); grew = true; } }
  const kept = subs.filter(m => !m.id || !drop.has(m.id));
  const next: WorldContent = { ...content, subMaps: kept };
  if (!kept.length) delete next.subMaps;
  return next;
}

/** Create a child map owned by `locationId` on `parentMapId`. Returns content + new map id. */
export function createSubMap(content: WorldContent, parentMapId: string, locationId: string, cols = 12, rows = 8): { content: WorldContent; mapId: string } {
  const taken = new Set([ROOT, ...(content.subMaps ?? []).map(m => m.id)]);
  let id = `${safeId(locationId)}_map`; for (let i = 2; taken.has(id); i++) id = `${safeId(locationId)}_map${i}`;
  const title = content.locations.find(l => l.id === locationId)?.title ?? locationId;
  const map: WorldMap = { ...createEmptyMap(cols, rows), id, name: title.slice(0, 80), parent: { mapId: parentMapId, locationId } };
  return { content: { ...content, subMaps: [...(content.subMaps ?? []), map] }, mapId: id };
}

/** Hierarchy wiring for a sub-map: child locations get parentLocationId = owner, plus ordinary move actions
 *  owner → entry (first POI) and child → owner for each child lacking one. Returns number of actions added. */
export function linkSubMapLocations(content: WorldContent, mapId: string): { content: WorldContent; added: number } {
  const map = content.subMaps?.find(m => m.id === mapId); const owner = map?.parent?.locationId;
  if (!map || !owner) return { content, added: 0 };
  const children = map.pois.map(p => p.locationId).filter(id => id !== owner && content.locations.some(l => l.id === id));
  if (!children.length) return { content, added: 0 };
  const title = (id: string) => content.locations.find(l => l.id === id)?.title ?? id;
  const moves = (from: string, to: string) => content.actions.some(a => a.locationId === from && a.effects.some(e => e.kind === 'move' && e.locationId === to));
  const ids = new Set(content.actions.map(a => a.id));
  const uniq = (base: string) => { let v = safeId(base); for (let i = 2; ids.has(v); i++) v = `${safeId(base)}_${i}`; ids.add(v); return v; };
  const mk = (from: string, to: string, label: string) => ({ id: uniq(`go_${from}_${to}`), label, description: '', locationId: from, availableWhen: [], requires: [],
    blockedReason: '暂时无法通行', risk: '', timeCost: 1, once: false, effects: [{ kind: 'move' as const, locationId: to }], text: `你${label}。`, origin: 'adapted' as const, evidence: [] });
  const added = [];
  if (!children.some(c => moves(owner, c))) added.push(mk(owner, children[0], `进入${title(children[0])}`));
  for (const c of children) if (!moves(c, owner)) added.push(mk(c, owner, `返回${title(owner)}`));
  const locations = content.locations.map(l => (children.includes(l.id) && !l.parentLocationId ? { ...l, parentLocationId: owner } : l));
  return { content: { ...content, locations, actions: [...content.actions, ...added] }, added: added.length };
}
