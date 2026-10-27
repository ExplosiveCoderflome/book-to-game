import {
  entriesForScene,
  fillSceneTextInputSchema,
  type Draft,
  type FillSceneTextInput,
  type FillSceneTextResult,
  type SourceDocument,
} from '@novel-game/contracts';
import { AppError } from '../../../shared/errors.js';

export interface DraftReader { get(id: string): Draft }
export interface SourceReader { get(id: string): SourceDocument }

export interface SceneFillModel {
  fillSceneText(input: {
    gameTitle: string;
    premise: string;
    direction: string;
    polishTitle: boolean;
    scene: { id: string; title: string; text: string; ending?: string; choiceLabels: string[] };
    neighborHints: { id: string; title: string }[];
    worldbookSnippets: { title: string; content: string; kind: string }[];
    sourceExcerpts: { chapterId: string; paragraphId: string; text: string }[];
  }, signal: AbortSignal): Promise<{ text: string; title?: string }>;
}

function sourceExcerpts(source: SourceDocument | undefined, evidence: { chapterId: string; paragraphId: string }[]): { chapterId: string; paragraphId: string; text: string }[] {
  if (!source) return [];
  const out: { chapterId: string; paragraphId: string; text: string }[] = [];
  for (const item of evidence.slice(0, 8)) {
    const chapter = source.chapters.find(c => c.id === item.chapterId);
    const paragraph = chapter?.paragraphs.find(p => p.id === item.paragraphId);
    if (paragraph?.text) {
      out.push({ chapterId: item.chapterId, paragraphId: item.paragraphId, text: paragraph.text.slice(0, 500) });
    }
  }
  if (out.length === 0) {
    for (const chapter of source.chapters.slice(0, 2)) {
      for (const paragraph of chapter.paragraphs.slice(0, 3)) {
        out.push({ chapterId: chapter.id, paragraphId: paragraph.id, text: paragraph.text.slice(0, 400) });
        if (out.length >= 4) return out;
      }
    }
  }
  return out;
}

/**
 * Author-time L3 assist: deepen one scene's body text (optional title polish).
 * Does NOT mutate the draft; the client applies the result as a dirty local edit.
 */
export async function fillDraftSceneText(
  drafts: DraftReader,
  sources: SourceReader,
  raw: FillSceneTextInput,
  model: SceneFillModel,
  signal: AbortSignal = AbortSignal.timeout(90_000),
): Promise<FillSceneTextResult> {
  const input = fillSceneTextInputSchema.parse(raw);
  const draft = drafts.get(input.id);
  const scene = draft.content.scenes.find(s => s.id === input.sceneId);
  if (!scene) {
    throw new AppError('SCENE_NOT_FOUND', `场景不存在：${input.sceneId}`, 404);
  }
  const title = (input.currentTitle?.trim() || scene.title).slice(0, 200);
  const text = (input.currentText ?? scene.text).slice(0, 12000);
  const polishTitle = !!input.polishTitle;
  const neighborIds = new Set(scene.choices.map(c => c.targetSceneId));
  const neighborHints = draft.content.scenes
    .filter(s => neighborIds.has(s.id))
    .slice(0, 6)
    .map(s => ({ id: s.id, title: s.title }));
  const worldbookSnippets = entriesForScene(draft.content.worldbook, scene.id).slice(0, 6).map(entry => ({
    title: entry.title.slice(0, 80),
    content: entry.content.slice(0, 240),
    kind: entry.kind,
  }));
  let source: SourceDocument | undefined;
  try { source = sources.get(draft.sourceId); } catch { source = undefined; }

  try {
    const modelOut = await model.fillSceneText({
      gameTitle: draft.content.title,
      premise: draft.content.premise,
      direction: input.direction?.trim() || draft.content.premise,
      polishTitle,
      scene: {
        id: scene.id,
        title,
        text,
        ending: scene.ending,
        choiceLabels: scene.choices.map(c => c.label),
      },
      neighborHints,
      worldbookSnippets,
      sourceExcerpts: sourceExcerpts(source, scene.evidence),
    }, signal);
    const filled = modelOut.text.trim().slice(0, 12000);
    if (!filled) {
      return { status: 'unavailable', sceneId: scene.id, text: null, title: null, reason: '模型未返回可用正文。' };
    }
    const polished = polishTitle && modelOut.title?.trim()
      ? modelOut.title.trim().slice(0, 200)
      : null;
    return { status: 'ok', sceneId: scene.id, text: filled, title: polished, reason: null };
  } catch (error) {
    if (error instanceof AppError && (error.code === 'SCENE_NOT_FOUND' || error.status === 404)) throw error;
    const reason = error instanceof AppError
      ? error.message
      : (error instanceof Error ? error.message : '补全文失败');
    return { status: 'unavailable', sceneId: scene.id, text: null, title: null, reason };
  }
}
