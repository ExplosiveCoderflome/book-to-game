/**
 * Goal-directed strategies for the author-side simulator (route coverage). A goal strategy is told which endings it
 * should reach and back-chains, every step, from the authored data only: the choices / actions / events / thresholds
 * that fire a target ending, the conditions those need, the cards and actions that satisfy those conditions, and so on
 * (bounded depth). It then scores the options a player could see. No world-specific ids, no prose reading.
 *
 * It reads the full AdventureState (author tool), unlike the generic strategies that only use the projected view, so
 * conditions are evaluated by the engine's own `matches`.
 */
import { SYSTEM_WAIT_ACTION_ID, type AdventureView, type WorldCondition, type WorldContent, type WorldEffect } from '@novel-game/contracts';
import type { AdventureState } from '../adventure/adventure-state.js';
import { matches } from '../adventure/rules.js';
import type { SimOption } from './types.js';

type Base = Exclude<WorldCondition, {kind: 'anyOf'}>;
interface Supplier {key: string; storyletId?: string; locations?: string[]; reqs: WorldCondition[]; effects: WorldEffect[]}
interface Source {reqs: WorldCondition[]; supplier?: Supplier; survive?: boolean}
interface Plan {wanted: Map<string, number>; cards: Map<string, number>; resDir: Map<string, number>; locs: Map<string, number>;
  protect: Map<string, boolean>; caps: Map<string, number>; wait: number; unmet: number; seen: Set<string>}

const MAX_DEPTH = 5;
const flat = (effects: readonly WorldEffect[]): WorldEffect[] => effects.flatMap(e => e.kind === 'roll' ? [e, ...flat(e.success as WorldEffect[]), ...flat(e.failure as WorldEffect[])] : [e]);
/** Endings an option can fire (direct or inside a roll branch). */
export const endingsIn = (effects: readonly WorldEffect[]): string[] => flat(effects).flatMap(e => e.kind === 'ending' ? [e.endingId] : []);
export function expectedDelta(effects: readonly WorldEffect[], resourceId: string): number {
  let sum = 0;
  for (const e of effects) {
    if (e.kind === 'resource' && e.resourceId === resourceId) sum += e.delta ?? 0;
    if (e.kind === 'roll') sum += 0.5 * expectedDelta(e.success as WorldEffect[], resourceId) + 0.5 * expectedDelta(e.failure as WorldEffect[], resourceId);
  }
  return sum;
}

/** Every authored way an option-like thing (card choice, action, event) can change the world. */
export function suppliersOf(world: WorldContent): Supplier[] {
  const out: Supplier[] = [];
  for (const sl of world.storylets ?? []) for (const c of sl.choices) out.push({key: `sl__${sl.id}__${c.id}`, storyletId: sl.id,
    ...(sl.locationIds?.length ? {locations: sl.locationIds} : {}), reqs: [...(sl.when ?? []), ...(c.availableWhen ?? []), ...(c.requires ?? [])], effects: c.effects});
  for (const a of world.actions) out.push({key: a.id, locations: [a.locationId], reqs: [...a.availableWhen, ...a.requires], effects: a.effects});
  // Events fire on their own once `when` holds: chasing their conditions is how a player "uses" them.
  for (const ev of world.events) out.push({key: `event:${ev.id}`, reqs: ev.when, effects: ev.effects});
  return out;
}

/** Static trigger sources of an ending (also used by the coverage report to flag endings nothing can fire). */
export function endingSources(world: WorldContent, endingId: string, suppliers = suppliersOf(world)): Source[] {
  const sources: Source[] = suppliers.filter(s => endingsIn(s.effects).includes(endingId)).map(s => ({reqs: [], supplier: s}));
  const ending = world.endings.find(e => e.id === endingId);
  if (ending?.when.length) sources.push({reqs: ending.when});
  for (const [id, def] of Object.entries(world.resourceDefs ?? {})) {
    if (def.onMax?.ending === endingId && def.max !== undefined) sources.push({reqs: [{kind: 'resource', resourceId: id, atLeast: def.max}]});
    if (def.onMin?.ending === endingId) sources.push({reqs: [{kind: 'resource', resourceId: id, atMost: def.min}]});
  }
  if (world.clock?.timeoutEndingId === endingId || ending?.kind === 'timeout') sources.push({reqs: [], survive: true});
  return sources;
}

