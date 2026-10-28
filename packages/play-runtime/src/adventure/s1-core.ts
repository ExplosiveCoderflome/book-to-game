/**
 * S1 production-flow core helpers (pure, no imports from rules.ts to keep the module graph acyclic):
 * seeded RNG, time limit, resource bounds, roll chance, calendar text.
 */
import { usesS1Systems, type WorldContent, type WorldRollEffect } from '@novel-game/contracts';
import type { AdventureState } from './adventure-state.js';

export const isS1World = (world: WorldContent): boolean => usesS1Systems(world);

/** mulberry32 addressed by cursor: output n depends only on (seed, n). Advances the cursor. */
export function rngNext(state: Pick<AdventureState, 'rng'>): number {
  const rng = state.rng ?? (state.rng = {seed: 0, cursor: 0});
  rng.cursor += 1;
  let t = (rng.seed + Math.imul(rng.cursor, 0x6D2B79F5)) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
/** FNV-1a 32-bit — deterministic fallback seed when a caller supplies none. */
export function seedFromString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/** Effective limit: clock.limitMonths when the world has a clock, otherwise the legacy timeLimit. */
export function timeLimitOf(world: WorldContent): number { return world.clock ? world.clock.limitMonths : world.timeLimit; }

export function resourceLabel(world: WorldContent, id: string): string { return world.resourceDefs?.[id]?.label ?? id; }
export function currentMax(world: WorldContent | undefined, state: Pick<AdventureState, 'resourceMax'>, id: string): number | undefined {
  return state.resourceMax?.[id] ?? world?.resourceDefs?.[id]?.max;
}

/** Collected while one action settles; becomes `lastResult` and drives threshold triggers. */
export interface EffectContext {
  deltas: Map<string, {delta: number; clamped?: 'min' | 'max'}>;
  maxChanges: {id: string; from: number; to: number}[];
  crossings: {id: string; bound: 'min' | 'max'}[];
  roll?: {chance?: number; success: boolean};
  texts: string[];
  endingId?: string;
  endingKind?: 'ending' | 'failure';
}
export const newEffectContext = (): EffectContext => ({deltas: new Map(), maxChanges: [], crossings: [], texts: []});

export interface ChanceBreakdown {chance: number; parts: {label: string; add: number}[]; min: number; max: number}
const round4 = (n: number) => Math.round(n * 10000) / 10000;
/** Success probability for a roll from the current resources; parts lists base + every non-zero modifier. */
export function computeChance(roll: WorldRollEffect, resources: Record<string, number>, world: WorldContent, facts: Record<string, boolean> = {}): ChanceBreakdown {
  const min = roll.chance.min ?? 0; const max = roll.chance.max ?? 1;
  const parts: {label: string; add: number}[] = [{label: '基础', add: roll.chance.base}];
  for (const mod of roll.chance.mods ?? []) {
    if (mod.factId) {
      if ((facts[mod.factId] ?? false) === (mod.value ?? true) && mod.add) parts.push({label: mod.label ?? world.facts.find(f => f.id === mod.factId)?.label ?? mod.factId, add: mod.add});
      continue;
    }
    if (!mod.resourceId) continue;
    const value = resources[mod.resourceId] ?? 0;
    const label = mod.label ?? resourceLabel(world, mod.resourceId);
    if (mod.per !== undefined) { const add = round4(mod.per * value); if (add !== 0) parts.push({label, add}); continue; }
    if (mod.atLeast !== undefined && value < mod.atLeast) continue;
    if (mod.atMost !== undefined && value > mod.atMost) continue;
    if (mod.add) parts.push({label, add: mod.add});
  }
  const sum = parts.reduce((acc, part) => acc + part.add, 0);
  return {chance: round4(Math.min(max, Math.max(min, sum))), parts, min, max};
}

/** 「第{year}年 {month}月」 for a months-elapsed value (D2: 0 = the start month). */
export function formatCalendar(world: WorldContent, month: number): string {
  const clock = world.clock;
  if (!clock) return `${month}`;
  const total = clock.startMonth - 1 + month;
  const year = clock.startYear + Math.floor(total / 12);
  const mon = (total % 12) + 1;
  return (clock.display ?? '第{year}年 {month}月').replaceAll('{year}', String(year)).replaceAll('{month}', String(mon));
}
/** <12 → 「n 个月」; multiples of 12 → 「n 年」; else 「n 年 m 个月」. */
export function formatMonths(months: number): string {
  if (months < 12) return `${months} 个月`;
  const years = Math.floor(months / 12); const rest = months % 12;
  return rest === 0 ? `${years} 年` : `${years} 年 ${rest} 个月`;
}

/** U18: explicit countdownResourceId, else a resource the clock rules decrement whose onMin ends the game. */
export function countdownResource(world: WorldContent): string | undefined {
  const clock = world.clock;
  if (!clock) return undefined;
  if (clock.countdownResourceId) return clock.countdownResourceId;
  for (const rule of clock.rules ?? []) for (const effect of rule.effects) {
    if (effect.kind === 'resource' && effect.delta < 0 && world.resourceDefs?.[effect.resourceId]?.onMin?.ending) return effect.resourceId;
  }
  return undefined;
}
