import type { ItemAsset, ItemCategory } from '@novel-game/contracts';

export type ItemCategoryFilter = ItemCategory | 'all';

export function filterItemAssets(
  items: readonly ItemAsset[],
  category: ItemCategoryFilter,
  query: string,
): ItemAsset[] {
  const q = query.trim().toLowerCase();
  return items.filter(item => {
    if (category !== 'all' && item.category !== category) return false;
    if (!q) return true;
    const hay = [item.label, item.id, item.blurb ?? '', ...(item.tags ?? [])].join(' ').toLowerCase();
    return hay.includes(q);
  });
}
