/**
 * S5: check a ProductionPlan's world (rules only — prose is still a writing brief) before any text is generated:
 *  - every planned ending has a closed precondition chain: each required fact can be set, each resource threshold can be
 *    reached with the authored sources, each "seen card" requirement points at a card that can be seen that often;
 *  - key steps are actively executable (not only passive events) and not locked behind a single non-urgent one-time card;
 *  - the quickest ordinary ending is not trivially short (S3 static estimate);
 *  - a goal-directed probe actually reaches the planned routes; when none is reached the plan is blocked.
 * Generic: no world-specific ids; reuses the S1 back-chaining (suppliers / ending sources).
 */
import type { PlanCheckIssue, PlanCheckReport, WorldCondition, WorldContent, WorldEffect, WorldRevision } from '@novel-game/contracts';
import { endingSources, suppliersOf } from './goal-strategy.js';
import { keyStepsOf } from './guidance.js';
import { estimateMinSteps, initialResource } from './pacing.js';
import { probeRoutes, type SimRoute } from './simulate.js';

type Supplier = ReturnType<typeof suppliersOf>[number];
const flat = (effects: readonly WorldEffect[]): WorldEffect[] => effects.flatMap(e => e.kind === 'roll' ? [e, ...flat(e.success as WorldEffect[]), ...flat(e.failure as WorldEffect[])] : [e]);
const firesEnding = (s: Supplier) => flat(s.effects).some(e => e.kind === 'ending');
/** Plan-stage line for the quickest ordinary ending (static minimum decisions). */
export const PLAN_MIN_STEPS = 10;

export interface PlanCheckOptions {probeSeeds?: number; maxSteps?: number; probe?: boolean}

/** Optimistic upper bound: ignore gates/order, retain finite use counts, and never reject a potentially reachable cap. */
function possibleResourceMax(world: WorldContent, resourceId: string, suppliers: Supplier[]): number | undefined {
  const initial = world.resourceDefs?.[resourceId]?.max;
  if (initial === undefined) return undefined;
  const sources = suppliers.map(s => {
    const card = s.storyletId ? world.storylets?.find(sl => sl.id === s.storyletId) : undefined;
    const uses = s.key.startsWith('event:') ? 1 : card ? (card.repeat ? card.repeat.maxTimes ?? Infinity : 1)
      : world.actions.find(a => a.id === s.key)?.once ? 1 : Infinity;
    return {effects: s.effects, uses};
  });
  for (const rule of world.clock?.rules ?? []) sources.push({effects: rule.effects, uses: Math.floor(world.clock!.limitMonths / rule.everyMonths)});
  let maximum = initial;
  let extra = 0;
  for (const source of sources) {
    if (source.uses === 0) continue;
    for (const effect of flat(source.effects)) {
      if (effect.kind !== 'resource_max' || effect.resourceId !== resourceId) continue;
      if (effect.set !== undefined) maximum = Math.max(maximum, effect.set);
      if ((effect.delta ?? 0) > 0) extra += effect.delta! * source.uses;
    }
  }
  // Put positive deltas after the largest set as a safe overestimate, even if that ordering cannot actually occur.
  return maximum + extra;
}

