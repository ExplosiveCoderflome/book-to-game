export { ItemCatalogService } from './application/catalog-service.js';
export { SqliteItemCatalogRepository } from './infrastructure/sqlite-item-catalog-repository.js';
export type { BuildingHardRowSource, ItemCatalogRepository, StoredItemCatalog } from './application/ports.js';
export {
  acceptItemDrafts,
  acceptLootRows,
  acceptShelfRows,
  proposeItemAssets,
  proposeLootRows,
  proposeShelfRows,
  ITEM_DRAFT_CONTEXT_LIMIT,
  type BuildingShelfWriter,
  type ItemDraftModel,
} from './application/propose-items.js';
