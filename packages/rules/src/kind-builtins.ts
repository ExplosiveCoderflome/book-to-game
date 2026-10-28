/**
 * Built-in kind catalog + evaluators. Populated at module init.
 * Schema authority remains contracts' zod unions; kinds here must stay in sync.
 */

import type { WorldCondition } from '@novel-game/contracts';
import { KindRegistry, type KindMeta } from './kind-registry.js';
import type { ReachCondition, ReachEffect, ReachVarValue } from './reachability.js';
import type { WorldConditionState } from './world-opening.js';
import { locationSpatial } from './map-geometry.js';
import { effectiveRelation } from './factions.js';

export type StoryConditionEvaluator = (
  condition: ReachCondition,
  variables: Record<string, ReachVarValue>,
) => boolean;

export type StoryEffectApplier = (
  effect: ReachEffect,
  variables: Record<string, ReachVarValue>,
) => Record<string, ReachVarValue> | null;

export type WorldConditionEvaluator = (
  condition: WorldCondition,
  state: WorldConditionState,
) => boolean;

export const storyConditionKinds = new KindRegistry<StoryConditionEvaluator>();
export const storyEffectKinds = new KindRegistry<StoryEffectApplier>();
export const worldConditionKinds = new KindRegistry<WorldConditionEvaluator>();
/** Metadata only in v1 — pure apply still lives in adventure-sessions (worldbook caps). */
export const worldEffectKinds = new KindRegistry();

/** POI cell of the player's current location (first POI wins). */
export function locationCell(state: WorldConditionState): string | undefined {
  return locationSpatial(state.map, state.locationId).cell;
}

