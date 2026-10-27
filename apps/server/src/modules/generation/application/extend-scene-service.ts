import type { Draft, ExtendDraftSceneInput, GameContent } from '@novel-game/contracts';
import { AppError } from '../../../shared/errors.js';
import { mergeSceneExtension } from '../domain/merge-scene-extension.js';
import type { GenerationProvider } from '../domain/ports.js';

export interface DraftMutator {
  get(id: string): Draft;
  update(id: string, input: {version: number; content: GameContent}): Draft;
}

/** Synchronous-looking API that awaits the model; used by HTTP command. */
export async function extendDraftScene(
  drafts: DraftMutator,
  provider: GenerationProvider,
  input: ExtendDraftSceneInput,
  options: {providerConfigured: boolean} = {providerConfigured: true},
): Promise<Draft> {
  if (!options.providerConfigured) {
    throw new AppError('MODEL_NOT_CONFIGURED', '尚未配置模型。请进入“模型设置”后再延申节点。', 503);
  }
  if (!provider.extendScenes) {
    throw new AppError('EXTEND_PROVIDER_UNAVAILABLE', '当前生成器不支持节点延申', 503);
  }
  const draft = drafts.get(input.id);
  if (draft.version !== input.version) {
    throw new AppError('DRAFT_VERSION_CONFLICT', '草稿已更新，请刷新后再延申', 409);
  }
  if (!draft.content.scenes.some(scene => scene.id === input.sceneId)) {
    throw new AppError('SCENE_NOT_FOUND', `锚点场景不存在：${input.sceneId}`, 404);
  }
  const extension = await provider.extendScenes(
    draft.content,
    input.sceneId,
    input.direction ?? draft.content.premise,
    AbortSignal.timeout(120_000),
  );
  const content = mergeSceneExtension(draft.content, input.sceneId, extension);
  return drafts.update(input.id, {version: input.version, content});
}
