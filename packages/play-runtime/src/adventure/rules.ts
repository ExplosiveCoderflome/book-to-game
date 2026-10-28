import {type WorldContent, type WorldCondition, type WorldEffect} from '@novel-game/contracts';
import { computeChance, currentMax, formatCalendar, isS1World, newEffectContext, resourceLabel, rngNext, timeLimitOf, type EffectContext } from './s1-core.js';
import {applySetFactionRelation, applySetTerritory, applyTerritoryOverlay, exploreLocation, findMap, locationMap, mapIdOf, locationSpatial, matchesWorldConditions, mergeTakenTags, worldbookBlockReason, worldbookIncrementCap, worldbookSpendsForChoice} from '@novel-game/rules';
import type { AdventureState } from './adventure-state.js';

/** Pure WorldCondition match — authority lives in @novel-game/rules (world-opening). */
export function matches(conditions: WorldCondition[], state: AdventureState, world?: WorldContent): boolean {
  const map = world ? effectiveLocationMap(world, state) : undefined;
  return matchesWorldConditions(conditions, {
    ...state, ...(map ? { map } : {}),
    factionRelations: world?.factionRelations,
    relationOverlay: state.factionRelations,
    resources: state.resources ?? {},
    ...(state.storyletState ? { storyletSeen: state.storyletState.seen } : {}),
    ...(world?.clock ? { clockStartMonth: world.clock.startMonth } : {}),
  });
}
/** Map for the player's location with this session's territory overlay folded in (authored map untouched). */
export function effectiveLocationMap(world: WorldContent, state: Pick<AdventureState, 'locationId' | 'territory'>) {
  const map = locationMap(world, state.locationId);
  return map ? applyTerritoryOverlay(map, state.territory?.[mapIdOf(map)]) : undefined;
}
function addOnce(items: string[], id: string): void { if (!items.includes(id)) items.push(id); }

