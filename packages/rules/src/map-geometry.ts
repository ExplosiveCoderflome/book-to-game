import type { CellKey, WorldMap, WorldMapGeometry, WorldMapKind } from '@novel-game/contracts';
import { cellKey, hexDistance, hexInBounds, listHexCells, parseCellKey, type Axial } from './world-map.js';

/**
 * Replaceable spatial seam. Every map kind (hex today; square / vector / image later) provides one adapter.
 * Rule kinds and worldbook selection only use `locationSpatial` — never grid math directly.
 */
export interface GeometryAdapter {
  readonly kind: WorldMapKind;
  inBounds(cell: CellKey): boolean;
  listCells(): CellKey[];
  neighbors(cell: CellKey): CellKey[];
  /** Step distance between two cells; undefined when either key is invalid. */
  distance(a: CellKey, b: CellKey): number | undefined;
}

type AdapterFactory = (geometry: WorldMapGeometry) => GeometryAdapter;
const factories = new Map<WorldMapKind, AdapterFactory>();

export function registerGeometryKind(kind: WorldMapKind, factory: AdapterFactory): void { factories.set(kind, factory); }
export function registeredGeometryKinds(): WorldMapKind[] { return [...factories.keys()]; }
export function geometryFor(map: Pick<WorldMap, 'geometry'>): GeometryAdapter | undefined {
  return factories.get(map.geometry.kind)?.(map.geometry);
}

const HEX_DIRS: Axial[] = [{ q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 }, { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 }];
registerGeometryKind('hex', geometry => {
  const g = geometry;
  return {
    kind: 'hex',
    inBounds: cell => { const a = parseCellKey(cell); return !!a && hexInBounds(g, a); },
    listCells: () => listHexCells(g).map(cellKey),
    neighbors: cell => {
      const a = parseCellKey(cell); if (!a) return [];
      return HEX_DIRS.map(d => ({ q: a.q + d.q, r: a.r + d.r })).filter(n => hexInBounds(g, n)).map(cellKey);
    },
    distance: (x, y) => { const a = parseCellKey(x), b = parseCellKey(y); return a && b ? hexDistance(a, b) : undefined; },
  };
});

/** What a location "is" spatially. Kind-agnostic answer consumed by rules + worldbook. */
export interface LocationSpatial {
  cell?: CellKey;
  terrainId?: string;
  factionId?: string;
  regionIds: string[];
}

/** Resolve location → cell → layer ids. Missing map / unbound location → empty (conditions fail closed). */
export function locationSpatial(map: WorldMap | undefined, locationId: string | undefined): LocationSpatial {
  if (!map || !locationId) return { regionIds: [] };
  const cell = map.pois.find(p => p.locationId === locationId)?.anchor.cell;
  if (!cell) return { regionIds: [] };
  const layers = map.layers ?? {};
  const region = layers.regions?.cells[cell];
  return {
    cell,
    terrainId: layers.terrain?.cells[cell],
    factionId: layers.factions?.cells[cell],
    regionIds: region ? [region] : [],
  };
}

/** Distance between two locations on the map (undefined when not both placed or kind lacks metric). */
export function locationDistance(map: WorldMap | undefined, a: string, b: string): number | undefined {
  if (!map) return undefined;
  const ca = locationSpatial(map, a).cell, cb = locationSpatial(map, b).cell;
  return ca && cb ? geometryFor(map)?.distance(ca, cb) : undefined;
}
