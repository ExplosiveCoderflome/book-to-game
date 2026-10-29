/**
 * Headless playtest simulator (§6.7). Drives the SAME engine as the player package (createAdventureState /
 * advanceAdventure / projectAdventure) with scripted strategies over many seeds and aggregates a PlaytestReport.
 * Author-side only: exported via `@novel-game/play-runtime/sim`, never from the package root.
 */
import { type AdventureView, type PassCheck, type PlaytestReport, type RouteCoverageReport, type WorldContent, type WorldEffect, type WorldRevision } from '@novel-game/contracts';
import type { AdventureState } from '../adventure/adventure-state.js';
import { advanceAdventure } from '../adventure/advance-adventure.js';
import { projectAdventure } from '../adventure/project-adventure.js';
import { createAdventureState } from '../adventure/start-adventure.js';
import { formatMonths } from '../adventure/s1-core.js';

import type { SimOption } from './types.js';
import { endingSources, goalStrategy, suppliersOf } from './goal-strategy.js';
import { routeGuidance } from './guidance.js';
import { diagnosePacing } from './pacing.js';
export type { SimOption } from './types.js';
/** `state` is the full engine state (author tool); generic strategies only use the projected view, goal strategies need conditions. */
export interface Strategy {id: string; label: string; pick(options: SimOption[], view: AdventureView, rand: () => number, state?: AdventureState): SimOption}
/** A planned route (ProductionPlan.routes) — strategy text is for authors; endingIds drive the goal strategy. */
export interface SimRoute {id: string; name: string; endingIds: string[]}
export interface SimulateOptions {seeds?: number; maxSteps?: number; strategies?: string[]; now?: string; draftId?: string; draftVersion?: number;
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
  pacing?: boolean}

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

/** Default strategy set (§6.7) resolved against a world's resources. */
export function defaultStrategies(world: WorldContent): Strategy[] {
  const defs = world.resourceDefs ?? {};
  const ids = Object.keys(defs).filter(id => defs[id]!.display !== 'hidden');
  const prefer = (wanted: string[], fallback: number) => wanted.find(id => ids.includes(id)) ?? ids[fallback] ?? ids[0] ?? '';
  const money = prefer(['lingshi', 'money', 'coin', 'gold', 'primary_coin'], 1);
  const growth = prefer(['xiuwei', 'reputation', 'trust', ...ids.filter(id => /_(trust|reputation)$/.test(id))], ids.findIndex(id => id !== money));
  // 魔道: chase the resource whose max ends the game (xinmo in 《寿灯》).
  const dark = ids.includes('xinmo') ? 'xinmo' : ids.find(id => defs[id]!.onMax?.ending) ?? growth;
  const label = (id: string) => defs[id]?.label ?? id;
  return [
    {id: 'random', label: '随机', pick: (o, _v, r) => pickRandom(o, r)},
    {id: growth === money ? `greedy-growth-${growth}` : `greedy-${growth}`, label: `只顾${label(growth)}`, pick: greedy(growth)},
    {id: `greedy-${money}`, label: `只顾${label(money)}`, pick: greedy(money)},
    {id: 'modao', label: ids.includes('xinmo') ? '魔道优先' : `追求${label(dark)}`, pick: greedy(dark)},
    {id: 'merchant', label: `跑商（攒${label(money)}）`, pick: merchantStrategy(world, money)},
    {id: 'lazy', label: ids.includes('xiuwei') ? '只修炼' : '原地行动', pick: (options, _v, r) => {
      // Only cultivate in place: never move; prefer growth per month; wait when nothing grows.
      const stay = options.filter(o => !o.moves);
      const pool = stay.length ? stay : options;
      const growing = pool.filter(o => expectedDelta(o.effects, growth) > 0);
      if (growing.length) return greedy(growth)(growing, _v, () => 0.5 + r() * 0.5);
      return pool.find(o => o.id === '__wait__') ?? pickRandom(pool, r);
    }},
  ];
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
  playCounts: Record<string, number>}

