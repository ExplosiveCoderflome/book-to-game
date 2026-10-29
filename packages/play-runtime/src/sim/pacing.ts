/**
 * S3 pacing: (1) a static estimate of the fewest decisions that can reach each ending — a relaxed plan over the authored
 * data (fact chains, resource grinding at the best per-step gain, travel between the locations involved, clock waits),
 * usable at plan stage before any prose exists; (2) when the 「随机」 run is below the G1 pacing line, concrete causes with a
 * fix each: endings that fire too early (cheap single-resource thresholds), failures that arrive too fast, a clock that
 * allows too few decisions, repeatable cards without text variants, too little authored text overall.
 */
import type { PacingCause, PacingReport, PacingEstimateRow, WorldCondition, WorldContent, WorldEffect } from '@novel-game/contracts';
import { endingSources, expectedDelta, suppliersOf } from './goal-strategy.js';

type Supplier = ReturnType<typeof suppliersOf>[number];
interface RelaxedPlan {keys: Set<string>; grind: Map<string, number>; locs: Set<string>; waitMonths: number}
const INF = 1e9;
const flat = (effects: readonly WorldEffect[]): WorldEffect[] => effects.flatMap(e => e.kind === 'roll' ? [e, ...flat(e.success as WorldEffect[]), ...flat(e.failure as WorldEffect[])] : [e]);
const firesEnding = (s: Supplier) => flat(s.effects).some(e => e.kind === 'ending');

export function initialResource(world: WorldContent, id: string): number {
  const def = world.resourceDefs?.[id];
  return def?.initial ?? world.resources?.[id] ?? def?.min ?? 0;
}
/** Longest time cost of any option (months with a clock, turns otherwise): the fastest way to burn the clock. */
const timeCosts = (world: WorldContent) => [...world.actions.map(a => a.timeCost), ...(world.storylets ?? []).flatMap(s => s.choices.map(c => c.timeCost ?? 1))];

