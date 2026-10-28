import { z } from 'zod';
import {
  gameContentSchema, worldContentSchema,
  type BuildingLibrary, type GameRevision, type ItemCatalog, type WorldRevision,
} from '@novel-game/contracts';
import {
  HOST_API_VERSION, PACKAGE_FORMAT_VERSION, RUNTIME_VERSION, catalogHashOf, contentHashOf, createAdventureState, createSessionState,
  projectAdventure, projectSession, scriptSafeJson,
  type PackageContent, type PackageDegraded, type PackageManifest,
} from '@novel-game/play-runtime';
import { AppError } from '../../../shared/errors.js';
import { snapshotCatalogs } from '../domain/catalog-snapshot.js';
import { scanForSecrets } from '../domain/secret-scan.js';
import { assemblePackageHtml, packageFileName, templateIsUsable } from '../domain/assemble.js';
import { appendPayload, checkPlayerBinary, exeFileName, sha256HexBytes } from '../domain/exe-trailer.js';
import type { ExportRevisionSources, MediaReader, PlayerTemplateReader, WindowsPlayerBinary, WindowsPlayerReader } from './ports.js';

export const DEFAULT_EXPORT_MAX_BYTES = 20 * 1024 * 1024;

export const exportPlayPackageInputSchema = z.object({
  kind: z.enum(['game', 'world']),
  revisionId: z.string().min(1),
  target: z.enum(['html', 'windows-exe']).default('html'),
  locale: z.enum(['zh-CN', 'en-US']).optional(),
});
export type ExportPlayPackageInput = z.input<typeof exportPlayPackageInputSchema>;

export type ExportReport = {
  fileName: string;
  size: number;
  mode: 'story' | 'open';
  kind: 'game' | 'world';
  packageId: string;
  revision: { id: string; version: number };
  contentHash: string;
  formatVersion: number;
  runtimeVersion: string;
  catalogSnapshot: PackageManifest['catalogSnapshot'];
  degraded: PackageDegraded[];
  /**
   * The complete single-file package. Clients turn it into a download; nothing is written server-side.
   * For `windows-exe` it is '' (the payload is inside `fileBase64`, byte-identical to an html export; not sent twice).
   */
  html: string;
  target: 'html' | 'windows-exe';
  /** SHA-256 (hex) of the HTML bytes — for exe, the same value is in the footer (§7.6-2). */
  payloadSha256: string;
  /** windows-exe only: the whole .exe, base64 — same JSON download channel as html (X7). `size` = exe bytes. */
  fileBase64?: string;
  /** windows-exe only, when the player build reported them. */
  player?: { version?: string; hostApiVersion: number };
};

/** X5: what can be exported right now. Read-only; the click-time EXPORT_TARGET_UNAVAILABLE stays as the fallback. */
export type ExportTargets = {
  html: { available: boolean; unavailableReason?: 'template-missing' };
  'windows-exe': {
    available: boolean;
    unavailableReason?: 'player-missing' | 'player-invalid' | 'player-already-packaged' | 'player-host-api';
    playerPath: string;
    version?: string;
    hostApiVersion?: number;
  };
};

export type ExportServiceOptions = {
  appVersion: string;
  maxBytes?: number;
  now?: () => string;
  /** Exact secret values to keep out of every package (model key, access code, env keys). */
  secrets?: () => string[];
};

const MEDIA_PREFIX = '/media/';

function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

export class ExportService {
  constructor(
    private readonly sources: ExportRevisionSources,
    private readonly media: MediaReader,
    private readonly template: PlayerTemplateReader,
    private readonly options: ExportServiceOptions,
    private readonly windowsPlayer: WindowsPlayerReader | null = null,
  ) {}

  exportTargets(): ExportTargets {
    const template = this.template.read();
    const html = template && templateIsUsable(template) ? { available: true } : { available: false, unavailableReason: 'template-missing' as const };
    const playerPath = this.windowsPlayer?.location() ?? 'dist/player/btg-player-windows-x64.exe';
    const player = this.windowsPlayer?.read() ?? null;
    if (!player) return { html, 'windows-exe': { available: false, unavailableReason: 'player-missing', playerPath } };
    const check = checkPlayerBinary(player.bytes, player.hostApiVersion ?? HOST_API_VERSION);
    const meta = { ...(player.version ? { version: player.version } : {}), hostApiVersion: player.hostApiVersion ?? HOST_API_VERSION };
    return { html, 'windows-exe': check.ok ? { available: true, playerPath, ...meta } : { available: false, unavailableReason: check.reason, playerPath, ...meta } };
  }

