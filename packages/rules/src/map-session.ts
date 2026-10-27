import type { CellKey, WorldContent, WorldMap } from '@novel-game/contracts';
import { geometryFor, locationSpatial } from './map-geometry.js';

/**
 * Session-side spatial helpers. Pure: authored maps are never mutated — every function returns new values.
 * Multi-map aware: a world may hold several maps; a location resolves to the map that carries its POI.
 */
export const ROOT_MAP_ID = 'root';
export function mapIdOf(map: Pick<WorldMap, 'id'> | undefined): string { return map?.id ?? ROOT_MAP_ID; }

/** All authored maps of a world (root first). */
export function worldMaps(world: Pick<WorldContent, 'map' | 'subMaps'>): WorldMap[] {
  return [...(world.map ? [world.map] : []), ...(world.subMaps ?? [])];
}
export function findMap(world: Pick<WorldContent, 'map' | 'subMaps'>, mapId: string): WorldMap | undefined {
  return worldMaps(world).find(m => mapIdOf(m) === mapId);
}

/** Map that carries this location's POI (deepest/sub-map POIs win over root), else the root map. */
export function locationMap(world: Pick<WorldContent, 'map' | 'subMaps'>, locationId: string | undefined): WorldMap | undefined {
  if (!locationId) return world.map;
  const subs = world.subMaps ?? [];
  return subs.find(m => m.pois.some(p => p.locationId === locationId))
    ?? (world.map?.pois.some(p => p.locationId === locationId) ? world.map : undefined)
    ?? world.map;
}

/** Cells revealed when standing on `cell` (the cell + neighbours within radius). */
export function revealAround(map: WorldMap, cell: CellKey, radius = 1): CellKey[] {
  const geo = geometryFor(map); if (!geo || !geo.inBounds(cell)) return [];
  const out = new Set<CellKey>([cell]); let frontier = [cell];
  for (let i = 0; i < radius; i++) {
    const next: CellKey[] = [];
    for (const c of frontier) for (const n of geo.neighbors(c)) if (!out.has(n)) { out.add(n); next.push(n); }
    frontier = next;
  }
  return [...out];
}

/** Explored-cell bookkeeping keyed by map id. Returns a new record (or the same one if nothing changed). */
export function exploreLocation(
  explored: Record<string, string[]> | undefined,
  world: Pick<WorldContent, 'map' | 'subMaps'>,
  locationId: string,
  radius = 1,
): Record<string, string[]> {
  const prev = explored ?? {};
  const map = locationMap(world, locationId); if (!map) return prev;
  const cell = locationSpatial(map, locationId).cell; if (!cell) return prev;
  const id = mapIdOf(map); const have = new Set(prev[id] ?? []); const before = have.size;
  for (const c of revealAround(map, cell, radius)) have.add(c);
  return have.size === before && prev[id] ? prev : { ...prev, [id]: [...have].sort() };
}
