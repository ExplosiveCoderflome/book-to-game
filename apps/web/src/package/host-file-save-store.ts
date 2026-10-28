import { HOST_INDEX_ID, type BtgHost, type SaveStore } from '@novel-game/play-runtime';

/**
 * exe save store (slice §5.5, UI plan X11/X14): `%APPDATA%\BookToGame\Player\saves\<packageId>\<saveId>.json`
 * through the four host calls. The host is async (Tauri invoke); the SaveStore port is sync, so:
 *   • `open()` preloads every save (booting shows 「正在打开…」),
 *   • reads come from that cache, writes update the cache synchronously and are flushed in the background
 *     (serialised, coalesced per id; the host writes each file atomically: tmp → rename),
 *   • a failed flush is reported to `onFlushError` with the exact record, so the guard can re-home it.
 * `index.json` keeps creation order; files not in the index (e.g. copied in) are appended by name.
 */
export class HostFileSaveStore implements SaveStore {
  private readonly cache = new Map<string, string | null>();
  /** Last value confirmed on disk per id (what the next launch would see). */
  private readonly persisted = new Map<string, string | null>();
  private order: string[] = [];
  private readonly pending = new Map<string, { kind: 'write'; json: string } | { kind: 'delete' }>();
  private chain: Promise<void> = Promise.resolve();
  private failed = false;
  onFlushError: ((id: string, json: string) => void) | null = null;

  private constructor(private readonly host: BtgHost, private readonly packageId: string) {}

  /** Preload + probe. Throws when listing fails (⇒ caller uses host-fallback `host-unavailable`). */
  static async open(host: BtgHost, packageId: string): Promise<{ store: HostFileSaveStore; probeOk: boolean }> {
    const store = new HostFileSaveStore(host, packageId);
    const ids = await host.saveList(packageId);
    let indexed: string[] = [];
    if (ids.includes(HOST_INDEX_ID)) {
      try {
        const raw = await host.saveRead(packageId, HOST_INDEX_ID);
        const parsed: unknown = raw ? JSON.parse(raw) : [];
        if (Array.isArray(parsed)) indexed = parsed.filter((x): x is string => typeof x === 'string');
      } catch { /* unreadable index ⇒ name order */ }
    }
    const files = ids.filter(id => id !== HOST_INDEX_ID);
    const fileSet = new Set(files);
    store.order = [...indexed.filter(id => fileSet.has(id)), ...files.filter(id => !indexed.includes(id)).sort()];
    for (const id of store.order) {
      let value: string | null = null;
      try { value = await host.saveRead(packageId, id); } catch { /* unreadable ⇒ blocked row */ }
      store.cache.set(id, value);
      store.persisted.set(id, value);
    }
    // Probe: (re)write the index atomically. A read-only saves folder shows up here, before the first save.
    let probeOk = true;
    try { await host.saveWrite(packageId, HOST_INDEX_ID, JSON.stringify(store.order)); } catch { probeOk = false; }
    return { store, probeOk };
  }

  list(): string[] { return [...this.order]; }
  read(id: string): string | null { return this.cache.get(id) ?? null; }

  write(id: string, json: string): void {
    if (this.failed) throw new Error('host save folder not writable');
    this.cache.set(id, json);
    const isNew = !this.order.includes(id);
    if (isNew) this.order.push(id);
    this.enqueue(id, { kind: 'write', json });
    if (isNew) this.enqueue(HOST_INDEX_ID, { kind: 'write', json: JSON.stringify(this.order) });
  }

  delete(id: string): void {
    this.cache.delete(id);
    this.order = this.order.filter(x => x !== id);
    this.enqueue(id, { kind: 'delete' });
    this.enqueue(HOST_INDEX_ID, { kind: 'write', json: JSON.stringify(this.order) });
  }

  /** Resolves when every queued write has reached the host (tests / before-close). */
  whenIdle(): Promise<void> { return this.chain; }

  private enqueue(id: string, op: { kind: 'write'; json: string } | { kind: 'delete' }) {
    const already = this.pending.has(id);
    this.pending.set(id, op); // coalesce: only the latest record per id is written
    if (already) return;
    this.chain = this.chain.then(async () => {
      const next = this.pending.get(id);
      this.pending.delete(id);
      if (!next) return;
      try {
        if (next.kind === 'write') { await this.host.saveWrite(this.packageId, id, next.json); this.persisted.set(id, next.json); }
        else { await this.host.saveDelete(this.packageId, id); this.persisted.delete(id); }
      } catch {
        if (next.kind === 'write' && id !== HOST_INDEX_ID) {
          this.failed = true;
          // Show what is really on disk; the guard re-homes the newer record in the fallback tier.
          if (this.persisted.has(id)) this.cache.set(id, this.persisted.get(id)!);
          else { this.cache.delete(id); this.order = this.order.filter(x => x !== id); }
          this.onFlushError?.(id, next.json);
        } else if (next.kind === 'write') {
          this.failed = true;
        }
      }
    });
  }
}
