import type { BuildingLibrary } from '@novel-game/contracts';

export interface StoredBuildingLibrary {
  library: BuildingLibrary;
  revision: number;
}

export interface BuildingLibraryRepository {
  get(): StoredBuildingLibrary | null;
  save(library: BuildingLibrary, expectedRevision: number): StoredBuildingLibrary;
}
