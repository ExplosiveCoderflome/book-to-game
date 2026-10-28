import type { BuildingLibrary, GameRevision, ItemCatalog, WorldRevision } from '@novel-game/contracts';

export interface ExportRevisionSources {
  getGameRevision(id: string): GameRevision;
  getWorldRevision(id: string): WorldRevision;
  buildingLibrary(): BuildingLibrary;
  itemCatalog(): ItemCatalog;
}

/** Reads a stored image by its media-relative path (e.g. `building-images/x.svg`). null = missing. */
export interface MediaReader {
  read(relativePath: string): { bytes: Uint8Array; mime: string } | null;
}

/** Prebuilt single-file player shell (built by `npm run build:player`). null = not built. */
export interface PlayerTemplateReader {
  read(): string | null;
}

/** Prebuilt Windows player (M1b-2; built on Windows/CI, never on the author's machine). */
export type WindowsPlayerBinary = { bytes: Uint8Array; version?: string; hostApiVersion?: number };
export interface WindowsPlayerReader {
  /** Where the player is expected (shown in 「需要文件：…」; repo-relative when possible). */
  location(): string;
  /** null = not there. */
  read(): WindowsPlayerBinary | null;
}
