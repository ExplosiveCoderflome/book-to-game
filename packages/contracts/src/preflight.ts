/**
 * S1 author-side preflight reports (C9). Type-only: lint v2 lives in @novel-game/rules/preflight and the
 * simulator in @novel-game/play-runtime/sim; neither is part of the offline play package.
 */
export type LintSeverity = 'error' | 'warning';
export type LintCategory = 'structure' | 'resource' | 'pool' | 'text' | 'volume';
export interface LintTarget {kind: 'world' | 'storylet' | 'location' | 'ending' | 'resource' | 'action' | 'scene' | 'choice'; id: string; label?: string}
export interface LintIssue {severity: LintSeverity; category: LintCategory; ruleId: string; message: string; target?: LintTarget}
/** One pass-line row (§1): `line` and `measured` are display text produced by the checker; UI never hardcodes thresholds. */
export interface PassCheck {id: string; label: string; line: string; measured: string; pass: boolean}
export type VolumeTier = 'S' | 'M' | 'L';
export interface LintReport {
  draftId?: string; draftVersion: number; createdAt: string;
  contentKind: 'world' | 'story';
  /** D7: true when the content uses S1 systems — only then do errors block publishing. */
  blocking: boolean;
  tier: VolumeTier;
  errors: number; warnings: number;
  issues: LintIssue[];
  checks: PassCheck[];
  stats: {cards: number; repeatableCards: number; endings: number; locations: number; chars: number};
}
export interface PlaytestStrategyInfo {id: string; label: string; runs: number}
export interface PlaytestReport {
  draftId?: string; draftVersion: number; createdAt: string;
  seeds: number; maxSteps: number;
  strategies: PlaytestStrategyInfo[];
  checks: PassCheck[];
  /** endingRates[strategyId][endingKey] = share of runs (0–1); endingKey = ending id or `(none)` for capped runs. */
  endingRates: Record<string, Record<string, number>>;
  endings: {id: string; title: string; kind: string}[];
  /** Per strategy: median decisions to the end and unique body characters read. */
  medians: Record<string, {decisions: number; uniqueChars: number; months: number}>;
  /** resourceBands[resourceId] = P10/P50/P90 at checkpoints (share of the run). */
  resourceBands: Record<string, {label: string; points: {at: number; p10: number; p50: number; p90: number}[]}>;
  cards: {neverDrawn: string[]; drawRate: Record<string, number>; consecutiveRepeatRate: number};
  deadEnds: number;
  lockedRatio: number;
  /** Share of steps where a resource sat at its min or max (warning > 0.5). */
  pinnedRatio: Record<string, number>;
  gatesNeverMet: string[];
  /** K15: ending passage / 「这一生」 coverage (present when the world has passages or recap). Keys of passageHits are `endingId/passageId`. */
  endingExtras?: {byEnding: Record<string, {runs: number; withRecap: number; passages: number}>; passageHits: Record<string, number>; recapHits: Record<string, number>;
    passagesNeverShown: string[]; recapNeverShown: string[]; endingsWithoutRecap: string[]};
  durationMs: number;
}