export function goalStrategy(world: WorldContent, targets: readonly string[]) {
  const suppliers = suppliersOf(world);
  const target = new Set(targets);
  const sources = targets.flatMap(id => endingSources(world, id, suppliers));
  const defs = world.resourceDefs ?? {};
  const storylets = new Map((world.storylets ?? []).map(sl => [sl.id, sl]));
  const range = (id: string) => Math.max(1, (defs[id]?.max ?? (defs[id]?.min ?? 0) + 100) - (defs[id]?.min ?? 0));
  // Static movement graph (move actions); distances by BFS on demand.
  const edges = world.actions.flatMap(a => a.effects.filter(e => e.kind === 'move').map(e => ({from: a.locationId, to: (e as {locationId: string}).locationId})));
  const distCache = new Map<string, Map<string, number>>();
  const distFrom = (to: string) => {
    let d = distCache.get(to);
    if (!d) { d = new Map([[to, 0]]); const q = [to]; while (q.length) { const at = q.shift()!; for (const e of edges) if (e.to === at && !d.has(e.from)) { d.set(e.from, d.get(at)! + 1); q.push(e.from); } } distCache.set(to, d); }
    return d;
  };
  const danger = Object.entries(defs).flatMap(([id, def]) => [
    ...(def.onMin?.ending && !target.has(def.onMin.ending) ? [{id, low: true}] : []),
    ...(def.onMax?.ending && !target.has(def.onMax.ending) && def.max !== undefined ? [{id, low: false}] : [])]);
  // Indexes: who sets / reveals / teaches a fact, who raises a resource, which card a threshold pushes.
  const index = new Map<string, Supplier[]>();
  const put = (k: string, sup: Supplier) => { const list = index.get(k) ?? []; if (!list.includes(sup)) list.push(sup); index.set(k, list); };
  for (const sup of suppliers) for (const e of flat(sup.effects)) {
    if (e.kind === 'set') put(`set:${e.factId}=${e.value}`, sup);
    if (e.kind === 'reveal') put(`reveal:${e.factId}`, sup);
    if (e.kind === 'npc_learn') put(`learn:${e.npcId}:${e.factId}`, sup);
    if (e.kind === 'resource' && (e.delta ?? 0) > 0) put(`up:${e.resourceId}`, sup);
  }
  const setters = (k: string) => index.get(k) ?? [];
  const pushedBy = new Map<string, WorldCondition>();
  for (const [id, def] of Object.entries(defs)) {
    if (def.onMax?.storylet && def.max !== undefined) pushedBy.set(def.onMax.storylet, {kind: 'resource', resourceId: id, atLeast: def.max});
    if (def.onMin?.storylet) pushedBy.set(def.onMin.storylet, {kind: 'resource', resourceId: id, atMost: def.min});
  }

  // Condition results are memoised per decision (one state, many back-chains over the same condition objects).
  let metCache = new Map<WorldCondition, boolean>();
  function plan(state: AdventureState, source: Source): Plan {
    const p: Plan = {wanted: new Map(), cards: new Map(), resDir: new Map(), locs: new Map(), protect: new Map(), caps: new Map(), wait: source.survive ? 1 : 0, unmet: 0, seen: new Set()};
    const met = (c: WorldCondition) => { let v = metCache.get(c); if (v === undefined) { v = matches([c], state, world); metCache.set(c, v); } return v; };
    const bump = (m: Map<string, number>, k: string, w: number) => m.set(k, Math.max(m.get(k) ?? 0, w));
    const addSupplier = (s: Supplier, depth: number, w: number) => {
      if ((p.wanted.get(s.key) ?? 0) >= w || p.seen.has(`${s.key}@${depth}`)) return;
      p.seen.add(`${s.key}@${depth}`);
      if (!s.key.startsWith('event:')) bump(p.wanted, s.key, w);
      // Go where a supplier is usable now; one still gated mostly sends us after its prerequisites instead.
      const ready = s.reqs.every(met);
      if (s.locations) for (const l of s.locations) bump(p.locs, l, ready ? w : w * 0.02);
      expand(s.reqs, depth + 1, w * 0.6);
      const push = s.storyletId ? pushedBy.get(s.storyletId) : undefined; // card drawn by a resource threshold
      if (push) expand([push], depth + 1, w * 0.8);
    };
    const need = (c: Base, depth: number, w: number) => {
      switch (c.kind) {
        case 'fact': for (const s of setters(`set:${c.factId}=${c.value}`)) addSupplier(s, depth, w); break;
        case 'known': for (const s of setters(`reveal:${c.factId}`)) addSupplier(s, depth, w); break;
        case 'npc_knows': for (const s of setters(`learn:${c.npcId}:${c.factId}`)) addSupplier(s, depth, w); break;
        case 'storylet_seen': {
          if ((c.atLeast ?? 1) <= 0) break; // an atMost-only gate: just don't play it (handled by not wanting it)
          const sl = storylets.get(c.storyletId); if (!sl) break;
          bump(p.cards, sl.id, w);
          const ready = (sl.when ?? []).every(met);
          for (const l of sl.locationIds ?? []) bump(p.locs, l, ready ? w : w * 0.02);
          expand(sl.when ?? [], depth + 1, w * 0.6);
          const push = pushedBy.get(sl.id); if (push) expand([push], depth + 1, w * 0.8);
          break;
        }
        case 'resource': {
          const v = state.resources?.[c.resourceId] ?? 0;
          if (c.atLeast !== undefined && v < c.atLeast) {
            p.resDir.set(c.resourceId, (p.resDir.get(c.resourceId) ?? 0) + w);
            // Milestone resources (few authored sources, e.g. 境界): chase the cards / actions that raise them too.
            const ups = setters(`up:${c.resourceId}`);
            if (ups.length <= 16) for (const s of ups) addSupplier(s, depth, w * 0.5);
          }
          // Lowering a resource only for a deeper prerequisite usually fights the goal itself; only the goal's own caps count.
          if (c.atMost !== undefined && v > c.atMost && depth <= 1) p.resDir.set(c.resourceId, (p.resDir.get(c.resourceId) ?? 0) - w);
          break;
        }
        // Waiting only helps for a window still ahead; a passed window is a dead branch.
        case 'time': if (state.elapsed < c.atLeast) p.wait = Math.max(p.wait, w); break;
        case 'clock': if ((c.atLeastMonth ?? 0) > state.elapsed && (c.atMostMonth ?? Infinity) >= state.elapsed) p.wait = Math.max(p.wait, w); break;
        default: break;
      }
    };
    function expand(conds: readonly WorldCondition[], depth: number, w: number) {
      for (const c of conds) {
        if (met(c)) {
          if (c.kind === 'fact' && depth <= 2) p.protect.set(c.factId, c.value);
          if (c.kind === 'resource' && c.atMost !== undefined && depth === 0) p.caps.set(c.resourceId, Math.min(p.caps.get(c.resourceId) ?? Infinity, c.atMost));
          continue;
        }
        if (depth <= 1) p.unmet += depth === 0 ? 1 : 0.3;
        if (depth >= MAX_DEPTH) continue;
        if (c.kind === 'anyOf') { for (const sub of c.conditions) if (!met(sub)) need(sub, depth, w * 0.7); }
        else need(c, depth, w);
      }
    }
    if (source.supplier) { p.unmet += source.supplier.reqs.filter(c => !met(c)).length ? 0 : -0.5; addSupplier(source.supplier, 0, 1); }
    expand(source.reqs, 0, 1);
    // Fallback destinations: anywhere a wanted resource can be raised (weak, so real targets win).
    for (const [rid, dw] of p.resDir) if (dw > 0) for (const s of setters(`up:${rid}`)) for (const l of s.locations ?? []) bump(p.locs, l, Math.min(0.05, 0.05 * dw));
    return p;
  }

  return (options: SimOption[], view: AdventureView, rand: () => number, state?: AdventureState): SimOption => {
    if (!state || rand() < 0.05) return options[Math.floor(rand() * options.length)]!;
    metCache = new Map();
    // Pick the source that is currently closest to firing (fewest unmet conditions in its back-chain).
    let p: Plan | undefined; let source0: Source = {reqs: []};
    for (const s of sources) { const cand = plan(state, s); if (!p || cand.unmet < p.unmet - 1e-9) { p = cand; source0 = s; } }
    p ??= plan(state, source0);
    // Hand cards holding a wanted choice that is still locked: do not burn them on another choice.
    const holding = new Set((view.hand ?? []).filter(card => card.choices.some(ch => !ch.enabled && p!.wanted.has(ch.id))).map(card => card.storyletId));
    // Where to be: the location with the most valuable wanted supplier, discounted by distance; stay when it is here.
    let goal: string | undefined; let goalValue = -Infinity;
    for (const [l, w] of p.locs) { const v = w - 0.1 * (distFrom(l).get(state.locationId) ?? 99); if (v > goalValue + 1e-9) { goalValue = v; goal = l; } }
    const goalW = goal ? p.locs.get(goal)! : 0;
    const away = goal !== undefined && goal !== state.locationId && goalW > (p.locs.get(state.locationId) ?? 0) + 1e-9;
    const here = away ? distFrom(goal!).get(state.locationId) ?? 99 : 0;
    let best = -Infinity; let pool: SimOption[] = [];
    for (const o of options) {
      let score = 0;
      const ends = endingsIn(o.effects);
      if (ends.some(e => target.has(e))) score += 1e6; else if (ends.length) score -= 1e5;
      score += 1e4 * (p.wanted.get(o.id) ?? 0);
      if (o.storyletId) {
        score += 3e3 * (p.cards.get(o.storyletId) ?? 0);
        if (holding.has(o.storyletId) && !p.wanted.has(o.id)) score -= 2e4;
      }
      for (const e of flat(o.effects)) if (e.kind === 'set' && p.protect.has(e.factId) && p.protect.get(e.factId) !== e.value) score -= 5e4;
      for (const [rid, cap] of p.caps) { const d = expectedDelta(o.effects, rid); if (d > 0 && (state.resources?.[rid] ?? 0) + d > cap) score -= 3e4; }
      for (const [rid, dw] of p.resDir) score += 2e4 * dw * expectedDelta(o.effects, rid) / range(rid) / Math.max(1, o.timeCost);
      for (const d of danger) {
        const def = defs[d.id]!; const v = state.resources?.[d.id] ?? 0; const r = range(d.id);
        const close = d.low ? 1 - (v - def.min) / r : 1 - ((def.max ?? v) - v) / r;
        // A goal that needs this resource pushed toward the danger side (e.g. 心魔 60–88 for 血灯) only fears the last stretch.
        const towards = (p.resDir.get(d.id) ?? 0) * (d.low ? -1 : 1) > 0;
        if (towards ? close > 0.9 : close > 0.6) score += (d.low ? 1 : -1) * expectedDelta(o.effects, d.id) / r * (close > 0.8 ? 3e4 : 3e3);
      }
      if (o.moves) {
        const dest = flat(o.effects).find(e => e.kind === 'move') as {locationId: string} | undefined;
        score += away && dest && (distFrom(goal!).get(dest.locationId) ?? 99) < here ? 2e3 * goalW : -200;
      }
      // Any action lets time pass; only a survive goal (timeout ending) actively prefers spending it.
      if (o.id === SYSTEM_WAIT_ACTION_ID) score += source0.survive ? 100 : -50;
      if (p.wait) score += (source0.survive ? 50 : 2) * p.wait * o.timeCost;
      if (score > best + 1e-9) { best = score; pool = [o]; } else if (Math.abs(score - best) <= 1e-9) pool.push(o);
    }
    return pool[Math.floor(rand() * pool.length)]!;
  };
}
