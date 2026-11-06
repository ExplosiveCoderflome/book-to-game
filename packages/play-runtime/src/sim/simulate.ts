/**
 * Headless playtest simulator (§6.7). Drives the SAME engine as the player package (createAdventureState /
 * advanceAdventure / projectAdventure) with scripted strategies over many seeds and aggregates a PlaytestReport.
 * Author-side only: exported via `@novel-game/play-runtime/sim`, never from the package root.
 */
import { type AdventureView, type FunMetricId, type FunProfile, type PassCheck, type PlaytestReport, type RouteCoverageReport, type WorldContent, type WorldEffect, type WorldRevision } from '@novel-game/contracts';
import type { AdventureState } from '../adventure/adventure-state.js';
import { advanceAdventure } from '../adventure/advance-adventure.js';
import { projectAdventure } from '../adventure/project-adventure.js';
import { createAdventureState } from '../adventure/start-adventure.js';
import { formatMonths } from '../adventure/s1-core.js';

import type { SimOption } from './types.js';
import { endingSources, goalStrategy, suppliersOf } from './goal-strategy.js';
import { routeGuidance } from './guidance.js';
import { diagnosePacing } from './pacing.js';
import { applyOpeningRollCommand, applyOpeningSet } from '../adventure/opening-roll.js';
import { causalDependencyGraph } from '@novel-game/rules';
import { assertExtensionWorldReferences, checkExtensionDeclaration, checkExtensionInvocation, extensionTests, initializeExtensionSandbox, extensionRewriteRound, type ExtensionIssue } from '../adventure/extensions.js';
export type { SimOption } from './types.js';
/** `state` is the full engine state (author tool); generic strategies only use the projected view, goal strategies need conditions. */
export interface Strategy {id: string; label: string; pick(options: SimOption[], view: AdventureView, rand: () => number, state?: AdventureState): SimOption}
/** A planned route (ProductionPlan.routes) — strategy text is for authors; endingIds drive the goal strategy. */
export interface SimRoute {id: string; name: string; endingIds: string[]}
export type SimProfile = Omit<Partial<FunProfile>, 'thresholds'> & {
  /** V0a partial-profile knobs remain valid alongside the full FunProfile contract. */
  thresholds?: Partial<FunProfile['thresholds']>;
  strategyIds?: readonly string[];
  resourcePrefs?: {money?: string[]; growth?: string[]; dark?: string[]};
  strategyLabels?: Partial<Record<string, string>>;
};
export interface SimulateOptions {seeds?: number; maxSteps?: number; strategies?: string[]; now?: string; draftId?: string; draftVersion?: number;
  evidence?: {runs: number; seed: number; maxSteps: number};
  profile?: SimProfile;
  /** Cooperative yield between runs (server passes setImmediate); keeps the event loop responsive. */
  yieldEvery?: () => Promise<void>;
  /** Route coverage (goal-directed strategies). 'auto' (default) = one goal strategy per authored ending; an array adds the
   *  planned routes on top; false = skip. Runs separately from the generic strategies, so G1–G8 are unchanged. */
  routes?: SimRoute[] | 'auto' | false;
  /** Seeds per goal strategy (default min(seeds, 40)). */
  routeSeeds?: number;
  /** Which endings get their own goal strategy: 'all' (default) or only those no generic strategy covers (cheaper; production). */
  routeEndings?: 'all' | 'uncovered';
  /** S2: route guidance for goal-only endings (extra random-strategy trials per candidate edit). Off by default. */
  guidance?: boolean | {seeds?: number; maxHints?: number};
  /** S3 pacing diagnosis + static minimum-step estimate (cheap; on by default). */
   pacing?: boolean;
   /** Author-only validation hook, including initial/final/hidden state (not quantile samples). */
   inspectState?: (state: AdventureState, world: WorldContent) => void;
   /** Gate's no-extension baseline: neutralize calls while retaining all native rules. */
   extensionBaseline?: boolean}
export interface ExtensionSimulationCheck {status: 'pass' | 'rewrite' | 'human'; rewriteRound: number; passed: boolean; issues: ExtensionIssue[]; report?: PlaytestReport; baseline?: PlaytestReport;
  comparison?: Record<string, {baseline: number; extended: number; delta: number}>}
export type ExtensionGateOptions = Omit<SimulateOptions, 'inspectState' | 'extensionBaseline'> & {maxEndingRate?: number; baselineRevision?: WorldRevision};

/** Explicit comparison semantics: conditions are neutral true; effect references are removed. */
function withoutExtensions(revision: WorldRevision): WorldRevision {
  const neutral = {kind: 'clock', atLeastMonth: 0};
  const strip = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(strip).filter(v => v !== undefined);
    if (!value || typeof value !== 'object') return value;
    const obj = value as Record<string, unknown>;
    if (obj.kind === 'extension') {
      const d = revision.content.extensions?.find(d => d.id === obj.extensionId);
      return d?.point === 'condition' ? neutral : undefined;
    }
    return Object.fromEntries(Object.entries(obj).filter(([k]) => k !== 'extensions' && k !== 'extensionAudit').map(([k, v]) => [k, strip(v)]));
  };
  return strip(revision) as WorldRevision;
}

/** The author/model port gets structured errors; at most THREE actual rewrite calls per review. */
export async function reviewWorldExtensions(initial: WorldRevision,
  rewrite: (candidate: WorldRevision, failure: ExtensionSimulationCheck) => Promise<WorldRevision>, options: ExtensionGateOptions = {}): Promise<{revision: WorldRevision; check: ExtensionSimulationCheck}> {
  let revision = structuredClone(initial);
  for (let round = 0; ; round++) {
    const check = await checkWorldExtensions(revision, round, options);
    if (check.status !== 'rewrite') return {revision, check};
    revision = await rewrite(structuredClone(revision), check);
  }
}

