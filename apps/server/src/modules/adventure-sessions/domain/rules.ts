import {type WorldContent, type WorldCondition, type WorldEffect} from '@novel-game/contracts';
import {matchesWorldConditions, mergeTakenTags, worldbookBlockReason, worldbookIncrementCap, worldbookSpendsForChoice} from '@novel-game/rules';
import type { AdventureState } from './adventure-state.js';

/** Pure WorldCondition match — authority lives in @novel-game/rules (world-opening). */
export function matches(conditions: WorldCondition[], state: AdventureState, world?: WorldContent): boolean {
  return matchesWorldConditions(conditions, world?.map ? { ...state, map: world.map } : state);
}
function addOnce(items: string[], id: string): void { if (!items.includes(id)) items.push(id); }

export function applyEffects(effects: WorldEffect[], state: AdventureState, world?: WorldContent): void {
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
        state.resources[effect.resourceId] = previous + delta;
        break;
      }
    }
  }
}

export function visible(action: WorldContent['actions'][number], state: AdventureState, world?: WorldContent): boolean {
  return action.locationId === state.locationId && !(action.once && state.performedActionIds.includes(action.id)) && matches(action.availableWhen, state, world);
}

export function blockedReason(action: WorldContent['actions'][number], world: WorldContent, state: AdventureState): string | undefined {
  if (action.timeCost > world.timeLimit - state.elapsed) return '剩余时间不足';
  if (action.npcId && state.npcs[action.npcId]?.locationId !== state.locationId) return '目标人物不在此处';
  if (!matches(action.requires, state, world)) return action.blockedReason.trim() || '尚未满足执行条件。';
  const wb = worldbookBlockReason(
    action,
    state.locationId,
    state.resources ?? {},
    world.worldbook,
    state.takenTags ?? [],
    'location',
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
  for (const spend of worldbookSpendsForChoice(action, state.locationId, world.worldbook, 'location')) {
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

export function settle(world: WorldContent, state: AdventureState): string[] {
  const narration: string[] = [];
  // Events may make an earlier event eligible. Every event can fire only once, so this terminates.
  let triggered = true;
  while (triggered) {
    triggered = false;
    for (const event of world.events) {
      if (state.triggeredEventIds.includes(event.id) || !matches(event.when, state, world)) continue;
      state.triggeredEventIds.push(event.id); applyEffects(event.effects, state, world); triggered = true;
      if (event.visibility === 'public' && event.text) narration.push(event.text);
    }
  }
  const ending = world.endings.find(candidate => matches(candidate.when, state, world));
  if (ending) state.ending = {id: ending.id, title: ending.title, text: ending.text};
  else if (state.elapsed >= world.timeLimit) state.ending = {id: 'timeout', title: '时间已到', text: world.timeoutEnding};
  return narration;
}
