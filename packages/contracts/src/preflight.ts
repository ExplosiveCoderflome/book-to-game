/**
 * S1 author-side preflight reports (C9). Type-only: lint v2 lives in @novel-game/rules/preflight and the
 * simulator in @novel-game/play-runtime/sim; neither is part of the offline play package.
 */
import type {ClockUnit, Storylet, WorldCondition} from './world.js';

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
  /** Present only when the caller supplied a named FunProfile; legacy reports keep their shape. */
  profileId?: string;
  /** Server-derived fingerprint for the exact rules, prose, blocks and evidence specification. */
  evidence?: {
    schemaVersion: 1; checkVersion: string; reportId: string; contentHash: string; specHash?: string;
    runs: number; seed: number; maxSteps: number; strategies: string[];
    status: 'observed' | 'unsupported'; unsupportedReason?: string;
    endingReachability: {endingId: string; status: 'observed' | 'sampled-not-hit' | 'not-run'; witness?: {strategy: string; seed: number; actionIds: string[]}}[];
    witnesses: {strategy: string; seed: number; endingId: string; rawSteps: number; effectiveSteps: number; actionIds: string[]}[];
    samples: {strategy: string; seed: number; endingId?: string; outcome: 'ending' | 'dead-end' | 'capped'; rawSteps: number; effectiveSteps: number; actionIds: string[]}[];
    distribution: {runs: number; rawSteps: {minimum: number; average: number; maximum: number}; effectiveSteps: {minimum: number; average: number; maximum: number}};
    deadEnds: {strategy: string; seed: number; rawSteps: number; actionIds: string[]}[];
    cappedRuns: number; cappedWitnesses: {strategy: string; seed: number; rawSteps: number; effectiveSteps: number; actionIds: string[]}[];
    repeatedStates: number; noProgressRuns: number; prose: {observed: boolean; repeatedBodies: string[]};
  };
  seeds: number; maxSteps: number;
  timeUnit?: ClockUnit | 'turn';
  strategies: PlaytestStrategyInfo[];
  openingRoll?: {strategies: Record<string,{runs:number;failureRate:number;endingRates:Record<string,number>}>};
  checks: PassCheck[];
  /** endingRates[strategyId][endingKey] = share of runs (0–1); endingKey = ending id or `(none)` for capped runs. */
  endingRates: Record<string, Record<string, number>>;
  endings: {id: string; title: string; kind: string}[];
  /** Per strategy: median decisions to the end and unique body characters read. */
  medians: Record<string, {decisions: number; uniqueChars: number; months: number}>;
  /** resourceBands[resourceId] = P10/P50/P90 at checkpoints (share of the run). */
  resourceBands: Record<string, {label: string; points: {at: number; p10: number; p50: number; p90: number}[]}>;
  cards: {neverDrawn: string[]; drawRate: Record<string, number>; consecutiveRepeatRate: number};
  /** Hard safety floor, independent of optional FunProfile metrics; capped unfinished runs are excluded. */
  runLength?: {completedRuns: number; minimum?: number; average?: number};
  deadEnds: number;
  lockedRatio: number;
  /** Share of steps where a resource sat at its min or max (warning > 0.5). */
  pinnedRatio: Record<string, number>;
  gatesNeverMet: string[];
  /** K15: ending passage / 「这一生」 coverage (present when the world has passages or recap). Keys of passageHits are `endingId/passageId`. */
  endingExtras?: {byEnding: Record<string, {runs: number; withRecap: number; passages: number}>; passageHits: Record<string, number>; recapHits: Record<string, number>;
    passagesNeverShown: string[]; recapNeverShown: string[]; endingsWithoutRecap: string[]};
  /** Route coverage: goal-directed strategies per ending / planned route, run separately from the generic strategies. */
  routeCoverage?: RouteCoverageReport;
  /** S3: why the 「随机」 run is short (present when G1 fails) plus the static minimum-step estimate per ending. */
  pacing?: PacingReport;
  durationMs: number;
}
export interface CausalityReport {
  worldId: string; expectedVersion: number; contentHash: string; reportId: string; checkVersion: string;
  status: 'pass' | 'fail' | 'inconclusive' | 'unsupported'; exploredStates: number; maxStates: number;
  findings: {code: string; severity: 'error' | 'warning'; entityIds: string[]; message: string;
    witness?: {seed: number; actionIds: string[]; alternateActionIds?: string[]}}[];
  limitations: string[];
}
/** covered = a generic strategy reaches it ≥ 5%; goal-only = only a goal-directed strategy reaches it (needs route guidance under random play);
 *  unreached = no automatic strategy reached it (NOT proof that it is unreachable); no-trigger = nothing in the content can fire it. */