export function applyEffects(effects: WorldEffect[], state: AdventureState, world?: WorldContent, ctx?: EffectContext): void {
  for (const effect of effects) {
    switch (effect.kind) {
      case 'set': state.facts[effect.factId] = effect.value; break;
      case 'reveal': addOnce(state.knownFactIds, effect.factId); break;
      case 'npc_learn': addOnce(state.npcs[effect.npcId].knownFactIds, effect.factId); break;
      case 'move': state.locationId = effect.locationId; break;
      case 'npc_move': state.npcs[effect.npcId].locationId = effect.locationId; break;
      case 'resource': {
        if (!state.resources) state.resources = {};
        let delta = effect.delta;
        const cap = worldbookIncrementCap(effect.resourceId, world?.worldbook);
        if (cap !== undefined && Math.abs(delta) > cap) {
          delta = delta > 0 ? cap : -cap;
        }
        const previous = state.resources[effect.resourceId] ?? 0;
        const def = world?.resourceDefs?.[effect.resourceId];
        if (!def) {
          state.resources[effect.resourceId] = previous + delta;
          if (ctx) recordDelta(ctx, effect.resourceId, delta);
          break;
        }
        // S1: clamp to [min, current max] after the worldbook cap; note threshold crossings.
        const max = currentMax(world, state, effect.resourceId);
        let next = previous + delta; let clamped: 'min' | 'max' | undefined;
        if (max !== undefined && next > max) { next = max; clamped = 'max'; }
        if (next < def.min) { next = def.min; clamped = 'min'; }
        state.resources[effect.resourceId] = next;
        if (ctx) {
          recordDelta(ctx, effect.resourceId, next - previous, clamped);
          if (previous > def.min && next === def.min) ctx.crossings.push({id: effect.resourceId, bound: 'min'});
          if (max !== undefined && previous < max && next === max) ctx.crossings.push({id: effect.resourceId, bound: 'max'});
        }
        break;
      }
      case 'resource_max': {
        if (!state.resources) state.resources = {};
        const from = currentMax(world, state, effect.resourceId) ?? (state.resources[effect.resourceId] ?? 0);
        const to = effect.set !== undefined ? effect.set : from + (effect.delta ?? 0);
        state.resourceMax = {...(state.resourceMax ?? {}), [effect.resourceId]: to};
        const value = state.resources[effect.resourceId] ?? 0;
        if (value > to) { state.resources[effect.resourceId] = to; if (ctx) recordDelta(ctx, effect.resourceId, to - value, 'max'); }
        if (ctx && from !== to) ctx.maxChanges.push({id: effect.resourceId, from, to});
        break;
      }
      case 'ending': {
        if (ctx) ctx.endingId ??= effect.endingId;
        else if (world && !state.ending) state.ending = resolveEnding(world, state, effect.endingId);
        break;
      }
      case 'roll': {
        if (!world) break;
        const {chance} = computeChance(effect, state.resources ?? {}, world, state.facts);
        const success = rngNext(state) < chance;
        const local = ctx ?? newEffectContext();
        local.roll = {...(effect.showChance === false ? {} : {chance}), success};
        applyEffects(success ? effect.success : effect.failure, state, world, local);
        const text = success ? effect.successText : effect.failureText;
        if (text) local.texts.push(text);
        if (!ctx && local.endingId && !state.ending) state.ending = resolveEnding(world, state, local.endingId);
        break;
      }
      case 'set_territory': {
        if (!world) break;
        const map = effect.mapId ? findMap(world, effect.mapId) : locationMap(world, state.locationId);
        if (!map) break;
        const id = mapIdOf(map);
        state.territory = { ...(state.territory ?? {}), [id]: applySetTerritory(state.territory?.[id], map, effect) };
        break;
      }
      case 'set_faction_relation':
        state.factionRelations = applySetFactionRelation(world ?? {}, state.factionRelations, effect);
        break;
      case 'start_encounter': {
        // P2 stub: auditable engage flag only — no CombatRuntime.
        const key = effect.placementId || effect.encounterId || 'anon';
        const factId = `enc_engaged_${key}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
        state.facts[factId] = true;
        addOnce(state.knownFactIds, factId);
        break;
      }
    }
  }
}

function recordDelta(ctx: EffectContext, id: string, delta: number, clamped?: 'min' | 'max'): void {
  const entry = ctx.deltas.get(id) ?? {delta: 0};
  entry.delta += delta; if (clamped) entry.clamped = clamped;
  ctx.deltas.set(id, entry);
}

/** Authored ending → saved ending (S1 adds kind, path and conditional text variants). */
export function resolveEnding(world: WorldContent, state: AdventureState, endingId: string, fallbackKind: 'ending' | 'failure' = 'ending'): NonNullable<AdventureState['ending']> {
  const ending = world.endings.find(item => item.id === endingId);
  if (!ending) return {id: endingId, title: endingId, text: '', kind: fallbackKind, path: endingPath(state)};
  const variant = ending.textVariants?.find(item => matches(item.when, state, world));
  return {id: ending.id, title: ending.title, text: variant?.text ?? ending.text, kind: ending.kind ?? fallbackKind, path: endingPath(state), ...endingExtras(world, state, ending)};
}
/**
 * K15: passages (array order) and 「这一生」 recap lines (by `order`, else array order) whose `when` holds in the state
 * at the moment the ending fires. Only held entries are returned (no spoilers); empty lists are omitted.
 */
export function endingExtras(world: WorldContent, state: AdventureState, ending: Pick<WorldContent['endings'][number], 'passages'> | undefined): Pick<NonNullable<AdventureState['ending']>, 'passages' | 'recap'> {
  const passages = (ending?.passages ?? []).filter(p => matches(p.when, state, world)).map(p => ({id: p.id, text: p.text}));
  const recap = (world.recap ?? []).map((r, index) => ({r, index})).filter(({r}) => matches(r.when, state, world))
    .sort((a, b) => (a.r.order ?? a.index) - (b.r.order ?? b.index) || a.index - b.index).map(({r}) => ({id: r.id, text: r.text}));
  // recap: [] (world has a recap, nothing held) ≠ absent (world without recap[] — UI falls back to 「走过的路」).
  return {...(passages.length ? {passages} : {}), ...(world.recap ? {recap} : {})};
}
function endingPath(state: AdventureState): string[] { return (state.storyletState?.path ?? []).slice(-8); }

/** onMin / onMax triggers for bounds crossed in this step (each crossing fires once). */
export function fireThresholds(world: WorldContent, state: AdventureState, ctx: EffectContext, depth = 0): void {
  const crossings = ctx.crossings.splice(0);
  for (const crossing of crossings) {
    const def = world.resourceDefs?.[crossing.id];
    const trigger = crossing.bound === 'min' ? def?.onMin : def?.onMax;
    if (!trigger) continue;
    if (trigger.effects?.length) applyEffects(trigger.effects, state, world, ctx);
    if (trigger.storylet && !(state.forcedStorylets ?? []).includes(trigger.storylet)) state.forcedStorylets = [...(state.forcedStorylets ?? []), trigger.storylet];
    if (trigger.ending && !ctx.endingId) { ctx.endingId = trigger.ending; ctx.endingKind = 'failure'; }
  }
  if (ctx.crossings.length && depth < 4) fireThresholds(world, state, ctx, depth + 1);
}

export function visible(action: WorldContent['actions'][number], state: AdventureState, world?: WorldContent): boolean {
  return action.locationId === state.locationId && !(action.once && state.performedActionIds.includes(action.id)) && matches(action.availableWhen, state, world);
}

export function blockedReason(action: WorldContent['actions'][number], world: WorldContent, state: AdventureState): string | undefined {
  if (action.timeCost > timeLimitOf(world) - state.elapsed) return '剩余时间不足';
  if (action.npcId && state.npcs[action.npcId]?.locationId !== state.locationId) return '目标人物不在此处';
  if (!matches(action.requires, state, world)) {
    if (isS1World(world)) return requiresBlock(action.requires, world, state, action.blockedReason).reason;
    return action.blockedReason.trim() || '尚未满足执行条件。';
  }
  const wb = worldbookBlockReason(
    action,
    state.locationId,
    state.resources ?? {},
    world.worldbook,
    state.takenTags ?? [],
    'location',
    {regionIds: locationSpatial(effectiveLocationMap(world, state), state.locationId).regionIds},
  );
  if (wb) return wb;
  return undefined;
}

/** Apply worldbook spend_on_choice against open resources after a successful act. */
export function applyWorldbookSpends(
  action: WorldContent['actions'][number],
  world: WorldContent,
  state: AdventureState,
): void {
  if (!state.resources) state.resources = { ...(world.resources ?? {}) };
  for (const spend of worldbookSpendsForChoice(action, state.locationId, world.worldbook, 'location', {regionIds: locationSpatial(effectiveLocationMap(world, state), state.locationId).regionIds})) {
    const previous = state.resources[spend.variable] ?? 0;
    state.resources[spend.variable] = previous - spend.amount;
  }
}

export function recordActionTags(
  action: WorldContent['actions'][number],
  state: AdventureState,
): void {
  state.takenTags = mergeTakenTags(state.takenTags, action.tags);
}

export function settle(world: WorldContent, state: AdventureState, ctx?: EffectContext): string[] {
  const narration: string[] = [];
  // Events may make an earlier event eligible. Every event can fire only once, so this terminates.
  let triggered = true;
  while (triggered) {
    triggered = false;
    for (const event of world.events) {
      if (state.triggeredEventIds.includes(event.id) || !matches(event.when, state, world)) continue;
      state.triggeredEventIds.push(event.id); applyEffects(event.effects, state, world, ctx); triggered = true;
      if (event.visibility === 'public' && event.text) narration.push(event.text);
    }
  }
  state.explored = exploreLocation(state.explored, world, state.locationId);
  if (ctx) {
    fireThresholds(world, state, ctx);
    if (ctx.endingId && !state.ending) state.ending = resolveEnding(world, state, ctx.endingId, ctx.endingKind);
    if (state.ending) return narration;
  }
  const s1 = isS1World(world);
  // Endings with an empty `when` (S1 only) are reached by effects/triggers, never matched here.
  const ending = world.endings.find(candidate => candidate.when.length > 0 && matches(candidate.when, state, world));
  if (ending) state.ending = s1 ? resolveEnding(world, state, ending.id) : {id: ending.id, title: ending.title, text: ending.text, ...endingExtras(world, state, ending)};
  else if (state.elapsed >= timeLimitOf(world)) state.ending = s1
    ? (world.clock?.timeoutEndingId && world.endings.some(item => item.id === world.clock?.timeoutEndingId)
      ? {...resolveEnding(world, state, world.clock.timeoutEndingId), kind: 'timeout'}
      : {id: 'timeout', title: '时间已到', text: world.timeoutEnding, kind: 'timeout', path: endingPath(state), ...endingExtras(world, state, undefined)})
    : {id: 'timeout', title: '时间已到', text: world.timeoutEnding};
  return narration;
}

export type BlockedReasonKind = 'generated' | 'author' | 'legacy';
/**
 * S1 (§5.3 / U4): the first failing condition explains the block. Numeric / clock / seen conditions get a
 * generated sentence with exact numbers; other kinds fall back to the author's text.
 * For storylet choices an explicit author `blockedReason` always wins (passed as `authorOverride`).
 */
export function requiresBlock(conditions: WorldCondition[], world: WorldContent, state: AdventureState, authorText?: string, authorOverride?: string): {reason: string; kind: BlockedReasonKind} {
  if (authorOverride?.trim()) return {reason: authorOverride.trim(), kind: 'author'};
  const failing = conditions.find(condition => !matches([condition], state, world));
  const generated = failing ? describeCondition(failing, world, state) : undefined;
  if (generated) return {reason: generated, kind: 'generated'};
  return {reason: authorText?.trim() || '条件未满足', kind: authorText?.trim() ? 'author' : 'generated'};
}
function fmtValue(world: WorldContent, id: string, n: number): string {
  const def = world.resourceDefs?.[id];
  const label = def?.valueLabels?.[n - (def?.min ?? 0)];
  return label ?? String(n);
}
/** Short form used inside anyOf: 「心魔 ≥ 30」. */
function shortCondition(condition: WorldCondition, world: WorldContent): string | undefined {
  if (condition.kind === 'resource') {
    const def = world.resourceDefs?.[condition.resourceId];
    if (def?.display === 'hidden') return undefined;
    const label = resourceLabel(world, condition.resourceId);
    if (condition.atLeast !== undefined && condition.atMost !== undefined) return `${label} ${fmtValue(world, condition.resourceId, condition.atLeast)}–${fmtValue(world, condition.resourceId, condition.atMost)}`;
    return condition.atLeast !== undefined ? `${label} ≥ ${fmtValue(world, condition.resourceId, condition.atLeast)}` : `${label} ≤ ${fmtValue(world, condition.resourceId, condition.atMost ?? 0)}`;
  }
  if (condition.kind === 'clock') return condition.atLeastMonth !== undefined ? `${formatCalendar(world, condition.atLeastMonth)} 起`
    : condition.atMostMonth !== undefined ? `${formatCalendar(world, condition.atMostMonth)} 前` : `每年 ${(condition.monthOfYearIn ?? []).join('、')} 月`;
  if (condition.kind === 'storylet_seen') return `经历过「${world.storylets?.find(item => item.id === condition.storyletId)?.title ?? condition.storyletId}」`;
  return undefined;
}
export function describeCondition(condition: WorldCondition, world: WorldContent, state: AdventureState): string | undefined {
  if (condition.kind === 'resource') {
    const def = world.resourceDefs?.[condition.resourceId];
    if (def?.display === 'hidden') return '条件未满足';
    const label = resourceLabel(world, condition.resourceId);
    const value = state.resources?.[condition.resourceId] ?? 0;
    const v = fmtValue(world, condition.resourceId, value);
    if (condition.atLeast !== undefined && condition.atMost !== undefined) return `${label}不在范围：需 ${fmtValue(world, condition.resourceId, condition.atLeast)}–${fmtValue(world, condition.resourceId, condition.atMost)}，现有 ${v}`;
    if (condition.atLeast !== undefined && value < condition.atLeast) return `${label}不足：需 ≥ ${fmtValue(world, condition.resourceId, condition.atLeast)}，现有 ${v}`;
    if (condition.atMost !== undefined) return `${label}过高：需 ≤ ${fmtValue(world, condition.resourceId, condition.atMost)}，现有 ${v}`;
    return undefined;
  }
  if (condition.kind === 'clock') {
    if (condition.atLeastMonth !== undefined && state.elapsed < condition.atLeastMonth) return `时候未到：${formatCalendar(world, condition.atLeastMonth)} 起才行`;
    if (condition.atMostMonth !== undefined && state.elapsed > condition.atMostMonth) return `时候已过：${formatCalendar(world, condition.atMostMonth)} 前才行`;
    if (condition.monthOfYearIn) return `时候未到：每年 ${condition.monthOfYearIn.join('、')} 月才行`;
    return undefined;
  }
  if (condition.kind === 'storylet_seen') {
    const title = world.storylets?.find(item => item.id === condition.storyletId)?.title ?? condition.storyletId;
    const seen = state.storyletState?.seen[condition.storyletId] ?? 0;
    return seen < (condition.atLeast ?? 1) ? `还没经历「${title}」` : `已经历过「${title}」`;
  }
  if (condition.kind === 'anyOf') {
    const parts = condition.conditions.map(member => shortCondition(member, world));
    if (parts.some(part => part === undefined)) return undefined;
    return `需满足其一：${parts.join('；')}`;
  }
  return undefined;
}
