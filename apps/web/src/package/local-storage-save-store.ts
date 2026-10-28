import type { SaveStore } from '@novel-game/play-runtime';

/** localStorage keys (slice §5.5): one partition per packageId, so different games never see each other. */
export const indexKey = (packageId: string) => `btg:pkg:${packageId}:index`;
export const saveKey = (packageId: string, id: string) => `btg:pkg:${packageId}:save:${id}`;

/**
 * Browser save store for the export package. Returns null from `open` when storage is disabled
 * (file:// with blocked site data, private modes that throw), so the caller can run from memory.
 */
export class LocalStorageSaveStore implements SaveStore {
  private constructor(private readonly storage: Storage, private readonly packageId: string) {}

  static open(packageId: string, getStorage: () => Storage | null = () => window.localStorage): LocalStorageSaveStore | null {
    try {
      const storage = getStorage();
      if (!storage) return null;
      const probe = `btg:probe:${packageId}`;
      storage.setItem(probe, '1');
      storage.removeItem(probe);
      return new LocalStorageSaveStore(storage, packageId);
    } catch { return null; }
  }

  list(): string[] {
    try {
      const value = JSON.parse(this.storage.getItem(indexKey(this.packageId)) ?? '[]');
      return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
    } catch { return []; }
  }

  read(id: string): string | null {
    return this.storage.getItem(saveKey(this.packageId, id));
  }

  /** Throws on quota / disabled storage; GuardedSaveStore turns that into the banner. */
  write(id: string, json: string): void {
    this.storage.setItem(saveKey(this.packageId, id), json);
    const ids = this.list();
    if (!ids.includes(id)) this.storage.setItem(indexKey(this.packageId), JSON.stringify([...ids, id]));
  }

  delete(id: string): void {
    this.storage.removeItem(saveKey(this.packageId, id));
    this.storage.setItem(indexKey(this.packageId), JSON.stringify(this.list().filter(x => x !== id)));
  }
}