function registerBuiltins(): void {
  storyConditionKinds
    .register({
      kind: 'variable.equals',
      family: 'story.condition',
      label: '等于',
      description: '变量当前值严格等于给定值时条件成立',
      evaluate: (condition, variables) => {
        if (condition.type !== 'variable.equals') return false;
        if (!Object.hasOwn(variables, condition.variable)) return false;
        return variables[condition.variable] === condition.value;
      },
    })
    .register({
      kind: 'variable.gte',
      family: 'story.condition',
      label: '大于或等于',
      description: '数值变量 ≥ 阈值时条件成立（变量须为有限数字）',
      evaluate: (condition, variables) => {
        if (condition.type !== 'variable.gte') return false;
        if (!Object.hasOwn(variables, condition.variable)) return false;
        const current = variables[condition.variable];
        return typeof current === 'number' && Number.isFinite(current) && current >= condition.value;
      },
    });

  storyEffectKinds
    .register({
      kind: 'variable.set',
      family: 'story.effect',
      label: '设置为',
      description: '将已声明变量设为给定值（类型须与初值一致）',
      evaluate: (effect, variables) => {
        if (effect.type !== 'variable.set') return null;
        if (!Object.hasOwn(variables, effect.variable)) return null;
        const previous = variables[effect.variable];
        if (typeof previous !== typeof effect.value) return null;
        if (typeof effect.value === 'number' && !Number.isFinite(effect.value)) return null;
        return { ...variables, [effect.variable]: effect.value };
      },
    })
    .register({
      kind: 'variable.increment',
      family: 'story.effect',
      label: '增加（负数为减少）',
      description: '对数值变量加减增量（结果须仍为有限数字）',
      evaluate: (effect, variables) => {
        if (effect.type !== 'variable.increment') return null;
        if (!Object.hasOwn(variables, effect.variable)) return null;
        const previous = variables[effect.variable];
        if (typeof previous !== 'number' || typeof effect.value !== 'number') return null;
        const value = previous + effect.value;
        if (!Number.isFinite(value)) return null;
        return { ...variables, [effect.variable]: value };
      },
    });

  worldConditionKinds
    .register({
      kind: 'fact',
      family: 'world.condition',
      label: '事实值',
      description: '世界事实当前布尔值等于给定值',
      evaluate: (condition, state) =>
        condition.kind === 'fact' && state.facts[condition.factId] === condition.value,
    })
    .register({
      kind: 'known',
      family: 'world.condition',
      label: '玩家已知',
      description: '玩家已揭示该事实',
      evaluate: (condition, state) =>
        condition.kind === 'known' && state.knownFactIds.includes(condition.factId),
    })
    .register({
      kind: 'npc_knows',
      family: 'world.condition',
      label: 'NPC 已知',
      description: '指定 NPC 已知该事实',
      evaluate: (condition, state) =>
        condition.kind === 'npc_knows'
        && state.npcs[condition.npcId]?.knownFactIds.includes(condition.factId) === true,
    })
    .register({
      kind: 'time',
      family: 'world.condition',
      label: '时间至少',
      description: '已消耗时间 ≥ 阈值',
      evaluate: (condition, state) =>
        condition.kind === 'time' && state.elapsed >= condition.atLeast,
    })
    .register({
      kind: 'at_terrain',
      family: 'world.condition',
      label: '所在地形',
      description: '玩家当前地点在地图上的格子地形属于所列地形之一（无地图/未放置 → 不成立）',
      evaluate: (condition, state) => {
        if (condition.kind !== 'at_terrain') return false;
        const terrain = locationSpatial(state.map, state.locationId).terrainId;
        return terrain !== undefined && condition.terrainIds.includes(terrain);
      },
    })
    .register({
      kind: 'in_faction_territory',
      family: 'world.condition',
      label: '位于势力领土',
      description: '玩家当前地点所在格子归属所列势力之一（作者基线领土）',
      evaluate: (condition, state) => {
        if (condition.kind !== 'in_faction_territory') return false;
        const owner = locationSpatial(state.map, state.locationId).factionId;
        return owner !== undefined && condition.factionIds.includes(owner);
      },
    })
    .register({
      kind: 'in_region',
      family: 'world.condition',
      label: '位于区域',
      description: '玩家当前地点位于所列区域/街区之一（无地图/未放置/无区域 → 不成立）',
      evaluate: (condition, state) => {
        if (condition.kind !== 'in_region') return false;
        return locationSpatial(state.map, state.locationId).regionIds.some(r => condition.regionIds.includes(r));
      },
    })
    .register({
      kind: 'faction_relation',
      family: 'world.condition',
      label: '势力关系',
      description: '两势力当前关系（会话变化优先于作者设定）符合所列立场且好感在区间内',
      evaluate: (condition, state) => {
        if (condition.kind !== 'faction_relation') return false;
        const r = effectiveRelation({ factionRelations: state.factionRelations }, state.relationOverlay, condition.a, condition.b);
        if (condition.stances && !condition.stances.includes(r.stance)) return false;
        if (condition.atLeast !== undefined && r.standing < condition.atLeast) return false;
        if (condition.atMost !== undefined && r.standing > condition.atMost) return false;
        return true;
      },
    })
    .register({
      kind: 'npc_at_location',
      family: 'world.condition',
      label: '人物在某地',
      description: '指定 NPC 当前位于该地点',
      evaluate: (condition, state) => {
        if (condition.kind !== 'npc_at_location') return false;
        const loc = state.npcLocations?.[condition.npcId] ?? (state.npcs[condition.npcId] as { locationId?: string } | undefined)?.locationId;
        return loc === condition.locationId;
      },
    })
    .register({
      kind: 'resource',
      family: 'world.condition',
      label: '资源至少',
      description: '开放世界数值资源当前值 ≥ 阈值（缺省按 0）',
      evaluate: (condition, state) => {
        if (condition.kind !== 'resource') return false;
        const current = state.resources?.[condition.resourceId] ?? 0;
        if (!Number.isFinite(current)) return false;
        if (condition.atLeast !== undefined && current < condition.atLeast) return false;
        if (condition.atMost !== undefined && current > condition.atMost) return false;
        return condition.atLeast !== undefined || condition.atMost !== undefined;
      },
    });

  worldEffectKinds
    .register({
      kind: 'set',
      family: 'world.effect',
      label: '设置事实',
      description: '设置世界事实布尔值',
    })
    .register({
      kind: 'reveal',
      family: 'world.effect',
      label: '揭示给玩家',
      description: '将事实加入玩家已知集合',
    })
    .register({
      kind: 'npc_learn',
      family: 'world.effect',
      label: 'NPC 获知',
      description: '指定 NPC 获知事实',
    })
    .register({
      kind: 'move',
      family: 'world.effect',
      label: '玩家移动',
      description: '将玩家移到目标地点',
    })
    .register({
      kind: 'npc_move',
      family: 'world.effect',
      label: 'NPC 移动',
      description: '将 NPC 移到目标地点',
    })
    .register({
      kind: 'resource',
      family: 'world.effect',
      label: '资源增减',
      description: '调整开放世界数值资源（可受世界书上限约束）',
    })
    .register({
      kind: 'set_territory',
      family: 'world.effect',
      label: '改变领土',
      description: '本局中把指定格或整片区域划归某势力（或设为无主）；作者地图不变',
    })
    .register({
      kind: 'set_faction_relation',
      family: 'world.effect',
      label: '改变势力关系',
      description: '本局中设置两势力立场/好感，或按增量调整好感（±100 封顶）',
    })
    .register({
      kind: 'start_encounter',
      family: 'world.effect',
      label: '开始遭遇（桩）',
      description: '遭遇桩：写入开战旗（enc_engaged_*）并揭示；不启动战斗 runtime / 血条',
    });
}

