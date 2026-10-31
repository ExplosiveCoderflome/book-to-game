import {
  findBuildingAsset, mapFillPlacementSchema,
  type MapFillPlacement, type MapFillProposalItem, type WorldContent, type WorldDraft, type WorldMap,
} from '@novel-game/contracts';
import { mapRouteActionIds, ROOT_MAP_ID, validateMapFill } from '@novel-game/rules';
import { AppError } from '../../../shared/errors.js';
import type { BuildingLibraryService } from '../../building-library/index.js';
import type { WorldService } from './world-service.js';

export type MapFillTarget = { version: number; mapId?: string };
export type PlaceMapFillInput = MapFillTarget & { placement: MapFillPlacement };
export type UpdateMapFillInput = MapFillTarget & {
  placementId: string;
  patch: Partial<Pick<MapFillPlacement, 'label' | 'localOverrides'>>;
};
export type AcceptMapFillInput = MapFillTarget & { items: MapFillProposalItem[] };

function selectedMap(content: WorldContent, mapId = ROOT_MAP_ID): WorldMap {
  const map = mapId === ROOT_MAP_ID ? content.map : content.subMaps?.find(item => item.id === mapId);
  if (!map) throw new AppError('MAP_NOT_FOUND', `地图不存在：${mapId}`, 404);
  return map;
}

function replaceMap(content: WorldContent, mapId: string | undefined, next: WorldMap): WorldContent {
  const id = mapId ?? ROOT_MAP_ID;
  if (id === ROOT_MAP_ID) return { ...content, map: next };
  return { ...content, subMaps: (content.subMaps ?? []).map(map => map.id === id ? next : map) };
}

function assertLocked(map: WorldMap): void {
  if (!map.structureLocked) {
    throw new AppError('MAP_STRUCTURE_NOT_LOCKED', '请先确认地图结构，再编辑填充层', 409);
  }
}

function assertBoundLocation(content: WorldContent, map: WorldMap, locationId: string): void {
  if (!content.locations.some(location => location.id === locationId) || !map.pois.some(poi => poi.locationId === locationId)) {
    throw new AppError('MAP_FILL_LOCATION_UNBOUND', `填充目标必须是已绑定到当前地图的地点：${locationId}`, 422);
  }
}

function assertAsset(library: BuildingLibraryService, placement: MapFillPlacement): void {
  if (!placement.buildingAssetId) return;
  const asset = findBuildingAsset(
    library.get().library,
    placement.buildingAssetId,
    placement.buildingAssetVersion,
  );
  if (!asset) throw new AppError('BUILDING_NOT_FOUND', `建筑库中找不到资产：${placement.buildingAssetId}`, 422);
  if (asset.kind !== placement.kind) {
    throw new AppError('MAP_FILL_KIND_MISMATCH', `填充种类 ${placement.kind} 与库资产 ${asset.id} 的种类 ${asset.kind} 不一致`, 422);
  }
  if (placement.buildingAssetVersion !== undefined && placement.buildingAssetVersion !== asset.version) {
    throw new AppError('BUILDING_VERSION_CONFLICT', `建筑资产 ${asset.id} 已更新，请重新选择版本`, 409);
  }
}

function allFillIds(map: WorldMap): Set<string> {
  return new Set([
    ...(map.fill?.placements ?? []).map(item => item.id),
    ...(map.fill?.cellMarkers ?? []).map(item => item.id),
    ...(map.fill?.routeMarkers ?? []).map(item => item.id),
  ]);
}

function assertNoFillErrors(content: WorldContent, map: WorldMap, library: BuildingLibraryService): void {
  const issues = validateMapFill(map, content.locations.map(location => location.id), {
    buildingAssetIds: library.assetIds(),
    routeIds: mapRouteActionIds(content.actions),
  }).filter(issue => issue.level === 'error');
  if (issues.length) {
    throw new AppError('MAP_FILL_INVALID', issues.map(issue => issue.message).join('；'), 422, { issues });
  }
}

