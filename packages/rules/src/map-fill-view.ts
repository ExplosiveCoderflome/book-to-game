import {
  BUILDING_KIND_COLOR, findBuildingAsset, MAP_FILL_KIND_ICON, MAP_FILL_KIND_LABEL,
  type BuildingLibrary, type MapFillIcon, type MapFillKind, type WorldContent, type WorldMap,
} from '@novel-game/contracts';

export function mapRouteActionIds(actions: Pick<WorldContent['actions'][number], 'id' | 'effects'>[]): string[] {
  return actions.filter(action => action.effects.some(effect => effect.kind === 'move')).map(action => action.id);
}

type FillDisplay = {
  id: string;
  kind: MapFillKind;
  label?: string;
  buildingAssetId?: string;
  buildingAssetVersion?: number;
  localOverrides?: Record<string, unknown>;
};

function displayOf(item: FillDisplay, library: BuildingLibrary | undefined) {
  const overrides = item.localOverrides ?? {};
  const asset = item.buildingAssetId && library
    ? findBuildingAsset(library, item.buildingAssetId, item.buildingAssetVersion)
    : undefined;
  const text = (key: 'label' | 'icon') => typeof overrides[key] === 'string' && overrides[key].trim()
    ? overrides[key].trim()
    : undefined;
  return {
    label: text('label') ?? item.label ?? asset?.label ?? MAP_FILL_KIND_LABEL[item.kind],
    color: typeof overrides.color === 'string' ? overrides.color : asset?.color ?? BUILDING_KIND_COLOR[item.kind],
    icon: text('icon') ?? asset?.icon ?? MAP_FILL_KIND_ICON[item.kind],
  };
}

/** Display-only resolved icons. Placement interaction remains the rules-projected location actions. */
export function projectMapFillIcons(
  map: WorldMap,
  library?: BuildingLibrary,
  actions: WorldContent['actions'] = [],
): MapFillIcon[] {
  const cellOf = new Map(map.pois.map(poi => [poi.locationId, poi.anchor.cell]));
  const icons: MapFillIcon[] = [];
  for (const placement of map.fill?.placements ?? []) {
    const cell = cellOf.get(placement.locationId);
    if (!cell) continue;
    icons.push({
      id: placement.id,
      kind: placement.kind,
      cell,
      locationId: placement.locationId,
      ...displayOf(placement, library),
    });
  }
  for (const marker of map.fill?.cellMarkers ?? []) {
    icons.push({
      id: marker.id,
      kind: marker.kind,
      cell: marker.cell,
      illustrative: true,
      ...displayOf(marker, library),
    });
  }
  for (const marker of map.fill?.routeMarkers ?? []) {
    const action = actions.find(candidate => candidate.id === marker.routeId);
    const move = action?.effects.find(effect => effect.kind === 'move');
    const cell = action ? cellOf.get(action.locationId) : undefined;
    const toCell = move && move.kind === 'move' ? cellOf.get(move.locationId) : undefined;
    if (!cell || !toCell) continue;
    icons.push({
      id: marker.id,
      kind: marker.kind,
      cell,
      toCell,
      routeId: marker.routeId,
      illustrative: true,
      ...displayOf(marker, library),
    });
  }
  return icons;
}