export function estimateMinSteps(world: WorldContent, suppliers = suppliersOf(world)): Record<string, number> {
  const facts0 = new Map(world.facts.map(f => [f.id, !!(f as {initialValue?: boolean}).initialValue]));
  const plain = suppliers.filter(s => !s.key.startsWith('event:') && !firesEnding(s));
  // Only options a player can take again and again can be ground; a one-time card / action gives its delta once.
  const repeatable = (s: Supplier) => s.storyletId ? !!world.storylets?.find(x => x.id === s.storyletId)?.repeat : !world.actions.find(a => a.id === s.key)?.once;
  const tcOf = (s: Supplier) => s.storyletId ? (world.storylets?.find(x => x.id === s.storyletId)?.choices.find(c => s.key === `sl__${s.storyletId}__${c.id}`)?.timeCost ?? 1) : (world.actions.find(a => a.id === s.key)?.timeCost ?? 1);
  const maxTc = Math.max(1, ...plain.filter(repeatable).map(tcOf));
  // Movement graph for travel cost.
  const edges = world.actions.flatMap(a => a.effects.filter(e => e.kind === 'move').map(e => [a.locationId, (e as {locationId: string}).locationId] as const));
  const dist = (from: string, to: string) => {
    if (from === to) return 0;
    const seen = new Map([[from, 0]]); const q = [from];
    while (q.length) { const at = q.shift()!; for (const [a, b] of edges) if (a === at && !seen.has(b)) { seen.set(b, seen.get(at)! + 1); if (b === to) return seen.get(b)!; q.push(b); } }
    return 3;
  };
  const travel = (locs: Set<string>) => {
    let at = world.initialLocationId; let n = 0; const left = new Set(locs); left.delete(at);
    while (left.size) { let best = ''; let bd = INF; for (const l of left) { const d = dist(at, l); if (d < bd) { bd = d; best = l; } } n += bd; at = best; left.delete(best); }
    return n;
  };
  const size = (p: RelaxedPlan) => {
    if (!Number.isFinite(p.waitMonths)) return INF;
    let n = [...p.keys].filter(k => !k.startsWith('event:')).length + travel(p.locs);
    for (const g of p.grind.values()) n += g;
    return Math.max(n, Math.ceil(p.waitMonths / maxTc));
  };
  const empty = (): RelaxedPlan => ({keys: new Set(), grind: new Map(), locs: new Set(), waitMonths: 0});
  const merge = (a: RelaxedPlan, b: RelaxedPlan): RelaxedPlan => {
    const g = new Map(a.grind); for (const [k, v] of b.grind) g.set(k, Math.max(g.get(k) ?? 0, v));
    return {keys: new Set([...a.keys, ...b.keys]), grind: g, locs: new Set([...a.locs, ...b.locs]), waitMonths: Math.max(a.waitMonths, b.waitMonths)};
  };
  const impossible = (): RelaxedPlan => ({...empty(), waitMonths: Infinity});
  // Memoised per pass; cycles are cut with the previous pass's value, so a few passes settle order effects.
  let memo = new Map<string, RelaxedPlan>(); let prev = new Map<string, RelaxedPlan>();
  const stack = new Set<string>();
  const viaSupplier = (s: Supplier): RelaxedPlan => {
    const p = planReqs(s.reqs);
    const out = merge(p, {...empty(), keys: new Set([s.key])});
    if (s.locations?.length) out.locs.add(s.locations.includes(world.initialLocationId) ? world.initialLocationId : s.locations[0]!);
    return out;
  };
  const cheapest = (cands: Supplier[]): RelaxedPlan => {
    let best = impossible(); let bs = INF;
    for (const s of cands) { const p = viaSupplier(s); const n = size(p); if (n < bs) { bs = n; best = p; } }
    return best;
  };
  const grindFor = (resourceId: string, need: number, up: boolean): RelaxedPlan => {
    if (need <= 0) return empty();
    let best = impossible(); let bs = INF;
    for (const s of plain) {
      const d = expectedDelta(s.effects, resourceId) * (up ? 1 : -1);
      if (d <= 0 || (!repeatable(s) && d < need)) continue;
      const base = viaSupplier(s);
      const reps = Math.ceil(need / d);
      const p = merge(base, {...empty(), grind: new Map([[`${resourceId}:${up ? '+' : '-'}`, reps - 1]])});
      const n = size(p); if (n < bs) { bs = n; best = p; }
    }
    // Passive clock rules (e.g. a yearly −1): wait them out at the longest repeatable time cost per decision.
    for (const r of world.clock?.rules ?? []) {
      const d = r.effects.reduce((n, e) => n + (e.kind === 'resource' && e.resourceId === resourceId ? (e.delta ?? 0) : 0), 0) * (up ? 1 : -1);
      if (d <= 0) continue;
      const reps = Math.ceil(need / (d * maxTc / r.everyMonths));
      if (reps < bs) { bs = reps; best = {...empty(), grind: new Map([[`${resourceId}:${up ? '+' : '-'}`, reps]])}; }
    }
    return best;
  };
  function planCond(c: WorldCondition): RelaxedPlan {
    if (c.kind === 'anyOf') { let best = impossible(); let bs = INF; for (const x of c.conditions) { const p = planCond(x); const n = size(p); if (n < bs) { bs = n; best = p; } } return best; }
    const key = JSON.stringify(c);
    const hit = memo.get(key); if (hit) return hit;
    if (stack.has(key)) return prev.get(key) ?? impossible(); // cycle: use the previous pass's value
    stack.add(key);
    let out: RelaxedPlan;
    switch (c.kind) {
      case 'fact': out = facts0.get(c.factId) === c.value ? empty()
        : cheapest(suppliers.filter(s => !firesEnding(s) && flat(s.effects).some(e => e.kind === 'set' && e.factId === c.factId && e.value === c.value))); break;
      case 'known': out = world.facts.some(f => f.id === c.factId && f.playerKnown) ? empty()
        : cheapest(suppliers.filter(s => !firesEnding(s) && flat(s.effects).some(e => e.kind === 'reveal' && e.factId === c.factId))); break;
      case 'resource': {
        const v0 = initialResource(world, c.resourceId);
        out = empty();
        if (c.atLeast !== undefined) out = merge(out, grindFor(c.resourceId, c.atLeast - v0, true));
        if (c.atMost !== undefined) out = merge(out, grindFor(c.resourceId, v0 - c.atMost, false));
        break;
      }
      case 'clock': out = {...empty(), waitMonths: c.atLeastMonth ?? 0}; break;
      case 'time': out = {...empty(), waitMonths: c.atLeast}; break;
      case 'storylet_seen': {
        const sl = world.storylets?.find(x => x.id === c.storyletId);
        out = (c.atLeast ?? 0) > 0 && sl ? merge(planReqs(sl.when ?? []), {...empty(), keys: new Set([`seen:${sl.id}`]), grind: new Map([[`seen:${sl.id}`, (c.atLeast ?? 1) - 1]])}) : empty();
        break;
      }
      default: out = empty();
    }
    stack.delete(key);
    memo.set(key, out);
    return out;
  }
  function planReqs(reqs: readonly WorldCondition[]): RelaxedPlan { return reqs.reduce((p, c) => merge(p, planCond(c)), empty()); }
  const result: Record<string, number> = {};
  const limit = world.clock?.limitMonths ?? world.timeLimit;
  const sources = new Map(world.endings.map(e => [e.id, endingSources(world, e.id, suppliers)]));
  for (let pass = 0; pass < 3; pass++) {
    for (const list of sources.values()) for (const src of list) if (!src.survive) src.supplier ? viaSupplier(src.supplier) : planReqs(src.reqs);
    prev = memo; memo = new Map();
  }
  memo = prev;
  for (const e of world.endings) {
    let best = INF;
    for (const src of sources.get(e.id)!) {
      const n = src.survive ? (limit ? Math.ceil(limit / maxTc) : INF) : size(src.supplier ? viaSupplier(src.supplier) : planReqs(src.reqs));
      best = Math.min(best, n);
    }
    result[e.id] = best >= INF ? -1 : best;
  }
  return result;
}

