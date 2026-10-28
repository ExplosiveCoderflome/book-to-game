/**
 * Save storage port for the offline player (slice §5.5). One instance = one package partition.
 * Web uses localStorage (`btg:pkg:<packageId>:…`); exe uses host files (preloaded cache, async flush — X11);
 * tests use memory.
 *
 * The port stays SYNCHRONOUS on purpose (X11): the local repositories read-modify-write a save inside one
 * act() call, so a replayed requestId always sees the event recorded by the first call — no double advance,
 * whatever the disk does later. Async storage (the Windows host) is wrapped as "preload at boot + write-behind".
 */
export interface SaveStore {
  /** Save ids in CREATION order (X14: 「存档 n」 numbering never depends on readable content). */
  list(): string[];
  read(id: string): string | null;
  write(id: string, json: string): void;
  delete(id: string): void;
}

export class MemorySaveStore implements SaveStore {
  private readonly map = new Map<string, string>();
  list(): string[] { return [...this.map.keys()]; }
  read(id: string): string | null { return this.map.get(id) ?? null; }
  write(id: string, json: string): void { this.map.set(id, json); }
  delete(id: string): void { this.map.delete(id); }
}

/** Where NEW writes land (UI plan §1.4). `persistent:false` on top of any of them = memory only. */
export type SaveLocation = 'browser' | 'host-file' | 'host-fallback';
export type SaveFallbackReason = 'host-write-failed' | 'host-unavailable' | 'host-version';
export type SaveStoreStatus = {
  persistent: boolean;
  reason?: 'unavailable' | 'write-failed';
  where: SaveLocation;
  fallbackReason?: SaveFallbackReason;
};

/** A persistent tier and what it is called in the UI. */
export type SaveTier = { store: SaveStore; where: SaveLocation };

export type GuardedOptions = {
  /** Next tier when the first fails (exe: the WebView's localStorage). */
  fallback?: SaveTier | null;
  /** Context when no tier is usable at all (browser vs exe copy). Default: first tier's `where`, else 'browser'. */
  where?: SaveLocation;
  /** Already falling back at boot (host missing / version not supported / probe write failed). */
  fallbackReason?: SaveFallbackReason;
};

type Picked = { json: string; tier: number };

/** >0 when a is newer than b: turn first, then updatedAt (ISO strings compare lexicographically). */
function newer(a: string, b: string): number {
  const [ta, ua] = rank(a);
  const [tb, ub] = rank(b);
  return ta !== tb ? ta - tb : ua === ub ? 0 : ua > ub ? 1 : -1;
}

function rank(json: string): [number, string] {
  try {
    const state = (JSON.parse(json) as { state?: { turn?: unknown; updatedAt?: unknown } }).state;
    return [typeof state?.turn === 'number' ? state.turn : -1, typeof state?.updatedAt === 'string' ? state.updatedAt : ''];
  } catch { return [-1, '']; }
}

/**
 * Degrading chain: tier 0 (host file / localStorage) → tier 1 (fallback localStorage) → memory.
 * Only ever moves DOWN within a process (UI plan §4.3); next launch decides again.
 * Reads look at every tier: the same id in two tiers ⇒ the newer one (turn, then updatedAt) wins, nothing lost or duplicated.
 */
export class GuardedSaveStore implements SaveStore {
  private readonly overlay = new MemorySaveStore();
  private readonly tiers: SaveTier[];
  private active: number;
  private statusValue: SaveStoreStatus;
  private readonly listeners = new Set<(status: SaveStoreStatus) => void>();

  constructor(primary: SaveStore | SaveTier | null, options: GuardedOptions = {}) {
    const first = primary && 'store' in primary ? primary : primary ? { store: primary, where: 'browser' as const } : null;
    this.tiers = [first, options.fallback ?? null].filter((t): t is SaveTier => !!t);
    this.active = 0;
    const where = this.tiers[0]?.where ?? options.where ?? 'browser';
    this.statusValue = this.tiers.length
      ? { persistent: true, where, ...(options.fallbackReason ? { fallbackReason: options.fallbackReason } : {}) }
      : { persistent: false, reason: 'unavailable', where, ...(options.fallbackReason ? { fallbackReason: options.fallbackReason } : {}) };
  }