function proposalPlacement(item: MapFillProposalItem, taken: Set<string>): MapFillPlacement {
  if (item.assetDraft) {
    throw new AppError('MAP_FILL_ASSET_REVIEW_REQUIRED', '新资产必须先经建筑库审核入库，再接受地图放置', 409);
  }
  let id = item.proposalId;
  for (let n = 2; taken.has(id); n++) id = `${item.proposalId}_${n}`.slice(0, 80);
  taken.add(id);
  return {
    id,
    kind: item.kind,
    locationId: item.locationId,
    ...(item.label ? { label: item.label } : {}),
    ...(item.buildingAssetId ? { buildingAssetId: item.buildingAssetId } : {}),
    ...(item.buildingAssetVersion ? { buildingAssetVersion: item.buildingAssetVersion } : {}),
    ...(item.localOverrides ? { localOverrides: item.localOverrides } : {}),
  };
}

/** Locked-map command path. Library assets are read-only; placement overrides never write back. */
export function placeMapFill(
  worlds: WorldService,
  library: BuildingLibraryService,
  id: string,
  input: PlaceMapFillInput,
): { draft: WorldDraft; placement: MapFillPlacement } {
  const current = worlds.get(id);
  const map = selectedMap(current.content, input.mapId);
  assertLocked(map);
  const placement = mapFillPlacementSchema.parse(input.placement);
  if (allFillIds(map).has(placement.id)) throw new AppError('MAP_FILL_DUPLICATE_ID', `填充项 id 已存在：${placement.id}`, 409);
  assertBoundLocation(current.content, map, placement.locationId);
  assertAsset(library, placement);
  const nextMap: WorldMap = {
    ...map,
    fill: { ...(map.fill ?? {}), placements: [...(map.fill?.placements ?? []), placement] },
  };
  assertNoFillErrors(current.content, nextMap, library);
  return { draft: worlds.update(id, { version: input.version, content: replaceMap(current.content, input.mapId, nextMap) }), placement };
}

/** Inspector edits affect only this placement. In particular, color/icon/label never mutate the catalog. */
export function updateMapFillPlacement(
  worlds: WorldService,
  library: BuildingLibraryService,
  id: string,
  input: UpdateMapFillInput,
): { draft: WorldDraft; placement: MapFillPlacement } {
  const current = worlds.get(id);
  const map = selectedMap(current.content, input.mapId);
  assertLocked(map);
  let updated: MapFillPlacement | undefined;
  const placements = (map.fill?.placements ?? []).map(placement => {
    if (placement.id !== input.placementId) return placement;
    updated = {
      ...placement,
      ...(input.patch.label !== undefined ? { label: input.patch.label } : {}),
      ...(input.patch.localOverrides !== undefined ? { localOverrides: input.patch.localOverrides } : {}),
    };
    return updated;
  });
  if (!updated) throw new AppError('MAP_FILL_NOT_FOUND', `填充项不存在：${input.placementId}`, 404);
  assertAsset(library, updated);
  const nextMap: WorldMap = { ...map, fill: { ...(map.fill ?? {}), placements } };
  assertNoFillErrors(current.content, nextMap, library);
  return { draft: worlds.update(id, { version: input.version, content: replaceMap(current.content, input.mapId, nextMap) }), placement: updated };
}

/** Accept reviewed existing-asset placements in one draft write. New assets use accept_building_drafts first. */
export function acceptMapFill(
  worlds: WorldService,
  library: BuildingLibraryService,
  id: string,
  input: AcceptMapFillInput,
): { draft: WorldDraft; placements: MapFillPlacement[] } {
  const current = worlds.get(id);
  const map = selectedMap(current.content, input.mapId);
  assertLocked(map);
  const taken = allFillIds(map);
  const additions = input.items.map(item => proposalPlacement(item, taken));
  for (const placement of additions) {
    assertBoundLocation(current.content, map, placement.locationId);
    assertAsset(library, placement);
  }
  const nextMap: WorldMap = {
    ...map,
    fill: { ...(map.fill ?? {}), placements: [...(map.fill?.placements ?? []), ...additions] },
  };
  assertNoFillErrors(current.content, nextMap, library);
  return { draft: worlds.update(id, { version: input.version, content: replaceMap(current.content, input.mapId, nextMap) }), placements: additions };
}

export function mapForMapFill(content: WorldContent, mapId?: string): WorldMap {
  return selectedMap(content, mapId);
}

export function assertMapFillProposalTarget(map: WorldMap): void {
  assertLocked(map);
}

