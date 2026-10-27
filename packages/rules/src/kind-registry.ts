/**
 * Kind registry seam — metadata + eval dispatch for condition/effect kinds.
 *
 * Wire safety: zod closed unions stay in `@novel-game/contracts` (v1).
 * This registry is the mechanical path for future kinds:
 *   contracts schema → register eval (+ meta) here → dual runtime wrappers → UI reads list().
 * User-authored runtime kinds / disk plugins are out of scope.
 */

export type KindFamily =
  | 'story.condition'
  | 'story.effect'
  | 'world.condition'
  | 'world.effect';

export type KindMeta = {
  kind: string;
  family: KindFamily;
  /** Short authoring label (zh key; UI may pass through i18n). */
  label: string;
  /** Author-facing description of when to use this kind. */
  description: string;
};

export type KindEntry<TEval = never> = KindMeta & {
  /** Pure evaluator / applier. World effects may omit until moved into rules. */
  evaluate?: TEval;
};

/**
 * Small in-memory registry. Re-registering the same `kind` overwrites (idempotent list size).
 * Unknown kinds: callers treat missing `evaluate` as fail-closed (condition false / effect reject).
 */
export class KindRegistry<TEval = never> {
  private readonly byKind = new Map<string, KindEntry<TEval>>();

  register(entry: KindEntry<TEval>): this {
    this.byKind.set(entry.kind, entry);
    return this;
  }

  get(kind: string): KindEntry<TEval> | undefined {
    return this.byKind.get(kind);
  }

  has(kind: string): boolean {
    return this.byKind.has(kind);
  }

  list(): KindMeta[] {
    return [...this.byKind.values()].map(({ kind, family, label, description }) => ({
      kind,
      family,
      label,
      description,
    }));
  }

  /** Clear all entries — tests only. */
  clear(): void {
    this.byKind.clear();
  }
}
