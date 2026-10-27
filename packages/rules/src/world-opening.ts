/** Opening action density & initial-state condition matching for open worlds. */

import { SYSTEM_WAIT_ACTION_ID, type WorldCondition, type WorldContent, type WorldMap } from '@novel-game/contracts';
import { evalWorldCondition } from './kind-builtins.js';

/** Minimal snapshot for WorldCondition matching (opening eval + adventure runtime). */
export type WorldConditionState = {
  facts: Record<string, boolean>;
  knownFactIds: readonly string[];
  npcs: Record<string, { knownFactIds: readonly string[] }>;
  elapsed: number;
  /** Player location — required by map-aware kinds (at_terrain / in_faction_territory). */
  locationId?: string;
  /** Optional authored map; absent → map-aware kinds fail closed. */
  map?: WorldMap;
  /** Authored relation matrix + session overrides (faction_relation kind). */
  factionRelations?: WorldContent['factionRelations'];
  relationOverlay?: Record<string, { stance: 'ally' | 'neutral' | 'hostile'; standing: number }>;
  /** NPC locations (npc_at_location kind). */
  npcLocations?: Record<string, string>;
};

export type OpeningEvalState = WorldConditionState & {
  locationId: string;
  npcs: Record<string, { locationId: string; knownFactIds: string[] }>;
  knownFactIds: string[];
};

/** Build the factual snapshot a new adventure would start with (before settle). */
export function initialWorldState(world: WorldContent): OpeningEvalState {
  return {
    locationId: world.initialLocationId,
    facts: Object.fromEntries(world.facts.map(fact => [fact.id, fact.initialValue])),
    knownFactIds: world.facts.filter(fact => fact.playerKnown).map(fact => fact.id),
    npcs: Object.fromEntries(world.npcs.map(npc => [
      npc.id,
      { locationId: npc.initialLocationId, knownFactIds: [...npc.knownFactIds] },
    ])),
    elapsed: 0,
    ...(world.map ? { map: world.map } : {}),
    ...(world.factionRelations ? { factionRelations: world.factionRelations } : {}),
  };
}

export function matchesWorldConditions(conditions: WorldCondition[], state: WorldConditionState): boolean {
  return conditions.every(condition => evalWorldCondition(condition, state));
}

/** Pure time-sink labels — do not count toward opening density. */
const WAIT_LABEL = /^(等待|等待片刻|再等一会|再等一会儿|原地等待|休息一会|休息一会儿|wait|wait a (moment|bit|while))$/i;

export function isWaitLikeAction(action: { id: string; label: string }): boolean {
  return action.id === SYSTEM_WAIT_ACTION_ID || WAIT_LABEL.test(action.label.trim());
}

export type OpeningActionReport = {
  /** Visible at start (availableWhen met, at initial location). */
  visibleIds: string[];
  /** Visible and requires met — truly clickable (excludes wait-like). */
  executableIds: string[];
  /** Visible but requires unmet — must render disabled + blockedReason. */
  lockedVisibleIds: string[];
  count: number;
  ok: boolean;
  message: string | null;
};

/**
 * Count immediately executable non-wait actions at the start location.
 * Hard gate: count ≥ 3.
 */
export function assessOpeningActions(world: WorldContent): OpeningActionReport {
  const state = initialWorldState(world);
  const atStart = world.actions.filter(action => action.locationId === world.initialLocationId);
  const visible = atStart.filter(action => matchesWorldConditions(action.availableWhen, state));
  const executable = visible.filter(action =>
    matchesWorldConditions(action.requires, state) && !isWaitLikeAction(action));
  const lockedVisible = visible.filter(action =>
    !matchesWorldConditions(action.requires, state) && action.id !== SYSTEM_WAIT_ACTION_ID);
  const count = executable.length;
  const ok = count >= 3;
  return {
    visibleIds: visible.map(a => a.id),
    executableIds: executable.map(a => a.id),
    lockedVisibleIds: lockedVisible.map(a => a.id),
    count,
    ok,
    message: ok ? null : `开局可执行行动不足：起始地点仅有 ${count} 个立即可执行行动（不含等待），至少需要 3 个`,
  };
}
