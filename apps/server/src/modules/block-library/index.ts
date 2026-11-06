export { BlockLibraryService } from './application/block-library-service.js';
export { lintCatalog, type CatalogSnapshot } from './application/catalog-lint.js';
export type { BlockCatalogRepository, CatalogReferenceSource, StoredCatalogOverride } from './application/ports.js';
export { SqliteBlockCatalogRepository, migrateBlockCatalog } from './infrastructure/sqlite-block-catalog-repository.js';
