import { CONTENT_SCRIPT_ID, MANIFEST_SCRIPT_ID, loadPackage, type PackageLoadResult } from '@novel-game/play-runtime';

/**
 * Read the two embedded scripts and verify them (formatVersion + contentHash). Pure DOM read, no network.
 * In the Windows player the host also reports whether the exe footer's payload SHA-256 matched (§6.3):
 * a mismatch opens the same 「这个游戏文件已损坏」 page — never a native dialog.
 */
export function bootPackage(doc: Document = document, scope: unknown = typeof window === 'undefined' ? undefined : window): PackageLoadResult & { rawManifest?: Record<string, unknown> } {
  const manifestText = doc.getElementById(MANIFEST_SCRIPT_ID)?.textContent;
  const contentText = doc.getElementById(CONTENT_SCRIPT_ID)?.textContent;
  let result = loadPackage(manifestText, contentText);
  let rawManifest: Record<string, unknown> | undefined;
  try { rawManifest = JSON.parse(manifestText ?? 'null') ?? undefined; } catch { /* corrupt */ }
  const host = (scope as { __BTG_HOST__?: { payloadIntact?: unknown } } | undefined)?.__BTG_HOST__;
  if (host && host.payloadIntact === false) {
    result = { ok: false, kind: 'corrupt', reason: 'payload-sha256', title: typeof rawManifest?.title === 'string' ? rawManifest.title : undefined };
  }
  return { ...result, rawManifest };
}