export async function checkWorldExtensions(revision: WorldRevision, rewriteRound = 0, options: ExtensionGateOptions = {}): Promise<ExtensionSimulationCheck> {
  const issues: ExtensionIssue[] = [];
  const add = (code: string, message: string) => issues.push({severity: 'error', code, message});
  const ids = new Set<string>();
  for (const declaration of revision.content.extensions ?? []) {
    if (ids.has(declaration.id)) add('extension.duplicate-id', `duplicate extension: ${declaration.id}`);
    ids.add(declaration.id);
    const staticCheck = checkExtensionDeclaration(declaration, rewriteRound);
    issues.push(...staticCheck.issues);
    if (staticCheck.ok) {
      try { assertExtensionWorldReferences(declaration, revision.content); }
      catch (error) { add('extension.state-reference', error instanceof Error ? error.message : String(error)); }
      const tests = await extensionTests(declaration);
      issues.push(...tests.issues);
      if (tests.passed < 3) add('extension.test-count', `${declaration.id}: fewer than 3 passing tests`);
    }
  }
  const scan = (value: unknown, point?: 'condition' | 'effect'): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { for (const item of value) scan(item, point); return; }
    const obj = value as Record<string, unknown>;
    if (obj.kind === 'extension') {
      const d = revision.content.extensions?.find(d => d.id === obj.extensionId && d.point === point);
      if (!d) add('extension.reference', `unknown ${point ?? 'unscoped'} extension: ${String(obj.extensionId)}`);
      else try { checkExtensionInvocation(d, (obj.params ?? {}) as Record<string, unknown>); }
      catch (error) { add('extension.params', error instanceof Error ? error.message : String(error)); }
    }
    for (const [key, child] of Object.entries(obj)) {
      if (key === 'extensions' || key === 'extensionAudit') continue;
      scan(child, ['when', 'requires', 'availableWhen', 'conditions'].includes(key) ? 'condition'
        : ['effects', 'success', 'failure'].includes(key) ? 'effect' : point);
    }
  };
  scan(revision.content);
  const seeds = options.seeds ?? 2000; const maxEndingRate = options.maxEndingRate ?? options.profile?.thresholds?.maxRandomEndingRate ?? 0.4;
  if (!Number.isInteger(seeds) || seeds < 2 || seeds > 10000) add('extension.seeds', 'gate needs 2..10000 seeds');
  if (!Number.isFinite(maxEndingRate) || maxEndingRate < 0 || maxEndingRate > 1) add('extension.ending-threshold', 'ending threshold must be within 0..1');
  let report: PlaytestReport | undefined; let baseline: PlaytestReport | undefined;
  let comparison: ExtensionSimulationCheck['comparison'];
  if (!issues.length) {
    try {
      const inspectState = (state: AdventureState, world: WorldContent) => {
        if (state.extensionAudit?.length) throw new Error(`${state.extensionAudit[0]!.code}: ${state.extensionAudit[0]!.message}`);
        for (const [id, value] of Object.entries(state.resources)) {
          const d = world.resourceDefs?.[id]; const max = state.resourceMax?.[id] ?? d?.max;
          if (!Number.isFinite(value) || (d && value < d.min) || (max !== undefined && value > max)) throw new Error(`resource out of bounds: ${id}`);
        }
      };
      const simOptions = {...options, seeds, routes: false as const, pacing: false, inspectState,
        strategies: [...new Set(['random', ...(options.strategies ?? defaultStrategies(revision.content, options.profile).map(s => s.id))])],
        profile: {...options.profile, strategyIds: [...new Set(['random', ...(options.profile?.strategyIds ?? options.profile?.strategies ?? STRATEGY_IDS)])]}};
      // Clone both inputs: neither audit nor baseline removal touches the immutable revision.
      report = await simulateWorld(structuredClone(revision), simOptions);
      baseline = await simulateWorld(structuredClone(options.baselineRevision ?? revision), {...simOptions, extensionBaseline: !options.baselineRevision});
      if (report.deadEnds > 0) add('extension.sim-dead-end', `${report.deadEnds} dead-end runs`);
      for (const [strategy, rates] of Object.entries(report.endingRates)) if ((rates['(none)'] ?? 0) > 0) add('extension.sim-stuck', `${strategy}: reached step limit without ending`);
      if (baseline.deadEnds || Object.values(baseline.endingRates).some(r => (r['(none)'] ?? 0) > 0)) add('extension.baseline-stuck', 'baseline has dead ends or unfinished runs');
      comparison = Object.fromEntries([...new Set([...Object.keys(report.endingRates.random ?? {}), ...Object.keys(baseline.endingRates.random ?? {})])].map(id => {
        const extended = report!.endingRates.random?.[id] ?? 0; const base = baseline!.endingRates.random?.[id] ?? 0;
        if (id !== '(none)' && extended > maxEndingRate) add('extension.sim-ending-concentration', `${id}: ${extended} exceeds ${maxEndingRate}; baseline ${base}`);
        return [id, {baseline: base, extended, delta: extended - base}];
      }));
    } catch (error) { add('extension.sim-crash', error instanceof Error ? error.message : String(error)); }
  }
  const round = extensionRewriteRound(rewriteRound);
  const passed = issues.length === 0;
  return {status: passed ? 'pass' : round < 3 ? 'rewrite' : 'human', rewriteRound: round, passed, issues,
    ...(report ? {report} : {}), ...(baseline ? {baseline} : {}), ...(comparison ? {comparison} : {})};
}

// ── option extraction (from the projected view + authored effects, i.e. what a player could see)
function optionsOf(view: AdventureView, world: WorldContent): SimOption[] {
  const out: SimOption[] = [];
  const actionById = new Map(world.actions.map(a => [a.id, a]));
  for (const card of view.hand ?? []) {
    const sl = world.storylets?.find(s => s.id === card.storyletId);
    for (const ch of card.choices) {
      const cid = ch.id.slice(`sl__${card.storyletId}__`.length);
      const src = sl?.choices.find(c => c.id === cid);
      out.push({id: ch.id, label: ch.label, enabled: ch.enabled, timeCost: ch.timeCost, effects: src?.effects ?? [], fromHand: true, storyletId: card.storyletId, moves: !!src?.effects.some(e => e.kind === 'move')});
    }
  }
  for (const a of view.actions) {
    const src = actionById.get(a.id);
    out.push({id: a.id, label: a.label, enabled: a.enabled, timeCost: a.timeCost, effects: src?.effects ?? [], fromHand: false, moves: !!src?.effects.some(e => e.kind === 'move')});
  }
  return out;
}
/** Expected change of a resource from authored effects (rolls weighted 50/50 — strategy heuristic only). */
function expectedDelta(effects: WorldEffect[], resourceId: string): number {
  let sum = 0;
  for (const e of effects) {
    if (e.kind === 'resource' && e.resourceId === resourceId) sum += e.delta ?? 0;
    if (e.kind === 'roll') sum += 0.5 * expectedDelta(e.success as WorldEffect[], resourceId) + 0.5 * expectedDelta(e.failure as WorldEffect[], resourceId);
  }
  return sum;
}
function hasCost(o: SimOption): boolean {
  const neg = (effects: readonly WorldEffect[]): boolean => effects.some(e => (e.kind === 'resource' && (e.delta ?? 0) < 0) || (e.kind === 'roll' && (neg(e.failure as WorldEffect[]) || neg(e.success as WorldEffect[]))));
  return o.timeCost > 0 || neg(o.effects) || o.effects.some(e => e.kind === 'roll');
}
const pickRandom = <T>(items: T[], rand: () => number): T => items[Math.floor(rand() * items.length)]!;
function greedy(resourceId: string, sign = 1) {
  return (options: SimOption[], _view: AdventureView, rand: () => number) => {
    // Per month of time spent, so free cards are not starved by long jobs; ties random; small exploration.
    if (rand() < 0.15) return pickRandom(options, rand);
    let best = -Infinity; let pool: SimOption[] = [];
    for (const o of options) {
      const score = sign * expectedDelta(o.effects, resourceId) / Math.max(1, o.timeCost) + (o.fromHand ? 0.01 : 0);
      if (score > best + 1e-9) { best = score; pool = [o]; } else if (Math.abs(score - best) <= 1e-9) pool.push(o);
    }
    return pickRandom(pool, rand);
  };
}

/**
 * 跑商 strategy (S1 follow-up): heads for the ending gated behind a large money threshold (《寿灯》: 万宝楼东家).
 * Back-chains from that gate: the facts / storylet_seen it needs, the cards that set them, and so on. Then it
 * stays where those cards are drawn, plays chain cards first (never the choice that un-sets a chain fact or ends
 * the run elsewhere), and otherwise earns money per month (trade, sell, wages), calming the ending-on-max resource
 * (心魔) when it runs high. Pure heuristic over authored data — no world-specific ids.
 */
