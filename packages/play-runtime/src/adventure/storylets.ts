/**
 * S1 storylet hand, monthly clock rules and timed windows (§3.2 c/e).
 * Pure functions over AdventureState; all randomness comes from the save's seeded RNG.
 */
import { storyletBodies, type Storylet, type StoryletChoice, type WorldContent } from '@novel-game/contracts';
import type { AdventureHandCard, AdventureState } from './adventure-state.js';
import { applyEffects, matches } from './rules.js';
import { currentMax, rngNext, type EffectContext } from './s1-core.js';

export const STORYLET_CHOICE_PREFIX = 'sl__';
export const storyletChoiceId = (storyletId: string, choiceId: string): string => `${STORYLET_CHOICE_PREFIX}${storyletId}__${choiceId}`;

export function handSizeOf(world: WorldContent): number { return world.storyletRules?.handSize ?? 3; }

/** Initial S1 fields for a new save (resources clamped to their bounds, RNG seeded, windows at month 0). */
export function initS1State(world: WorldContent, state: AdventureState, seed: number): void {
  state.rng = {seed: seed >>> 0, cursor: 0};
  for (const [id, def] of Object.entries(world.resourceDefs ?? {})) {
    let value = def.initial ?? state.resources[id] ?? def.min;
    if (def.max !== undefined && value > def.max) value = def.max;
    if (value < def.min) value = def.min;
    state.resources[id] = value;
  }
  if (world.storylets) {
    state.hand = [];
    state.storyletState = {seen: {}, lastTurn: {}, lastVariant: {}, drawn: {}, path: []};
    state.forcedStorylets = [];
  }
  if (world.clock) {
    state.clockFired = 0;
    state.openWindows = openWindowsAt(world, 0);
    for (const id of state.openWindows) forceWindowCard(world, state, id);
  }
}

export function openWindowsAt(world: WorldContent, month: number): string[] {
  return (world.clock?.windows ?? []).filter(w => w.fromMonth <= month && month <= w.toMonth).map(w => w.id);
}
function forceWindowCard(world: WorldContent, state: AdventureState, windowId: string): void {
  const storyletId = world.clock?.windows?.find(w => w.id === windowId)?.storyletId;
  if (storyletId && !(state.forcedStorylets ?? []).includes(storyletId)) state.forcedStorylets = [...(state.forcedStorylets ?? []), storyletId];
}

/**
 * Clock rules for every month boundary crossed in (from, to], settled one by one, then window open/close.
 * Returns opened / closed window ids.
 */
export function runClock(world: WorldContent, state: AdventureState, from: number, to: number, ctx: EffectContext): {opened: string[]; closed: string[]} {
  const clock = world.clock;
  if (!clock) return {opened: [], closed: []};
  for (let month = Math.max(from, state.clockFired ?? 0) + 1; month <= to; month++) {
    for (const rule of clock.rules ?? []) {
      if (month % rule.everyMonths !== 0) continue;
      applyEffects(rule.effects, state, world, ctx);
      if (rule.text) ctx.texts.push(rule.text);
    }
  }
  state.clockFired = Math.max(state.clockFired ?? 0, to);
  const before = state.openWindows ?? [];
  const now = openWindowsAt(world, to);
  const opened = now.filter(id => !before.includes(id));
  const closed = before.filter(id => !now.includes(id));
  state.openWindows = now;
  for (const id of opened) forceWindowCard(world, state, id);
  for (const id of closed) {
    const storyletId = clock.windows?.find(w => w.id === id)?.storyletId;
    if (!storyletId) continue;
    state.forcedStorylets = (state.forcedStorylets ?? []).filter(item => item !== storyletId);
    state.hand = (state.hand ?? []).filter(card => card.storyletId !== storyletId);
  }
  return {opened, closed};
}

