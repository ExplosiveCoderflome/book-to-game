import { GuardedSaveStore, detectHost, type SaveTier } from '@novel-game/play-runtime';
import { HostFileSaveStore } from './host-file-save-store';
import { LocalStorageSaveStore } from './local-storage-save-store';

/**
 * Pick the save storage for this run (UI plan §1.4 / §4.3). Same HTML in a browser and in the exe:
 *   no host            → browser (localStorage)
 *   host, version ok   → host-file; flush failure / probe failure → host-fallback (localStorage) → memory
 *   host, version bad  → host-fallback (`host-version`); list fails → host-fallback (`host-unavailable`)
 */
export async function openPackageSaveStore(
  packageId: string,
  scope: unknown = typeof window === 'undefined' ? undefined : window,
  getStorage?: () => Storage | null,
): Promise<{ store: GuardedSaveStore; host: HostFileSaveStore | null }> {
  const local = LocalStorageSaveStore.open(packageId, getStorage);
  const detected = detectHost(scope);
  if (detected.kind === 'none') {
    return { store: new GuardedSaveStore(local ? { store: local, where: 'browser' } : null, { where: 'browser' }), host: null };
  }
  const fallback: SaveTier | null = local ? { store: local, where: 'host-fallback' } : null;
  if (detected.kind === 'unsupported') {
    return { store: new GuardedSaveStore(fallback, { where: 'host-fallback', fallbackReason: 'host-version' }), host: null };
  }
  let opened: Awaited<ReturnType<typeof HostFileSaveStore.open>>;
  try { opened = await HostFileSaveStore.open(detected.host, packageId); } catch {
    return { store: new GuardedSaveStore(fallback, { where: 'host-fallback', fallbackReason: 'host-unavailable' }), host: null };
  }
  const store = new GuardedSaveStore({ store: opened.store, where: 'host-file' }, { fallback });
  opened.store.onFlushError = (id, json) => store.reportAsyncWriteFailure(opened.store, id, json);
  // Read-only saves folder: existing files stay readable (and continuable), new writes go to the fallback.
  if (!opened.probeOk) store.failActiveTier();
  return { store, host: opened.store };
}
