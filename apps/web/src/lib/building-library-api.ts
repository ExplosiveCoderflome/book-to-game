import type {
  AcceptBuildingDraftsInput, BuildingAsset, BuildingAssetDraft, BuildingDraftProposal,
  BuildingLibraryView, LocalPlacementOverrides, ProposeBuildingAssetsInput,
} from '@novel-game/contracts';
import { request } from './api';

export function loadBuildingLibrary(token: string) {
  return request<BuildingLibraryView>(token, '/settings/building-library');
}

export function saveBuildingLibrary(token: string, library: BuildingLibraryView['library'], expectedRevision: number) {
  return request<BuildingLibraryView>(token, '/settings/building-library', 'PUT', { library, expectedRevision });
}

export function createBuildingAsset(token: string, draft: BuildingAssetDraft & { expectedRevision: number }) {
  return request<BuildingLibraryView & { asset: BuildingAsset }>(token, '/settings/building-library/assets', 'POST', draft);
}

export function updateBuildingAsset(
  token: string,
  id: string,
  patch: Partial<Omit<BuildingAsset, 'id'>>,
  expectedRevision: number,
) {
  return request<BuildingLibraryView>(token, `/settings/building-library/assets/${encodeURIComponent(id)}`, 'PUT', {
    expectedRevision, patch,
  });
}

export function deleteBuildingAsset(token: string, id: string, expectedRevision: number) {
  return request<BuildingLibraryView>(token, `/settings/building-library/assets/${encodeURIComponent(id)}`, 'DELETE', {
    expectedRevision,
  });
}

export function promoteBuildingVariant(
  token: string,
  baseId: string,
  expectedRevision: number,
  opts?: { label?: string; overrides?: LocalPlacementOverrides },
) {
  return request<BuildingLibraryView & { asset: BuildingAsset }>(token, '/settings/building-library/promote', 'POST', {
    baseId, expectedRevision, ...opts,
  });
}

export function proposeBuildingAssets(token: string, input: ProposeBuildingAssetsInput) {
  return request<BuildingDraftProposal>(token, '/settings/building-library/propose', 'POST', input);
}

export function acceptBuildingDrafts(token: string, input: AcceptBuildingDraftsInput) {
  return request<BuildingLibraryView & { assets: BuildingAsset[] }>(
    token, '/settings/building-library/accept', 'POST', input,
  );
}

export function generateBuildingImage(
  token: string,
  assetId: string,
  body: { expectedRevision: number; prompt?: string; preferSvg?: boolean; width?: number; height?: number },
) {
  return request<BuildingLibraryView & { asset: BuildingAsset; image: { imageUrl: string; imageProvider: string; imagePath?: string; mimeType: string; revisedPrompt?: string } }>(
    token,
    `/settings/building-library/assets/${encodeURIComponent(assetId)}/generate-image`,
    'POST',
    body,
    { signal: AbortSignal.timeout(120_000) },
  );
}

export function generateBuildingImagePreview(
  token: string,
  body: {
    label: string; kind: import('@novel-game/contracts').MapFillKind;
    tags?: string[]; color?: string; icon?: string; blurb?: string;
    prompt?: string; preferSvg?: boolean; seed?: number;
  },
) {
  return request<{ imageUrl: string; imageProvider: string; imagePath?: string; mimeType: string; revisedPrompt?: string }>(
    token,
    '/settings/building-library/generate-image-preview',
    'POST',
    body,
    { signal: AbortSignal.timeout(120_000) },
  );
}
