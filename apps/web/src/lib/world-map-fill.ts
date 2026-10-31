import type {
  BuildingAsset, BuildingLibrary, LocalPlacementOverrides, MapCellMarker, MapFillKind, MapFillPlacement, MapFillProposalItem, MapRouteMarker, WorldContent, WorldMap,
} from '@novel-game/contracts';
import { lockMapStructure, unlockMapStructure } from '@novel-game/rules';

export { lockMapStructure, unlockMapStructure };

const safeId = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60) || 'fill';

function withPlacements(map: WorldMap, placements: MapFillPlacement[]): WorldMap {
  if (!placements.length && !(map.fill?.cellMarkers?.length) && !(map.fill?.routeMarkers?.length)) {
    const next = { ...map }; delete next.fill; return next;
  }
  return {
    ...map,
    fill: {
      placements,
      ...(map.fill?.cellMarkers ? { cellMarkers: map.fill.cellMarkers } : {}),
      ...(map.fill?.routeMarkers ? { routeMarkers: map.fill.routeMarkers } : {}),
    },
  };
}

function takenIds(map: WorldMap): Set<string> {
  return new Set([
    ...(map.fill?.placements ?? []).map(item => item.id),
    ...(map.fill?.cellMarkers ?? []).map(item => item.id),
    ...(map.fill?.routeMarkers ?? []).map(item => item.id),
  ]);
}

