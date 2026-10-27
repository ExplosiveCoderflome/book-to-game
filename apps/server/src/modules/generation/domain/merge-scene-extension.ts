import type { CanvasLayout, GameContent, Scene, SceneExtension } from '@novel-game/contracts';
import { AppError } from '../../../shared/errors.js';

/** Merge model-proposed neighbors into the graph without wiping unrelated nodes. Explicit edges only. */
export function mergeSceneExtension(content: GameContent, anchorId: string, extension: SceneExtension): GameContent {
  const anchor = content.scenes.find(scene => scene.id === anchorId);
  if (!anchor) throw new AppError('SCENE_NOT_FOUND', `锚点场景不存在：${anchorId}`, 404);

  const existingIds = new Set(content.scenes.map(scene => scene.id));
  const newIds = new Set<string>();
  for (const scene of extension.scenes) {
    if (existingIds.has(scene.id)) {
      throw new AppError('SCENE_ID_CONFLICT', `延申场景 ID 与现有冲突：${scene.id}`, 422, {path: `scenes.${scene.id}`});
    }
    if (newIds.has(scene.id)) {
      throw new AppError('SCENE_ID_CONFLICT', `延申场景 ID 重复：${scene.id}`, 422, {path: `scenes.${scene.id}`});
    }
    newIds.add(scene.id);
  }

  const known = new Set([...existingIds, ...newIds]);
  for (const scene of extension.scenes) {
    for (const choice of scene.choices) {
      if (!known.has(choice.targetSceneId)) {
        throw new AppError('INVALID_EXTENSION_EDGE', `延申选择指向未知场景：${choice.targetSceneId}`, 422, {
          path: `scenes.${scene.id}.choices.${choice.id}`,
        });
      }
    }
  }
  for (const choice of extension.anchorChoices) {
    if (!known.has(choice.targetSceneId)) {
      throw new AppError('INVALID_EXTENSION_EDGE', `锚点新选择指向未知场景：${choice.targetSceneId}`, 422, {
        path: `anchorChoices.${choice.id}`,
      });
    }
    if (anchor.choices.some(existing => existing.id === choice.id)) {
      throw new AppError('CHOICE_ID_CONFLICT', `锚点已有同名选择：${choice.id}`, 422, {path: `anchorChoices.${choice.id}`});
    }
  }
  if (anchor.choices.length + extension.anchorChoices.length > 8) {
    throw new AppError('TOO_MANY_CHOICES', '锚点选择超过上限（8）', 422, {path: `scenes.${anchorId}.choices`});
  }

  const layout = placeNearAnchor(content.canvasLayout ?? {}, anchorId, extension.scenes);
  const scenes = content.scenes.map(scene => {
    if (scene.id !== anchorId) return scene;
    return {...scene, choices: [...scene.choices, ...extension.anchorChoices]};
  });
  return {
    ...content,
    canvasLayout: layout,
    scenes: [...scenes, ...extension.scenes],
  };
}

function placeNearAnchor(layout: CanvasLayout, anchorId: string, scenes: Scene[]): CanvasLayout {
  const base = layout[anchorId] ?? {x: 120, y: 160};
  const next = {...layout};
  scenes.forEach((scene, index) => {
    if (next[scene.id]) return;
    const col = index % 3;
    const row = Math.floor(index / 3);
    next[scene.id] = {x: base.x + 220 + col * 200, y: base.y - 80 + row * 140};
  });
  return next;
}
