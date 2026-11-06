import type { CatalogDataMap, CatalogKind } from '@novel-game/contracts';

export interface StoredCatalogOverride<K extends CatalogKind = CatalogKind> {
  kind: K;
  id: string;
  data: CatalogDataMap[K];
  updatedAt: string;
}

export interface BlockCatalogRepository {
  get<K extends CatalogKind>(kind: K, id: string): StoredCatalogOverride<K> | undefined;
  list(): StoredCatalogOverride[];
  /** null = 必须尚无自定义覆盖；number = 自定义覆盖必须仍位于该版本。 */
  save<K extends CatalogKind>(kind: K, data: CatalogDataMap[K], expectedCustomVersion: number | null): StoredCatalogOverride<K>;
  delete(kind: CatalogKind, id: string, expectedCustomVersion: number): void;
}

export interface CatalogContentReference {
  id: string;
  content: object;
}

/** 应用层只依赖引用查询端口，不依赖 SQLite、Express 或具体世界/生成模块。 */
export interface CatalogReferenceSource {
  listStories(): readonly CatalogContentReference[];
  listWorlds(): readonly CatalogContentReference[];
  listGenerationJobs(): readonly {id: string; statTemplateId?: string}[];
}
