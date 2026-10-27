import type { Choice, GameContent, SessionView, VariableValue } from '@novel-game/contracts';

export interface PlayOverlayState {
  currentSceneId: string;
  visitedSceneIds: string[];
  trailEdgeKeys: string[];
  blockedEdgeKeys: string[];
}

export function choiceAvailable(choice: Choice, variables: Record<string, VariableValue>): boolean {
  return (choice.conditions ?? []).every(condition => {
    if (!Object.hasOwn(variables, condition.variable)) return false;
    const current = variables[condition.variable];
    return condition.type === 'variable.equals'
      ? current === condition.value
      : typeof current === 'number' && Number.isFinite(current) && current >= condition.value;
  });
}

/** Reconstruct taken edges from session history against the published graph. */
export function trailFromHistory(
  content: GameContent,
  history: SessionView['history'],
): { trailEdgeKeys: string[]; visitedSceneIds: string[] } {
  const visited = new Set<string>();
  const trailEdgeKeys: string[] = [];
  const byId = new Map(content.scenes.map(scene => [scene.id, scene]));

  for (let index = 0; index < history.length; index++) {
    const entry = history[index]!;
    visited.add(entry.sceneId);
    if (index === 0) continue;
    const prev = history[index - 1]!;
    const prevScene = byId.get(prev.sceneId);
    if (!prevScene) continue;
    const match =
      prevScene.choices.find(choice => choice.label === entry.choiceLabel && choice.targetSceneId === entry.sceneId)
      ?? prevScene.choices.find(choice => choice.targetSceneId === entry.sceneId && (!entry.choiceLabel || choice.label === entry.choiceLabel))
      ?? prevScene.choices.find(choice => choice.targetSceneId === entry.sceneId);
    if (match) trailEdgeKeys.push(`${prevScene.id}:${match.id}`);
  }

  return { trailEdgeKeys, visitedSceneIds: [...visited] };
}

/** Edges from the current scene whose conditions fail under the session variables. */
export function blockedEdgesForScene(
  content: GameContent,
  sceneId: string,
  variables: Record<string, VariableValue> = {},
): string[] {
  const scene = content.scenes.find(item => item.id === sceneId);
  if (!scene) return [];
  return scene.choices
    .filter(choice => (choice.conditions?.length ?? 0) > 0 && !choiceAvailable(choice, variables))
    .map(choice => `${scene.id}:${choice.id}`);
}

export function playOverlayFromSession(content: GameContent, session: Pick<SessionView, 'scene' | 'history' | 'variables'>): PlayOverlayState {
  const { trailEdgeKeys, visitedSceneIds } = trailFromHistory(content, session.history);
  const currentSceneId = session.scene.id;
  if (!visitedSceneIds.includes(currentSceneId)) visitedSceneIds.push(currentSceneId);
  return {
    currentSceneId,
    visitedSceneIds,
    trailEdgeKeys,
    blockedEdgeKeys: blockedEdgesForScene(content, currentSceneId, session.variables ?? {}),
  };
}