/** Unique body text authored in the world (what a reader could ever see). */
export function authoredChars(world: WorldContent): number {
  const texts = new Set<string>();
  const add = (t?: string) => { if (t) texts.add(t); };
  for (const l of world.locations) add(l.text);
  for (const a of world.actions) add(a.text);
  for (const s of world.storylets ?? []) { add(s.text); for (const v of s.textVariants ?? []) add(v); for (const v of s.textCases ?? []) add(v.text); for (const c of s.choices) add(c.text); }
  for (const e of world.endings) { add(e.text); for (const p of e.passages ?? []) add(p.text); }
  for (const ev of world.events) add((ev as {text?: string}).text);
  let n = 0; for (const t of texts) n += [...t.replace(/\s+/g, '')].length;
  return n;
}

export interface PacingInput {
  line: {decisions: number; uniqueChars: number};
  random?: {decisions: number; uniqueChars: number; months: number};
  randomRuns: number;
  /** Decisions of each 「随机」 run, by ending id (or `(none)`). */
  randomByEnding: Record<string, number[]>;
  /** Fewest decisions seen per ending over every simulated run. */
  minByEnding: Record<string, number>;
  /** Storylet plays summed over 「随机」 runs. */
  randomPlays: Record<string, number>;
}

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2 + 0.5)]! : 0; };
const pct = (x: number) => `${Math.round(x * 100)}%`;

