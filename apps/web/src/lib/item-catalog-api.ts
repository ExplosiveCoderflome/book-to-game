import type {
  AcceptItemDraftsInput, AcceptLootRowsInput, AcceptShelfRowsInput,
  ItemAsset, ItemAssetDraft, ItemCatalogView, ItemDraftProposal,
  LootDraftProposal, ProposeItemAssetsInput, ProposeLootRowsInput,
  ProposeShelfRowsInput, ShelfDraftProposal,
} from '@novel-game/contracts';
import { request } from './api';

export function loadItemCatalog(token: string) {
  return request<ItemCatalogView>(token, '/settings/item-catalog');
}

export function saveItemCatalog(token: string, catalog: ItemCatalogView['catalog'], expectedRevision: number) {
  return request<ItemCatalogView>(token, '/settings/item-catalog', 'PUT', { catalog, expectedRevision });
}

export function createItemAsset(token: string, draft: ItemAssetDraft & { expectedRevision: number }) {
  return request<ItemCatalogView & { asset: ItemAsset }>(token, '/settings/item-catalog/assets', 'POST', draft);
}

export function updateItemAsset(
  token: string,
  id: string,
  patch: Partial<Omit<ItemAsset, 'id'>>,
  expectedRevision: number,
) {
  return request<ItemCatalogView>(token, `/settings/item-catalog/assets/${encodeURIComponent(id)}`, 'PUT', {
    expectedRevision, patch,
  });
}

export function deleteItemAsset(token: string, id: string, expectedRevision: number, force?: boolean) {
  return request<ItemCatalogView>(token, `/settings/item-catalog/assets/${encodeURIComponent(id)}`, 'DELETE', {
    expectedRevision, force,
  });
}

export function proposeItemAssets(token: string, input: ProposeItemAssetsInput) {
  return request<ItemDraftProposal>(token, '/settings/item-catalog/propose', 'POST', input);
}

export function acceptItemDrafts(token: string, input: AcceptItemDraftsInput) {
  return request<ItemCatalogView & { assets: ItemAsset[] }>(token, '/settings/item-catalog/accept', 'POST', input);
}

export function proposeShelfRows(token: string, input: ProposeShelfRowsInput) {
  return request<ShelfDraftProposal>(token, '/settings/item-catalog/propose-shelf', 'POST', input);
}

export function acceptShelfRows(token: string, input: AcceptShelfRowsInput) {
  return request<{ library: unknown; revision: number }>(token, '/settings/item-catalog/accept-shelf', 'POST', input);
}

export function proposeLootRows(token: string, input: ProposeLootRowsInput) {
  return request<LootDraftProposal>(token, '/settings/item-catalog/propose-loot', 'POST', input);
}

export function acceptLootRows(token: string, input: AcceptLootRowsInput) {
  return request<{ library: unknown; revision: number }>(token, '/settings/item-catalog/accept-loot', 'POST', input);
}
