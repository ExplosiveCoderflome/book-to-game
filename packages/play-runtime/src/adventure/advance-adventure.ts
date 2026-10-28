import { SYSTEM_WAIT_ACTION_ID, type AdventureActInput, type BuildingLibrary, type ItemCatalog, type WorldContent } from '@novel-game/contracts';
import { findFillAction, fillSpecificBlockedReason, type FillCompiledAction } from '@novel-game/rules';
import { AppError } from '../errors.js';
import type { AdventureLastResult, AdventureState } from './adventure-state.js';
import { applyEffects, applyWorldbookSpends, blockedReason, matches, recordActionTags, requiresBlock, settle, visible } from './rules.js';
import { isS1World, newEffectContext, resourceLabel, timeLimitOf, type EffectContext } from './s1-core.js';
import { clockRefreshDue, findHandChoice, markPlayed, moveRefreshDue, refreshHand, runClock } from './storylets.js';
import { systemWait } from './system-actions.js';

export type AdvanceAdventureOptions = {
  buildingLibrary?: BuildingLibrary;
  itemCatalog?: ItemCatalog;
};

export function advanceAdventure(
  current: AdventureState,
  input: AdventureActInput,
  world: WorldContent,
  now: string,
  opts: AdvanceAdventureOptions = {},
): AdventureState {
  if (current.turn !== input.expectedTurn) throw new AppError('SESSION_TURN_CONFLICT', '存档已推进，请刷新后再行动', 409);
  if (current.ending) throw new AppError('SESSION_ENDED', '冒险已结束', 409);
  if (isS1World(world)) return advanceS1(current, input, world, now, opts);
  const fillAction = findFillAction(world, input.actionId, {
    library: opts.buildingLibrary,
    catalog: opts.itemCatalog,
  });
  const action: FillCompiledAction | WorldContent['actions'][number] | undefined =
    input.actionId === SYSTEM_WAIT_ACTION_ID
      ? systemWait(current.locationId)
      : (fillAction ?? world.actions.find(item => item.id === input.actionId));
  if (!action || !visible(action, current, world)) throw new AppError('INVALID_ACTION', '此行动当前不可用', 400);
  const specific = (action as FillCompiledAction).fillBlockHints
    ? fillSpecificBlockedReason(action as FillCompiledAction, current.resources ?? {}, current.facts)
    : undefined;
  const reason = specific ?? blockedReason(action, world, current);
  if (reason !== undefined) throw new AppError('ACTION_BLOCKED', reason, 400);
  const state = structuredClone(current);
  if (!state.resources) state.resources = { ...(world.resources ?? {}) };
  if (!state.takenTags) state.takenTags = [];
  state.turn++; state.elapsed += action.timeCost; state.updatedAt = now;
  if (action.once) state.performedActionIds.push(action.id);
  applyEffects(action.effects, state, world);
  applyWorldbookSpends(action, world, state);
  recordActionTags(action, state);
  const text = [action.text, ...settle(world, state)].filter(Boolean).join('\n');
  state.history.push({ turn: state.turn, elapsed: state.elapsed, actionLabel: action.label, text });
  return state;
}

/**
 * S1 step: a storylet choice and a fixed action are the same kind of step — one timeCost,
 * one effects pass, clock rules for every crossed month, windows, threshold triggers, settle, hand refresh.
 */