function merchantStrategy(world: WorldContent, money: string): Strategy['pick'] {
  const storylets = world.storylets ?? [];
  const defs = world.resourceDefs ?? {};
  const endsIn = (effects: readonly WorldEffect[]): string[] => effects.flatMap(e => e.kind === 'ending' ? [e.endingId]
    : e.kind === 'roll' ? [...endsIn(e.success as WorldEffect[]), ...endsIn(e.failure as WorldEffect[])] : []);
  const gate = (sl: (typeof storylets)[number]) => Math.max(0, ...(sl.when ?? []).map(c => c.kind === 'resource' && c.resourceId === money ? c.atLeast ?? 0 : 0));
  const targets = storylets.filter(sl => gate(sl) > 0 && sl.choices.some(c => endsIn(c.effects).length)).sort((a, b) => gate(b) - gate(a)).slice(0, 1);
  const targetEndings = new Set(targets.flatMap(sl => sl.choices.flatMap(c => endsIn(c.effects))));
  const chainCards = new Set(targets.map(sl => sl.id)); const chainFacts = new Set<string>();
  for (let changed = true; changed;) {
    changed = false;
    for (const sl of storylets) {
      const sets = sl.choices.some(c => c.effects.some(e => e.kind === 'set' && e.value === true && chainFacts.has(e.factId)));
      if (sets && !chainCards.has(sl.id)) { chainCards.add(sl.id); changed = true; }
      if (!chainCards.has(sl.id)) continue;
      for (const c of [...(sl.when ?? []), ...sl.choices.flatMap(ch => ch.requires ?? [])]) {
        if (c.kind === 'fact' && c.value === true && !chainFacts.has(c.factId)) { chainFacts.add(c.factId); changed = true; }
        if (c.kind === 'storylet_seen' && !chainCards.has(c.storyletId)) { chainCards.add(c.storyletId); changed = true; }
      }
    }
  }
  // Home = the location where most chain cards are drawn; next hop toward it via move actions (BFS).
  const tally = new Map<string, number>();
  for (const sl of storylets) if (chainCards.has(sl.id)) for (const l of sl.locationIds ?? []) tally.set(l, (tally.get(l) ?? 0) + 1);
  const home = [...tally].sort((a, b) => b[1] - a[1])[0]?.[0];
  const hop = new Map<string, string>(); // location → action id that moves one step closer to home
  if (home) {
    const edges = world.actions.flatMap(a => a.effects.filter(e => e.kind === 'move').map(e => ({from: a.locationId, to: (e as {locationId: string}).locationId, id: a.id})));
    const dist = new Map([[home, 0]]); const queue = [home];
    while (queue.length) { const at = queue.shift()!; for (const e of edges) if (e.to === at && !dist.has(e.from)) { dist.set(e.from, dist.get(at)! + 1); hop.set(e.from, e.id); queue.push(e.from); } }
  }
  const danger = Object.keys(defs).filter(id => defs[id]!.onMax?.ending);
  const byId = new Map(storylets.map(sl => [sl.id, sl]));
  const setsChain = (effects: readonly WorldEffect[]) => effects.some(e => e.kind === 'set' && e.value === true && chainFacts.has(e.factId));
  let remembered = new Map<string, boolean>(); let lastTurn = Infinity;
  return (options, view, rand) => {
    if (view.turn < lastTurn) remembered = new Map(); // new run
    lastTurn = view.turn;
    const fact = (id: string) => view.facts.find(f => f.id === id)?.value ?? remembered.get(id) ?? false;
    // Chain cards whose fact-setting choice is still locked (e.g. 押上三百灵石 needs 300): keep them, don't burn them on 「以后再说」.
    const holding = new Set((view.hand ?? []).filter(card => chainCards.has(card.storyletId) && card.choices.some(ch => {
      const src = byId.get(card.storyletId)?.choices.find(c => ch.id === `sl__${card.storyletId}__${c.id}`);
      return !ch.enabled && !!src && src.effects.some(e => e.kind === 'set' && e.value === true && chainFacts.has(e.factId) && !fact(e.factId));
    })).map(card => card.storyletId));
    const pick = (() => {
      if (rand() < 0.05) return pickRandom(options, rand);
      const res = view.resources ?? {};
      let best = -Infinity; let pool: SimOption[] = [];
      for (const o of options) {
        let score = expectedDelta(o.effects, money) / Math.max(1, o.timeCost);
        const endings = endsIn(o.effects);
        if (endings.some(e => targetEndings.has(e))) score += 1e6; else if (endings.length) score -= 1e5;
        for (const e of o.effects) if (e.kind === 'set' && chainFacts.has(e.factId) && fact(e.factId) !== e.value) score += e.value ? 1e4 : -1e5;
        if (o.storyletId && chainCards.has(o.storyletId)) score += 300;
        if (o.storyletId && holding.has(o.storyletId) && !setsChain(o.effects)) score -= 2e4;
        for (const d of danger) {
          const max = defs[d]!.max ?? 100; const v = res[d] ?? 0;
          if (v >= 0.6 * max) score += -expectedDelta(o.effects, d) * (v >= 0.8 * max ? 200 : 20);
        }
        if (o.moves) score += home && view.location.id !== home && hop.get(view.location.id) === o.id ? 50 : -50;
        if (o.id === '__wait__' && view.location.id === home) score += 1; // let the hand refresh rather than wander
        if (score > best + 1e-9) { best = score; pool = [o]; } else if (Math.abs(score - best) <= 1e-9) pool.push(o);
      }
      return pickRandom(pool, rand);
    })();
    for (const e of pick.effects) if (e.kind === 'set') remembered.set(e.factId, e.value);
    return pick;
  };
}

export const XIANXIA_SIM_PREFS = {
  resourcePrefs: {money: ['lingshi'], growth: ['xiuwei'], dark: ['xinmo']},
  strategyLabels: {modao: '魔道优先', lazy: '只修炼'},
} as const;

function strategyResources(world: WorldContent, profile: SimProfile) {
  const defs = world.resourceDefs ?? {};
  const ids = Object.keys(defs).filter(id => defs[id]!.display !== 'hidden');
  const prefer = (wanted: string[], fallback: number) => wanted.find(id => ids.includes(id)) ?? ids[fallback] ?? ids[0] ?? '';
  const money = prefer([...(profile.resourcePrefs?.money ?? []), ...XIANXIA_SIM_PREFS.resourcePrefs.money,
    'money', 'coin', 'gold', 'primary_coin'], 1);
  const growth = prefer([...(profile.resourcePrefs?.growth ?? []), ...XIANXIA_SIM_PREFS.resourcePrefs.growth,
    'reputation', 'trust', ...ids.filter(id => /_(trust|reputation)$/.test(id))], ids.findIndex(id => id !== money));
  // 魔道: chase the configured dark resource, then one whose max ends the game.
  const dark = [...(profile.resourcePrefs?.dark ?? []), ...XIANXIA_SIM_PREFS.resourcePrefs.dark]
    .find(id => ids.includes(id)) ?? ids.find(id => defs[id]!.onMax?.ending) ?? growth;
  return {defs, money, growth, dark};
}

/** Default strategy set (§6.7) resolved against a world's resources. */
export function defaultStrategies(world: WorldContent, profile: SimProfile = {}): Strategy[] {
  const {defs, money, growth, dark} = strategyResources(world, profile);
  const label = (id: string) => defs[id]?.label ?? id;
  const strategies: Strategy[] = [
    {id: 'random', label: '随机', pick: (o, _v, r) => pickRandom(o, r)},
    {id: growth === money ? `greedy-growth-${growth}` : `greedy-${growth}`, label: `只顾${label(growth)}`, pick: greedy(growth)},
    {id: `greedy-${money}`, label: `只顾${label(money)}`, pick: greedy(money)},
    {id: 'modao', label: dark === XIANXIA_SIM_PREFS.resourcePrefs.dark[0] ? XIANXIA_SIM_PREFS.strategyLabels.modao : `追求${label(dark)}`, pick: greedy(dark)},
    {id: 'merchant', label: `跑商（攒${label(money)}）`, pick: merchantStrategy(world, money)},
    {id: 'lazy', label: growth === XIANXIA_SIM_PREFS.resourcePrefs.growth[0] ? XIANXIA_SIM_PREFS.strategyLabels.lazy : '原地行动', pick: (options, _v, r) => {
      // Only cultivate in place: never move; prefer growth per month; wait when nothing grows.
      const stay = options.filter(o => !o.moves);
      const pool = stay.length ? stay : options;
      const growing = pool.filter(o => expectedDelta(o.effects, growth) > 0);
      if (growing.length) return greedy(growth)(growing, _v, () => 0.5 + r() * 0.5);
      return pool.find(o => o.id === '__wait__') ?? pickRandom(pool, r);
    }},
    ...(world.openingRoll?.enabled ? [
      {id: 'rollRandom', label: '随机开局', pick: (o: SimOption[], _v: AdventureView, r: () => number) => pickRandom(o, r)},
      {id: 'rollWorst', label: '最低开局', pick: (o: SimOption[], _v: AdventureView, r: () => number) => pickRandom(o, r)},
      {id: 'rollBest', label: '最高开局', pick: (o: SimOption[], _v: AdventureView, r: () => number) => pickRandom(o, r)},
    ] : []),
  ];
  const selected: readonly string[] = profile.strategyIds ?? profile.strategies ?? STRATEGY_IDS;
  return strategies.flatMap((strategy, index) => (index < 6
    ? selected.includes(STRATEGY_IDS[index]!) || selected.includes(strategy.id)
    : selected.includes(strategy.id) || selected.includes(strategy.id === 'rollRandom' ? 'roll-random' : strategy.id === 'rollWorst' ? 'roll-worst' : 'roll-best'))
    ? [{...strategy, label: profile.strategyLabels?.[strategy.id]
      ?? profile.strategyLabels?.[STRATEGY_IDS[index]!]
      ?? strategy.label}] : []);
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const quantile = (sorted: number[], q: number) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1) + 0.5))]! : 0;
const median = (xs: number[]) => quantile([...xs].sort((a, b) => a - b), 0.5);