registerBuiltins();

/** Fail-closed: unknown kind or missing evaluator → condition not met. */
export function evalStoryCondition(
  condition: ReachCondition,
  variables: Record<string, ReachVarValue>,
): boolean {
  const entry = storyConditionKinds.get(condition.type);
  return entry?.evaluate?.(condition, variables) ?? false;
}

/**
 * Apply one story effect via registry.
 * Returns null on unknown kind, type mismatch, or non-finite number.
 */
export function applyStoryEffect(
  effect: ReachEffect,
  variables: Record<string, ReachVarValue>,
): Record<string, ReachVarValue> | null {
  const entry = storyEffectKinds.get(effect.type);
  return entry?.evaluate?.(effect, variables) ?? null;
}

/** Fail-closed: unknown world condition kind → not matched. */
export function evalWorldCondition(
  condition: WorldCondition,
  state: WorldConditionState,
): boolean {
  // S1 kinds (clock / storylet_seen / one-level anyOf) are evaluated here, outside the
  // metadata registry, so the legacy kind list (and its snapshot tests) stays unchanged.
  if (condition.kind === 'clock') {
    const month = state.elapsed;
    if (condition.atLeastMonth !== undefined && month < condition.atLeastMonth) return false;
    if (condition.atMostMonth !== undefined && month > condition.atMostMonth) return false;
    if (condition.monthOfYearIn) {
      const calendarMonth = (((state.clockStartMonth ?? 1) - 1 + month) % 12) + 1;
      if (!condition.monthOfYearIn.includes(calendarMonth)) return false;
    }
    return condition.atLeastMonth !== undefined || condition.atMostMonth !== undefined || condition.monthOfYearIn !== undefined;
  }
  if (condition.kind === 'storylet_seen') {
    const seen = state.storyletSeen?.[condition.storyletId] ?? 0;
    if (seen < (condition.atLeast ?? 1)) return false;
    return condition.atMost === undefined || seen <= condition.atMost;
  }
  if (condition.kind === 'anyOf') return condition.conditions.some(member => evalWorldCondition(member, state));
  const entry = worldConditionKinds.get(condition.kind);
  return entry?.evaluate?.(condition, state) ?? false;
}

export function listAllKindMeta(): KindMeta[] {
  return [
    ...storyConditionKinds.list(),
    ...storyEffectKinds.list(),
    ...worldConditionKinds.list(),
    ...worldEffectKinds.list(),
  ];
}

/** Re-seed builtins after a test clears a registry. */
export function resetBuiltinKinds(): void {
  storyConditionKinds.clear();
  storyEffectKinds.clear();
  worldConditionKinds.clear();
  worldEffectKinds.clear();
  registerBuiltins();
}
