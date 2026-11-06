import type { CatalogDataMap, CatalogEntry, CatalogKind, FunTag } from '@novel-game/contracts';

export function catalogEntryTitle<K extends CatalogKind>(entry: CatalogEntry<K>): string {
  const data = entry.data as {label?: string};
  return data.label || entry.id;
}

export function catalogEntryDescription<K extends CatalogKind>(entry: CatalogEntry<K>): string {
  const data = entry.data as {blurb?: string; description?: string};
  return data.blurb ?? data.description ?? '';
}

export function filterCatalogEntries<K extends CatalogKind>(
  entries: readonly CatalogEntry<K>[], query: string, funTag: FunTag | 'all' = 'all',
): CatalogEntry<K>[] {
  const needle = query.trim().toLocaleLowerCase();
  return entries.filter(entry => {
    if (funTag !== 'all') {
      const tags = 'funTags' in entry.data ? entry.data.funTags as readonly string[] : [];
      if (!tags.includes(funTag)) return false;
    }
    if (!needle) return true;
    return [entry.id, catalogEntryTitle(entry), catalogEntryDescription(entry)]
      .some(value => value.toLocaleLowerCase().includes(needle));
  });
}

export function suggestCustomId<K extends CatalogKind>(entries: readonly CatalogEntry<K>[], baseId: string): string {
  const occupied = new Set(entries.map(entry => entry.id));
  const stem = baseId.replace(/_custom(?:_\d+)?$/, '').slice(0, 32);
  for (let index = 1; index < 1000; index++) {
    const suffix = `_custom${index === 1 ? '' : `_${index}`}`;
    const id = `${stem.slice(0, 40 - suffix.length)}${suffix}`;
    if (!occupied.has(id)) return id;
  }
  return `custom_${Date.now().toString(36)}`.slice(0, 40);
}

export function copyForCustom<K extends CatalogKind>(entry: CatalogEntry<K>, entries: readonly CatalogEntry<K>[]): CatalogDataMap[K] {
  return {...JSON.parse(JSON.stringify(entry.data)) as CatalogDataMap[K], id: suggestCustomId(entries, entry.id), version: 1};
}
