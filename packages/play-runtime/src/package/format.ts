import type { BuildingLibrary, GameRevision, ItemCatalog, WorldRevision } from '@novel-game/contracts';
import { sha256Hex } from './sha256.js';

/** Package (single-file HTML) format. Bump only with a player that can read the new shape. */
export const PACKAGE_FORMAT_VERSION = 1;
export const MANIFEST_SCRIPT_ID = 'btg-manifest';
export const CONTENT_SCRIPT_ID = 'btg-content';

export type PackageMode = 'story' | 'open';
export type PackageDegraded = { kind: 'image' | 'catalog' | string; detail: string };

export interface PackageManifest {
  formatVersion: number;
  packageId: string;
  mode: PackageMode;
  title: string;
  revision: { id: string; version: number; createdAt: string; kind: 'game' | 'world' };
  contentHash: string;
  catalogSnapshot: { buildingAssets: number; items: number; hash: string; subset: boolean } | null;
  runtimeVersion: string;
  exportedAt: string;
  exporter: { app: 'book-to-game'; appVersion: string };
  locale: 'zh-CN' | 'en-US';
  degraded: PackageDegraded[];
  /** Reserved. M1b fixed to mode:'none' with no endpoint; never a key field. */
  ai: { mode: 'none' };
}

export type PackageCatalogSnapshot = { buildingLibrary: BuildingLibrary; itemCatalog: ItemCatalog };
export type StoryPackageContent = { revision: GameRevision };
export type OpenPackageContent = { revision: WorldRevision; catalogSnapshot: PackageCatalogSnapshot };
export type PackageContent = StoryPackageContent | OpenPackageContent;

/** JSON safe to place inside <script type="application/json"> (no `</script>` / `<!--` breakouts). */
export function scriptSafeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export function contentHashOf(contentText: string): string {
  return sha256Hex(contentText);
}

export function catalogHashOf(snapshot: PackageCatalogSnapshot): string {
  return sha256Hex(JSON.stringify(snapshot));
}

export type PackageLoadResult =
  | { ok: true; manifest: PackageManifest; content: PackageContent }
  | { ok: false; kind: 'corrupt' | 'format-newer'; reason: string; title?: string };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Validate the two embedded scripts. Pure: callers pass the raw textContent.
 * corrupt  = missing/garbled JSON, hash mismatch, or shape mismatch.
 * format-newer = formatVersion is newer than this player understands.
 */
export function loadPackage(manifestText: string | null | undefined, contentText: string | null | undefined): PackageLoadResult {
  if (!manifestText || !contentText) return { ok: false, kind: 'corrupt', reason: 'missing-script' };
  let manifest: unknown;
  try { manifest = JSON.parse(manifestText); } catch { return { ok: false, kind: 'corrupt', reason: 'manifest-json' }; }
  if (!isObj(manifest)) return { ok: false, kind: 'corrupt', reason: 'manifest-shape' };
  const title = typeof manifest.title === 'string' ? manifest.title : undefined;
  if (typeof manifest.formatVersion !== 'number') return { ok: false, kind: 'corrupt', reason: 'manifest-format', title };
  if (manifest.formatVersion > PACKAGE_FORMAT_VERSION) return { ok: false, kind: 'format-newer', reason: `format ${manifest.formatVersion} > ${PACKAGE_FORMAT_VERSION}`, title };
  if (manifest.formatVersion !== PACKAGE_FORMAT_VERSION) return { ok: false, kind: 'corrupt', reason: 'manifest-format', title };
  if (typeof manifest.contentHash !== 'string' || contentHashOf(contentText) !== manifest.contentHash) {
    return { ok: false, kind: 'corrupt', reason: 'content-hash', title };
  }
  let content: unknown;
  try { content = JSON.parse(contentText); } catch { return { ok: false, kind: 'corrupt', reason: 'content-json', title }; }
  if (!isObj(content) || !isObj(content.revision) || !isObj((content.revision as Record<string, unknown>).content)) {
    return { ok: false, kind: 'corrupt', reason: 'content-shape', title };
  }
  if (manifest.mode !== 'story' && manifest.mode !== 'open') return { ok: false, kind: 'corrupt', reason: 'manifest-mode', title };
  if (typeof manifest.packageId !== 'string' || !manifest.packageId) return { ok: false, kind: 'corrupt', reason: 'manifest-package-id', title };
  if (manifest.mode === 'open' && !isObj(content.catalogSnapshot)) return { ok: false, kind: 'corrupt', reason: 'catalog-missing', title };
  return { ok: true, manifest: manifest as unknown as PackageManifest, content: content as unknown as PackageContent };
}