function runOne(revision: WorldRevision, strategy: Strategy, seed: number, maxSteps: number, now: string): RunResult {
  const world = revision.content;
  const rand = mulberry(seed ^ 0x9E3779B9);
  let state: AdventureState = createAdventureState(revision, `sim-${strategy.id}-${seed}`, now, {}, seed);
  const seen = new Set<string>(); let chars = 0;
  const read = (text: string | undefined) => { if (text && !seen.has(text)) { seen.add(text); chars += [...text.replace(/\s+/g, '')].length; } };
  const defs = world.resourceDefs ?? {};
  const samples: Record<string, number[]> = {}; const pinned: Record<string, number> = {};
  const res: RunResult = {ending: '(none)', decisions: 0, uniqueChars: 0, months: 0, deadEnd: false, samples, drawn: new Set(), plays: 0, repeats: 0,
    visible: 0, locked: 0, pinned, steps: 0, costSteps: 0, enabledIds: new Set(), visibleLockedIds: new Set(), passageIds: [], recapIds: [], playCounts: {}};
  let lastPlayed = '';
  let view = projectAdventure(state, revision);
  read(view.location.text);
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
    if (pick.storyletId) {
      res.plays++; res.playCounts[pick.storyletId] = (res.playCounts[pick.storyletId] ?? 0) + 1; if (pick.storyletId === lastPlayed) res.repeats++; lastPlayed = pick.storyletId;
      const card = view.hand?.find(h => h.storyletId === pick.storyletId); read(card?.text);
    } else lastPlayed = '';
    state = {...state, history: []}; // the simulator does not need the transcript; keeps steps O(1)
    state = advanceAdventure(state, {actionId: pick.id, expectedTurn: state.turn, requestId: '00000000-0000-4000-8000-000000000000'}, world, now);
    res.decisions++;
    for (const h of state.history) for (const line of h.text.split('\n')) read(line);
    view = projectAdventure(state, revision);
  }
  if (view.ending) {
    res.ending = view.ending.id; read(view.ending.text);
    for (const p of view.ending.passages ?? []) { read(p.text); res.passageIds.push(p.id); }
    for (const r of view.ending.recap ?? []) { read(r.text); res.recapIds.push(r.id); }
  }
  res.uniqueChars = chars; res.months = state.elapsed;
  return res;
}

/** G1 pacing line (also applied per route by the coverage report). */
export const PACING_LINE = {decisions: 60, uniqueChars: 10000} as const;
export const STRATEGY_IDS = ['random', 'greedy-growth', 'greedy-money', 'modao', 'merchant', 'lazy'] as const;

