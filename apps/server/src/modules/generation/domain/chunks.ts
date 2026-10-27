import type { Analysis, AnalysisResult, SourceDocument } from '@novel-game/contracts';
import { analysisSchema } from '@novel-game/contracts';
import { AppError } from '../../../shared/errors.js';
import type { SourceChunk } from './ports.js';

const CHUNK_CHARS = 12000;
export function chunkSource(source: SourceDocument): SourceChunk[] {
  const chunks: SourceChunk[] = [];
  let current: SourceChunk = {index: 0, chapterIds: [], paragraphs: []};
  let size = 0;
  const flush = () => {
    if (!current.paragraphs.length) return;
    chunks.push(current); current = {index: chunks.length, chapterIds: [], paragraphs: []}; size = 0;
  };
  for (const chapter of source.chapters) {
    for (const paragraph of chapter.paragraphs) {
      for (let offset = 0; offset < paragraph.text.length; offset += CHUNK_CHARS) {
        const text = paragraph.text.slice(offset, offset + CHUNK_CHARS);
        if (size + text.length > CHUNK_CHARS) flush();
        current.paragraphs.push({chapterId: chapter.id, paragraphId: paragraph.id, text});
        if (!current.chapterIds.includes(chapter.id)) current.chapterIds.push(chapter.id);
        size += text.length;
      }
    }
  }
  flush();
  if (!chunks.length) throw new AppError('EMPTY_SOURCE', '小说没有可分析的正文');
  if (chunks.length > 512) throw new AppError('GENERATION_LIMIT', '首期单次分析最多 512 个文本块，请分卷导入');
  return chunks;
}
export function validateAnalysis(input: Analysis, chunk: SourceChunk): Analysis {
  const result = analysisSchema.parse(input);
  const refs = new Set(chunk.paragraphs.map(p => `${p.chapterId}/${p.paragraphId}`));
  const groups = [
    ['characters', result.characters],
    ['locations', result.locations],
    ['worldRules', result.worldRules],
  ] as const;
  for (const [bucket, facts] of groups) {
    for (let index = 0; index < facts.length; index++) {
      const fact = facts[index];
      if (!fact.evidence.length || fact.evidence.some(e => !refs.has(`${e.chapterId}/${e.paragraphId}`))) {
        const path = `${bucket}.${index}.evidence`;
        throw new AppError('INVALID_EVIDENCE', `模型分析的证据没有指向当前文本块中的真实段落（${path}）`, 422, {
          path, issues: [{path, message: '证据必须引用当前文本块中的 chapterId 与 paragraphId'}],
        });
      }
    }
  }
  return result;
}
export function mergeAnalyses(parts: Analysis[], source: SourceDocument): AnalysisResult {
  // Preserve original evidence and conflicting names; semantic alias merging is deferred.
  return {
    summary: parts.map((p, i) => `【文本块 ${i + 1}】${p.summary}`).join('\n'),
    characters: parts.flatMap(p => p.characters), locations: parts.flatMap(p => p.locations),
    worldRules: parts.flatMap(p => p.worldRules), uncertainties: parts.flatMap(p => p.uncertainties),
    coverage: {chapterIds: source.chapters.filter(c => c.paragraphs.some(p => p.text.length > 0)).map(c => c.id), totalChapters: source.chapterCount},
  };
}
