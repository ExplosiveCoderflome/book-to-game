import type { ExtractMapDraftInput, MapDraftDiff, MapDraftModelOutput, SourceDocument, WorldContent } from '@novel-game/contracts';
import { planMapDraft, worldFactions } from '@novel-game/rules';
import { AppError } from '../../../shared/errors.js';
import type { WorldService } from './world-service.js';

/** AI adapter seam for map extraction. Implementations only propose; nothing here writes the draft. */
export interface MapDraftModel {
  extractMapDraft(input: { text: string; existingLocations: string[]; existingFactions: string[] }, signal: AbortSignal): Promise<MapDraftModelOutput>;
}
export const MAP_DRAFT_TEXT_LIMIT = 16_000;

function sourceText(doc: SourceDocument, chapterIds: string[] | undefined, content: WorldContent): string {
  const wanted = new Set(chapterIds?.length ? chapterIds : content.sourceChapterIds);
  const chapters = doc.chapters.filter(c => wanted.size === 0 || wanted.has(c.id));
  return (chapters.length ? chapters : doc.chapters).map(c => `${c.title}\n${c.paragraphs.map(p => p.text).join('\n')}`).join('\n\n');
}

/** Read-only: returns a draft diff for author review. The world draft is not modified. */
export async function extractMapDraft(worlds: WorldService, readSource: (id: string) => SourceDocument, id: string, input: ExtractMapDraftInput,
  model: MapDraftModel, signal: AbortSignal = AbortSignal.timeout(120_000), modelName?: string): Promise<MapDraftDiff> {
  const draft = worlds.get(id);
  const text = (input.text?.trim() || sourceText(readSource(draft.sourceId), input.chapterIds, draft.content)).slice(0, MAP_DRAFT_TEXT_LIMIT);
  if (!text) throw new AppError('EMPTY_SOURCE', '没有可用于提取地图的原文', 422);
  const output = await model.extractMapDraft({ text, existingLocations: draft.content.locations.map(l => l.title),
    existingFactions: worldFactions(draft.content).map(f => f.name) }, signal);
  return { ...planMapDraft(draft.content, output), ...(modelName ? { model: modelName } : {}) };
}