interface RunResult {ending: string; decisions: number; uniqueChars: number; months: number; deadEnd: boolean;
  samples: Record<string, number[]>; drawn: Set<string>; plays: number; repeats: number; visible: number; locked: number;
  pinned: Record<string, number>; steps: number; costSteps: number; enabledIds: Set<string>; visibleLockedIds: Set<string>;
  /** K15: ending passages / recap lines shown at the end of this run. */
  passageIds: string[]; recapIds: string[];
  /** S3: storylet plays this run. */
  playCounts: Record<string, number>; actionIds: string[]; effectiveSteps: number; noProgress: boolean; repeatedStates: number; proseBodies: string[]; observedText: string[]}

function runOne(revision: WorldRevision, strategy: Strategy, seed: number, maxSteps: number, now: string, inspectState?: SimulateOptions['inspectState']): RunResult {
  const world = revision.content;
  const rand = mulberry(seed ^ 0x9E3779B9);
  let state: AdventureState = createAdventureState(revision, `sim-${strategy.id}-${seed}`, now, {}, seed);
  inspectState?.(state, world);
  if (state.openingRoll && world.openingRoll?.enabled) {
    const mode = strategy.id === 'rollWorst' ? 'min' : strategy.id === 'rollBest' ? 'max' : 'random';
    const rolled = applyOpeningRollCommand(world, state.openingRoll, 'roll');
    if (mode === 'min' || mode === 'max') {
      const score = (set: {values: Record<string, number>}) => Object.entries(set.values).reduce((sum, [id, value]) => sum + value * (world.openingRoll!.score?.[id] ?? 1), 0);
      const order = rolled.history.map((set, index) => ({index, value: score(set)})).sort((a, b) => mode === 'min' ? a.value - b.value : b.value - a.value);
      state.openingRoll = applyOpeningRollCommand(world, rolled, 'select', order[0]?.index);
    } else state.openingRoll = rolled;
    state.openingRoll = applyOpeningRollCommand(world, state.openingRoll, 'confirm');
    applyOpeningSet(world, state, state.openingRoll);
  }
  const seen = new Set<string>(); let chars = 0;
  const seenStates = new Set<string>(); const actionIds: string[] = []; const proseBodies: string[] = [];
  const observedText: string[] = [];
  const read = (text: string | undefined) => { if (text && !seen.has(text)) { seen.add(text); chars += [...text.replace(/\s+/g, '')].length; } };
  const defs = world.resourceDefs ?? {};
  const samples: Record<string, number[]> = {}; const pinned: Record<string, number> = {};
  const res: RunResult = {ending: '(none)', decisions: 0, uniqueChars: 0, months: 0, deadEnd: false, samples, drawn: new Set(), plays: 0, repeats: 0,
    visible: 0, locked: 0, pinned, steps: 0, costSteps: 0, enabledIds: new Set(), visibleLockedIds: new Set(), passageIds: [], recapIds: [], playCounts: {}, actionIds, effectiveSteps: 0, noProgress: false, repeatedStates: 0, proseBodies, observedText};
  let lastPlayed = '';
  let view = projectAdventure(state, revision);
  inspectState?.(state, world);
  read(view.location.text);
  if (view.location.text?.trim()) res.observedText.push(view.location.text);
  seenStates.add(semanticDependencyState(state, view, world));
  for (let step = 0; step < maxSteps && !view.ended; step++) {
    for (const card of view.hand ?? []) res.drawn.add(card.storyletId);
    for (const [id, def] of Object.entries(defs)) {
      if (def.display === 'hidden') continue;
      const v = state.resources?.[id] ?? 0;
      (samples[id] ??= []).push(v);
      const max = state.resourceMax?.[id] ?? def.max;
      if (v <= def.min || (max !== undefined && v >= max)) pinned[id] = (pinned[id] ?? 0) + 1;
    }
    const options = optionsOf(view, world);
    const enabled = options.filter(o => o.enabled);
    res.visible += options.length; res.locked += options.length - enabled.length; res.steps++;
    for (const o of options) (o.enabled ? res.enabledIds : res.visibleLockedIds).add(o.id);
    if (enabled.some(hasCost)) res.costSteps++;
    if (!enabled.length) { res.deadEnd = true; break; }
    const pick = strategy.pick(enabled, view, rand, state);
    const beforeState = semanticDependencyState(state, view, world);
    if (pick.storyletId) {
      res.plays++; res.playCounts[pick.storyletId] = (res.playCounts[pick.storyletId] ?? 0) + 1; if (pick.storyletId === lastPlayed) res.repeats++; lastPlayed = pick.storyletId;
      const card = view.hand?.find(h => h.storyletId === pick.storyletId); read(card?.text);
    } else lastPlayed = '';
    state = {...state, history: []}; // the simulator does not need the transcript; keeps steps O(1)
    state = advanceAdventure(state, {actionId: pick.id, expectedTurn: state.turn, requestId: '00000000-0000-4000-8000-000000000000'}, world, now);
    actionIds.push(pick.id);
    res.decisions++;
    for (const h of state.history) for (const line of h.text.split('\n')) read(line);
    for (const h of state.history) if (h.text.trim()) res.observedText.push(h.text);
    view = projectAdventure(state, revision);
    if (view.location.text?.trim()) res.observedText.push(view.location.text);
    const afterState = semanticDependencyState(state, view, world);
    if (seenStates.has(afterState)) res.repeatedStates++;
    else if (afterState !== beforeState) res.effectiveSteps++;
    seenStates.add(afterState);
    inspectState?.(state, world);
  }
  if (view.ending) {
    res.ending = view.ending.id; read(view.ending.text);
    if (view.ending.text.trim()) res.observedText.push(view.ending.text);
    for (const p of view.ending.passages ?? []) { read(p.text); res.passageIds.push(p.id); }
    for (const r of view.ending.recap ?? []) { read(r.text); res.recapIds.push(r.id); }
  }
  res.uniqueChars = chars; res.months = state.elapsed;
  res.noProgress = res.decisions > 0 && res.effectiveSteps === 0;
  return res;
}

