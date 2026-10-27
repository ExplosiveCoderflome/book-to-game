import type { WorldContent, WorldCondition, WorldEffect } from '@novel-game/contracts';
import type { AdventureState } from './adventure-state.js';
export function matches(conditions: WorldCondition[], state: AdventureState): boolean {
  return conditions.every(condition => {
    switch (condition.kind) {
      case 'fact': return state.facts[condition.factId] === condition.value;
      case 'known': return state.knownFactIds.includes(condition.factId);
      case 'npc_knows': return state.npcs[condition.npcId]?.knownFactIds.includes(condition.factId) === true;
      case 'time': return state.elapsed >= condition.atLeast;
    }
  });
}
function addOnce(items: string[], id: string): void {if (!items.includes(id)) items.push(id);}
export function applyEffects(effects: WorldEffect[], state: AdventureState): void {
  for (const effect of effects) {
    switch (effect.kind) {
      case 'set': state.facts[effect.factId] = effect.value; break;
      case 'reveal': addOnce(state.knownFactIds, effect.factId); break;
      case 'npc_learn': addOnce(state.npcs[effect.npcId].knownFactIds, effect.factId); break;
      case 'move': state.locationId = effect.locationId; break;
      case 'npc_move': state.npcs[effect.npcId].locationId = effect.locationId; break;
    }
  }
}
export function visible(action: WorldContent['actions'][number], state: AdventureState): boolean {
  return action.locationId === state.locationId && !(action.once && state.performedActionIds.includes(action.id)) && matches(action.availableWhen, state);
}
export function blockedReason(action: WorldContent['actions'][number], world: WorldContent, state: AdventureState): string | undefined {
  if (action.timeCost > world.timeLimit - state.elapsed) return '剩余时间不足';
  if (action.npcId && state.npcs[action.npcId]?.locationId !== state.locationId) return '目标人物不在此处';
  if (!matches(action.requires, state)) return action.blockedReason.trim() || '尚未满足执行条件。';
  return undefined;
}
export function settle(world: WorldContent, state: AdventureState): string[] {
  const narration: string[] = [];
  // Events may make an earlier event eligible. Every event can fire only once, so this terminates.
  let triggered = true;
  while (triggered) {
    triggered = false;
    for (const event of world.events) {
      if (state.triggeredEventIds.includes(event.id) || !matches(event.when, state)) continue;
      state.triggeredEventIds.push(event.id); applyEffects(event.effects, state); triggered = true;
      if (event.visibility === 'public' && event.text) narration.push(event.text);
    }
  }
  const ending = world.endings.find(candidate => matches(candidate.when, state));
  if (ending) state.ending = {id: ending.id, title: ending.title, text: ending.text};
  else if (state.elapsed >= world.timeLimit) state.ending = {id: 'timeout', title: '时间已到', text: world.timeoutEnding};
  return narration;
}
