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
  ending?: {id: string; title: string; text: string};
  history: AdventureHistory[]; createdAt: string; updatedAt: string;
}