  /** windows-exe: the player is checked first so a missing player answers fast, before any packaging work. */
  private requireWindowsPlayer(): WindowsPlayerBinary {
    const playerPath = this.windowsPlayer?.location() ?? 'dist/player/btg-player-windows-x64.exe';
    const player = this.windowsPlayer?.read() ?? null;
    const check = player ? checkPlayerBinary(player.bytes, player.hostApiVersion ?? HOST_API_VERSION) : { ok: false as const, reason: 'player-missing' as const };
    if (!player || !check.ok) {
      throw new AppError('EXPORT_TARGET_UNAVAILABLE', 'Windows 播放器未就绪，网页版可正常导出', 501, {
        target: 'windows-exe', playerPath, unavailableReason: check.ok ? 'player-missing' : check.reason,
      });
    }
    return player;
  }

  exportPlayPackage(raw: ExportPlayPackageInput): ExportReport {
    const input = exportPlayPackageInputSchema.parse(raw);
    const player = input.target === 'windows-exe' ? this.requireWindowsPlayer() : null;
    const revision = this.loadRevision(input.kind, input.revisionId);
    const degraded: PackageDegraded[] = [];
    let content: PackageContent;
    let catalogInfo: PackageManifest['catalogSnapshot'] = null;

    if (input.kind === 'game') {
      const game = revision as GameRevision;
      this.validateGame(game);
      content = { revision: game };
    } else {
      const world = revision as WorldRevision;
      const snapshot = snapshotCatalogs(world.content, this.sources.buildingLibrary(), this.sources.itemCatalog());
      if (snapshot.missing.length) {
        throw new AppError('EXPORT_UNSUPPORTED_CONTENT', '有内容引用已失效', 422, {
          items: snapshot.missing.map(m => ({ kind: m.kind, label: m.label, ref: m.assetId })),
        });
      }
      const buildingLibrary = this.inlineImages(snapshot.buildingLibrary, 'building', degraded);
      const itemCatalog = this.inlineImages(snapshot.itemCatalog, 'item', degraded);
      const catalogSnapshot = { buildingLibrary, itemCatalog };
      this.validateWorld(world, catalogSnapshot);
      content = { revision: world, catalogSnapshot };
      catalogInfo = {
        buildingAssets: buildingLibrary.assets.length,
        items: itemCatalog.items.length,
        hash: catalogHashOf(catalogSnapshot),
        subset: snapshot.subset,
      };
    }

    const contentText = scriptSafeJson(content);
    const title = revision.content.title;
    const manifest: PackageManifest = {
      formatVersion: PACKAGE_FORMAT_VERSION,
      packageId: `btg-${input.kind}-${revision.draftId}`,
      mode: input.kind === 'game' ? 'story' : 'open',
      title,
      revision: { id: revision.id, version: revision.version, createdAt: revision.createdAt, kind: input.kind },
      contentHash: contentHashOf(contentText),
      catalogSnapshot: catalogInfo,
      runtimeVersion: RUNTIME_VERSION,
      exportedAt: (this.options.now ?? (() => new Date().toISOString()))(),
      exporter: { app: 'book-to-game', appVersion: this.options.appVersion },
      locale: input.locale ?? 'zh-CN',
      degraded,
      ai: { mode: 'none' },
    };
    const manifestText = scriptSafeJson(manifest);
    const template = this.template.read();
    if (!template || !templateIsUsable(template)) {
      throw new AppError('EXPORT_PLAYER_UNAVAILABLE', '网页播放器模板未构建，请先运行 npm run build:player', 503);
    }

    const hits = scanForSecrets(content, { manifest: manifestText, content: contentText, player: template }, this.secrets());
    if (hits.length) {
      // Location only — the value is never echoed back.
      throw new AppError('EXPORT_SECRET_DETECTED', '检测到密钥，已中止', 422, { locations: hits.map(h => h.location), rules: [...new Set(hits.map(h => h.rule))] });
    }

    const html = assemblePackageHtml(template, manifestText, contentText, title);
    const size = Buffer.byteLength(html, 'utf8');
    const limit = this.options.maxBytes ?? DEFAULT_EXPORT_MAX_BYTES;
    if (size > limit) throw new AppError('EXPORT_TOO_LARGE', '包体超过上限', 413, { size, limit });

    const htmlBytes = Buffer.from(html, 'utf8');
    const report: ExportReport = {
      fileName: packageFileName(title, revision.version),
      size, mode: manifest.mode, kind: input.kind, packageId: manifest.packageId,
      revision: { id: revision.id, version: revision.version },
      contentHash: manifest.contentHash, formatVersion: manifest.formatVersion, runtimeVersion: manifest.runtimeVersion,
      catalogSnapshot: catalogInfo, degraded, html, target: 'html', payloadSha256: sha256HexBytes(htmlBytes),
    };
    if (!player) return report;
    // The size limit applies to the game content (= the HTML payload); the player adds a fixed few MB on top.
    const hostApiVersion = player.hostApiVersion ?? HOST_API_VERSION;
    const { exe, payloadSha256 } = appendPayload(player.bytes, htmlBytes, hostApiVersion);
    return {
      ...report,
      target: 'windows-exe',
      html: '',
      fileName: exeFileName(report.fileName),
      size: exe.length,
      payloadSha256,
      fileBase64: Buffer.from(exe.buffer, exe.byteOffset, exe.byteLength).toString('base64'),
      player: { ...(player.version ? { version: player.version } : {}), hostApiVersion },
    };
  }