function advanceS1(current: AdventureState, input: AdventureActInput, world: WorldContent, now: string, opts: AdvanceAdventureOptions): AdventureState {
  const hand = findHandChoice(world, current, input.actionId);
  let fixed: FillCompiledAction | WorldContent['actions'][number] | undefined;
  if (!hand) {
    const fillAction = findFillAction(world, input.actionId, {library: opts.buildingLibrary, catalog: opts.itemCatalog});
    fixed = input.actionId === SYSTEM_WAIT_ACTION_ID ? systemWait(current.locationId) : (fillAction ?? world.actions.find(item => item.id === input.actionId));
    if (!fixed || !visible(fixed, current, world)) throw new AppError('INVALID_ACTION', '此行动当前不可用', 400);
    const specific = (fixed as FillCompiledAction).fillBlockHints ? fillSpecificBlockedReason(fixed as FillCompiledAction, current.resources ?? {}, current.facts) : undefined;
    const reason = specific ?? blockedReason(fixed, world, current);
    if (reason !== undefined) throw new AppError('ACTION_BLOCKED', reason, 400);
  } else {
    if (hand.choice.availableWhen?.length && !matches(hand.choice.availableWhen, current, world)) throw new AppError('INVALID_ACTION', '此行动当前不可用', 400);
    const reason = storyletChoiceBlock(hand.choice, world, current);
    if (reason) throw new AppError('ACTION_BLOCKED', reason.reason, 400);
  }
  const timeCost = hand ? hand.choice.timeCost : fixed!.timeCost;
  const label = hand ? hand.choice.label : fixed!.label;
  const state = structuredClone(current);
  if (!state.resources) state.resources = {...(world.resources ?? {})};
  if (!state.takenTags) state.takenTags = [];
  const fromMonth = state.elapsed; const fromLocation = state.locationId;
  const before = {...state.resources};
  state.turn++; state.elapsed += timeCost; state.updatedAt = now;
  const ctx = newEffectContext();
  if (hand) {
    markPlayed(state, hand.storylet);
    applyEffects(hand.choice.effects, state, world, ctx);
  } else {
    if (fixed!.once) state.performedActionIds.push(fixed!.id);
    applyEffects(fixed!.effects, state, world, ctx);
    applyWorldbookSpends(fixed!, world, state);
    // Worldbook spends bypass applyEffects: record their deltas too.
    for (const [id, value] of Object.entries(state.resources)) {
      const known = ctx.deltas.get(id)?.delta ?? 0;
      const actual = value - (before[id] ?? 0);
      if (actual !== known) ctx.deltas.set(id, {...(ctx.deltas.get(id) ?? {}), delta: actual});
    }
    recordActionTags(fixed!, state);
  }
  const windows = runClock(world, state, fromMonth, state.elapsed, ctx);
  const narration = settle(world, state, ctx);
  if (!state.ending) refreshHand(world, state, moveRefreshDue(world, fromLocation, state.locationId) || clockRefreshDue(world, fromMonth, state.elapsed));
  state.lastResult = buildLastResult(world, label, timeCost, ctx, windows);
  const actionText = hand ? hand.choice.text : fixed!.text;
  const text = [actionText, ...ctx.texts, ...narration].filter(Boolean).join('\n');
  state.history.push({turn: state.turn, elapsed: state.elapsed, actionLabel: label, text});
  return state;
}

export function storyletChoiceBlock(choice: {timeCost: number; requires?: WorldContent['actions'][number]['requires']; blockedReason?: string}, world: WorldContent, state: AdventureState) {
  if (choice.timeCost > timeLimitOf(world) - state.elapsed) return {reason: '剩余时间不足', kind: 'generated' as const};
  if (choice.requires?.length) {
    if (!matches(choice.requires, state, world)) return requiresBlock(choice.requires, world, state, undefined, choice.blockedReason);
  }
  return undefined;
}

function buildLastResult(world: WorldContent, actionLabel: string, months: number, ctx: EffectContext, windows: {opened: string[]; closed: string[]}): AdventureLastResult {
  const hidden = (id: string) => world.resourceDefs?.[id]?.display === 'hidden';
  const deltas: AdventureLastResult['deltas'] = [];
  for (const [id, entry] of ctx.deltas) {
    if (hidden(id) || (entry.delta === 0 && !entry.clamped)) continue;
    deltas.push({id, label: resourceLabel(world, id), delta: entry.delta, ...(entry.clamped ? {clamped: entry.clamped} : {})});
  }
  for (const change of ctx.maxChanges) if (!hidden(change.id)) deltas.push({kind: 'max', id: change.id, label: resourceLabel(world, change.id), from: change.from, to: change.to});
  const windowLabel = (id: string) => {
    const w = world.clock?.windows?.find(item => item.id === id);
    return w?.label ?? world.storylets?.find(sl => sl.id === w?.storyletId)?.title ?? id;
  };
  return {
    actionLabel, months, deltas,
    ...(ctx.roll ? {roll: ctx.roll} : {}),
    ...(windows.opened.length || windows.closed.length ? {windows: {opened: windows.opened.map(windowLabel), closed: windows.closed.map(windowLabel)}} : {}),
  };
}