function windowsOf(world: WorldContent, storyletId: string) { return (world.clock?.windows ?? []).filter(w => w.storyletId === storyletId); }
export function inWindow(world: WorldContent, state: AdventureState, storyletId: string): boolean {
  return windowsOf(world, storyletId).some(w => (state.openWindows ?? []).includes(w.id));
}
function atLocation(sl: Storylet, state: AdventureState): boolean { return !sl.locationIds?.length || sl.locationIds.includes(state.locationId); }
/** Window-bound cards only exist while one of their windows is open. */
function windowOk(world: WorldContent, state: AdventureState, sl: Storylet): boolean {
  return windowsOf(world, sl.id).length === 0 || inWindow(world, state, sl.id);
}
function usable(sl: Storylet, state: AdventureState): boolean {
  const ss = state.storyletState!;
  const seen = ss.seen[sl.id] ?? 0;
  const last = ss.lastTurn[sl.id];
  if (last === state.turn) return false; // never back in the hand right after being played
  if (!sl.repeat) return seen === 0;
  if (sl.repeat.maxTimes != null && seen >= sl.repeat.maxTimes) return false;
  return last === undefined || state.turn - last > sl.repeat.cooldownTurns;
}
/** Draw candidate: location, window, `when`, cooldown, maxTimes, once. */
function eligible(world: WorldContent, state: AdventureState, sl: Storylet): boolean {
  return atLocation(sl, state) && windowOk(world, state, sl) && usable(sl, state) && (!sl.when?.length || matches(sl.when, state, world));
}
function weightOf(world: WorldContent, sl: Storylet, state: AdventureState): number {
  let weight = sl.weight?.base ?? 10;
  for (const mod of sl.weight?.mods ?? []) {
    if (mod.when?.length && !matches(mod.when, state, world)) continue;
    if (!mod.resourceId) { weight += mod.add; continue; }
    const value = state.resources?.[mod.resourceId] ?? 0;
    if (mod.atLeast !== undefined && value < mod.atLeast) continue;
    if (mod.atMost !== undefined && value > mod.atMost) continue;
    weight += mod.add;
  }
  return Math.max(0, weight);
}
function pickVariant(sl: Storylet, state: AdventureState): number {
  const n = storyletBodies(sl).length;
  if (n <= 1) return 0;
  if (sl.variantMode === 'sequential') return Math.min(state.storyletState!.seen[sl.id] ?? 0, n - 1);
  let v = Math.floor(rngNext(state) * n);
  if (v === state.storyletState!.lastVariant[sl.id]) v = (v + 1) % n;
  return v;
}
function drawCard(sl: Storylet, state: AdventureState, forced = false): AdventureHandCard {
  const ss = state.storyletState!;
  const variant = pickVariant(sl, state);
  ss.lastVariant[sl.id] = variant;
  ss.drawn[sl.id] = (ss.drawn[sl.id] ?? 0) + 1;
  return {storyletId: sl.id, variant, drawnTurn: state.turn, ...(forced ? {forced: true} : {})};
}

/**
 * Rebuild the hand after an action. `discard` (move / clock refresh) replaces unplayed ordinary cards.
 * Forced and urgent cards enter first; the rest are drawn by weight without replacement.
 */