export function diagnosePacing(world: WorldContent, input: PacingInput): PacingReport {
  const suppliers = suppliersOf(world);
  const est = estimateMinSteps(world, suppliers);
  const defs = world.resourceDefs ?? {};
  const label = (id: string) => defs[id]?.label ?? id;
  const optLabel = (s: Supplier) => {
    if (s.storyletId) { const sl = world.storylets?.find(x => x.id === s.storyletId); const c = sl?.choices.find(ch => s.key === `sl__${sl.id}__${ch.id}`); return c ? `${sl!.title}·${c.label}` : s.key; }
    return world.actions.find(a => a.id === s.key)?.label ?? s.key;
  };
  const rows: PacingEstimateRow[] = world.endings.map(e => {
    const runs = input.randomByEnding[e.id] ?? [];
    return {endingId: e.id, title: e.title, kind: e.kind ?? 'ending', estimateMin: est[e.id] ?? -1,
      ...(input.minByEnding[e.id] !== undefined ? {simulatedMin: input.minByEnding[e.id]} : {}),
      randomShare: input.randomRuns ? runs.length / input.randomRuns : 0, ...(runs.length ? {randomMedian: median(runs)} : {})};
  });
  const ordinary = rows.filter(r => r.kind !== 'failure' && r.kind !== 'timeout' && r.estimateMin >= 0);
  const chars = authoredChars(world);
  const rnd = input.random;
  const belowLine = !!rnd && (rnd.decisions < input.line.decisions || rnd.uniqueChars < input.line.uniqueChars);
  const causes: PacingCause[] = [];
  if (rnd && belowLine) {
    const shortRuns = rnd.decisions < input.line.decisions;
    const half = Math.ceil(input.line.decisions / 2);
    for (const r of rows) {
      if (!shortRuns || r.kind === 'timeout' || r.randomShare < 0.15 || (r.randomMedian ?? INF) >= input.line.decisions) continue;
      const sources = endingSources(world, r.endingId, suppliers);
      const thresholds = sources.flatMap(s => s.supplier ? [] : s.reqs.length && s.reqs.every(c => c.kind === 'resource') ? s.reqs as Extract<WorldCondition, {kind: 'resource'}>[] : []);
      if (thresholds.length) {
        const t = thresholds[0]!; const up = t.atLeast !== undefined; const thr = (up ? t.atLeast : t.atMost)!;
        const v0 = initialResource(world, t.resourceId);
        const pushers = suppliers.filter(s => !s.key.startsWith('event:')).map(s => ({s, d: expectedDelta(s.effects, t.resourceId) * (up ? 1 : -1)})).filter(x => x.d > 0).sort((a, b) => b.d - a.d);
        const g = pushers[0]?.d ?? 1;
        const names = pushers.slice(0, 3).map(x => `「${optLabel(x.s)}」${up ? '+' : '−'}${Math.round(x.d * 10) / 10}`).join('、');
        const cmp = `${label(t.resourceId)}${up ? '≥' : '≤'}${thr}`;
        const base = `「${r.title}」占随机 ${pct(r.randomShare)}，中位 ${r.randomMedian} 步就结束：只需「${cmp}」（初始 ${v0}；${names || '无直接来源'}；最少约 ${r.estimateMin} 步）`;
        if (r.kind === 'failure') {
          causes.push({ruleId: 'pacing.fast-failure', endingId: r.endingId, resourceId: t.resourceId, share: r.randomShare, message: base,
            suggestion: `降低这些选项对「${label(t.resourceId)}」的${up ? '增量' : '消耗'}，或加入随时间回落/可主动${up ? '降低' : '恢复'}的手段，使随机局通常能撑过 ${input.line.decisions} 步`});
        } else {
          const target = up ? v0 + g * half : v0 - g * half;
          const max = up ? defs[t.resourceId]?.max : defs[t.resourceId]?.min;
          const capped = max !== undefined && (up ? target > max : target < max);
          causes.push({ruleId: 'pacing.early-ending', endingId: r.endingId, resourceId: t.resourceId, share: r.randomShare, message: base,
            suggestion: capped ? `门槛已接近上限，建议再加一个需要多步达成的事实前置（例如某条关键链的结果），而不只是累计「${label(t.resourceId)}」`
              : `把门槛提高到约 ${label(t.resourceId)}${up ? '≥' : '≤'}${Math.round(target)}（最少步数约 ${half}），或再加一个需要多步达成的事实前置`});
        }
      } else if (r.kind !== 'failure') {
        causes.push({ruleId: 'pacing.early-ending', endingId: r.endingId, share: r.randomShare,
          message: `「${r.title}」占随机 ${pct(r.randomShare)}，中位 ${r.randomMedian} 步就结束；静态估计最少 ${r.estimateMin} 步`,
          suggestion: `在它的前置链上加中间步骤（新的事实或资源门槛），让最少步数接近 ${half}`});
      } else {
        causes.push({ruleId: 'pacing.fast-failure', endingId: r.endingId, share: r.randomShare,
          message: `失败结局「${r.title}」占随机 ${pct(r.randomShare)}，中位 ${r.randomMedian} 步`, suggestion: '让触发它的选项更少出现或更晚可用，并给出可见的预警'});
      }
    }
    const limit = world.clock?.limitMonths;
    const timeoutShare = rows.filter(r => r.kind === 'timeout').reduce((n, r) => n + r.randomShare, 0);
    if (shortRuns && limit && timeoutShare >= 0.15) {
      const tcs = timeCosts(world); const mean = tcs.length ? tcs.reduce((a, b) => a + b, 0) / tcs.length : 1;
      const cap = Math.round(limit / Math.max(0.1, mean));
      if (cap < input.line.decisions * 1.2) causes.push({ruleId: 'pacing.clock-short', share: timeoutShare,
        message: `时限 ${limit} 个月，选项平均耗时 ${Math.round(mean * 10) / 10} 个月 → 一局最多约 ${cap} 次决策；${pct(timeoutShare)} 的随机局在时限结束`,
        suggestion: `把时限延长到约 ${Math.ceil(input.line.decisions * 1.2 * mean)} 个月，或把常用行动改成 0 耗时/更短耗时`});
    }
    if (rnd.uniqueChars < input.line.uniqueChars) {
      const runs = Math.max(1, input.randomRuns);
      for (const sl of world.storylets ?? []) {
        if (!sl.repeat || (sl.textVariants?.length ?? 0) + (sl.textCases?.length ?? 0) >= 2) continue;
        const per = (input.randomPlays[sl.id] ?? 0) / runs;
        if (per >= 1.5) causes.push({ruleId: 'pacing.repeat-no-variants', storyletId: sl.id, share: per,
          message: `可重复卡「${sl.title}」没有正文变体，随机一局平均打出 ${Math.round(per * 10) / 10} 次，重复部分不计入不重复字数`,
          suggestion: '按资源档位或事实给它加 2–3 个 textVariants，或限制 maxTimes'});
      }
      if (chars < input.line.uniqueChars * 1.5) causes.push({ruleId: 'pacing.thin-text',
        message: `全部正文合计约 ${chars} 字，随机一局读到 ${rnd.uniqueChars} 字（线 ${input.line.uniqueChars}）`,
        suggestion: `正文总量至少要到线的 1.5 倍（约 ${Math.ceil(input.line.uniqueChars * 1.5)} 字）：扩写地点/卡牌/结局文本，或给高频卡加变体`});
    }
    // Endings / clock first (by share of random runs), then text causes.
    const rank = (c: PacingCause) => c.ruleId === 'pacing.repeat-no-variants' ? 1 : c.ruleId === 'pacing.thin-text' ? 2 : 0;
    causes.sort((a, b) => rank(a) - rank(b) || (b.share ?? 0) - (a.share ?? 0));
  }
  return {line: input.line, ...(rnd ? {random: rnd} : {}), belowLine, causes,
    estimate: {rows, ...(ordinary.length ? {shortestOrdinary: Math.min(...ordinary.map(r => r.estimateMin))} : {}), authoredChars: chars}};
}
