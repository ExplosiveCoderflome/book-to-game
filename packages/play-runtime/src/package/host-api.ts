/**
 * M1b-2 Windows player contract (slice §5.2). Shared by the exporter (server), the offline page (web)
 * and mirrored by the Rust player (`apps/player-host/src/trailer.rs`, `host.rs`). Pure; no Node/DOM.
 *
 *   <game>-v<N>.exe = [btg-player.exe bytes][payload = the M1b-1 HTML, byte-for-byte][footer, 52 bytes]
 *   footer = magic "BTGPKG01" (8) · payloadLength u64 LE (8) · payloadSha256 (32 raw bytes) · hostApiVersion u32 LE (4)
 *
 * The player reads the LAST 52 bytes of its own file; no magic there ⇒ look for `game.btgpkg.html` next to the exe.
 */
export const HOST_API_VERSION = 1;
/** hostApiVersion values this page build can talk to. Anything else ⇒ `host-fallback` (`host-version`). */
export const SUPPORTED_HOST_API_VERSIONS: readonly number[] = [1];
export const EXE_TRAILER_MAGIC = 'BTGPKG01';
export const EXE_TRAILER_LENGTH = 52;
export const SIDECAR_PACKAGE_FILE = 'game.btgpkg.html';
/** Display-only (the host exposes no path API): paste into Explorer's address bar. */
export const HOST_SAVES_DIR_DISPLAY = '%APPDATA%\\BookToGame\\Player\\saves\\';
/** Reserved save id: `<packageId>\index.json` keeps creation order (X14). Never a real save. */
export const HOST_INDEX_ID = 'index';
/** Ids the host accepts for packageId / saveId (no path separators, no dots). */
export const HOST_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * What the Windows player injects as `window.__BTG_HOST__` before the page runs.
 * Four save calls only — no network, no shell, no arbitrary file access.
 */
export interface BtgHost {
  hostApiVersion: number;
  /** false when the footer's payloadSha256 did not match the payload bytes ⇒ page shows 「已损坏」. */
  payloadIntact?: boolean;
  /** Where the payload came from (diagnostics only). */
  payloadSource?: 'trailer' | 'sidecar';
  /**
   * hostApiVersion stamped in the exe footer by the exporter (what this payload was packaged for).
   * The player injects it next to its own `hostApiVersion`; if they differ the page must not use the host
   * save folder ⇒ `unsupported` ⇒ host-fallback + 「播放器版本和这个游戏文件不匹配」 banner (UI plan §2.3).
   */
  payloadHostApiVersion?: number;
  saveList(packageId: string): Promise<string[]>;
  saveRead(packageId: string, saveId: string): Promise<string | null>;
  saveWrite(packageId: string, saveId: string, json: string): Promise<void>;
  saveDelete(packageId: string, saveId: string): Promise<void>;
}

export type ExeTrailer = { payloadOffset: number; payloadLength: number; payloadSha256: string; hostApiVersion: number };

const ASCII = (s: string) => Uint8Array.from(s, c => c.charCodeAt(0));

function hexToBytes(hex: string): Uint8Array {
  if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error('payloadSha256 must be 64 hex chars');
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
const bytesToHex = (b: Uint8Array) => [...b].map(x => x.toString(16).padStart(2, '0')).join('');

/** The fixed 52-byte footer appended after the payload. `payloadSha256` = hex SHA-256 of the payload bytes. */
export function encodeExeTrailer(payloadLength: number, payloadSha256: string, hostApiVersion = HOST_API_VERSION): Uint8Array {
  if (!Number.isSafeInteger(payloadLength) || payloadLength <= 0) throw new Error('payloadLength must be a positive integer');
  const out = new Uint8Array(EXE_TRAILER_LENGTH);
  const view = new DataView(out.buffer);
  out.set(ASCII(EXE_TRAILER_MAGIC), 0);
  view.setBigUint64(8, BigInt(payloadLength), true);
  out.set(hexToBytes(payloadSha256), 16);
  view.setUint32(48, hostApiVersion, true);
  return out;
}

/** Parse the footer at the end of `file`. null = no (valid) trailer — the player then tries the sidecar file. */
export function decodeExeTrailer(file: Uint8Array): ExeTrailer | null {
  if (file.length < EXE_TRAILER_LENGTH) return null;
  const start = file.length - EXE_TRAILER_LENGTH;
  const footer = file.subarray(start);
  const magic = ASCII(EXE_TRAILER_MAGIC);
  for (let i = 0; i < magic.length; i++) if (footer[i] !== magic[i]) return null;
  const view = new DataView(footer.buffer, footer.byteOffset, footer.byteLength);
  const length = view.getBigUint64(8, true);
  if (length === 0n || length > BigInt(start)) return null;
  const payloadLength = Number(length);
  return {
    payloadOffset: start - payloadLength,
    payloadLength,
    payloadSha256: bytesToHex(footer.subarray(16, 48)),
    hostApiVersion: view.getUint32(48, true),
  };
}

/** Does this binary already carry a game? (A packaged exe must never be used as the player base.) */
export function hasExeTrailer(file: Uint8Array): boolean { return decodeExeTrailer(file) !== null; }

/** Runtime detection in the page. Absent ⇒ plain browser (`where: 'browser'`). */
export function detectHost(scope: unknown): { kind: 'none' } | { kind: 'unsupported'; version: unknown } | { kind: 'ok'; host: BtgHost } {
  const host = (scope as { __BTG_HOST__?: unknown } | null | undefined)?.__BTG_HOST__ as Partial<BtgHost> | undefined;
  if (!host || typeof host !== 'object') return { kind: 'none' };
  const fns = ['saveList', 'saveRead', 'saveWrite', 'saveDelete'] as const;
  if (typeof host.hostApiVersion !== 'number' || !SUPPORTED_HOST_API_VERSIONS.includes(host.hostApiVersion)
    || fns.some(f => typeof host[f] !== 'function')
    || (host.payloadHostApiVersion !== undefined && host.payloadHostApiVersion !== host.hostApiVersion)) {
    return { kind: 'unsupported', version: host.hostApiVersion };
  }
  return { kind: 'ok', host: host as BtgHost };
}