export function refreshHand(world: WorldContent, state: AdventureState, discard: boolean): void {
  const storylets = world.storylets;
  if (!storylets || !state.storyletState || state.ending) return;
  const byId = new Map(storylets.map(sl => [sl.id, sl]));
  const size = handSizeOf(world);
  let hand = (state.hand ?? []).filter(card => {
    const sl = byId.get(card.storyletId);
    if (!sl || !atLocation(sl, state) || !windowOk(world, state, sl)) return false;
    if (card.forced) return true;
    if (sl.when?.length && !matches(sl.when, state, world)) return false;
    return !discard || !!sl.urgent;
  });
  const inHand = (id: string) => hand.some(card => card.storyletId === id);
  const front: AdventureHandCard[] = [];
  for (const id of state.forcedStorylets ?? []) {
    const sl = byId.get(id);
    if (!sl || inHand(id) || !atLocation(sl, state) || !windowOk(world, state, sl) || !usable(sl, state)) continue;
    front.push(drawCard(sl, state, true));
  }
  state.forcedStorylets = (state.forcedStorylets ?? []).filter(id => !front.some(card => card.storyletId === id));
  for (const sl of storylets) {
    if (!sl.urgent || inHand(sl.id) || front.some(card => card.storyletId === sl.id) || !eligible(world, state, sl)) continue;
    front.push(drawCard(sl, state));
  }
  hand = [...front, ...hand];
  // Priority cards first; ordinary cards beyond the hand size fall out.
  const priority = (card: AdventureHandCard) => card.forced || byId.get(card.storyletId)?.urgent ? 0 : 1;
  hand = hand.map((card, index) => ({card, index})).sort((a, b) => priority(a.card) - priority(b.card) || a.index - b.index).map(x => x.card).slice(0, Math.max(size, front.length));
  let pool = storylets.filter(sl => !sl.urgent && !hand.some(card => card.storyletId === sl.id) && eligible(world, state, sl))
    .map(sl => ({sl, weight: weightOf(world, sl, state)})).filter(item => item.weight > 0);
  while (hand.length < size && pool.length) {
    const total = pool.reduce((acc, item) => acc + item.weight, 0);
    let r = rngNext(state) * total;
    let index = pool.findIndex(item => (r -= item.weight) < 0);
    if (index < 0) index = pool.length - 1;
    hand.push(drawCard(pool[index].sl, state));
    pool = pool.filter((_, i) => i !== index);
  }
  state.hand = hand;
}

/** Locate a hand choice by its engine id (`sl__{storylet}__{choice}`). */
export function findHandChoice(world: WorldContent, state: AdventureState, actionId: string): {storylet: Storylet; choice: StoryletChoice; card: AdventureHandCard} | undefined {
  if (!actionId.startsWith(STORYLET_CHOICE_PREFIX)) return undefined;
  for (const card of state.hand ?? []) {
    const storylet = world.storylets?.find(sl => sl.id === card.storyletId);
    const choice = storylet?.choices.find(c => storyletChoiceId(storylet.id, c.id) === actionId);
    if (storylet && choice) return {storylet, choice, card};
  }
  return undefined;
}

export function markPlayed(state: AdventureState, storylet: Storylet): void {
  const ss = state.storyletState!;
  ss.seen[storylet.id] = (ss.seen[storylet.id] ?? 0) + 1;
  ss.lastTurn[storylet.id] = state.turn;
  if (!storylet.repeat) ss.path.push(storylet.title);
  state.hand = (state.hand ?? []).filter(card => card.storyletId !== storylet.id);
  state.forcedStorylets = (state.forcedStorylets ?? []).filter(id => id !== storylet.id);
}

/** Clock refresh boundary crossed (refreshEveryMonths, default 3)? */
export function clockRefreshDue(world: WorldContent, from: number, to: number): boolean {
  const rules = world.storyletRules;
  if (!world.clock || !(rules?.refreshOn ?? ['move', 'clock']).includes('clock')) return false;
  const every = rules?.refreshEveryMonths ?? 3;
  return Math.floor(to / every) > Math.floor(from / every);
}
export function moveRefreshDue(world: WorldContent, fromLocation: string, toLocation: string): boolean {
  return fromLocation !== toLocation && (world.storyletRules?.refreshOn ?? ['move', 'clock']).includes('move');
}

/** S4: body shown for a hand card — the first state case that holds now, else the rotated variant drawn with the card. */
export function storyletText(world: WorldContent, state: AdventureState, sl: Storylet, variant: number): string {
  const hit = sl.textCases?.find(c => matches(c.when, state, world));
  if (hit) return hit.text;
  const bodies = storyletBodies(sl);
  return bodies[variant] ?? bodies[0] ?? '';
}
/** Location description with S1 conditional variants (first match wins). */
export function locationText(world: WorldContent, state: AdventureState, locationId: string): string {
  const location = world.locations.find(item => item.id === locationId);
  if (!location) return '';
  return location.textVariants?.find(variant => matches(variant.when, state, world))?.text ?? location.text;
}

export { currentMax };
