import type { AdventureHistory } from '@novel-game/contracts';
export interface AdventureState {
  schemaVersion: 1;
  id: string; worldRevisionId: string; turn: number; elapsed: number; locationId: string;
  facts: Record<string, boolean>; knownFactIds: string[];
  /** Open-world numeric pools (qi/mana/…) for worldbook power/upgrade. */
  resources: Record<string, number>;
  /** Tags from actions already taken — drives worldbook one_path_lock. */
  takenTags: string[];
  npcs: Record<string, {locationId: string; knownFactIds: string[]}>;
  performedActionIds: string[]; triggeredEventIds: string[];
  /** Fog of war: explored cells per map id (session-only; authored maps never change). */
  explored?: Record<string, string[]>;
  /** Dynamic territory overlay per map id: cell → faction id ('' = unclaimed). */
  territory?: Record<string, Record<string, string>>;
  /** Faction relation overrides keyed by sorted pair "a|b". */
  factionRelations?: Record<string, {stance: 'ally' | 'neutral' | 'hostile'; standing: number}>;
  ending?: {id: string; title: string; text: string};
  history: AdventureHistory[]; createdAt: string; updatedAt: string;
}