export type RouteCoverageStatus = 'covered' | 'goal-only' | 'unreached' | 'no-trigger';
export interface RouteCoverageIssue {severity: LintSeverity; ruleId: string; message: string; endingId?: string; routeId?: string}
export interface RouteCoverageReport {
  seeds: number;
  /** Pacing line used for routes (same as G1). */
  pacing: {decisions: number; uniqueChars: number};
  routes: {id: string; name: string; source: 'plan' | 'ending'; endingIds: string[]; strategyId: string; hitRate: number;
    endingRates: Record<string, number>; medians: {decisions: number; uniqueChars: number; months: number}; deadEnds: number; belowPacing: boolean}[];
  endings: {id: string; title: string; kind: string; triggers: number; bestGeneric: number; bestGenericStrategy?: string;
    /** Hit rate of the ending's own goal strategy; absent when skipped (routeEndings 'uncovered' and a generic strategy already covers it). */
    goalRate?: number; status: RouteCoverageStatus}[];
  issues: RouteCoverageIssue[];
  /** S2: route guidance for goal-only endings (present when requested). Suggestions only — never written back without the author. */
  guidance?: RouteGuidanceHint[];
}
/** One suggested content edit (S2). `gate-trap`: add conditions to an option that permanently blocks a key step; `nudge-card`:
 *  add an urgent storylet that offers a location-bound key step everywhere once its requirements hold (placeholder prose);
 *  `weight`: raise a key storylet's base draw weight. */
export type GuidanceEdit =
  | {kind: 'gate-trap'; target: {actionId?: string; storyletId?: string; choiceId?: string}; label: string; blocks: string; add: WorldCondition[]; /** Display labels of `add`. */ addLabels: string[]}
  | {kind: 'nudge-card'; label: string; fromActionId: string; card: Storylet}
  | {kind: 'weight'; storyletId: string; label: string; from: number; to: number};
export interface RouteGuidanceHint {
  endingId: string; title: string;
  /** Random-strategy hit rate before / after applying `edits` (same seeds). */
  randomBefore: number; randomAfter: number; seeds: number;
  /** Key steps found by back-chaining from the ending (labels, in play order). */
  keySteps: string[];
  edits: GuidanceEdit[];
  message: string;
}

/** S3 pacing diagnosis. `causes` explain a short 「随机」 run with a concrete fix each; `estimate` is the static
 *  (no simulation) minimum number of decisions to each ending — usable at plan stage — next to the simulated minimum. */
export interface PacingCause {ruleId: 'pacing.early-ending' | 'pacing.fast-failure' | 'pacing.clock-short' | 'pacing.repeat-no-variants' | 'pacing.thin-text';
  message: string; suggestion: string; endingId?: string; storyletId?: string; resourceId?: string; share?: number}
export interface PacingEstimateRow {endingId: string; title: string; kind: string;
  /** Static estimate of the fewest decisions that can reach the ending (relaxed plan over authored data). */
  estimateMin: number;
  /** Fewest decisions observed in simulation (all strategies incl. goal-directed); absent when never reached. */
  simulatedMin?: number;
  /** Share of 「随机」 runs and their median decisions. */
  randomShare: number; randomMedian?: number}
export interface PacingReport {
  line: {decisions: number; uniqueChars: number};
  random?: {decisions: number; uniqueChars: number; months: number};
  belowLine: boolean;
  causes: PacingCause[];
  estimate: {rows: PacingEstimateRow[]; shortestOrdinary?: number; authoredChars: number};
}

/** S5: ProductionPlan mechanics check, run on the plan's world before any prose is written. Errors block approval. */
export type PlanCheckRule = 'plan.fact-unsettable' | 'plan.passive-only' | 'plan.threshold-open' | 'plan.ending-no-trigger' | 'plan.draw-locked'
  | 'plan.pacing-short' | 'plan.routes-dead' | 'plan.route-dead';
export interface PlanCheckIssue {severity: LintSeverity; ruleId: PlanCheckRule; message: string; suggestion: string; endingId?: string; routeId?: string; target?: string}
export interface PlanCheckReport {
  errors: number; warnings: number; blocking: boolean;
  issues: PlanCheckIssue[];
  /** Goal-directed probe per planned route (share of probe runs that reach one of its ordinary endings). */
  routes: {id: string; name: string; hitRate: number}[];
  /** S3 static estimate: fewest decisions to the quickest ordinary ending. */
  shortestOrdinary?: number;
}
