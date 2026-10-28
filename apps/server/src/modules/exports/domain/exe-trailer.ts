import { createHash } from 'node:crypto';
import {
  EXE_TRAILER_LENGTH, HOST_API_VERSION, SUPPORTED_HOST_API_VERSIONS, decodeExeTrailer, encodeExeTrailer, hasExeTrailer,
  type ExeTrailer,
} from '@novel-game/play-runtime';

/**
 * M1b-2 exe = prebuilt player + the M1b-1 HTML byte-for-byte + 52-byte footer (slice §5.2).
 * No compiler on the author's machine: this is plain byte concatenation. Mirrors `apps/player-host/src/payload.rs`.
 */
export const sha256HexBytes = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

export type PlayerCheck =
  | { ok: true }
  | { ok: false; reason: 'player-invalid' | 'player-already-packaged' | 'player-host-api' };

/** A usable base player: a PE image ("MZ"), not already carrying a game, speaking a host API this page knows. */
export function checkPlayerBinary(bytes: Uint8Array, hostApiVersion: number = HOST_API_VERSION): PlayerCheck {
  if (bytes.length < 64 || bytes[0] !== 0x4d || bytes[1] !== 0x5a) return { ok: false, reason: 'player-invalid' };
  if (hasExeTrailer(bytes)) return { ok: false, reason: 'player-already-packaged' };
  if (!SUPPORTED_HOST_API_VERSIONS.includes(hostApiVersion)) return { ok: false, reason: 'player-host-api' };
  return { ok: true };
}

/** `[player][payload][footer]`. Returns the exe bytes and the payload hash written into the footer. */
export function appendPayload(player: Uint8Array, payload: Uint8Array, hostApiVersion: number = HOST_API_VERSION): { exe: Uint8Array; payloadSha256: string } {
  const payloadSha256 = sha256HexBytes(payload);
  const footer = encodeExeTrailer(payload.length, payloadSha256, hostApiVersion);
  const exe = new Uint8Array(player.length + payload.length + EXE_TRAILER_LENGTH);
  exe.set(player, 0);
  exe.set(payload, player.length);
  exe.set(footer, player.length + payload.length);
  return { exe, payloadSha256 };
}

export type ExtractedPayload =
  | { ok: true; trailer: ExeTrailer; payload: Uint8Array; intact: boolean }
  | { ok: false };

/** What the player does at startup: footer → payload slice → SHA-256 check. `ok:false` ⇒ try the sidecar file. */
export function extractPayload(exe: Uint8Array): ExtractedPayload {
  const trailer = decodeExeTrailer(exe);
  if (!trailer) return { ok: false };
  const payload = exe.subarray(trailer.payloadOffset, trailer.payloadOffset + trailer.payloadLength);
  return { ok: true, trailer, payload, intact: sha256HexBytes(payload) === trailer.payloadSha256 };
}

/** `<title>-v<N>.html` → `<title>-v<N>.exe` (X4). */
export const exeFileName = (htmlFileName: string) => htmlFileName.replace(/\.html$/i, '') + '.exe';