function nextId(map: WorldMap, seed: string): string {
  const taken = takenIds(map); const base = safeId(seed);
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}_${n}`.slice(0, 80);
  return id;
}

export type AddFillInput = {
  id?: string;
  kind: MapFillKind;
  locationId: string;
  label?: string;
  buildingAssetId?: string;
  buildingAssetVersion?: number;
  localOverrides?: LocalPlacementOverrides;
};

/** Add a fill placement on a location. Optionally reference a building-library asset. Does not touch structure. */
export function addFillPlacement(map: WorldMap, input: AddFillInput): WorldMap {
  const id = nextId(map, input.id ?? `${safeId(input.kind)}_${safeId(input.locationId)}`);
  const placement: MapFillPlacement = { id, kind: input.kind, locationId: input.locationId };
  if (input.label?.trim()) placement.label = input.label.trim().slice(0, 80);
  if (input.buildingAssetId) {
    placement.buildingAssetId = input.buildingAssetId;
    if (input.buildingAssetVersion) placement.buildingAssetVersion = input.buildingAssetVersion;
  }
  if (input.localOverrides && Object.keys(input.localOverrides).length) {
    placement.localOverrides = { ...input.localOverrides };
  }
  return withPlacements(map, [...(map.fill?.placements ?? []), placement]);
}

/** Place from a library asset (ref + optional local overrides). Kind comes from the asset. */
export function placeFromBuildingAsset(
  map: WorldMap,
  locationId: string,
  asset: BuildingAsset,
  overrides?: LocalPlacementOverrides,
): WorldMap {
  return addFillPlacement(map, {
    kind: asset.kind,
    locationId,
    label: overrides?.label,
    buildingAssetId: asset.id,
    buildingAssetVersion: asset.version,
    localOverrides: overrides,
  });
}

export type AddFillMarkerInput = {
  kind: MapFillKind;
  label?: string;
  buildingAssetId?: string;
  buildingAssetVersion?: number;
  localOverrides?: LocalPlacementOverrides;
};

function markerFields(input: AddFillMarkerInput) {
  return {
    kind: input.kind,
    ...(input.label?.trim() ? {label: input.label.trim().slice(0, 80)} : {}),
    ...(input.buildingAssetId ? {buildingAssetId: input.buildingAssetId} : {}),
    ...(input.buildingAssetId && input.buildingAssetVersion ? {buildingAssetVersion: input.buildingAssetVersion} : {}),
    ...(input.localOverrides && Object.keys(input.localOverrides).length ? {localOverrides: {...input.localOverrides}} : {}),
  };
}

/** Cell markers are intentionally display-only; validation always emits a warning until a rules hook exists. */
export function addFillCellMarker(map: WorldMap, input: AddFillMarkerInput & {cell: string}): WorldMap {
  const marker: MapCellMarker = {
    id: nextId(map, `${input.kind}_cell_${input.cell}`),
    cell: input.cell,
    ...markerFields(input),
  };
  return {
    ...map,
    fill: {...(map.fill ?? {placements: []}), cellMarkers: [...(map.fill?.cellMarkers ?? []), marker]},
  };
}

/** Route markers name an existing move action; they never create a route or movement effect. */
export function addFillRouteMarker(map: WorldMap, input: AddFillMarkerInput & {routeId: string}): WorldMap {
  const marker: MapRouteMarker = {
    id: nextId(map, `${input.kind}_route_${input.routeId}`),
    routeId: input.routeId,
    ...markerFields(input),
  };
  return {
    ...map,
    fill: {
      ...(map.fill ?? {placements: []}),
      ...(map.fill?.cellMarkers ? {cellMarkers: map.fill.cellMarkers} : {}),
      routeMarkers: [...(map.fill?.routeMarkers ?? []), marker],
    },
  };
}

export function removeFillMarker(map: WorldMap, id: string): WorldMap {
  const cellMarkers = (map.fill?.cellMarkers ?? []).filter(marker => marker.id !== id);
  const routeMarkers = (map.fill?.routeMarkers ?? []).filter(marker => marker.id !== id);
  if (cellMarkers.length === (map.fill?.cellMarkers ?? []).length && routeMarkers.length === (map.fill?.routeMarkers ?? []).length) return map;
  const placements = map.fill?.placements ?? [];
  if (!placements.length && !cellMarkers.length && !routeMarkers.length) {
    const next = {...map}; delete next.fill; return next;
  }
  return {
    ...map,
    fill: {
      placements,
      ...(cellMarkers.length ? {cellMarkers} : {}),
      ...(routeMarkers.length ? {routeMarkers} : {}),
    },
  };
}

export function updateFillPlacement(
  map: WorldMap,
  id: string,
  patch: Partial<Pick<MapFillPlacement, 'kind' | 'locationId' | 'label' | 'buildingAssetId' | 'buildingAssetVersion' | 'localOverrides'>>,
): WorldMap {
  const placements = (map.fill?.placements ?? []).map(p => {
    if (p.id !== id) return p;
    const next: MapFillPlacement = { ...p, ...patch };
    if (patch.label !== undefined) {
      if (patch.label.trim()) next.label = patch.label.trim().slice(0, 80);
      else delete next.label;
    }
    if (patch.buildingAssetId === undefined && 'buildingAssetId' in patch) {
      delete next.buildingAssetId;
      delete next.buildingAssetVersion;
    }
    if (patch.localOverrides === undefined && 'localOverrides' in patch) delete next.localOverrides;
    return next;
  });
  return withPlacements(map, placements);
}

export function removeFillPlacement(map: WorldMap, id: string): WorldMap {
  const placements = (map.fill?.placements ?? []).filter(p => p.id !== id);
  if (placements.length === (map.fill?.placements ?? []).length) return map;
  return withPlacements(map, placements);
}

/** Draft fields for 「加入库」 from an existing placement (no library write). */
export function placementToBuildingDraft(placement: MapFillPlacement): {
  kind: MapFillKind;
  label: string;
  preferredId?: string;
  provenance?: BuildingAsset['provenance'];
} {
  return {
    kind: placement.kind,
    label: placement.label?.trim() || placement.id,
    preferredId: placement.id,
    provenance: {
      source: 'placement',
      locationId: placement.locationId,
      createdAt: new Date().toISOString(),
    },
  };
}

/** Apply only reviewed placements to a locked map; topology and every other content field stay untouched. */
export function applyMapFillProposal(content: WorldContent, mapId: string | undefined, items: MapFillProposalItem[]): WorldContent {
  const root = !mapId || mapId === 'root';
  const current = root ? content.map : content.subMaps?.find(map => map.id === mapId);
  if (!current) throw new Error('地图不存在');
  if (!current.structureLocked) throw new Error('请先确认地图结构，再接受填充提案');
  let next = current;
  for (const item of items) {
    if (item.assetDraft) throw new Error('新资产必须先经建筑库审核入库');
    if (!content.locations.some(location => location.id === item.locationId) || !next.pois.some(poi => poi.locationId === item.locationId)) {
      throw new Error(`地点未绑定到当前地图：${item.locationId}`);
    }
    next = addFillPlacement(next, {
      id: item.proposalId,
      kind: item.kind,
      locationId: item.locationId,
      label: item.label,
      buildingAssetId: item.buildingAssetId,
      buildingAssetVersion: item.buildingAssetVersion,
      localOverrides: item.localOverrides as LocalPlacementOverrides | undefined,
    });
  }
  return root ? {...content, map: next} : {...content, subMaps: (content.subMaps ?? []).map(map => map.id === mapId ? next : map)};
}

export function findLibraryAsset(library: BuildingLibrary | undefined, id: string | undefined): BuildingAsset | undefined {
  if (!library || !id) return undefined;
  return library.assets.find(a => a.id === id);
}