  get status(): SaveStoreStatus { return this.statusValue; }
  onStatus(listener: (status: SaveStoreStatus) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  private emit() { for (const listener of this.listeners) listener(this.statusValue); }

  /** Move to the next tier (or memory). Returns the new active tier, or null for memory. */
  private degrade(): SaveTier | null {
    const failed = this.tiers[this.active];
    this.active += 1;
    const next = this.tiers[this.active] ?? null;
    if (next) {
      this.statusValue = {
        persistent: true, where: next.where,
        fallbackReason: failed?.where === 'host-file' ? 'host-write-failed' : this.statusValue.fallbackReason,
      };
    } else {
      this.statusValue = {
        persistent: false, reason: 'write-failed', where: this.statusValue.where,
        ...(failed?.where === 'host-file' ? { fallbackReason: 'host-write-failed' as const }
          : this.statusValue.fallbackReason ? { fallbackReason: this.statusValue.fallbackReason } : {}),
      };
    }
    this.emit();
    return next;
  }

  /** The active tier is known-bad before any write (exe probe failed): degrade now. */
  failActiveTier(): void { if (this.statusValue.persistent) this.degrade(); }

  list(): string[] {
    const ids: string[] = [];
    for (const tier of this.tiers) {
      try { ids.push(...tier.store.list()); } catch { /* unreadable tier → others */ }
    }
    return [...new Set([...ids, ...this.overlay.list()])];
  }

  private pick(id: string): Picked | null {
    let best: Picked | null = null;
    const consider = (json: string | null, tier: number) => {
      if (json === null) return;
      if (!best) { best = { json, tier }; return; }
      if (newer(json, best.json) > 0) best = { json, tier };
    };
    this.tiers.forEach((tier, i) => { try { consider(tier.store.read(id), i); } catch { /* unreadable */ } });
    consider(this.overlay.read(id), this.tiers.length);
    return best;
  }

  read(id: string): string | null { return this.pick(id)?.json ?? null; }

  write(id: string, json: string): void {
    let tier: SaveTier | null = this.tiers[this.active] ?? null;
    while (tier && this.statusValue.persistent) {
      try { tier.store.write(id, json); this.overlay.delete(id); return; } catch { tier = this.degrade(); }
    }
    this.overlay.write(id, json);
  }

  /**
   * An async tier (host file) reports that a write it already accepted failed on disk.
   * Degrade and re-home that exact record so the progress is kept (and stays replayable).
   */
  reportAsyncWriteFailure(store: SaveStore, id: string, json: string): void {
    const current = this.tiers[this.active];
    if (current?.store === store) this.degrade();
    const latest = this.read(id);
    // Keep whichever is newer: the failed record or something written after it.
    const record = latest !== null && newer(latest, json) > 0 ? latest : json;
    const next = this.tiers[this.active] ?? null;
    if (next && next.store !== store && this.statusValue.persistent) {
      try { next.store.write(id, record); return; } catch { this.degrade(); }
    }
    this.overlay.write(id, record);
    this.emit();
  }

  delete(id: string): void {
    this.overlay.delete(id);
    for (const tier of this.tiers) { try { tier.store.delete(id); } catch { /* ignore */ } }
  }

  /** True when this save only lives in memory (will be lost on close). */
  isUnsaved(id: string): boolean { return this.pick(id)?.tier === this.tiers.length; }

  /** True when this save's current copy lives in a fallback tier (exe 「临时位置」). */
  isFallback(id: string): boolean {
    const picked = this.pick(id);
    return !!picked && picked.tier < this.tiers.length && this.tiers[picked.tier]!.where === 'host-fallback';
  }
}
