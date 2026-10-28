import type { AdventureView, SessionView } from '@novel-game/contracts';
import {
  GuardedSaveStore, createLocalAdventurePort, createLocalStoryPort,
  type LocalAdventurePort, type LocalStoryPort, type OpenPackageContent, type PackageManifest, type SaveSlot as RuntimeSlot,
  type StoryPackageContent,
} from '@novel-game/play-runtime';
import type { SaveSlot } from '../components/player/SaveSlotList';
import type { PlayPagePort, StoryPagePort, Translate, WorldPagePort } from '../lib/play-port';
import { newRequestId } from '../lib/request-id';
import { packageErrorMessage } from './package-copy';

type Local<V> = { slots(): RuntimeSlot<V>[] };

/**
 * 「存档 n」 = position in the store's creation order (X14). Never derived from readable content, so a
 * corrupt save keeps its number and the others don't shift.
 */
export function ordinals(order: string[]): Map<string, number> {
  return new Map(order.map((id, i) => [id, i + 1]));
}

function rowsOf<V>(
  local: Local<V>, store: Pick<GuardedSaveStore, 'list' | 'isFallback'>, title: string, summarize: (view: V, t: Translate) => { summary: string; ended: boolean },
  blockedSummary: (turn: number, t: Translate) => string, t: Translate,
): SaveSlot[] {
  const slots = local.slots();
  const n = ordinals(store.list());
  return slots.map(slot => {
    const base = { id: slot.id, title, ordinal: n.get(slot.id), createdAt: slot.createdAt, updatedAt: slot.updatedAt ?? '', unsaved: slot.unsaved, fallback: store.isFallback(slot.id) };
    if (slot.status === 'blocked') {
      return { ...base, summary: typeof slot.turn === 'number' ? blockedSummary(slot.turn, t) : '', blockedReason: slot.blockedReason };
    }
    return { ...base, ...summarize(slot.view, t) };
  });
}

function common<R, V, A>(local: { listRevisions(): R[]; list(): V[]; get(id: string): V; start(id: string): V; act(id: string, input: A): V }, revisionOf: (v: V) => string, store: GuardedSaveStore) {
  const wrap = <T,>(fn: () => T) => new Promise<T>((resolve, reject) => { try { resolve(fn()); } catch (e) { reject(e); } });
  return {
    context: 'package' as const,
    revision: (id: string) => wrap(() => (local.listRevisions() as (R & { id: string })[]).find(r => r.id === id) ?? null),
    list: (id: string) => wrap(() => local.list().filter(v => revisionOf(v) === id)),
    get: (id: string) => wrap(() => local.get(id)),
    start: (id: string) => wrap(() => local.start(id)),
    act: (id: string, input: A) => wrap(() => local.act(id, input)),
    message: (error: unknown) => packageErrorMessage(error, store.status.where),
    // Local play is synchronous and atomic: a failure never leaves an unknown outcome.
    uncertain: () => false,
    pendingStorage: () => null,
    pendingKey: (kind: 'story' | 'world') => `btg:pending:${kind}`,
  } satisfies Omit<PlayPagePort<R, V, A>, 'rows'>;
}

export function packageStoryPort(manifest: PackageManifest, content: StoryPackageContent, store: GuardedSaveStore): { port: StoryPagePort; local: LocalStoryPort } {
  const local = createLocalStoryPort(content.revision, {
    packageId: manifest.packageId, store, newId: newRequestId, newSeed: newSeed, runtimeVersion: manifest.runtimeVersion, isUnsaved: id => store.isUnsaved(id),
  });
  const summarize = (v: SessionView, t: Translate) => ({ summary: t('第 {turn} 幕 · {scene}', { turn: v.turn + 1, scene: v.scene.title }), ended: v.ended });
  return { local, port: { ...common(local, v => v.gameRevisionId, store), rows: t => rowsOf(local, store, manifest.title, summarize, (turn, tr) => tr('第 {turn} 幕', { turn: turn + 1 }), t) } };
}

export function packageWorldPort(manifest: PackageManifest, content: OpenPackageContent, store: GuardedSaveStore): { port: WorldPagePort; local: LocalAdventurePort } {
  const local = createLocalAdventurePort(content.revision, content.catalogSnapshot, {
    packageId: manifest.packageId, store, newId: newRequestId, newSeed: newSeed, runtimeVersion: manifest.runtimeVersion, isUnsaved: id => store.isUnsaved(id),
  });
  const summarize = (v: AdventureView, t: Translate) => ({ summary: t('{location} · 行动 {turn}', { location: v.location.title, turn: v.turn }), ended: v.ended });
  return { local, port: { ...common(local, v => v.worldRevisionId, store), rows: t => rowsOf(local, store, manifest.title, summarize, (turn, tr) => tr('行动 {turn}', { turn }), t) } };
}

/** S1 save RNG seed from the browser CSPRNG (falls back to Math.random only when crypto is unavailable). */
function newSeed(): number {
  try { return globalThis.crypto.getRandomValues(new Uint32Array(1))[0]; } catch { return Math.floor(Math.random() * 0x100000000) >>> 0; }
}
