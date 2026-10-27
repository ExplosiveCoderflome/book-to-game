import type { AdventureView, WorldContent } from '@novel-game/contracts';
import { moveTarget } from './world-move';

export interface WorldPlayOverlayState {
  currentLocationId: string;
  visitedLocationIds: string[];
  trailEdgeKeys: string[];
  blockedEdgeKeys: string[];
  /** Local (non-move) actions at the current location that session marks disabled. */
  blockedActionIds: string[];
}

/** Reconstruct move edges from adventure history labels against the published world. */
export function worldTrailFromHistory(
  content: WorldContent,
  history: AdventureView['history'],
): { trailEdgeKeys: string[]; visitedLocationIds: string[]; inferredLocationId: string } {
  let locationId = content.initialLocationId;
  const visited = new Set<string>();
  if (locationId) visited.add(locationId);
  const trailEdgeKeys: string[] = [];

  for (const entry of history) {
    const label = entry.actionLabel?.trim();
    if (!label || !locationId) continue;
    const atHere = content.actions.filter(a => a.locationId === locationId && a.label === label);
    const match =
      atHere.find(a => moveTarget(a.effects))
      ?? atHere[0]
      ?? content.actions.find(a => a.label === label && a.locationId === locationId);
    if (!match) continue;
    const to = moveTarget(match.effects);
    if (to && to !== locationId) {
      trailEdgeKeys.push(`${locationId}:${match.id}`);
      locationId = to;
      visited.add(to);
    }
  }

  return {
    trailEdgeKeys,
    visitedLocationIds: [...visited],
    inferredLocationId: locationId || content.initialLocationId,
  };
}

/** Dim move edges / local actions the adventure view currently marks disabled. */
export function blockedWorldActions(
  content: WorldContent,
  locationId: string,
  sessionActions: AdventureView['actions'],
): { blockedEdgeKeys: string[]; blockedActionIds: string[] } {
  const byId = new Map(sessionActions.map(a => [a.id, a]));
  const blockedEdgeKeys: string[] = [];
  const blockedActionIds: string[] = [];
  for (const action of content.actions) {
    if (action.locationId !== locationId) continue;
    const view = byId.get(action.id);
    if (!view || view.enabled) continue;
    const to = moveTarget(action.effects);
    if (to && to !== action.locationId) blockedEdgeKeys.push(`${action.locationId}:${action.id}`);
    else blockedActionIds.push(action.id);
  }
  return { blockedEdgeKeys, blockedActionIds };
}

export function worldPlayOverlayFromAdventure(
  content: WorldContent,
  adventure: Pick<AdventureView, 'location' | 'history' | 'actions'>,
): WorldPlayOverlayState {
  const { trailEdgeKeys, visitedLocationIds, inferredLocationId } = worldTrailFromHistory(content, adventure.history);
  const currentLocationId = adventure.location.id || inferredLocationId;
  if (currentLocationId && !visitedLocationIds.includes(currentLocationId)) {
    visitedLocationIds.push(currentLocationId);
  }
  const { blockedEdgeKeys, blockedActionIds } = blockedWorldActions(
    content,
    currentLocationId,
    adventure.actions,
  );
  return {
    currentLocationId,
    visitedLocationIds,
    trailEdgeKeys,
    blockedEdgeKeys,
    blockedActionIds,
  };
}