export function semanticDependencyState(state: AdventureState, view: AdventureView, world: WorldContent): string {
  const available = [...view.actions.map(action => [action.id, action.enabled] as const), ...(view.hand ?? []).flatMap(card => card.choices.map(choice => [choice.id, choice.enabled] as const))]
    .sort(([a], [b]) => a.localeCompare(b));
  const thresholds = new Map<string, number[]>();
  const collect = (conditions: readonly import('@novel-game/contracts').WorldCondition[] | undefined): void => {
    for (const condition of conditions ?? []) {
      if (condition.kind === 'resource') {
        const values = thresholds.get(condition.resourceId) ?? [];
        if (condition.atLeast !== undefined) values.push(condition.atLeast);
        if (condition.atMost !== undefined) values.push(condition.atMost);
        thresholds.set(condition.resourceId, values);
      } else if (condition.kind === 'anyOf') collect(condition.conditions);
    }
  };
  for (const action of world.actions) collect(action.requires);
  for (const event of world.events) collect(event.when);
  for (const condition of [...(world.endConditions?.win ?? []), ...(world.endConditions?.lose ?? [])]) collect(condition.when);
  for (const ending of world.endings) collect(ending.when);
  for (const card of world.storylets ?? []) {
    collect(card.when);
    for (const mod of card.weight?.mods ?? []) {
      collect(mod.when);
      if (mod.resourceId) { const values = thresholds.get(mod.resourceId) ?? [];
        if (mod.atLeast !== undefined) values.push(mod.atLeast); if (mod.atMost !== undefined) values.push(mod.atMost);
        thresholds.set(mod.resourceId, values); }
    }
    for (const choice of card.choices) { collect(choice.availableWhen); collect(choice.requires); }
    for (const body of card.textCases ?? []) collect(body.when);
  }
  for (const location of world.locations) for (const variant of location.textVariants ?? []) collect(variant.when);
  for (const ending of world.endings) {
    for (const variant of ending.textVariants ?? []) collect(variant.when);
    for (const passage of ending.passages ?? []) collect(passage.when);
  }
  for (const recap of world.recap ?? []) collect(recap.when);
  const resourceBands = [...thresholds].sort(([a], [b]) => a.localeCompare(b)).map(([id, points]) =>
    [id, [...new Set(points)].sort((a, b) => a - b).filter(point => (state.resources?.[id] ?? 0) >= point).length]);
  const dependencies = collectWorldDependencies(world);
  return JSON.stringify({location: state.locationId,
    facts: Object.entries(state.facts).filter(([id]) => dependencies.facts.has(id)).sort(),
    known: [...state.knownFactIds].filter(id => dependencies.known.has(id)).sort(),
    ledger: state.ledger ? {held: state.ledger.heldFactIds.filter(id => dependencies.ledger.has(id)).sort(),
      consumed: state.ledger.consumedFactIds.filter(id => dependencies.ledger.has(id)).sort(),
      committed: state.ledger.committedFactIds.filter(id => dependencies.ledger.has(id)).sort()} : undefined,
    resourceBands, available, hand: (view.hand ?? []).map(card => ({id: card.storyletId,
      choices: card.choices.map(choice => [choice.label, choice.enabled])})), ending: view.ending?.id ?? null});
}
function collectWorldDependencies(world: WorldContent): {facts: Set<string>; known: Set<string>; ledger: Set<string>} {
  const graph = causalDependencyGraph(world);
  const facts = new Set<string>(); const known = new Set<string>(); const ledger = new Set<string>();
  const conditions = (items: readonly import('@novel-game/contracts').WorldCondition[] | undefined): void => {
    for (const condition of items ?? []) {
      if (condition.kind === 'fact') facts.add(condition.factId);
      if (condition.kind === 'known') { facts.add(condition.factId); known.add(condition.factId); }
      if (condition.kind === 'npc_knows') facts.add(condition.factId);
      if (condition.kind === 'anyOf') conditions(condition.conditions);
    }
  };
  for (const action of world.actions) conditions([...action.requires, ...action.availableWhen]);
  for (const event of world.events) conditions(event.when);
  for (const item of [...(world.endConditions?.win ?? []), ...(world.endConditions?.lose ?? [])]) conditions(item.when);
  for (const ending of world.endings) conditions(ending.when);
  for (const card of world.storylets ?? []) {
    conditions(card.when);
    for (const mod of card.weight?.mods ?? []) conditions(mod.when);
    for (const choice of card.choices) conditions([...(choice.availableWhen ?? []), ...(choice.requires ?? [])]);
    for (const body of card.textCases ?? []) conditions(body.when);
  }
  for (const location of world.locations) for (const variant of location.textVariants ?? []) conditions(variant.when);
  for (const ending of world.endings) {
    for (const variant of ending.textVariants ?? []) conditions(variant.when);
    for (const passage of ending.passages ?? []) conditions(passage.when);
  }
  for (const recap of world.recap ?? []) conditions(recap.when);
  for (const fact of graph.factIds) facts.add(fact);
  for (const id of graph.ledgerFactIds) { facts.add(id); ledger.add(id); }
  for (const entity of [...world.actions, ...world.events, ...world.endings]) {
    for (const assertion of entity.ledgerAssertions ?? []) { facts.add(assertion.factId); ledger.add(assertion.factId); }
    for (const effect of 'effects' in entity ? entity.effects : []) if (effect.kind === 'ledger') { facts.add(effect.factId); ledger.add(effect.factId); }
  }
  for (const card of world.storylets ?? []) for (const choice of card.choices) {
    for (const assertion of choice.ledgerAssertions ?? []) { facts.add(assertion.factId); ledger.add(assertion.factId); }
    for (const effect of choice.effects) if (effect.kind === 'ledger') { facts.add(effect.factId); ledger.add(effect.factId); }
  }
  return {facts, known, ledger};
}
/** G1 pacing line (also applied per route by the coverage report). */
export const MIN_RUN_DECISIONS = 5;
export const MIN_RUN_LENGTH_CHECK = 'minimum-run-length';
export const PACING_LINE = {decisions: 60, uniqueChars: 10000} as const;
export const STRATEGY_IDS = ['random', 'greedy-growth', 'greedy-money', 'modao', 'merchant', 'lazy', 'rollRandom', 'rollWorst', 'rollBest'] as const;
const LEGACY_METRICS: readonly FunMetricId[] = ['G1', 'G2', 'G4', 'G6', 'G8'];
const DEFAULT_THRESHOLDS = {minEndingRate: 0.05, maxRandomEndingRate: 0.6, minFailureFreeEndingRate: 0, minCollectionCompletionRate: 1};

