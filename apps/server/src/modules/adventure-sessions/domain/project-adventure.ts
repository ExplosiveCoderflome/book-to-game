import type { AdventureView, WorldRevision } from '@novel-game/contracts';
import { AppError } from '../../../shared/errors.js';
import type { AdventureState } from './adventure-state.js';
import { visible, blockedReason } from './rules.js';
import { systemWait } from './system-actions.js';
import { projectAdventureMap } from './map-view.js';

export function projectAdventure(state: AdventureState, revision: WorldRevision): AdventureView {
  const world = revision.content;
  const location = world.locations.find(item => item.id === state.locationId);
  if (!location) throw new AppError('INVALID_WORLD_STATE', '存档地点不存在', 500);
  const resources = { ...(state.resources ?? world.resources ?? {}) };
  const actions = state.ending ? [] : [...world.actions, systemWait(state.locationId)].filter(action => visible(action, state, world)).map(action => {
      const reason = blockedReason(action, world, state);
      return {id: action.id, label: action.label, description: action.description, timeCost: action.timeCost, risk: action.risk,
        enabled: reason === undefined, ...(reason === undefined ? {} : {blockedReason: reason})};
    });
  const map = projectAdventureMap(world, state, actions);
  return {id: state.id, worldRevisionId: state.worldRevisionId, turn: state.turn, elapsed: state.elapsed,
    timeLimit: world.timeLimit, ended: !!state.ending, playerRole: world.playerRole, goal: world.goal,
    location: {id: location.id, title: location.title, text: location.text},
    facts: world.facts.filter(fact => state.knownFactIds.includes(fact.id)).map(fact => ({id: fact.id, label: fact.label, description: fact.description, kind: fact.kind, value: state.facts[fact.id]})),
    resources,
    npcs: world.npcs.filter(npc => state.npcs[npc.id]?.locationId === state.locationId).map(npc => ({id: npc.id, name: npc.name, description: npc.description})),
    actions,
    ...(state.ending ? {ending: {...state.ending}} : {}),
    history: state.history.map(entry => ({...entry})), createdAt: state.createdAt, updatedAt: state.updatedAt,
    ...(map ? {map} : {}),
  };
}