export async function simulateWorld(revision: WorldRevision, opts: SimulateOptions = {}): Promise<PlaytestReport> {
  const started = Date.now();
  const world = revision.content;
  const seeds = opts.seeds ?? 200; const maxSteps = opts.maxSteps ?? 1500; const now = opts.now ?? new Date().toISOString();
  let strategies = defaultStrategies(world);
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
  // S3 pacing inputs.
  const randomByEnding: Record<string, number[]> = {}; const minByEnding: Record<string, number> = {}; const randomPlays: Record<string, number> = {};
  for (const strategy of strategies) {
    const counts: Record<string, number> = {}; const decisions: number[] = []; const unique: number[] = []; const months: number[] = [];
    for (let i = 0; i < seeds; i++) {
      const r = runOne(revision, strategy, i + 1, maxSteps, now);
      counts[r.ending] = (counts[r.ending] ?? 0) + 1;
      const k = (k15Runs[r.ending] ??= {runs: 0, withRecap: 0, passages: 0}); k.runs++; if (r.recapIds.length) k.withRecap++; k.passages += r.passageIds.length;
      for (const id of r.passageIds) passageHits[`${r.ending}/${id}`] = (passageHits[`${r.ending}/${id}`] ?? 0) + 1;
      for (const id of r.recapIds) recapHits[id] = (recapHits[id] ?? 0) + 1;
      decisions.push(r.decisions); unique.push(r.uniqueChars); months.push(r.months);
      if (r.ending !== '(none)') minByEnding[r.ending] = Math.min(minByEnding[r.ending] ?? Infinity, r.decisions);
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
  // ── G1–G8 simulator-side judgements (lint-side rows are merged by the server).
  const rnd = medians.random; const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;
  const best = (id: string) => Math.max(0, ...Object.values(endingRates).map(r => r[id] ?? 0));
  const unreached = endings.filter(e => best(e.id) < 0.05);
  const randomMax = Math.max(0, ...Object.entries(endingRates.random ?? {}).map(([, v]) => v));
  const lazyTimeout = Object.entries(endingRates.lazy ?? {}).filter(([id]) => endings.find(e => e.id === id)?.kind === 'timeout' || id === 'timeout').reduce((n, [, v]) => n + v, 0);
  const elapsedLabel = (n: number) => world.clock ? formatMonths(n) : `${n} 行动耗时`;
  const lazyLabel = strategies.find(strategy => strategy.id === 'lazy')?.label ?? '原地行动';
  const checks: PassCheck[] = [
    {id: 'G1', label: '时长', line: '「随机」首通中位数 ≥ 60 次决策且 ≥ 10,000 字不重复正文', measured: rnd ? `${rnd.decisions} 次决策 · ${rnd.uniqueChars} 字 · ${elapsedLabel(rnd.months)}` : '未运行「随机」', pass: !!rnd && rnd.decisions >= PACING_LINE.decisions && rnd.uniqueChars >= PACING_LINE.uniqueChars},
    {id: 'G2', label: '结局', line: '每个结局至少 1 种策略 ≥ 5%；「随机」任一结局 ≤ 60%', measured: `${endings.length - unreached.length}/${endings.length} 个结局达标${unreached.length ? `（未达：${unreached.map(e => e.title).join('、')}）` : ''} · 「随机」最高 ${pct(randomMax)}`, pass: !unreached.length && randomMax <= 0.6},
    {id: 'G4', label: '卡池', line: '连续两回合同一张 = 0 次；没有从未抽到的卡', measured: `连续重复 ${repeats} 次（${pct(consecutiveRepeatRate)}）· 从未抽到 ${neverDrawn.length} 张`, pass: repeats === 0 && neverDrawn.length === 0},
    {id: 'G6', label: '时钟', line: '时限结局在原地策略下可达', measured: endingRates.lazy ? `「${lazyLabel}」时限结局 ${pct(lazyTimeout)}` : `未运行「${lazyLabel}」`, pass: lazyTimeout > 0},
    {id: 'G8', label: '取舍', line: '每回合可见选项里 ≥ 1 个有代价；0 死路', measured: `有代价回合 ${pct(steps ? costSteps / steps : 0)} · 死路 ${deadEnds} · 锁定选项 ${pct(visible ? locked / visible : 0)}`, pass: steps > 0 && costSteps === steps && deadEnds === 0},
  ];
  const routeCoverage = opts.routes === false ? undefined
    : await coverRoutes(revision, endingRates, strategies.map(s => s.id), opts.routes === undefined || opts.routes === 'auto' ? [] : opts.routes,
      opts.routeSeeds ?? Math.min(seeds, 20), maxSteps, now, opts.yieldEvery, opts.routeEndings ?? 'all', minByEnding);
  if (routeCoverage && opts.guidance && routeCoverage.endings.some(e => e.status === 'goal-only' && e.kind !== 'failure')) {
    const g = typeof opts.guidance === 'object' ? opts.guidance : {};
    const gSeeds = g.seeds ?? Math.min(seeds, 100);
    const rate = async (w: WorldContent, endingId: string) => {
      const r = await simulateWorld({...revision, content: w}, {seeds: gSeeds, maxSteps, strategies: ['random'], routes: false, pacing: false, now, ...(opts.yieldEvery ? {yieldEvery: opts.yieldEvery} : {})});
      return r.endingRates.random?.[endingId] ?? 0;
    };
    routeCoverage.guidance = await routeGuidance(revision, {routeCoverage}, {seeds: gSeeds, maxSteps, now, rate, ...(g.maxHints ? {maxHints: g.maxHints} : {})});
    for (const h of routeCoverage.guidance) routeCoverage.issues.push({severity: 'warning', ruleId: 'route.guidance', endingId: h.endingId, message: h.message});
  }
  const pacing = opts.pacing === false ? undefined : diagnosePacing(world, {line: {...PACING_LINE}, ...(rnd ? {random: rnd} : {}), randomRuns: endingRates.random ? seeds : 0,
    randomByEnding, minByEnding, randomPlays});
  return {...(opts.draftId ? {draftId: opts.draftId} : {}), draftVersion: opts.draftVersion ?? 0, createdAt: now, seeds, maxSteps, timeUnit: world.clock ? 'month' : 'turn',
    strategies: strategies.map(s => ({id: s.id, label: s.label, runs: seeds})), checks, endingRates, endings, medians, resourceBands,
    cards: {neverDrawn, drawRate, consecutiveRepeatRate}, deadEnds, lockedRatio: visible ? locked / visible : 0, pinnedRatio, gatesNeverMet,
    ...(world.recap?.length || world.endings.some(e => e.passages?.length) ? {endingExtras: {
      byEnding: k15Runs, passageHits, recapHits,
      passagesNeverShown: world.endings.flatMap(e => (e.passages ?? []).map(p => `${e.id}/${p.id}`)).filter(key => !passageHits[key]),
      recapNeverShown: (world.recap ?? []).map(r => r.id).filter(id => !recapHits[id]),
      endingsWithoutRecap: world.recap?.length ? Object.entries(k15Runs).filter(([id, v]) => id !== '(none)' && v.runs > 0 && v.withRecap === 0).map(([id]) => id) : []}} : {}),
    ...(routeCoverage ? {routeCoverage} : {}),
    ...(pacing ? {pacing} : {}),
    durationMs: Date.now() - started};
}

const ROUTE_HIT_LINE = 0.2;
/**
 * Route coverage: one goal-directed strategy per authored ending (does an automatic player reach it at all?) plus one per
 * planned route. Generic rates come from the main run. Pacing is judged per ordinary route against the G1 line.
 */
async function coverRoutes(revision: WorldRevision, generic: PlaytestReport['endingRates'], genericIds: string[], planned: SimRoute[],
  seeds: number, maxSteps: number, now: string, yieldEvery?: () => Promise<void>, routeEndings: 'all' | 'uncovered' = 'all', minByEnding: Record<string, number> = {}): Promise<RouteCoverageReport> {
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
      belowPacing: judged && (medians.decisions < PACING_LINE.decisions || medians.uniqueChars < PACING_LINE.uniqueChars)});
  };
  const bestGenericOf = (endingId: string) => Math.max(0, ...genericIds.map(id => generic[id]?.[endingId] ?? 0));
  for (const e of world.endings) if (routeEndings === 'all' || bestGenericOf(e.id) < 0.05) await run({id: e.id, name: `直奔「${e.title}」`, endingIds: [e.id]}, 'ending');
  for (const r of planned) await run(r, 'plan');
  const issues: RouteCoverageReport['issues'] = [];
  const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;
  const endings: RouteCoverageReport['endings'] = world.endings.map(e => {
    const triggers = endingSources(world, e.id, suppliers).length;
    let bestGeneric = 0; let bestGenericStrategy: string | undefined;
    for (const id of genericIds) { const v = generic[id]?.[e.id] ?? 0; if (v > bestGeneric) { bestGeneric = v; bestGenericStrategy = id; } }
    const goalRate = routes.find(r => r.source === 'ending' && r.id === e.id)?.hitRate;
    const status = !triggers ? 'no-trigger' : bestGeneric >= 0.05 ? 'covered' : (goalRate ?? 0) > 0 ? 'goal-only' : 'unreached';
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
      message: `${r.source === 'plan' ? '规划路线' : '直达路线'}「${r.name}」中位 ${r.medians.decisions} 次决策 · ${r.medians.uniqueChars} 字，低于节奏线 ${PACING_LINE.decisions} 次 · ${PACING_LINE.uniqueChars} 字`});
  }
  return {seeds, pacing: {...PACING_LINE}, routes, endings, issues};
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
