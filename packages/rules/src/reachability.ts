/** Variable-aware story reachability: BFS over (sceneId, variableState). */

import { applyStoryEffect, evalStoryCondition } from './kind-builtins.js';

export type ReachVarValue = string | number | boolean;

export type ReachCondition =
  | { type: 'variable.equals'; variable: string; value: ReachVarValue }
  | { type: 'variable.gte'; variable: string; value: number };

export type ReachEffect =
  | { type: 'variable.set'; variable: string; value: ReachVarValue }
  | { type: 'variable.increment'; variable: string; value: number };

export type ReachChoice = {
  id: string;
  targetSceneId: string;
  conditions?: ReachCondition[];
  effects?: ReachEffect[];
};

export type ReachScene = { id: string; choices: ReachChoice[]; ending?: string };

export type ReachabilityGraph = {
  startSceneId: string;
  scenes: ReachScene[];
  variables?: Record<string, ReachVarValue>;
};

export interface ReachabilityReport {
  topologicalEndingIds: string[];
  stateEndingIds: string[];
  stateEndingTexts: string[];
  /** Topologically reachable endings that no legal variable path can reach. */
  conditionBlockedEndingIds: string[];
  /** Conditional edges never available in any visited (scene, vars) state. */
  deadConditionalEdgeKeys: string[];
  stateReachableSceneIds: string[];
  truncated: boolean;
  stateCount: number;
}

const DEFAULT_MAX_STATES = 8000;

export function choiceAvailable(
  choice: Pick<ReachChoice, 'conditions'>,
  variables: Record<string, ReachVarValue>,
): boolean {
  return (choice.conditions ?? []).every(condition => evalStoryCondition(condition, variables));
}

export function applyChoiceEffects(
  choice: Pick<ReachChoice, 'effects'>,
  current: Record<string, ReachVarValue>,
): Record<string, ReachVarValue> | null {
  let variables = { ...current };
  for (const effect of choice.effects ?? []) {
    const next = applyStoryEffect(effect, variables);
    if (!next) return null;
    variables = next;
  }
  return variables;
}

function encodeVars(variables: Record<string, ReachVarValue>): string {
  const keys = Object.keys(variables).sort();
  return keys.map(key => `${key}=${JSON.stringify(variables[key])}`).join('&');
}

function topologicalEndings(startId: string, byId: Map<string, ReachScene>): Set<string> {
  const reached = new Set<string>();
  const endings = new Set<string>();
  const queue = [startId];
  while (queue.length) {
    const id = queue.pop()!;
    if (reached.has(id)) continue;
    const scene = byId.get(id);
    if (!scene) continue;
    reached.add(id);
    if (scene.ending?.trim()) {
      endings.add(id);
      continue;
    }
    for (const choice of scene.choices) queue.push(choice.targetSceneId);
  }
  return endings;
}


/** Cap numeric vars just above the highest threshold/set seen so increment loops stay finite. */
function numericCaps(content: ReachabilityGraph): Map<string, number> {
  const caps = new Map<string, number>();
  const bump = (name: string, value: number) => {
    if (!Number.isFinite(value)) return;
    const prev = caps.get(name);
    caps.set(name, prev === undefined ? value : Math.max(prev, value));
  };
  for (const [name, value] of Object.entries(content.variables ?? {})) {
    if (typeof value === 'number') bump(name, value);
  }
  for (const scene of content.scenes) {
    for (const choice of scene.choices) {
      for (const condition of choice.conditions ?? []) {
        if (condition.type === 'variable.gte') bump(condition.variable, condition.value);
        else if (typeof condition.value === 'number') bump(condition.variable, condition.value);
      }
      for (const effect of choice.effects ?? []) {
        if (typeof effect.value === 'number') bump(effect.variable, effect.value);
      }
    }
  }
  for (const [name, value] of [...caps.entries()]) caps.set(name, value + 1);
  return caps;
}

function clampVars(
  variables: Record<string, ReachVarValue>,
  caps: Map<string, number>,
): Record<string, ReachVarValue> {
  const next = { ...variables };
  for (const [name, cap] of caps) {
    const current = next[name];
    if (typeof current === 'number' && current > cap) next[name] = cap;
  }
  return next;
}

/**
 * Bounded BFS over (sceneId, variableState). Proves which endings are reachable
 * under legal choice sequences that respect conditions/effects.
 */
export function analyzeReachability(
  content: ReachabilityGraph,
  options: { maxStates?: number } = {},
): ReachabilityReport {
  const maxStates = options.maxStates ?? DEFAULT_MAX_STATES;
  const byId = new Map(content.scenes.map(scene => [scene.id, scene]));
  const topoEndings = topologicalEndings(content.startSceneId, byId);

  const caps = numericCaps(content);
  const initialVars = clampVars({ ...(content.variables ?? {}) }, caps);
  const visited = new Set<string>();
  const queue: Array<{ sceneId: string; vars: Record<string, ReachVarValue> }> = [];
  const startKey = `${content.startSceneId}|${encodeVars(initialVars)}`;
  queue.push({ sceneId: content.startSceneId, vars: initialVars });
  visited.add(startKey);

  const stateEndingIds = new Set<string>();
  const stateScenes = new Set<string>();
  const conditionalEdgeKeys = new Set<string>();
  const unlockedConditional = new Set<string>();
  let truncated = false;

  for (const scene of content.scenes) {
    for (const choice of scene.choices) {
      if ((choice.conditions?.length ?? 0) > 0) {
        conditionalEdgeKeys.add(`${scene.id}:${choice.id}`);
      }
    }
  }

  while (queue.length) {
    if (visited.size > maxStates) {
      truncated = true;
      break;
    }
    const { sceneId, vars } = queue.shift()!;
    const scene = byId.get(sceneId);
    if (!scene) continue;
    stateScenes.add(sceneId);

    if (scene.ending?.trim()) {
      stateEndingIds.add(sceneId);
      continue;
    }

    for (const choice of scene.choices) {
      const edgeKey = `${sceneId}:${choice.id}`;
      const hasCond = (choice.conditions?.length ?? 0) > 0;
      if (hasCond && !choiceAvailable(choice, vars)) continue;
      if (hasCond) unlockedConditional.add(edgeKey);

      const applied = applyChoiceEffects(choice, vars);
      if (!applied) continue;
      const nextVars = clampVars(applied, caps);

      const nextKey = `${choice.targetSceneId}|${encodeVars(nextVars)}`;
      if (visited.has(nextKey)) continue;
      if (visited.size >= maxStates) {
        truncated = true;
        break;
      }
      visited.add(nextKey);
      queue.push({ sceneId: choice.targetSceneId, vars: nextVars });
    }
    if (truncated) break;
  }

  const conditionBlockedEndingIds = [...topoEndings].filter(id => !stateEndingIds.has(id));
  const deadConditionalEdgeKeys = [...conditionalEdgeKeys].filter(key => !unlockedConditional.has(key));

  const stateEndingTexts = [...new Set(
    [...stateEndingIds]
      .map(id => byId.get(id)?.ending?.trim() ?? '')
      .filter(Boolean),
  )];

  return {
    topologicalEndingIds: [...topoEndings],
    stateEndingIds: [...stateEndingIds],
    stateEndingTexts,
    conditionBlockedEndingIds,
    deadConditionalEdgeKeys,
    stateReachableSceneIds: [...stateScenes],
    truncated,
    stateCount: visited.size,
  };
}
