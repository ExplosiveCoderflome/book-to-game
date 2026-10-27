import type { GameContent } from '@novel-game/contracts';

/** Scenes with no outgoing choices — natural anchors for progressive +1 growth. Cap for batch UX. */
export function findLeafSceneIds(content: Pick<GameContent, 'scenes'>, limit = 8): string[] {
  const leaves = content.scenes.filter(scene => scene.choices.length === 0).map(scene => scene.id);
  return leaves.slice(0, Math.max(0, limit));
}
