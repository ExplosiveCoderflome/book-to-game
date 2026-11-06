import type {
  BlockLibraryView, CatalogDataMap, CatalogEntry, CatalogKind,
} from '@novel-game/contracts';
import { request } from './api';

const PATHS: Record<CatalogKind, string> = {
  block: 'blocks',
  'fun-profile': 'fun-profiles',
  'stat-template': 'stat-templates',
  'simulation-strategy': 'simulation-strategies',
};

export function loadBlockLibrary(token: string) {
  return request<BlockLibraryView>(token, '/settings/block-library');
}

export function upsertCatalogEntry<K extends CatalogKind>(token: string, kind: K, data: CatalogDataMap[K], expectedVersion: number) {
  return request<CatalogEntry<K>>(token, `/settings/block-library/${PATHS[kind]}/${encodeURIComponent(data.id)}`, 'PUT', {data, expectedVersion});
}

export function deleteCatalogEntry(token: string, kind: CatalogKind, id: string, expectedVersion: number) {
  return request<BlockLibraryView>(token, `/settings/block-library/${PATHS[kind]}/${encodeURIComponent(id)}`, 'DELETE', {expectedVersion});
}
