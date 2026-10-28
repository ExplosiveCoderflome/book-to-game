import type { ItemCatalog } from '@novel-game/contracts';

export interface StoredItemCatalog {
  catalog: ItemCatalog;
  revision: number;
}

export interface ItemCatalogRepository {
  get(): StoredItemCatalog | null;
  save(catalog: ItemCatalog, expectedRevision: number): StoredItemCatalog;
}

/** Optional hook so delete can scan building hard rows (M-item-2+). Soft drafts ignored. */
export type BuildingHardRowSource = () => readonly {
  id: string;
  shop?: { shelf?: Array<{ itemId?: string }> };
  supply?: { recipes?: Array<{ requiresItemId?: string }> };
  quest?: {
    slots?: Array<{
      giveItems?: Array<{ itemId?: string }>;
      rewards?: { items?: Array<{ itemId?: string }> };
    }>;
  };
  encounter?: { loot?: Array<{ itemId?: string }> };
}[];
