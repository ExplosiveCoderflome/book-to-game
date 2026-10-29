/**
 * S2 route guidance under random play. For an ending only a goal-directed strategy reaches ("goal-only"), find its key
 * steps by back-chaining from the authored data (the option that fires it, the facts that option needs, who sets those …),
 * propose generic content edits, and keep only the edits that measurably help the random strategy on the same seeds:
 *
 *  - gate-trap: an option that sets a fact a key step needs the other way (e.g. betraying the ally before ever meeting him)
 *    gets the key step's own positive fact requirements as extra conditions, so it cannot fire before the chain starts;
 *  - nudge-card: a location-bound key action is offered as an urgent storylet everywhere once its requirements hold
 *    (placeholder prose — lint flags it until the author rewrites it);
 *  - weight: a key storylet's base weight is raised.
 *
 * Pure suggestions: `applyGuidance` returns a new world; nothing is written back without the author.
 */
import type { GuidanceEdit, PlaytestReport, RouteGuidanceHint, Storylet, WorldCondition, WorldContent, WorldEffect, WorldRevision } from '@novel-game/contracts';
import { endingSources, suppliersOf } from './goal-strategy.js';

type Supplier = ReturnType<typeof suppliersOf>[number];
const MAX_DEPTH = 4;
const flat = (effects: readonly WorldEffect[]): WorldEffect[] => effects.flatMap(e => e.kind === 'roll' ? [e, ...flat(e.success as WorldEffect[]), ...flat(e.failure as WorldEffect[])] : [e]);
const factReqs = (reqs: readonly WorldCondition[]) => reqs.flatMap(c => c.kind === 'fact' ? [c] : []);

/** Key steps (play order: earliest first) for an ending, from static data only. */
export function keyStepsOf(world: WorldContent, endingId: string, suppliers = suppliersOf(world)): Supplier[] {
  const firing = endingSources(world, endingId, suppliers).flatMap(s => s.supplier && !s.supplier.key.startsWith('event:') ? [s.supplier] : []);
  if (!firing.length) return [];
  const simplest = (list: Supplier[]) => [...list].sort((a, b) => factReqs(a.reqs).length - factReqs(b.reqs).length || a.key.localeCompare(b.key))[0]!;
  const chain: Supplier[] = [];
  const visit = (sup: Supplier, depth: number) => {
    if (chain.includes(sup)) return;
    chain.unshift(sup);
    if (depth >= MAX_DEPTH) return;
    for (const c of factReqs(sup.reqs)) {
      if (c.value !== true) continue; // false facts hold from the start unless something sets them: handled as traps
      const setters = suppliers.filter(s => s !== sup && !s.key.startsWith('event:') && flat(s.effects).some(e => e.kind === 'set' && e.factId === c.factId && e.value === true));
      if (setters.length) visit(simplest(setters), depth + 1);
    }
  };
  visit(simplest(firing), 0);
  return chain;
}

const labelOf = (world: WorldContent, sup: Supplier): string => {
  if (sup.storyletId) { const sl = world.storylets?.find(s => s.id === sup.storyletId); const c = sl?.choices.find(ch => sup.key === `sl__${sl.id}__${ch.id}`); return c?.label ?? sl?.title ?? sup.key; }
  return world.actions.find(a => a.id === sup.key)?.label ?? sup.key;
};
const factLabel = (world: WorldContent, id: string) => world.facts.find(f => f.id === id)?.label ?? id;
const safeId = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 70);

/** Candidate edits for one ending (generic; no world-specific ids). */
export function candidateEdits(world: WorldContent, endingId: string, suppliers = suppliersOf(world)): {steps: Supplier[]; edits: GuidanceEdit[]} {
  const steps = keyStepsOf(world, endingId, suppliers);
  const edits: GuidanceEdit[] = [];
  const inChain = new Set(steps.map(s => s.key));
  // Traps: options outside the chain that flip a fact a key step needs.
  for (const step of steps) {
    const positives = factReqs(step.reqs).filter(c => c.value === true);
    for (const need of factReqs(step.reqs)) {
      for (const trap of suppliers) {
        if (inChain.has(trap.key) || trap.key.startsWith('event:')) continue;
        if (!flat(trap.effects).some(e => e.kind === 'set' && e.factId === need.factId && e.value !== need.value)) continue;
        const add = positives.filter(p => p.factId !== need.factId && !trap.reqs.some(r => r.kind === 'fact' && r.factId === p.factId)).map(p => ({kind: 'fact', factId: p.factId, value: true}) as WorldCondition);
        if (!add.length || edits.some(e => e.kind === 'gate-trap' && (e.target.actionId ?? `${e.target.storyletId}/${e.target.choiceId}`) === (trap.storyletId ? `${trap.storyletId}/${trap.key.slice(`sl__${trap.storyletId}__`.length)}` : trap.key))) continue;
        const target = trap.storyletId ? {storyletId: trap.storyletId, choiceId: trap.key.slice(`sl__${trap.storyletId}__`.length)} : {actionId: trap.key};
        edits.push({kind: 'gate-trap', target, label: labelOf(world, trap), blocks: labelOf(world, step), add, addLabels: add.map(c => c.kind === 'fact' ? factLabel(world, c.factId) : c.kind)});
      }
    }
  }
  // Location-bound key actions → nudge cards; key storylets → weight.
  const usedIds = new Set((world.storylets ?? []).map(s => s.id));
  for (const step of steps) {
    if (step.storyletId) {
      const sl = world.storylets?.find(s => s.id === step.storyletId);
      const base = sl?.weight?.base ?? 1;
      if (sl && !edits.some(e => e.kind === 'weight' && e.storyletId === sl.id)) edits.push({kind: 'weight', storyletId: sl.id, label: sl.title, from: base, to: Math.min(1000, Math.max(base * 3, base + 2))});
      continue;
    }
    const action = world.actions.find(a => a.id === step.key);
    if (!action) continue;
    const sets = flat(action.effects).filter(e => e.kind === 'set') as Extract<WorldEffect, {kind: 'set'}>[];
    const baseId = safeId(`guide_${action.id}`);
    let id = baseId;
    for (let n = 2; usedIds.has(id); n++) {
      const suffix = `_${n}`;
      id = `${baseId.slice(0, 70 - suffix.length)}${suffix}`;
    }
    usedIds.add(id);
    const card: Storylet = {id, title: action.label, kind: 'trigger', urgent: true,
      when: [...action.availableWhen, ...action.requires, ...sets.map(e => ({kind: 'fact', factId: e.factId, value: !e.value}) as WorldCondition)].slice(0, 20),
      text: `（路线提示，待改写）${action.label}`,
      // One choice: the card stays in hand until played (other actions remain available), so no 「以后再说」 is needed.
      choices: [{id: 'go', label: action.label, timeCost: action.timeCost, effects: action.effects, text: action.text}]};
    edits.push({kind: 'nudge-card', label: action.label, fromActionId: action.id, card});
  }
  return {steps, edits};
}

