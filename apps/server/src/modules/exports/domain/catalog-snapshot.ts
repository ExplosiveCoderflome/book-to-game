import type { BuildingAsset, BuildingLibrary, ItemCatalog, WorldContent } from '@novel-game/contracts';
import { projectFillActions } from '@novel-game/rules';

export type MissingReference = { kind: 'building-asset'; label: string; placementLabel?: string; assetId: string };

export type CatalogSnapshotResult = {
  buildingLibrary: BuildingLibrary;
  itemCatalog: ItemCatalog;
  /** true when the trimmed subset reproduces the full-catalog fill projection exactly. */
  subset: boolean;
  missing: MissingReference[];
};

function walk(value: unknown, visit: (key: string, value: unknown, owner: Record<string, unknown>) => void): void {
  if (Array.isArray(value)) { for (const item of value) walk(item, visit); return; }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    visit(key, child, value as Record<string, unknown>);
    walk(child, visit);
  }
}

function stringsIn(value: unknown, into: Set<string>): void {
  if (typeof value === 'string') { into.add(value); return; }
  if (Array.isArray(value)) { for (const item of value) stringsIn(item, into); return; }
  if (value && typeof value === 'object') for (const child of Object.values(value)) stringsIn(child, into);
}

/**
 * Freeze the Catalog at export time (slice §5.4): only assets/items the world references.
 * Falls back to the full catalogs if the subset would change what the shared engine projects.
 */
export function snapshotCatalogs(world: WorldContent, library: BuildingLibrary, catalog: ItemCatalog): CatalogSnapshotResult {
  const assetIds = new Set<string>();
  const missing: MissingReference[] = [];
  walk(world, (key, value, owner) => {
    if (key !== 'buildingAssetId' || typeof value !== 'string') return;
    assetIds.add(value);
    if (!library.assets.some(asset => asset.id === value)) {
      const placementLabel = typeof owner.label === 'string' ? owner.label : undefined;
      missing.push({ kind: 'building-asset', assetId: value, label: placementLabel ?? value, placementLabel });
    }
  });
  const assets: BuildingAsset[] = library.assets.filter(asset => assetIds.has(asset.id));
  const referenced = new Set<string>();
  stringsIn(world, referenced);
  stringsIn(assets, referenced);
  const items = catalog.items.filter(item => referenced.has(item.id));
  const subsetLibrary: BuildingLibrary = { ...library, assets };
  const subsetCatalog: ItemCatalog = { ...catalog, items };
  const full = JSON.stringify(projectFillActions(world, { library, catalog }));
  const trimmed = JSON.stringify(projectFillActions(world, { library: subsetLibrary, catalog: subsetCatalog }));
  if (full !== trimmed) return { buildingLibrary: library, itemCatalog: catalog, subset: false, missing };
  return { buildingLibrary: subsetLibrary, itemCatalog: subsetCatalog, subset: true, missing };
}
