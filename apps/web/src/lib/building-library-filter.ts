import type { BuildingAsset, MapFillKind } from '@novel-game/contracts';

export type BuildingKindFilter = MapFillKind | 'all';

/** Pure list filter for the dedicated building-library workspace. */
export function filterBuildingAssets(
  assets: readonly BuildingAsset[],
  kind: BuildingKindFilter,
  query: string,
): BuildingAsset[] {
  let list = kind === 'all' ? [...assets] : assets.filter(a => a.kind === kind);
  const q = query.trim().toLowerCase();
  if (!q) return list;
  return list.filter(a =>
    a.label.toLowerCase().includes(q)
    || a.id.toLowerCase().includes(q)
    || (a.tags ?? []).some(tag => tag.toLowerCase().includes(q))
    || (a.blurb ?? '').toLowerCase().includes(q));
}