  private secrets(): string[] {
    try { return this.options.secrets?.() ?? []; } catch { return []; }
  }

  private loadRevision(kind: 'game' | 'world', id: string): GameRevision | WorldRevision {
    try {
      return kind === 'game' ? this.sources.getGameRevision(id) : this.sources.getWorldRevision(id);
    } catch (error) {
      if (error instanceof AppError && error.status === 404) {
        throw new AppError('EXPORT_REVISION_NOT_PUBLISHED', '版本不存在或未发布', 404, { revisionId: id });
      }
      throw error;
    }
  }

  private validateGame(revision: GameRevision): void {
    const parsed = gameContentSchema.safeParse(revision.content);
    const issues = parsed.success ? [] : parsed.error.issues.slice(0, 8).map(i => `${i.path.join('.') || 'content'}：${i.message}`);
    if (!issues.length) {
      try { projectSession(createSessionState(revision, 'export-check', revision.createdAt), revision); } catch (error) {
        issues.push(error instanceof Error ? error.message : String(error));
      }
    }
    if (issues.length) throw new AppError('EXPORT_CONTENT_INVALID', '内容校验未通过', 422, { issues });
  }

  private validateWorld(revision: WorldRevision, catalogs: { buildingLibrary: BuildingLibrary; itemCatalog: ItemCatalog }): void {
    const parsed = worldContentSchema.safeParse(revision.content);
    const issues = parsed.success ? [] : parsed.error.issues.slice(0, 8).map(i => `${i.path.join('.') || 'content'}：${i.message}`);
    if (!issues.length) {
      try {
        const state = createAdventureState(revision, 'export-check', revision.createdAt, catalogs);
        projectAdventure(state, revision, catalogs);
      } catch (error) {
        issues.push(error instanceof Error ? error.message : String(error));
      }
    }
    if (issues.length) throw new AppError('EXPORT_CONTENT_INVALID', '内容校验未通过', 422, { issues });
  }

  /** Inline /media images as data URLs; drop server-local paths. Missing files degrade (display-only). */
  private inlineImages<T extends BuildingLibrary | ItemCatalog>(source: T, owner: 'building' | 'item', degraded: PackageDegraded[]): T {
    const list = ('assets' in source ? source.assets : source.items) as { label: string; imageUrl?: string; imagePath?: string }[];
    const next = list.map(entry => {
      const { imagePath, ...rest } = entry;
      const url = entry.imageUrl;
      if (url?.startsWith('data:')) return rest;
      const relative = url?.startsWith(MEDIA_PREFIX) ? url.slice(MEDIA_PREFIX.length) : imagePath;
      if (!url && !imagePath) return rest;
      const file = relative ? this.media.read(relative) : null;
      if (!file) {
        degraded.push({ kind: 'image', detail: `${owner === 'building' ? '建筑' : '物品'}「${entry.label}」 · ${(url ?? imagePath ?? '').split(/[\\/]/).pop()?.slice(0, 80) ?? ''}` });
        const { imageUrl: _dropped, ...withoutImage } = rest;
        return withoutImage;
      }
      return { ...rest, imageUrl: `data:${file.mime};base64,${bytesToBase64(file.bytes)}` };
    });
    return ('assets' in source ? { ...source, assets: next } : { ...source, items: next }) as T;
  }
}
