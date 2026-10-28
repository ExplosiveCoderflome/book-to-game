import {
  addBuildingAsset, buildingLibrarySaveInputSchema, createBuildingAsset, emptyBuildingLibrary,
  promoteBuildingVariant, removeBuildingAsset, updateBuildingAsset, validateBuildingLibrary,
  type BuildingAsset, type BuildingAssetDraft, type BuildingLibrary, type BuildingLibrarySaveInput,
  type BuildingLibraryView, type LocalPlacementOverrides,
} from '@novel-game/contracts';
import { AppError } from '../../../shared/errors.js';
import type { BuildingLibraryRepository } from './ports.js';

export type ItemIdSource = () => ReadonlySet<string>;

export class BuildingLibraryService {
  constructor(
    private readonly repository: BuildingLibraryRepository,
    private readonly itemIds: ItemIdSource = () => new Set(),
  ) {}

  private viewFrom(library: BuildingLibrary, revision: number): BuildingLibraryView {
    const issues = validateBuildingLibrary(library, { itemIds: this.itemIds() });
    const warnings = issues.filter(i => i.level === 'warning').map(i => i.message);
    return {
      library,
      revision,
      warnings: warnings.length ? warnings : undefined,
    };
  }

  private assertValid(library: BuildingLibrary): void {
    const errors = validateBuildingLibrary(library, { itemIds: this.itemIds() })
      .filter(i => i.level === 'error');
    if (errors.length) {
      throw new AppError('BUILDING_LIBRARY_INVALID', errors.map(e => e.message).join('；'), 422, {
        issues: errors,
      });
    }
  }

  get(): BuildingLibraryView {
    const row = this.repository.get();
    return this.viewFrom(row?.library ?? emptyBuildingLibrary(), row?.revision ?? 0);
  }

  save(input: BuildingLibrarySaveInput): BuildingLibraryView {
    const parsed = buildingLibrarySaveInputSchema.parse(input);
    const current = this.get();
    if (parsed.expectedRevision !== current.revision) {
      throw new AppError('BUILDING_LIBRARY_CONFLICT', '建筑库已更新，请重新载入后再保存', 409);
    }
    this.assertValid(parsed.library);
    const saved = this.repository.save(parsed.library, parsed.expectedRevision);
    return this.viewFrom(saved.library, saved.revision);
  }

  private mutate(expectedRevision: number, fn: (lib: BuildingLibrary) => BuildingLibrary): BuildingLibraryView {
    const current = this.get();
    if (expectedRevision !== current.revision) {
      throw new AppError('BUILDING_LIBRARY_CONFLICT', '建筑库已更新，请重新载入后再保存', 409);
    }
    const next = fn(current.library);
    this.assertValid(next);
    const saved = this.repository.save(next, expectedRevision);
    return this.viewFrom(saved.library, saved.revision);
  }

  createAsset(draft: BuildingAssetDraft, expectedRevision: number): BuildingLibraryView & { asset: BuildingAsset } {
    let created!: BuildingAsset;
    const view = this.mutate(expectedRevision, lib => {
      created = createBuildingAsset(lib, draft);
      return addBuildingAsset(lib, created);
    });
    return { ...view, asset: created };
  }

  updateAsset(id: string, patch: Partial<Omit<BuildingAsset, 'id'>>, expectedRevision: number): BuildingLibraryView {
    return this.mutate(expectedRevision, lib => updateBuildingAsset(lib, id, patch));
  }

  deleteAsset(id: string, expectedRevision: number): BuildingLibraryView {
    return this.mutate(expectedRevision, lib => removeBuildingAsset(lib, id));
  }

  promoteVariant(
    baseId: string,
    overrides: LocalPlacementOverrides,
    expectedRevision: number,
    opts?: { label?: string },
  ): BuildingLibraryView & { asset: BuildingAsset } {
    let created!: BuildingAsset;
    const view = this.mutate(expectedRevision, lib => {
      const base = lib.assets.find(a => a.id === baseId);
      if (!base) throw new AppError('BUILDING_NOT_FOUND', `建筑库中找不到资产：${baseId}`, 404);
      const r = promoteBuildingVariant(lib, base, overrides, opts);
      created = r.asset;
      return r.library;
    });
    return { ...view, asset: created };
  }

  /** Asset id set for map fill validation. */
  assetIds(): Set<string> {
    return new Set(this.get().library.assets.map(a => a.id));
  }
}