export function checkPlanWorld(world: WorldContent, routes: SimRoute[], opts: PlanCheckOptions = {}): PlanCheckReport {
  const suppliers = suppliersOf(world);
  const defs = world.resourceDefs ?? {};
  const maxBounds = new Map(Object.keys(defs).map(id => [id, possibleResourceMax(world, id, suppliers)]));
  const facts0 = new Map(world.facts.map(f => [f.id, !!(f as {initialValue?: boolean}).initialValue]));
  const factLabel = (id: string) => world.facts.find(f => f.id === id)?.label ?? id;
  const resLabel = (id: string) => defs[id]?.label ?? id;
  const endingTitle = (id: string) => world.endings.find(e => e.id === id)?.title ?? id;
  const kindOf = (id: string) => world.endings.find(e => e.id === id)?.kind ?? 'ending';
  const isRepeatable = (s: Supplier) => s.key.startsWith('event:') ? false : s.storyletId ? !!world.storylets?.find(x => x.id === s.storyletId)?.repeat : !world.actions.find(a => a.id === s.key)?.once;
  const optLabel = (s: Supplier) => {
    if (s.key.startsWith('event:')) return world.events.find(e => `event:${e.id}` === s.key)?.label ?? s.key;
    if (s.storyletId) { const sl = world.storylets?.find(x => x.id === s.storyletId); const c = sl?.choices.find(ch => s.key === `sl__${sl.id}__${ch.id}`); return c ? `${sl!.title}·${c.label}` : s.key; }
    return world.actions.find(a => a.id === s.key)?.label ?? s.key;
  };
  const issues: PlanCheckIssue[] = [];
  const seen = new Set<string>();
  const push = (i: PlanCheckIssue) => { const k = `${i.ruleId}|${i.target ?? ''}|${i.endingId ?? ''}|${i.routeId ?? ''}`; if (!seen.has(k)) { seen.add(k); issues.push(i); } };

  // ── Closure: why can a condition never hold? (empty list = closed). Cycles are treated optimistically.
  type Open = Omit<PlanCheckIssue, 'endingId'>;
  const memo = new Map<string, Open[]>(); const stack = new Set<string>();
  const thresholdOpen = (c: Extract<WorldCondition, {kind: 'resource'}>): Open[] => {
    const id = c.resourceId; const def = defs[id]; const v0 = initialResource(world, id); const out: Open[] = [];
    const sources = suppliers.filter(s => !firesEnding(s));
    const clockGain = (sign: number) => (world.clock?.rules ?? []).some(r => r.effects.some(e => e.kind === 'resource' && e.resourceId === id && (e.delta ?? 0) * sign > 0));
    for (const [bound, sign] of [[c.atLeast, 1], [c.atMost, -1]] as const) {
      if (bound === undefined) continue;
      const need = (bound - v0) * sign; if (need <= 0) continue;
      const lim = sign > 0 ? maxBounds.get(id) : def?.min;
      if (lim !== undefined && (sign > 0 ? bound > lim : bound < lim)) {
        out.push({severity: 'error', ruleId: 'plan.threshold-open', target: id, message: `条件「${resLabel(id)}${sign > 0 ? '≥' : '≤'}${bound}」超出资源${sign > 0 ? '上限' : '下限'} ${lim}，永远无法满足`,
          suggestion: `把门槛改到 ${lim} 以内，或调整「${resLabel(id)}」的${sign > 0 ? '上限' : '下限'}`});
        continue;
      }
      const moves = sources.map(s => ({s, d: flat(s.effects).reduce((n, e) => n + (e.kind === 'resource' && e.resourceId === id && (e.delta ?? 0) * sign > 0 ? Math.abs(e.delta ?? 0) : 0), 0)})).filter(x => x.d > 0);
      if (moves.some(x => isRepeatable(x.s)) || clockGain(sign)) continue;
      const total = moves.reduce((n, x) => n + x.d, 0);
      if (total < need) out.push({severity: 'error', ruleId: 'plan.threshold-open', target: id,
        message: `条件「${resLabel(id)}${sign > 0 ? '≥' : '≤'}${bound}」不闭合：初始 ${v0}，全部一次性来源合计只能${sign > 0 ? '增加' : '减少'} ${total}${moves.length ? `（${moves.map(x => `「${optLabel(x.s)}」${x.d}`).join('、')}）` : '（没有任何来源）'}`,
        suggestion: `补一个可重复的来源，或再加 ${Math.ceil(need - total)} 点一次性来源，或降低门槛`});
    }
    return out;
  };
  function open(c: WorldCondition): Open[] {
    if (c.kind === 'anyOf') { let best: Open[] | undefined; for (const x of c.conditions) { const o = open(x); if (!best || o.length < best.length) best = o; if (!o.length) break; } return best ?? []; }
    const key = JSON.stringify(c);
    const hit = memo.get(key); if (hit) return hit;
    if (stack.has(key)) return [];
    stack.add(key);
    let out: Open[] = [];
    switch (c.kind) {
      case 'fact': {
        if (facts0.get(c.factId) === c.value) break;
        if (!world.facts.some(f => f.id === c.factId)) { out = [{severity: 'error', ruleId: 'plan.fact-unsettable', target: c.factId, message: `条件引用了不存在的事实「${c.factId}」`, suggestion: '在 facts 里补上这个事实，或改用已有事实'}]; break; }
        const setters = suppliers.filter(s => !firesEnding(s) && flat(s.effects).some(e => e.kind === 'set' && e.factId === c.factId && e.value === c.value));
        if (!setters.length) { out = [{severity: 'error', ruleId: 'plan.fact-unsettable', target: c.factId,
          message: `关键任务无法执行：需要「${factLabel(c.factId)}」为${c.value ? '真' : '假'}，但没有任何行动、卡牌选项或事件会这样设置它`,
          suggestion: `加一个能主动执行的地点行动或卡牌选项来设置「${factLabel(c.factId)}」`}]; break; }
        let best: Open[] | undefined;
        for (const s of setters) { const o = s.reqs.flatMap(open); if (!best || o.length < best.length) best = o; if (!o.length) break; }
        out = best ?? [];
        break;
      }
      case 'known': if (!world.facts.some(f => f.id === c.factId && f.playerKnown) && !suppliers.some(s => flat(s.effects).some(e => e.kind === 'reveal' && e.factId === c.factId))) out = [{severity: 'error', ruleId: 'plan.fact-unsettable', target: c.factId,
        message: `需要玩家已知「${factLabel(c.factId)}」，但没有任何选项会揭示它`, suggestion: '加一个 reveal 效果的行动或卡牌选项'}]; break;
      case 'resource': out = thresholdOpen(c); break;
      case 'storylet_seen': {
        const sl = world.storylets?.find(x => x.id === c.storyletId);
        if ((c.atLeast ?? 0) <= 0) break;
        if (!sl) out = [{severity: 'error', ruleId: 'plan.fact-unsettable', target: c.storyletId, message: `条件要求见过不存在的卡「${c.storyletId}」`, suggestion: '改成已有卡牌 id'}];
        else if ((c.atLeast ?? 1) > 1 && !sl.repeat) out = [{severity: 'error', ruleId: 'plan.threshold-open', target: sl.id, message: `条件要求见过「${sl.title}」${c.atLeast} 次，但它是一次性卡`, suggestion: '把它设为可重复，或把次数改为 1'}];
        else out = (sl.when ?? []).flatMap(open);
        break;
      }
      default: break;
    }
    stack.delete(key);
    memo.set(key, out);
    return out;
  }

  const planned = routes.length ? routes : world.endings.filter(e => kindOf(e.id) !== 'failure' && kindOf(e.id) !== 'timeout').map(e => ({id: e.id, name: e.title, endingIds: [e.id]}));
  const routeEndings = [...new Set(planned.flatMap(r => r.endingIds))];
  for (const endingId of routeEndings) {
    const sources = endingSources(world, endingId, suppliers);
    if (!sources.length) { push({severity: 'error', ruleId: 'plan.ending-no-trigger', endingId, target: endingId, message: `规划结局「${endingTitle(endingId)}」没有任何触发来源`, suggestion: '给它加 when 条件，或让某个关键选项带 ending 效果'}); continue; }
    let best: Open[] | undefined;
    for (const src of sources) { const o = [...src.reqs, ...(src.supplier?.reqs ?? [])].flatMap(open); if (!best || o.length < best.length) best = o; if (!o.length) break; }
    for (const o of best ?? []) push({...o, endingId, message: `「${endingTitle(endingId)}」：${o.message}`});
    if (kindOf(endingId) === 'failure' || kindOf(endingId) === 'timeout') continue;
    // Key steps: actively executable, and not locked behind one draw of a one-time card.
    for (const step of keyStepsOf(world, endingId, suppliers)) {
      for (const c of step.reqs) {
        if (c.kind !== 'fact' || facts0.get(c.factId) === c.value) continue;
        const setters = suppliers.filter(s => !firesEnding(s) && flat(s.effects).some(e => e.kind === 'set' && e.factId === c.factId && e.value === c.value));
        if (setters.length && setters.every(s => s.key.startsWith('event:'))) push({severity: 'warning', ruleId: 'plan.passive-only', endingId, target: c.factId,
          message: `「${endingTitle(endingId)}」的关键前置「${factLabel(c.factId)}」只能由事件被动触发（${setters.map(optLabel).join('、')}），玩家无法主动推进`,
          suggestion: '补一个地点行动或卡牌选项作为主动推进的入口'});
        const active = setters.filter(s => !s.key.startsWith('event:'));
        const cards = active.filter(s => s.storyletId).map(s => world.storylets!.find(x => x.id === s.storyletId)!);
        if (active.length && active.every(s => s.storyletId) && cards.every(sl => !sl.urgent && !sl.repeat)) push({severity: 'warning', ruleId: 'plan.draw-locked', endingId, target: c.factId,
          message: `「${endingTitle(endingId)}」的关键前置「${factLabel(c.factId)}」只能靠抽到一次性卡${[...new Set(cards.map(sl => `「${sl.title}」`))].join('、')}获得，没抽到或错过就锁死主线`,
          suggestion: '把这张卡设为 urgent 或可重复，或补一个地点行动作为保底入口'});
      }
    }
  }
  // S3 static pacing estimate at plan stage.
  const est = estimateMinSteps(world, suppliers);
  const ordinary = routeEndings.filter(id => kindOf(id) !== 'failure' && kindOf(id) !== 'timeout' && (est[id] ?? -1) >= 0);
  const shortest = ordinary.length ? Math.min(...ordinary.map(id => est[id]!)) : undefined;
  if (shortest !== undefined && shortest < PLAN_MIN_STEPS) {
    const fast = ordinary.filter(id => est[id] === shortest);
    push({severity: 'warning', ruleId: 'plan.pacing-short', target: fast.join(','), endingId: fast[0],
      message: `最快的普通结局「${fast.map(endingTitle).join('、')}」静态估计最少 ${shortest} 步就能达成（规划线 ${PLAN_MIN_STEPS}）`,
      suggestion: '在这条路线上加阶段门槛：例如需要先完成另一条事实链，或把资源门槛提高到需要多次行动'});
  }
  // Goal-directed probe of the planned routes (sync; small).
  const probe = opts.probe === false ? [] : probeRoutes({id: 'plan-check', draftId: 'plan-check', sourceId: 'plan-check', version: 1, content: world, createdAt: '2026-01-01T00:00:00.000Z'} as WorldRevision,
    planned, opts.probeSeeds ?? 8, opts.maxSteps ?? 400);
  const routeRows = planned.map(r => ({id: r.id, name: r.name, hitRate: probe.find(p => p.id === r.id)?.hitRate ?? 0}));
  if (probe.length) {
    const dead = routeRows.filter(r => r.hitRate === 0);
    if (dead.length === routeRows.length) push({severity: 'error', ruleId: 'plan.routes-dead',
      message: `定向打法 ${opts.probeSeeds ?? 8} 局内没有到达任何一条规划路线的结局（${routeRows.map(r => `「${r.name}」`).join('、')}）`,
      suggestion: issues.some(i => i.severity === 'error') ? '先修好上面列出的不闭合前置，再重新检查' : '检查各结局的前置链是否被一次性选项或互斥事实堵死；可用 scripts/s1/playtest.ts --plan 查看路线覆盖细节'});
    else for (const r of dead) push({severity: 'warning', ruleId: 'plan.route-dead', routeId: r.id, target: r.id,
      message: `规划路线「${r.name}」在定向打法 ${opts.probeSeeds ?? 8} 局内没有到达`, suggestion: '检查这条路线结局的前置链和门槛'});
  }
  const errors = issues.filter(i => i.severity === 'error').length;
  return {errors, warnings: issues.length - errors, blocking: errors > 0, issues, routes: routeRows, ...(shortest !== undefined ? {shortestOrdinary: shortest} : {})};
}
