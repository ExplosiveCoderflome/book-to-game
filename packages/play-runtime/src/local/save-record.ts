import { RUNTIME_VERSION } from '../version.js';

export const SAVE_FORMAT_VERSION = 1;
/** Replay window: last N events per save (idempotent retry after a lost response). */
export const SAVE_EVENT_LIMIT = 50;

export type SaveEvent = { requestId: string; turn: number; input: string; response: unknown };

export interface SaveRecord<S> {
  saveFormatVersion: number;
  packageId: string;
  revisionId: string;
  runtimeVersion: string;
  state: S;
  events: SaveEvent[];
}

export type SaveBlockedReason = 'old-version' | 'corrupt';

export type SaveSlot<V> =
  | { id: string; status: 'ok'; view: V; createdAt: string; updatedAt: string; turn: number; unsaved: boolean }
  | { id: string; status: 'blocked'; blockedReason: SaveBlockedReason; createdAt?: string; updatedAt?: string; turn?: number; unsaved: boolean };

export type SaveExpectation = { packageId: string; revisionId: string; runtimeVersion?: string };

type Classified<S> =
  | { ok: true; record: SaveRecord<S> }
  | { ok: false; blockedReason: SaveBlockedReason; createdAt?: string; updatedAt?: string; turn?: number };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Honest compatibility check — never migrates. A save written by another revision, runtime or
 * save format is "old-version" (greyed, kept); unreadable JSON is "corrupt" (greyed, kept).
 */
export function classifySave<S extends { turn: number; createdAt: string; updatedAt: string; schemaVersion?: number }>(
  json: string | null,
  expected: SaveExpectation,
): Classified<S> {
  if (json === null) return { ok: false, blockedReason: 'corrupt' };
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { return { ok: false, blockedReason: 'corrupt' }; }
  if (!isObj(parsed) || !isObj(parsed.state) || !Array.isArray(parsed.events)) return { ok: false, blockedReason: 'corrupt' };
  const state = parsed.state as Record<string, unknown>;
  const meta = {
    createdAt: typeof state.createdAt === 'string' ? state.createdAt : undefined,
    updatedAt: typeof state.updatedAt === 'string' ? state.updatedAt : undefined,
    turn: typeof state.turn === 'number' ? state.turn : undefined,
  };
  if (typeof state.turn !== 'number' || typeof state.id !== 'string') return { ok: false, blockedReason: 'corrupt', ...meta };
  const runtimeVersion = expected.runtimeVersion ?? RUNTIME_VERSION;
  if (parsed.saveFormatVersion !== SAVE_FORMAT_VERSION
    || parsed.revisionId !== expected.revisionId
    || parsed.runtimeVersion !== runtimeVersion
    || (state.schemaVersion !== undefined && state.schemaVersion !== 1)) {
    return { ok: false, blockedReason: 'old-version', ...meta };
  }
  if (parsed.packageId !== expected.packageId) return { ok: false, blockedReason: 'corrupt', ...meta };
  return { ok: true, record: parsed as unknown as SaveRecord<S> };
}