/** Returns a new world with the edits applied (input untouched). */
export function applyGuidance(world: WorldContent, edits: readonly GuidanceEdit[]): WorldContent {
  const w: WorldContent = structuredClone(world);
  for (const e of edits) {
    if (e.kind === 'gate-trap') {
      if (e.target.actionId) { const a = w.actions.find(x => x.id === e.target.actionId); if (a) a.requires = [...a.requires, ...e.add]; }
      else { const c = w.storylets?.find(s => s.id === e.target.storyletId)?.choices.find(ch => ch.id === e.target.choiceId); if (c) c.requires = [...(c.requires ?? []), ...e.add]; }
    } else if (e.kind === 'nudge-card') {
      if (!(w.storylets ?? []).some(s => s.id === e.card.id)) w.storylets = [...(w.storylets ?? []), structuredClone(e.card)];
    } else {
      const sl = w.storylets?.find(s => s.id === e.storyletId); if (sl) sl.weight = {...(sl.weight ?? {}), base: e.to};
    }
  }
  return w;
}

export interface GuidanceOptions {seeds?: number; maxSteps?: number; maxHints?: number; now?: string;
  /** Random-strategy rate of an ending for a world (injected: the simulator passes its own runner). */
  rate: (world: WorldContent, endingId: string) => Promise<number>}

const describe = (world: WorldContent, e: GuidanceEdit): string => e.kind === 'gate-trap'
  ? `「${e.label}」改为须先满足${e.add.map(c => c.kind === 'fact' ? `「${factLabel(world, c.factId)}」` : '').join('、')}（否则会堵死「${e.blocks}」）`
  : e.kind === 'nudge-card' ? `新增路线提示卡「${e.label}」（条件满足时在各地出现）` : `剧情卡「${e.label}」权重 ${e.from} → ${e.to}`;

/** S2 entry: hints for the report's goal-only endings, best first, capped at `maxHints` (default 3). */
export async function routeGuidance(revision: WorldRevision, report: Pick<PlaytestReport, 'routeCoverage'>, opts: GuidanceOptions): Promise<RouteGuidanceHint[]> {
  const world = revision.content;
  const rc = report.routeCoverage;
  if (!rc) return [];
  const seeds = opts.seeds ?? 100;
  const suppliers = suppliersOf(world);
  const hints: RouteGuidanceHint[] = [];
  const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;
  for (const e of rc.endings.filter(x => x.status === 'goal-only' && x.kind !== 'failure')) { // failure endings need no guidance
    const {steps, edits} = candidateEdits(world, e.id, suppliers);
    if (!steps.length) continue;
    const before = await opts.rate(world, e.id); // same seeds as the trials below
    let kept: GuidanceEdit[] = [];
    let after = before;
    if (edits.length) {
      const full = await opts.rate(applyGuidance(world, edits), e.id);
      if (full > before) {
        // Backward elimination: drop edits that are not pulling their weight (keep ≥ 80% of the full gain and ≥ the 5% line when the full set had it).
        kept = [...edits]; after = full;
        const floor = Math.max(before + 0.8 * (full - before), full >= 0.05 ? 0.05 : 0);
        for (const edit of edits) {
          const trial = kept.filter(k => k !== edit);
          if (!trial.length) continue;
          const r = await opts.rate(applyGuidance(world, trial), e.id);
          if (r >= floor) { kept = trial; after = r; }
        }
      }
    }
    const keySteps = steps.map(s => labelOf(world, s));
    const message = kept.length && after > before
      ? `结局「${e.title}」随机到达 ${pct(before)} → ${pct(after)}（模拟 ${seeds} 局）：${kept.map(k => describe(world, k)).join('；')}。关键步骤：${keySteps.join(' → ')}${kept.some(k => k.kind === 'nudge-card') ? '。提示卡正文是占位，发布前需要改写' : ''}`
      : `结局「${e.title}」随机玩法下难以到达（${pct(before)}），自动建议没有改善；关键步骤：${keySteps.join(' → ')}，可考虑在随机路径上提前给出这些步骤的线索`;
    hints.push({endingId: e.id, title: e.title, randomBefore: before, randomAfter: after, seeds, keySteps, edits: kept, message});
  }
  return hints.sort((a, b) => (b.randomAfter - b.randomBefore) - (a.randomAfter - a.randomBefore)).slice(0, opts.maxHints ?? 3);
}
