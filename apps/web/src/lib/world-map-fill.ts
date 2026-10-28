import type {
  BuildingAsset, BuildingLibrary, LocalPlacementOverrides, MapFillKind, MapFillPlacement, WorldMap,
} from '@novel-game/contracts';
import { lockMapStructure, unlockMapStructure } from '@novel-game/rules';

export { lockMapStructure, unlockMapStructure };

const safeId = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60) || 'fill';

function withPlacements(map: WorldMap, placements: MapFillPlacement[]): WorldMap {
  if (!placements.length && !(map.fill?.cellMarkers?.length)) {
    const next = { ...map }; delete next.fill; return next;
  }
  return {
    ...map,
    fill: {
      placements,
      ...(map.fill?.cellMarkers ? { cellMarkers: map.fill.cellMarkers } : {}),
    },
  };
}

export type AddFillInput = {
  kind: MapFillKind;
  locationId: string;
  label?: string;
  buildingAssetId?: string;
  buildingAssetVersion?: number;
  localOverrides?: LocalPlacementOverrides;
};

/** Add a fill placement on a location. Optionally reference a building-library asset. Does not touch structure. */
export function addFillPlacement(map: WorldMap, input: AddFillInput): WorldMap {
  const taken = new Set((map.fill?.placements ?? []).map(p => p.id));
  for (const m of map.fill?.cellMarkers ?? []) taken.add(m.id);
  let id = `${safeId(input.kind)}_${safeId(input.locationId)}`;
  for (let i = 2; taken.has(id); i++) id = `${safeId(input.kind)}_${safeId(input.locationId)}_${i}`;
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
    label: overrides?.label ?? asset.label,
    buildingAssetId: asset.id,
    buildingAssetVersion: asset.version,
    localOverrides: overrides,
  });
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

export function findLibraryAsset(library: BuildingLibrary | undefined, id: string | undefined): BuildingAsset | undefined {
  if (!library || !id) return undefined;
  return library.assets.find(a => a.id === id);
}
