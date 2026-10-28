import type { AdventureHistory, EndingSnapshot } from '@novel-game/contracts';
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
  /** Ending snapshot; K15 passages/recap are resolved once when the ending fires and saved here (never recomputed on load). */
  ending?: EndingSnapshot;
  history: AdventureHistory[]; createdAt: string; updatedAt: string;
  // ── S1 (all optional; only present for worlds using resourceDefs / clock / storylets) ──
  /** Seeded RNG: value n = mulberry32 step n of `seed`. Same seed + same actions ⇒ same results. */
  rng?: {seed: number; cursor: number};
  /** Current storylet hand (≤ handSize). `variant` indexes textVariants. */
  hand?: AdventureHandCard[];
  storyletState?: {seen: Record<string, number>; lastTurn: Record<string, number>; lastVariant: Record<string, number>;
    drawn: Record<string, number>; path: string[]};
  /** Storylets pushed by onMin/onMax/window opening, waiting to enter the hand at a matching location. */
  forcedStorylets?: string[];
  /** Current resource maxima changed by `resource_max` (absent → resourceDefs max). */
  resourceMax?: Record<string, number>;
  /** Clock month up to which every-N-month rules have been settled. */
  clockFired?: number;
  /** Clock windows open at `elapsed`. */
  openWindows?: string[];
  /** What the last action changed (C2/C6) — projected as-is. */
  lastResult?: AdventureLastResult;
}
export interface AdventureHandCard {storyletId: string; variant: number; drawnTurn: number; forced?: boolean}
export interface AdventureLastResult {
  actionLabel: string; months: number;
  deltas: ({id: string; label: string; delta: number; clamped?: 'min' | 'max'} | {kind: 'max'; id: string; label: string; from: number; to: number})[];
  roll?: {chance?: number; success: boolean};
  windows?: {opened: string[]; closed: string[]};
}
