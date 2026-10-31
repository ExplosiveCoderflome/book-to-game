import {
  findBuildingAsset, MAP_FILL_KIND_LABEL, MAP_FILL_KINDS, mapFillModelOutputSchema,
  modelItemToDraftCard, proposeMapFillInputSchema,
  type BuildingAsset, type MapFillKind, type MapFillProposal, type MapFillProposalItem,
  type ProposeMapFillInput, type WorldMap,
} from '@novel-game/contracts';
import { AppError } from '../../../shared/errors.js';
import type { BuildingLibraryService } from '../../building-library/index.js';
import { assertMapFillProposalTarget, mapForMapFill } from './map-fill.js';
import type { WorldService } from './world-service.js';

export type MapFillModelLocation = {
  id: string;
  title: string;
  cell: string;
  venueType?: string;
};

/** Locked author-time snapshot only. No session or mutable service is exposed to the model. */
export type MapFillModelInput = Required<Pick<ProposeMapFillInput, 'count'>> & Pick<ProposeMapFillInput, 'prompt' | 'kinds' | 'allowNewAssets'> & {
  map: WorldMap;
  locations: MapFillModelLocation[];
  assets: BuildingAsset[];
};

export interface MapFillModel {
  proposeMapFill(input: MapFillModelInput, signal: AbortSignal): Promise<unknown>;
}

/** Deterministic test/mock adapter: existing catalog references always win over new drafts. */
export const mockMapFillModel: MapFillModel = {
  async proposeMapFill(input) {
    const kinds = input.kinds?.length ? input.kinds : MAP_FILL_KINDS;
    const placements: MapFillProposalItem[] = [];
    for (let index = 0; index < input.count && input.locations.length > 0; index++) {
      const location = input.locations[index % input.locations.length];
      const kind = kinds[index % kinds.length] as MapFillKind;
      const asset = input.assets.find(candidate => candidate.kind === kind);
      if (asset) {
        placements.push({
          proposalId: `mock_fill_${index + 1}`,
          kind,
          locationId: location.id,
          label: asset.label,
          buildingAssetId: asset.id,
          buildingAssetVersion: asset.version,
        });
        continue;
      }
      if (!input.allowNewAssets) continue;
      const assetDraft = modelItemToDraftCard({
        label: `${MAP_FILL_KIND_LABEL[kind]}·${location.title}`,
        kind,
        tags: ['地图填充', location.venueType ?? '野外'],
        blurb: input.prompt?.trim() || `为${location.title}补充${MAP_FILL_KIND_LABEL[kind]}。`,
      }, index);
      placements.push({
        proposalId: `mock_fill_${index + 1}`,
        kind,
        locationId: location.id,
        label: assetDraft.label,
        assetDraft,
      });
    }
    return { placements };
  },
};

/** Read-only proposal. Invalid/unbound model suggestions are excluded and reported; nothing is written. */
export async function proposeMapFill(
  worlds: WorldService,
  library: BuildingLibraryService,
  id: string,
  input: ProposeMapFillInput & { mapId?: string },
  model: MapFillModel,
  signal: AbortSignal = AbortSignal.timeout(120_000),
  modelName?: string,
): Promise<MapFillProposal> {
  const parsed = proposeMapFillInputSchema.parse(input);
  const draft = worlds.get(id);
  const map = mapForMapFill(draft.content, input.mapId);
  assertMapFillProposalTarget(map);
  const locationById = new Map(draft.content.locations.map(location => [location.id, location]));
  const locations = map.pois.flatMap(poi => {
    const location = locationById.get(poi.locationId);
    return location ? [{
      id: location.id,
      title: location.title,
      cell: poi.anchor.cell,
      ...(poi.venueType ? { venueType: poi.venueType } : {}),
    }] : [];
  });
  if (!locations.length) throw new AppError('MAP_FILL_NO_BOUND_LOCATION', '当前地图没有可绑定的地点', 422);
  const assets = library.get().library.assets;
  const raw = await model.proposeMapFill({
    prompt: parsed.prompt,
    kinds: parsed.kinds,
    count: parsed.count ?? 6,
    allowNewAssets: parsed.allowNewAssets,
    map: structuredClone(map),
    locations,
    assets: structuredClone(assets),
  }, signal);
  const output = mapFillModelOutputSchema.safeParse(raw);
  if (!output.success) {
    throw new AppError('MODEL_INVALID_RESPONSE', '模型返回的地图填充草案无法解析', 502, {
      issues: output.error.issues.slice(0, 6).map(issue => ({ path: issue.path.join('.'), message: issue.message })),
    });
  }

  const bound = new Set(locations.map(location => location.id));
  const allowedKinds = parsed.kinds?.length ? new Set(parsed.kinds) : undefined;
  const seen = new Set<string>();
  const warnings: string[] = [];
  const items: MapFillProposalItem[] = [];
  for (const item of output.data.placements) {
    if (items.length >= (parsed.count ?? 6)) break;
    if (seen.has(item.proposalId)) {
      warnings.push(`已过滤重复提案：${item.proposalId}`);
      continue;
    }
    seen.add(item.proposalId);
    if (!bound.has(item.locationId)) {
      warnings.push(`已过滤未绑定地点提案：${item.locationId}`);
      continue;
    }
    if (allowedKinds && !allowedKinds.has(item.kind)) {
      warnings.push(`已过滤不在所选种类内的提案：${item.proposalId}`);
      continue;
    }
    if (item.buildingAssetId) {
      const asset = findBuildingAsset({ schemaVersion: 1, assets }, item.buildingAssetId, item.buildingAssetVersion);
      if (!asset) {
        warnings.push(`已过滤引用未知库资产的提案：${item.buildingAssetId}`);
        continue;
      }
      if (asset.kind !== item.kind) {
        warnings.push(`已过滤资产种类不一致的提案：${item.proposalId}`);
        continue;
      }
      items.push({ ...item, buildingAssetVersion: asset.version });
      continue;
    }
    if (!item.assetDraft || !parsed.allowNewAssets) {
      warnings.push(`已过滤未引用库资产的提案：${item.proposalId}`);
      continue;
    }
    if (item.assetDraft.kind !== item.kind) {
      warnings.push(`已过滤新资产种类不一致的提案：${item.proposalId}`);
      continue;
    }
    items.push(item);
  }
  if (!items.length) warnings.push('没有可接受的地图填充提案');
  return { items, warnings: warnings.slice(0, 24), ...(modelName ? { model: modelName } : {}) };
}
