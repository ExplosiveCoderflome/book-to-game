import type { SourceDocument } from '@novel-game/contracts';
import { AppError } from '../../../shared/errors.js';

export function selectChapters(source: SourceDocument, chapterIds?: string[]): SourceDocument {
  if (!chapterIds) return source;
  const chosen = new Set(chapterIds);
  if (!chosen.size || chosen.size !== chapterIds.length || chapterIds.some(id => !source.chapters.some(c => c.id === id))) {
    throw new AppError('INVALID_CHAPTER_SCOPE', '改编章节必须属于当前原作，不能为空或重复');
  }
  const chapters = source.chapters.filter(c => chosen.has(c.id));
  return {...source, chapters, chapterCount: chapters.length,
    charCount: chapters.reduce((sum, c) => sum + c.paragraphs.reduce((n, p) => n + p.text.length, 0), 0)};
}
