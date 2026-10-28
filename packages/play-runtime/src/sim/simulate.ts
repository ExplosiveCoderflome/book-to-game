/**
 * Headless playtest simulator (§6.7). Drives the SAME engine as the player package (createAdventureState /
 * advanceAdventure / projectAdventure) with scripted strategies over many seeds and aggregates a PlaytestReport.
 * Author-side only: exported via `@novel-game/play-runtime/sim`, never from the package root.
 */
import { storyletBodies, type AdventureAction, type AdventureView, type PassCheck, type PlaytestReport, type WorldContent, type WorldEffect, type WorldRevision } from '@novel-game/contracts';
import type { AdventureState } from '../adventure/adventure-state.js';
import { advanceAdventure } from '../adventure/advance-adventure.js';
import { projectAdventure } from '../adventure/project-adventure.js';
import { createAdventureState } from '../adventure/start-adventure.js';
import { formatMonths } from '../adventure/s1-core.js';

export interface SimOption {id: string; label: string; enabled: boolean; timeCost: number; effects: WorldEffect[]; fromHand: boolean; storyletId?: string; moves: boolean}
export interface Strategy {id: string; label: string; pick(options: SimOption[], view: AdventureView, rand: () => number): SimOption}
export interface SimulateOptions {seeds?: number; maxSteps?: number; strategies?: string[]; now?: string; draftId?: string; draftVersion?: number;
  /** Cooperative yield between runs (server passes setImmediate); keeps the event loop responsive. */
  yieldEvery?: () => Promise<void>}

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
  const prefer = (want: string, fallback: number) => (ids.includes(want) ? want : ids[fallback] ?? ids[0] ?? '');
  const growth = prefer('xiuwei', 0); const money = prefer('lingshi', 1);
  // 魔道: chase the resource whose max ends the game (xinmo in 《寿灯》).
  const dark = ids.includes('xinmo') ? 'xinmo' : ids.find(id => defs[id]!.onMax?.ending) ?? growth;
  const label = (id: string) => defs[id]?.label ?? id;
  return [
    {id: 'random', label: '随机', pick: (o, _v, r) => pickRandom(o, r)},
    {id: `greedy-${growth}`, label: `只顾${label(growth)}`, pick: greedy(growth)},
    {id: `greedy-${money}`, label: `只顾${label(money)}`, pick: greedy(money)},
    {id: 'modao', label: '魔道优先', pick: greedy(dark)},
    {id: 'merchant', label: `跑商（攒${label(money)}）`, pick: merchantStrategy(world, money)},
    {id: 'lazy', label: '只修炼', pick: (options, _v, r) => {
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
  passageIds: string[]; recapIds: string[]}

function runOne(revision: WorldRevision, strategy: Strategy, seed: number, maxSteps: number, now: string): RunResult {
  const world = revision.content;
  const rand = mulberry(seed ^ 0x9E3779B9);
  let state: AdventureState = createAdventureState(revision, `sim-${strategy.id}-${seed}`, now, {}, seed);
  const seen = new Set<string>(); let chars = 0;
  const read = (text: string | undefined) => { if (text && !seen.has(text)) { seen.add(text); chars += [...text.replace(/\s+/g, '')].length; } };
  const defs = world.resourceDefs ?? {};
  const samples: Record<string, number[]> = {}; const pinned: Record<string, number> = {};
  const res: RunResult = {ending: '(none)', decisions: 0, uniqueChars: 0, months: 0, deadEnd: false, samples, drawn: new Set(), plays: 0, repeats: 0,
    visible: 0, locked: 0, pinned, steps: 0, costSteps: 0, enabledIds: new Set(), visibleLockedIds: new Set(), passageIds: [], recapIds: []};
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
    const pick = strategy.pick(enabled, view, rand);
    if (pick.storyletId) {
      res.plays++; if (pick.storyletId === lastPlayed) res.repeats++; lastPlayed = pick.storyletId;
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
  for (const strategy of strategies) {
    const counts: Record<string, number> = {}; const decisions: number[] = []; const unique: number[] = []; const months: number[] = [];
    for (let i = 0; i < seeds; i++) {
      const r = runOne(revision, strategy, i + 1, maxSteps, now);
      counts[r.ending] = (counts[r.ending] ?? 0) + 1;
      const k = (k15Runs[r.ending] ??= {runs: 0, withRecap: 0, passages: 0}); k.runs++; if (r.recapIds.length) k.withRecap++; k.passages += r.passageIds.length;
      for (const id of r.passageIds) passageHits[`${r.ending}/${id}`] = (passageHits[`${r.ending}/${id}`] ?? 0) + 1;
      for (const id of r.recapIds) recapHits[id] = (recapHits[id] ?? 0) + 1;
      decisions.push(r.decisions); unique.push(r.uniqueChars); months.push(r.months);
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
  const checks: PassCheck[] = [
    {id: 'G1', label: '时长', line: '「随机」首通中位数 ≥ 60 次决策且 ≥ 10,000 字不重复正文', measured: rnd ? `${rnd.decisions} 次决策 · ${rnd.uniqueChars} 字 · ${formatMonths(rnd.months)}` : '未运行「随机」', pass: !!rnd && rnd.decisions >= 60 && rnd.uniqueChars >= 10000},
    {id: 'G2', label: '结局', line: '每个结局至少 1 种策略 ≥ 5%；「随机」任一结局 ≤ 60%', measured: `${endings.length - unreached.length}/${endings.length} 个结局达标${unreached.length ? `（未达：${unreached.map(e => e.title).join('、')}）` : ''} · 「随机」最高 ${pct(randomMax)}`, pass: !unreached.length && randomMax <= 0.6},
    {id: 'G4', label: '卡池', line: '连续两回合同一张 = 0 次；没有从未抽到的卡', measured: `连续重复 ${repeats} 次（${pct(consecutiveRepeatRate)}）· 从未抽到 ${neverDrawn.length} 张`, pass: repeats === 0 && neverDrawn.length === 0},
    {id: 'G6', label: '时钟', line: '时限结局在「偷懒」策略下可达', measured: endingRates.lazy ? `「只修炼」（偷懒）时限结局 ${pct(lazyTimeout)}` : '未运行「只修炼」（偷懒）', pass: lazyTimeout > 0},
    {id: 'G8', label: '取舍', line: '每回合可见选项里 ≥ 1 个有代价；0 死路', measured: `有代价回合 ${pct(steps ? costSteps / steps : 0)} · 死路 ${deadEnds} · 锁定选项 ${pct(visible ? locked / visible : 0)}`, pass: steps > 0 && costSteps === steps && deadEnds === 0},
  ];
  return {...(opts.draftId ? {draftId: opts.draftId} : {}), draftVersion: opts.draftVersion ?? 0, createdAt: now, seeds, maxSteps,
    strategies: strategies.map(s => ({id: s.id, label: s.label, runs: seeds})), checks, endingRates, endings, medians, resourceBands,
    cards: {neverDrawn, drawRate, consecutiveRepeatRate}, deadEnds, lockedRatio: visible ? locked / visible : 0, pinnedRatio, gatesNeverMet,
    ...(world.recap?.length || world.endings.some(e => e.passages?.length) ? {endingExtras: {
      byEnding: k15Runs, passageHits, recapHits,
      passagesNeverShown: world.endings.flatMap(e => (e.passages ?? []).map(p => `${e.id}/${p.id}`)).filter(key => !passageHits[key]),
      recapNeverShown: (world.recap ?? []).map(r => r.id).filter(id => !recapHits[id]),
      endingsWithoutRecap: world.recap?.length ? Object.entries(k15Runs).filter(([id, v]) => id !== '(none)' && v.runs > 0 && v.withRecap === 0).map(([id]) => id) : []}} : {}),
    durationMs: Date.now() - started};
}