export async function simulateWorld(revision: WorldRevision, opts: SimulateOptions = {}): Promise<PlaytestReport> {
  if (opts.extensionBaseline) revision = withoutExtensions(revision);
  if (revision.content.extensions?.length) await initializeExtensionSandbox();
  const started = Date.now();
  const world = revision.content;
  const evidenceRuns = opts.evidence?.runs ?? 0;
  if (opts.evidence && (!Number.isInteger(evidenceRuns) || evidenceRuns < 1 || evidenceRuns > 20 || !Number.isInteger(opts.evidence.seed) || opts.evidence.seed < 0 || opts.evidence.seed > 0xffffffff || !Number.isInteger(opts.evidence.maxSteps) || opts.evidence.maxSteps < 1 || opts.evidence.maxSteps > 300)) throw new Error('Invalid evidence simulation bounds');
  const seeds = opts.seeds ?? 200; const maxSteps = opts.maxSteps ?? 1500; const now = opts.now ?? new Date().toISOString();
  const pacingLine = opts.profile?.pacingLine ?? PACING_LINE;
  const thresholds = {...DEFAULT_THRESHOLDS, ...opts.profile?.thresholds};
  const metricEnabled = (id: FunMetricId) => opts.profile?.metricMatrix
    ? opts.profile.metricMatrix[id] === true
    : LEGACY_METRICS.includes(id);
  let strategies = defaultStrategies(world, opts.profile);
  if (opts.strategies?.length) strategies = strategies.filter(s => opts.strategies!.includes(s.id));
  if (!strategies.length) throw new Error('没有匹配的策略');
  const endings = world.endings.map(e => ({id: e.id, title: e.title, kind: e.kind ?? 'ending'}));
  const endingRates: PlaytestReport['endingRates'] = {}; const medians: PlaytestReport['medians'] = {};
  const drawnRuns = new Map<string, number>(); let runs = 0; let deadEnds = 0; let plays = 0; let repeats = 0; let visible = 0; let locked = 0;
  let steps = 0; let costSteps = 0; const pinnedSteps: Record<string, number> = {};
  const bandRuns: Record<string, number[][]> = {}; const enabledEver = new Set<string>(); const lockedEver = new Set<string>();
  const CHECKPOINTS = [0, 0.25, 0.5, 0.75, 1];
  // K15 coverage: per ending, runs that reached it / runs with ≥ 1 recap line; passage and recap hit counts.
  const k15Runs: Record<string, {runs: number; withRecap: number; passages: number}> = {}; const passageHits: Record<string, number> = {}; const recapHits: Record<string, number> = {};
  let completedRuns = 0; let totalDecisions = 0; let minimumDecisions = Infinity;
  // S3 pacing inputs.
  const randomByEnding: Record<string, number[]> = {}; const minByEnding: Record<string, number> = {}; const randomPlays: Record<string, number> = {};
  for (const strategy of strategies) {
    const counts: Record<string, number> = {}; const decisions: number[] = []; const unique: number[] = []; const months: number[] = [];
    for (let i = 0; i < seeds; i++) {
      const r = runOne(revision, strategy, i + 1, maxSteps, now, opts.inspectState);
      counts[r.ending] = (counts[r.ending] ?? 0) + 1;
      const k = (k15Runs[r.ending] ??= {runs: 0, withRecap: 0, passages: 0}); k.runs++; if (r.recapIds.length) k.withRecap++; k.passages += r.passageIds.length;
      for (const id of r.passageIds) passageHits[`${r.ending}/${id}`] = (passageHits[`${r.ending}/${id}`] ?? 0) + 1;
      for (const id of r.recapIds) recapHits[id] = (recapHits[id] ?? 0) + 1;
      decisions.push(r.decisions); unique.push(r.uniqueChars); months.push(r.months);
      if (r.ending !== '(none)') {
        minByEnding[r.ending] = Math.min(minByEnding[r.ending] ?? Infinity, r.decisions);
        completedRuns++; totalDecisions += r.decisions; minimumDecisions = Math.min(minimumDecisions, r.decisions);
      }
      if (strategy.id === 'random') { (randomByEnding[r.ending] ??= []).push(r.decisions); for (const [id, n] of Object.entries(r.playCounts)) randomPlays[id] = (randomPlays[id] ?? 0) + n; }
      for (const id of r.drawn) drawnRuns.set(id, (drawnRuns.get(id) ?? 0) + 1);
      runs++; if (r.deadEnd) deadEnds++; plays += r.plays; repeats += r.repeats; visible += r.visible; locked += r.locked;
      steps += r.steps; costSteps += r.costSteps;
      for (const [id, n] of Object.entries(r.pinned)) pinnedSteps[id] = (pinnedSteps[id] ?? 0) + n;
      for (const id of r.enabledIds) enabledEver.add(id); for (const id of r.visibleLockedIds) lockedEver.add(id);
      if (strategy.id === 'random') for (const [id, xs] of Object.entries(r.samples)) {
        (bandRuns[id] ??= CHECKPOINTS.map(() => []));
        CHECKPOINTS.forEach((at, k) => bandRuns[id]![k]!.push(xs[Math.min(xs.length - 1, Math.round(at * (xs.length - 1)))] ?? 0));
      }
      if (opts.yieldEvery && i % 10 === 9) await opts.yieldEvery();
    }
    endingRates[strategy.id] = Object.fromEntries(Object.entries(counts).map(([k, n]) => [k, n / seeds]));
    medians[strategy.id] = {decisions: median(decisions), uniqueChars: median(unique), months: median(months)};
  }
  const defs = world.resourceDefs ?? {};
  const resourceBands: PlaytestReport['resourceBands'] = Object.fromEntries(Object.entries(bandRuns).map(([id, cols]) => [id, {label: defs[id]?.label ?? id,
    points: cols.map((col, k) => { const s = [...col].sort((a, b) => a - b); return {at: CHECKPOINTS[k]!, p10: quantile(s, 0.1), p50: quantile(s, 0.5), p90: quantile(s, 0.9)}; })}]));
  const cardIds = (world.storylets ?? []).map(s => s.id);
  const neverDrawn = cardIds.filter(id => !drawnRuns.has(id));
  const drawRate = Object.fromEntries(cardIds.map(id => [id, (drawnRuns.get(id) ?? 0) / Math.max(1, runs)]));
  const pinnedRatio = Object.fromEntries(Object.entries(pinnedSteps).map(([id, n]) => [id, n / Math.max(1, steps)]));
  const gatesNeverMet = [...lockedEver].filter(id => !enabledEver.has(id));
  const consecutiveRepeatRate = plays ? repeats / plays : 0;
  // ── Simulator-side judgements (lint-side rows are merged by the server).
  const rnd = medians.random; const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;
  const best = (id: string) => Math.max(0, ...Object.values(endingRates).map(r => r[id] ?? 0));
  const unreached = endings.filter(e => best(e.id) < thresholds.minEndingRate);
  const randomMax = Math.max(0, ...Object.entries(endingRates.random ?? {}).map(([, v]) => v));
  const lazyTimeout = Object.entries(endingRates.lazy ?? {}).filter(([id]) => endings.find(e => e.id === id)?.kind === 'timeout' || id === 'timeout').reduce((n, [, v]) => n + v, 0);
  const elapsedLabel = (n: number) => world.clock ? formatMonths(n, world.clock.unit) : `${n} 行动耗时`;
  const lazyLabel = strategies.find(strategy => strategy.id === 'lazy')?.label ?? '原地行动';
  const randomRates = endingRates.random;
  const failureFreeRate = endings.filter(ending => ending.kind !== 'failure').reduce((sum, ending) => sum + (randomRates?.[ending.id] ?? 0), 0);
  const failureRate = endings.filter(ending => ending.kind === 'failure').reduce((sum, ending) => sum + (randomRates?.[ending.id] ?? 0), 0);
  const pressureIds = Object.entries(defs).filter(([, def]) => def.onMax?.ending || def.onMin?.ending).map(([id]) => id);
  const bidirectional = pressureIds.filter(id => {
    const values = resourceBands[id]?.points.map(point => point.p50) ?? [];
    let rises = false; let falls = false;
    for (let i = 1; i < values.length; i++) { rises ||= values[i]! > values[i - 1]!; falls ||= values[i]! < values[i - 1]!; }
    return rises && falls;
  });
  const growth = strategyResources(world, opts.profile ?? {}).growth;
  const growthValues = resourceBands[growth]?.points.map(point => point.p50) ?? [];
  const growthMonotonic = growthValues.length > 1 && growthValues[growthValues.length - 1]! > growthValues[0]!
    && growthValues.every((value, index) => index === 0 || value >= growthValues[index - 1]!);
  const checks: PassCheck[] = [
    {id: 'G1', label: '时长', line: `「随机」首通中位数 ≥ ${pacingLine.decisions} 次决策且 ≥ ${pacingLine.uniqueChars.toLocaleString('en-US')} 字不重复正文`, measured: rnd ? `${rnd.decisions} 次决策 · ${rnd.uniqueChars} 字 · ${elapsedLabel(rnd.months)}` : '未运行「随机」', pass: !!rnd && rnd.decisions >= pacingLine.decisions && rnd.uniqueChars >= pacingLine.uniqueChars},
    {id: 'G2', label: '结局', line: `每个结局至少 1 种策略 ≥ ${pct(thresholds.minEndingRate)}；「随机」任一结局 ≤ ${pct(thresholds.maxRandomEndingRate)}`, measured: `${endings.length - unreached.length}/${endings.length} 个结局达标${unreached.length ? `（未达：${unreached.map(e => e.title).join('、')}）` : ''} · 「随机」最高 ${pct(randomMax)}`, pass: !unreached.length && randomMax <= thresholds.maxRandomEndingRate},
    {id: 'G4', label: '卡池', line: '连续两回合同一张 = 0 次；没有从未抽到的卡', measured: `连续重复 ${repeats} 次（${pct(consecutiveRepeatRate)}）· 从未抽到 ${neverDrawn.length} 张`, pass: repeats === 0 && neverDrawn.length === 0},
    {id: 'G6', label: '时钟', line: '时限结局在原地策略下可达', measured: endingRates.lazy ? `「${lazyLabel}」时限结局 ${pct(lazyTimeout)}` : `未运行「${lazyLabel}」`, pass: lazyTimeout > 0},
    {id: 'G8', label: '取舍', line: '每回合可见选项里 ≥ 1 个有代价；0 死路', measured: `有代价回合 ${pct(steps ? costSteps / steps : 0)} · 死路 ${deadEnds} · 锁定选项 ${pct(visible ? locked / visible : 0)}`, pass: steps > 0 && costSteps === steps && deadEnds === 0},
    ...(world.openingRoll?.enabled ? [
      {id:'opening-roll-worst',label:'最低开局',line:'最低开局的失败结局率 ≤ 60%',measured:`失败结局 ${pct(Math.max(0,...endings.filter(e=>e.kind==='failure').map(e=>endingRates.rollWorst?.[e.id]??0)))}`,pass:Math.max(0,...endings.filter(e=>e.kind==='failure').map(e=>endingRates.rollWorst?.[e.id]??0))<=0.6},
      {id:'opening-roll-best',label:'最高开局',line:'最高开局最常见结局 ≤ 50%',measured:`最高结局 ${pct(Math.max(0,...Object.values(endingRates.rollBest??{})))}`,pass:Math.max(0,...Object.values(endingRates.rollBest??{}))<=0.5},
    ] : []),
    {id: 'pressure-bidirectional', label: '压力节拍', line: '至少 1 个压力资源的中位曲线同时出现上升与下降', measured: pressureIds.length ? `双向 ${bidirectional.length}/${pressureIds.length} 个压力资源` : '没有带边界结局的压力资源', pass: bidirectional.length > 0},
    {id: 'growth-monotonic', label: '成长曲线', line: `主成长资源「${defs[growth]?.label ?? growth}」中位数逐段单调上升`, measured: growthValues.length ? growthValues.join(' → ') : '未采样主成长资源', pass: growthMonotonic},
    {id: 'failure-free-ending-rate', label: '治愈结局', line: `「随机」零失败结局率 ≥ ${pct(thresholds.minFailureFreeEndingRate)}`, measured: randomRates ? `零失败结局率 ${pct(failureFreeRate)} · 失败结局 ${pct(failureRate)}` : '未运行「随机」', pass: !!randomRates && failureFreeRate >= thresholds.minFailureFreeEndingRate},
  ].filter(check => metricEnabled(check.id as FunMetricId));
  // Never filter this safety check through a genre's optional metric matrix (nor confuse a timeout with a dead end).
  const runLength = {completedRuns, ...(completedRuns ? {minimum: minimumDecisions, average: totalDecisions / completedRuns} : {})};
  checks.push({id: MIN_RUN_LENGTH_CHECK, label: '最低局长', line: `已完成局的最短与平均局长均 ≥ ${MIN_RUN_DECISIONS} 次决策`,
    measured: completedRuns ? `${completedRuns} 局 · 最短 ${runLength.minimum} 步 · 平均 ${runLength.average!.toFixed(1)} 步` : '没有已完成局（未结束的截断局不计入）',
    pass: !completedRuns || (runLength.minimum! >= MIN_RUN_DECISIONS && runLength.average! >= MIN_RUN_DECISIONS)});
  const routeCoverage = opts.routes === false ? undefined
    : await coverRoutes(revision, endingRates, strategies.map(s => s.id), opts.routes === undefined || opts.routes === 'auto' ? [] : opts.routes,
      opts.routeSeeds ?? Math.min(seeds, 20), maxSteps, now, opts.yieldEvery, opts.routeEndings ?? 'all', minByEnding, pacingLine, thresholds.minEndingRate);
  if (metricEnabled('collection-reachable')) {
    const ordinary = routeCoverage?.endings.filter(ending => ending.kind === 'ending') ?? [];
    const reachable = ordinary.filter(ending => ending.status === 'covered' || ending.status === 'goal-only').length;
    const completion = ordinary.length ? reachable / ordinary.length : 0;
    checks.push({id: 'collection-reachable', label: '收集完整度', line: `普通结局通用/定向可达率 ≥ ${pct(thresholds.minCollectionCompletionRate)}`,
      measured: routeCoverage ? `${reachable}/${ordinary.length} 个普通结局可达（${pct(completion)}）` : '未运行路线覆盖',
      pass: !!routeCoverage && ordinary.length > 0 && completion >= thresholds.minCollectionCompletionRate});
  }
  if (routeCoverage && opts.guidance && routeCoverage.endings.some(e => e.status === 'goal-only' && e.kind !== 'failure')) {
    const g = typeof opts.guidance === 'object' ? opts.guidance : {};
    const gSeeds = g.seeds ?? Math.min(seeds, 100);
    const rate = async (w: WorldContent, endingId: string) => {
      const r = await simulateWorld({...revision, content: w}, {seeds: gSeeds, maxSteps, strategies: ['random'], routes: false, pacing: false, now, profile: opts.profile ? {...opts.profile, strategyIds: STRATEGY_IDS} : undefined, ...(opts.yieldEvery ? {yieldEvery: opts.yieldEvery} : {})});
      return r.endingRates.random?.[endingId] ?? 0;
    };
    routeCoverage.guidance = await routeGuidance(revision, {routeCoverage}, {seeds: gSeeds, maxSteps, now, rate, ...(g.maxHints ? {maxHints: g.maxHints} : {})});
    for (const h of routeCoverage.guidance) routeCoverage.issues.push({severity: 'warning', ruleId: 'route.guidance', endingId: h.endingId, message: h.message});
  }
  const pacing = opts.pacing === false ? undefined : diagnosePacing(world, {line: {...pacingLine}, ...(rnd ? {random: rnd} : {}), randomRuns: endingRates.random ? seeds : 0,
    randomByEnding, minByEnding, randomPlays});
  const evidence = opts.evidence ? collectEvidence(revision, strategies, opts.evidence, now) : undefined;
  return {...(opts.draftId ? {draftId: opts.draftId} : {}), draftVersion: opts.draftVersion ?? 0, createdAt: now,
    ...(opts.profile?.id ? {profileId: opts.profile.id} : {}), seeds, maxSteps, timeUnit: world.clock ? world.clock.unit : 'turn',
    strategies: strategies.map(s => ({id: s.id, label: s.label, runs: seeds})), checks, endingRates, endings, medians, resourceBands,
    cards: {neverDrawn, drawRate, consecutiveRepeatRate}, runLength, deadEnds, lockedRatio: visible ? locked / visible : 0, pinnedRatio, gatesNeverMet,
    ...(world.recap?.length || world.endings.some(e => e.passages?.length) ? {endingExtras: {
      byEnding: k15Runs, passageHits, recapHits,
      passagesNeverShown: world.endings.flatMap(e => (e.passages ?? []).map(p => `${e.id}/${p.id}`)).filter(key => !passageHits[key]),
      recapNeverShown: (world.recap ?? []).map(r => r.id).filter(id => !recapHits[id]),
      endingsWithoutRecap: world.recap?.length ? Object.entries(k15Runs).filter(([id, v]) => id !== '(none)' && v.runs > 0 && v.withRecap === 0).map(([id]) => id) : []}} : {}),
    ...(routeCoverage ? {routeCoverage} : {}),
    ...(pacing ? {pacing} : {}), ...(evidence ? {evidence} : {}),
    durationMs: Date.now() - started};
}

