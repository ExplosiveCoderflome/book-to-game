import {
  addItemAsset, createItemAsset, emptyItemCatalog, itemCatalogSaveInputSchema,
  removeItemAssetGuarded, updateItemAsset, validateItemCatalog,
  type ItemAsset, type ItemAssetDraft, type ItemCatalog, type ItemCatalogSaveInput,
  type ItemCatalogView,
} from '@novel-game/contracts';
import { AppError } from '../../../shared/errors.js';
import type { BuildingHardRowSource, ItemCatalogRepository } from './ports.js';

export class ItemCatalogService {
  constructor(
    private readonly repository: ItemCatalogRepository,
    private readonly buildingHardRows: BuildingHardRowSource = () => [],
  ) {}

  get(): ItemCatalogView {
    const row = this.repository.get();
    const catalog = row?.catalog ?? emptyItemCatalog();
    const warnings = validateItemCatalog(catalog)
      .filter(i => i.level === 'warning')
      .map(i => i.message);
    return { catalog, revision: row?.revision ?? 0, warnings: warnings.length ? warnings : undefined };
  }

  save(input: ItemCatalogSaveInput): ItemCatalogView {
    const parsed = itemCatalogSaveInputSchema.parse(input);
    const current = this.get();
    if (parsed.expectedRevision !== current.revision) {
      throw new AppError('ITEM_CATALOG_CONFLICT', '物品目录已更新，请重新载入后再保存', 409);
    }
    const errors = validateItemCatalog(parsed.catalog).filter(i => i.level === 'error');
    if (errors.length) {
      throw new AppError('ITEM_CATALOG_INVALID', errors.map(e => e.message).join('；'), 422, {
        issues: errors,
      });
    }
    const warnings = validateItemCatalog(parsed.catalog)
      .filter(i => i.level === 'warning')
      .map(i => i.message);
    const saved = this.repository.save(parsed.catalog, parsed.expectedRevision);
    return { catalog: saved.catalog, revision: saved.revision, warnings: warnings.length ? warnings : undefined };
  }

  private mutate(
    expectedRevision: number,
    fn: (cat: ItemCatalog) => { catalog: ItemCatalog; warnings?: string[] },
  ): ItemCatalogView {
    const current = this.get();
    if (expectedRevision !== current.revision) {
      throw new AppError('ITEM_CATALOG_CONFLICT', '物品目录已更新，请重新载入后再保存', 409);
    }
    const next = fn(current.catalog);
    const errors = validateItemCatalog(next.catalog).filter(i => i.level === 'error');
    if (errors.length) {
      throw new AppError('ITEM_CATALOG_INVALID', errors.map(e => e.message).join('；'), 422, {
        issues: errors,
      });
    }
    const soft = validateItemCatalog(next.catalog)
      .filter(i => i.level === 'warning')
      .map(i => i.message);
    const mergedWarnings = [...(next.warnings ?? []), ...soft];
    const saved = this.repository.save(next.catalog, expectedRevision);
    return {
      catalog: saved.catalog,
      revision: saved.revision,
      warnings: mergedWarnings.length ? mergedWarnings : undefined,
    };
  }

  createAsset(draft: ItemAssetDraft, expectedRevision: number): ItemCatalogView & { asset: ItemAsset } {
    let created!: ItemAsset;
    const view = this.mutate(expectedRevision, cat => {
      created = createItemAsset(cat, draft);
      return { catalog: addItemAsset(cat, created) };
    });
    return { ...view, asset: created };
  }

  updateAsset(id: string, patch: Partial<Omit<ItemAsset, 'id'>>, expectedRevision: number): ItemCatalogView {
    return this.mutate(expectedRevision, cat => ({ catalog: updateItemAsset(cat, id, patch) }));
  }

  deleteAsset(id: string, expectedRevision: number, opts?: { force?: boolean }): ItemCatalogView {
    try {
      return this.mutate(expectedRevision, cat =>
        removeItemAssetGuarded(cat, id, this.buildingHardRows(), opts),
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('仍被建筑硬行引用')) {
        throw new AppError('ITEM_REFERENCED', msg, 409, { itemId: id });
      }
      if (msg.includes('找不到')) {
        throw new AppError('ITEM_NOT_FOUND', msg, 404);
      }
      throw e;
    }
  }

  /** Item id set for future building / world validation. */
  itemIds(): Set<string> {
    return new Set(this.get().catalog.items.map(a => a.id));
  }
}
