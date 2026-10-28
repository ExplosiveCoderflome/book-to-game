/** Pure helpers for the author-side export report (UI plan §4.4 / §5.2–5.3). */
export type ExportDegraded = { kind: string; detail: string };
export type ExportTarget = 'html' | 'windows-exe';
/**
 * One report shape for both targets (slice §5 X7): the file comes back through the same JSON channel —
 * `html` (text) for the web package, `fileBase64` (the whole .exe) for Windows. Every field is from the
 * server; the UI never estimates sizes or versions.
 */
export type ExportReportView = {
  fileName: string; size: number; mode: 'story' | 'open'; kind: 'game' | 'world';
  degraded: ExportDegraded[]; html: string;
  target?: ExportTarget;
  /** SHA-256 of the HTML bytes (for exe: the embedded payload). Not shown; `data-payload-sha256` only. */
  payloadSha256?: string;
  fileBase64?: string;
  player?: { version?: string; hostApiVersion?: number };
};

export type ExportFailure =
  | { kind: 'not-published' }
  | { kind: 'invalid'; issues: string[] }
  | { kind: 'too-large'; size?: number; limit?: number }
  | { kind: 'secret'; locations: string[] }
  | { kind: 'unsupported'; items: { kind: string; label: string }[] }
  | { kind: 'target-unavailable'; playerPath?: string }
  | { kind: 'other' };

/** <1 MB → KB rounded; ≥1 MB → MB with one decimal. Pure formatting, never estimated. */
export function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const asObj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? v as Record<string, unknown> : {});

/** Error code → one of five failure classes; unknown codes fall to `other`. */
export function classifyExportError(code: string | undefined, details: unknown): ExportFailure {
  const d = asObj(details);
  switch (code) {
    case 'EXPORT_REVISION_NOT_PUBLISHED': return { kind: 'not-published' };
    case 'EXPORT_CONTENT_INVALID':
      return { kind: 'invalid', issues: Array.isArray(d.issues) ? d.issues.filter((x): x is string => typeof x === 'string') : [] };
    case 'EXPORT_TOO_LARGE':
      return { kind: 'too-large', size: typeof d.size === 'number' ? d.size : undefined, limit: typeof d.limit === 'number' ? d.limit : undefined };
    case 'EXPORT_SECRET_DETECTED':
      return { kind: 'secret', locations: Array.isArray(d.locations) ? d.locations.filter((x): x is string => typeof x === 'string').map(secretLocationLabel) : [] };
    case 'EXPORT_UNSUPPORTED_CONTENT':
      return {
        kind: 'unsupported',
        items: Array.isArray(d.items) ? d.items.map(asObj).map(i => ({ kind: String(i.kind ?? ''), label: String(i.label ?? i.ref ?? '') })) : [],
      };
    case 'EXPORT_TARGET_UNAVAILABLE':
      return { kind: 'target-unavailable', ...(typeof d.playerPath === 'string' ? { playerPath: d.playerPath } : {}) };
    default: return { kind: 'other' };
  }
}

/** Bytes of the downloadable file: exe from base64, html as UTF-8 text. */
export function reportFileBytes(report: Pick<ExportReportView, 'html' | 'fileBase64'>): Uint8Array {
  if (report.fileBase64 !== undefined) {
    const bin = atob(report.fileBase64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new TextEncoder().encode(report.html);
}

export function reportMime(report: Pick<ExportReportView, 'target'>): string {
  return report.target === 'windows-exe' ? 'application/vnd.microsoft.portable-executable' : 'text/html;charset=utf-8';
}

/** One hint span for both buttons; sentences joined with 「 · 」 (UI plan §3.1). */
export function exportHint(parts: (string | false | null | undefined)[]): string {
  return parts.filter((p): p is string => !!p).join(' · ');
}

/** JSON path → readable place. Never a value. */
export function secretLocationLabel(location: string): string {
  if (location === 'player') return '播放器模板';
  if (location === 'manifest') return '包信息';
  return location.replace(/^content\.revision\.content\.?/, '内容 · ').replace(/^content\.catalogSnapshot\./, '目录快照 · ').replace(/ · $/, '');
}

export function groupDegraded(list: ExportDegraded[]): { kind: string; items: string[] }[] {
  const groups = new Map<string, string[]>();
  for (const d of list) groups.set(d.kind, [...(groups.get(d.kind) ?? []), d.detail]);
  return [...groups].map(([kind, items]) => ({ kind, items }));
}

/**
 * Export report/failure strips belong to ONE draft + published revision. The scope key identifies it;
 * a strip stored under another key (previous draft/world, older revision) must never be shown.
 */
export function exportScopeKey(kind: 'game' | 'world', draftId: string | null | undefined, revisionId: string | null | undefined): string {
  return `${kind}:${draftId ?? 'new'}:${revisionId ?? 'unpublished'}`;
}

export type ScopedExportState<T> = { scope: string; value: T };

/** Value stored for `scope`, or null when the stored strip belongs to a different draft/revision. */
export function stateForScope<T>(stored: ScopedExportState<T> | null, scope: string): T | null {
  return stored && stored.scope === scope ? stored.value : null;
}