function collectEvidence(revision: WorldRevision, strategies: Strategy[], request: {runs: number; seed: number; maxSteps: number}, now: string) {
  const selected = strategies.slice(0, 8); const witnesses: NonNullable<PlaytestReport['evidence']>['witnesses'] = [];
  const deadEnds: NonNullable<PlaytestReport['evidence']>['deadEnds'] = []; const hits = new Map<string, NonNullable<PlaytestReport['evidence']>['endingReachability'][number]['witness']>();
  let cappedRuns = 0; let repeatedStates = 0; let noProgressRuns = 0; const cappedWitnesses: NonNullable<PlaytestReport['evidence']>['cappedWitnesses'] = [];
  const samples: NonNullable<PlaytestReport['evidence']>['samples'] = [];
  for (const strategy of selected) for (let run = 0; run < request.runs; run++) {
    const seed = (request.seed + run) >>> 0;
    const result = runOne(revision, strategy, seed, request.maxSteps, now);
    repeatedStates += result.repeatedStates;
    if (result.ending === '(none)' && !result.deadEnd) {
      cappedRuns++; cappedWitnesses.push({strategy: strategy.id, seed, rawSteps: result.decisions, effectiveSteps: result.effectiveSteps, actionIds: result.actionIds});
    }
    samples.push({strategy: strategy.id, seed, ...(result.ending !== '(none)' ? {endingId: result.ending} : {}),
      outcome: result.ending !== '(none)' ? 'ending' : result.deadEnd ? 'dead-end' : 'capped', rawSteps: result.decisions,
      effectiveSteps: result.effectiveSteps, actionIds: result.actionIds});
    if (result.deadEnd) deadEnds.push({strategy: strategy.id, seed, rawSteps: result.decisions, actionIds: result.actionIds});
    if (result.noProgress && result.decisions > 0) noProgressRuns++;
    if (result.ending !== '(none)' && !hits.has(result.ending)) {
      const witness = {strategy: strategy.id, seed, actionIds: result.actionIds}; hits.set(result.ending, witness);
      witnesses.push({strategy: strategy.id, seed, endingId: result.ending, rawSteps: result.decisions, effectiveSteps: result.effectiveSteps, actionIds: result.actionIds});
    }
  }
  const stats = (values: number[]) => ({minimum: Math.min(...values), average: values.reduce((sum, value) => sum + value, 0) / values.length, maximum: Math.max(...values)});
  return {schemaVersion: 1 as const, checkVersion: 'playtest-evidence-1', reportId: `sim-${request.seed}-${request.runs}-${request.maxSteps}`,
    contentHash: '', runs: request.runs, seed: request.seed, maxSteps: request.maxSteps, strategies: selected.map(strategy => strategy.id),
    status: 'observed' as const, endingReachability: revision.content.endings.map(ending => ({endingId: ending.id,
      status: hits.has(ending.id) ? 'observed' as const : 'sampled-not-hit' as const, ...(hits.has(ending.id) ? {witness: hits.get(ending.id)} : {})})),
     witnesses, samples, distribution: {runs: samples.length, rawSteps: stats(samples.map(sample => sample.rawSteps)), effectiveSteps: stats(samples.map(sample => sample.effectiveSteps))},
     deadEnds, cappedRuns, cappedWitnesses, repeatedStates, noProgressRuns, prose: {observed: samples.some(sample => sample.rawSteps > 0 && !!revision.content.actions.length), repeatedBodies: []}};
}

