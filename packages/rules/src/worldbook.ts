/** Pure worldbook runtime: place matching, hard-rule blocks, caps, spends, taken tags. */
import type { Worldbook, WorldbookEntry, WorldbookPlaceKind } from '@novel-game/contracts';

export function entryAppliesToScene(entry: WorldbookEntry, sceneId: string): boolean {
  if (entry.scope.type === 'global') return true;
  if (entry.scope.type !== 'scenes') return false;
  return entry.scope.sceneIds.includes(sceneId);
}

/**
 * Optional spatial context for location places. Callers resolve it via `locationSpatial(map, id)`
 * so worldbook stays ignorant of map geometry.
 */
export interface WorldbookPlaceContext { regionIds?: readonly string[] }

export function entryAppliesToLocation(entry: WorldbookEntry, locationId: string, ctx?: WorldbookPlaceContext): boolean {
  if (entry.scope.type === 'global') return true;
  if (entry.scope.type === 'regions') return (ctx?.regionIds ?? []).some(r => (entry.scope as { regionIds: string[] }).regionIds.includes(r));
  if (entry.scope.type !== 'locations') return false;
  return entry.scope.locationIds.includes(locationId);
}

export function entriesForPlace(
  worldbook: Worldbook | undefined,
  placeId: string,
  placeKind: WorldbookPlaceKind = 'scene',
  ctx?: WorldbookPlaceContext,
): WorldbookEntry[] {
  return (worldbook?.entries ?? []).filter(entry =>
    placeKind === 'location'
      ? entryAppliesToLocation(entry, placeId, ctx)
      : entryAppliesToScene(entry, placeId),
  );
}

export function entriesForScene(worldbook: Worldbook | undefined, sceneId: string): WorldbookEntry[] {
  return entriesForPlace(worldbook, sceneId, 'scene');
}

function choiceHasTag(choice: { tags?: string[] }, tag: string): boolean {
  return (choice.tags ?? []).includes(tag);
}

function choiceHasAnyTag(choice: { tags?: string[] }, tags: string[]): boolean {
  return tags.some(tag => choiceHasTag(choice, tag));
}

function inRange(value: number, min?: number, max?: number): boolean {
  if (min !== undefined && value < min) return false;
  if (max !== undefined && value > max) return false;
  return true;
}

function numericVar(
  variables: Record<string, string | number | boolean>,
  name: string,
): number | undefined {
  const current = variables[name];
  return typeof current === 'number' && Number.isFinite(current) ? current : undefined;
}

/**
 * Returns a zh-CN blocked reason when a hard worldbook rule forbids this choice
 * in the current scene / variable / taken-tag state. Undefined = allowed by worldbook.
 */
export function worldbookBlockReason(
  choice: { id: string; tags?: string[] },
  placeId: string,
  variables: Record<string, string | number | boolean>,
  worldbook: Worldbook | undefined,
  takenTags: readonly string[] = [],
  placeKind: WorldbookPlaceKind = 'scene',
  ctx?: WorldbookPlaceContext,
): string | undefined {
  const taken = new Set(takenTags);
  for (const entry of entriesForPlace(worldbook, placeId, placeKind, ctx)) {
    for (const constraint of entry.constraints ?? []) {
      if (constraint.type === 'forbid_choice_tags') {
        if (choiceHasAnyTag(choice, constraint.tags)) return constraint.message;
      }
      if (constraint.type === 'gate_tagged_choices') {
        if (!choiceHasAnyTag(choice, constraint.tags)) continue;
        const current = numericVar(variables, constraint.variable);
        if (current === undefined || !inRange(current, constraint.min, constraint.max)) {
          return constraint.message;
        }
      }
      if (constraint.type === 'require_min_variable') {
        if (!choiceHasAnyTag(choice, constraint.tags)) continue;
        const current = numericVar(variables, constraint.variable);
        if (current === undefined || current < constraint.min) return constraint.message;
      }
      if (constraint.type === 'require_max_variable') {
        if (!choiceHasAnyTag(choice, constraint.tags)) continue;
        const current = numericVar(variables, constraint.variable);
        if (current === undefined || current > constraint.max) return constraint.message;
      }
      if (constraint.type === 'spend_on_choice') {
        if (!choiceHasAnyTag(choice, constraint.tags)) continue;
        const current = numericVar(variables, constraint.variable);
        if (current === undefined || current < constraint.amount) return constraint.message;
      }
      if (constraint.type === 'one_path_lock') {
        const triggered = constraint.whenTags.some(tag => taken.has(tag));
        if (triggered && choiceHasAnyTag(choice, constraint.forbidTags)) return constraint.message;
      }
      if (constraint.type === 'upgrade_ladder') {
        const current = numericVar(variables, constraint.variable);
        for (const step of constraint.steps) {
          if (!choiceHasAnyTag(choice, step.tags)) continue;
          if (current === undefined || current < step.threshold) return constraint.message;
        }
      }
    }
  }
  return undefined;
}

/** Lowest maxDelta cap for a variable across all entries (global caps apply everywhere). */
export function worldbookIncrementCap(
  variable: string,
  worldbook: Worldbook | undefined,
): number | undefined {
  let cap: number | undefined;
  for (const entry of worldbook?.entries ?? []) {
    for (const constraint of entry.constraints ?? []) {
      if (constraint.type !== 'cap_variable_increment') continue;
      if (constraint.variable !== variable) continue;
      cap = cap === undefined ? constraint.maxDelta : Math.min(cap, constraint.maxDelta);
    }
  }
  return cap;
}

/** Resource spends to apply after a tagged choice succeeds (same projection scope as block). */
export function worldbookSpendsForChoice(
  choice: { tags?: string[] },
  placeId: string,
  worldbook: Worldbook | undefined,
  placeKind: WorldbookPlaceKind = 'scene',
  ctx?: WorldbookPlaceContext,
): Array<{ variable: string; amount: number }> {
  const spends: Array<{ variable: string; amount: number }> = [];
  for (const entry of entriesForPlace(worldbook, placeId, placeKind, ctx)) {
    for (const constraint of entry.constraints ?? []) {
      if (constraint.type !== 'spend_on_choice') continue;
      if (!choiceHasAnyTag(choice, constraint.tags)) continue;
      spends.push({ variable: constraint.variable, amount: constraint.amount });
    }
  }
  return spends;
}

/** Merge choice tags into the session's taken-tag set (for one_path_lock). */
export function mergeTakenTags(
  previous: readonly string[] | undefined,
  choiceTags: readonly string[] | undefined,
): string[] {
  const next = new Set(previous ?? []);
  for (const tag of choiceTags ?? []) next.add(tag);
  return [...next];
}