const ROUTE_HIT_LINE = 0.2;
/**
 * Route coverage: one goal-directed strategy per authored ending (does an automatic player reach it at all?) plus one per
 * planned route. Generic rates come from the main run. Pacing is judged per ordinary route against the G1 line.
 */
async function coverRoutes(revision: WorldRevision, generic: PlaytestReport['endingRates'], genericIds: string[], planned: SimRoute[],
  seeds: number, maxSteps: number, now: string, yieldEvery?: () => Promise<void>, routeEndings: 'all' | 'uncovered' = 'all', minByEnding: Record<string, number> = {},
  pacingLine: {decisions: number; uniqueChars: number} = PACING_LINE, endingRateLine = 0.05): Promise<RouteCoverageReport> {
  const world = revision.content;
  const suppliers = suppliersOf(world);
  const kindOf = (id: string) => world.endings.find(e => e.id === id)?.kind ?? 'ending';
  const routes: RouteCoverageReport['routes'] = [];
  const run = async (route: SimRoute, source: 'plan' | 'ending') => {
    const ordinary = route.endingIds.filter(id => kindOf(id) !== 'failure');
    const targets = source === 'plan' && ordinary.length ? ordinary : route.endingIds;
    const strategyId = `${source === 'plan' ? 'route' : 'goal'}-${route.id}`;
    const strategy: Strategy = {id: strategyId, label: route.name, pick: goalStrategy(world, targets)};
    const counts: Record<string, number> = {}; const decisions: number[] = []; const unique: number[] = []; const months: number[] = []; let deadEnds = 0;
    for (let i = 0; i < seeds; i++) {
      const r = runOne(revision, strategy, i + 1, maxSteps, now);
      counts[r.ending] = (counts[r.ending] ?? 0) + 1; if (r.deadEnd) deadEnds++;
      if (r.ending !== '(none)') minByEnding[r.ending] = Math.min(minByEnding[r.ending] ?? Infinity, r.decisions);
      if (targets.includes(r.ending)) { decisions.push(r.decisions); unique.push(r.uniqueChars); months.push(r.months); }
      if (yieldEvery && i % 10 === 9) await yieldEvery();
    }
    const hits = targets.reduce((n, id) => n + (counts[id] ?? 0), 0);
    const medians = {decisions: median(decisions), uniqueChars: median(unique), months: median(months)};
    const judged = hits > 0 && targets.some(id => kindOf(id) === 'ending');
    routes.push({id: route.id, name: route.name, source, endingIds: targets, strategyId, hitRate: hits / seeds,
      endingRates: Object.fromEntries(Object.entries(counts).map(([k, n]) => [k, n / seeds])), medians, deadEnds,
      belowPacing: judged && (medians.decisions < pacingLine.decisions || medians.uniqueChars < pacingLine.uniqueChars)});
  };
  const bestGenericOf = (endingId: string) => Math.max(0, ...genericIds.map(id => generic[id]?.[endingId] ?? 0));
  for (const e of world.endings) if (routeEndings === 'all' || bestGenericOf(e.id) < endingRateLine) await run({id: e.id, name: `直奔「${e.title}」`, endingIds: [e.id]}, 'ending');
  for (const r of planned) await run(r, 'plan');
  const issues: RouteCoverageReport['issues'] = [];
  const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;
  const endings: RouteCoverageReport['endings'] = world.endings.map(e => {
    const triggers = endingSources(world, e.id, suppliers).length;
    let bestGeneric = 0; let bestGenericStrategy: string | undefined;
    for (const id of genericIds) { const v = generic[id]?.[e.id] ?? 0; if (v > bestGeneric) { bestGeneric = v; bestGenericStrategy = id; } }
    const goalRate = routes.find(r => r.source === 'ending' && r.id === e.id)?.hitRate;
    const status = !triggers ? 'no-trigger' : bestGeneric >= endingRateLine ? 'covered' : (goalRate ?? 0) > 0 ? 'goal-only' : 'unreached';
    if (status === 'no-trigger') issues.push({severity: 'error', ruleId: 'route.no-trigger', endingId: e.id, message: `结局「${e.title}」没有任何触发来源（无 ending 效果、条件或资源阈值）`});
    if (status === 'unreached') issues.push({severity: 'warning', ruleId: 'route.unreached', endingId: e.id, message: `结局「${e.title}」所有自动策略（含定向）都没有到达；未覆盖不等于不可达，请检查前置条件链`});
    if (status === 'goal-only') issues.push({severity: 'warning', ruleId: 'route.random-starved', endingId: e.id,
      message: `结局「${e.title}」只有定向打法能到（${pct(goalRate ?? 0)}），通用策略最高 ${pct(bestGeneric)}；随机玩法下需要路线引导`});
    return {id: e.id, title: e.title, kind: e.kind ?? 'ending', triggers, bestGeneric, ...(bestGenericStrategy ? {bestGenericStrategy} : {}), ...(goalRate !== undefined ? {goalRate} : {}), status};
  });
  for (const r of routes) {
    if (r.source === 'plan' && r.hitRate < ROUTE_HIT_LINE) issues.push({severity: 'warning', ruleId: 'route.plan-weak', routeId: r.id,
      message: `规划路线「${r.name}」按路线打只有 ${pct(r.hitRate)} 到达其结局（线 ${pct(ROUTE_HIT_LINE)}）`});
    if (r.belowPacing && r.source === 'plan') issues.push({severity: 'warning', ruleId: 'route.pacing', routeId: r.id,
      message: `${r.source === 'plan' ? '规划路线' : '直达路线'}「${r.name}」中位 ${r.medians.decisions} 次决策 · ${r.medians.uniqueChars} 字，低于节奏线 ${pacingLine.decisions} 次 · ${pacingLine.uniqueChars} 字`});
  }
  return {seeds, pacing: {...pacingLine}, routes, endings, issues};
}

/** S5: synchronous goal-directed probe of planned routes (no generic strategies) — cheap enough for plan approval. */
export function probeRoutes(revision: WorldRevision, routes: SimRoute[], seeds = 8, maxSteps = 400, now = '2026-01-01T00:00:00.000Z'): {id: string; hitRate: number; endingRates: Record<string, number>}[] {
  const world = revision.content;
  const kindOf = (id: string) => world.endings.find(e => e.id === id)?.kind ?? 'ending';
  return routes.map(route => {
    const ordinary = route.endingIds.filter(id => kindOf(id) !== 'failure');
    const targets = ordinary.length ? ordinary : route.endingIds;
    const strategy: Strategy = {id: `route-${route.id}`, label: route.name, pick: goalStrategy(world, targets)};
    const counts: Record<string, number> = {};
    for (let i = 0; i < seeds; i++) { const r = runOne(revision, strategy, i + 1, maxSteps, now); counts[r.ending] = (counts[r.ending] ?? 0) + 1; }
    const hits = targets.reduce((n, id) => n + (counts[id] ?? 0), 0);
    return {id: route.id, hitRate: hits / seeds, endingRates: Object.fromEntries(Object.entries(counts).map(([k, n]) => [k, n / seeds]))};
  });
}
