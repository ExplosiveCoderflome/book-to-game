import { randomUUID } from 'node:crypto';
import type { SourceDocument, SourceSummary } from '@novel-game/contracts';
import { AppError } from '../../../shared/errors.js';
import { decodeSource, parseNovelExport, parseTextChapters, type SourceEncoding } from '../domain/parse-source.js';

export interface SourceReader { get(id: string): SourceDocument }
export interface SourceRepository {
  save(document: SourceDocument, bytes: Uint8Array): void;
  get(id: string): SourceDocument | undefined;
  list(): SourceSummary[];
}

export class SourceService implements SourceReader {
  constructor(private readonly repository: SourceRepository) {}

  importFile(input: { title: string; filename: string; bytes: Uint8Array; encoding?: SourceEncoding }): SourceDocument {
    if (!(input.bytes instanceof Uint8Array) || input.bytes.byteLength === 0) {
      throw new AppError('INVALID_SOURCE', '请选择包含正文的小说文件。');
    }
    if (input.bytes.byteLength > 5 * 1024 * 1024) {
      throw new AppError('SOURCE_TOO_LARGE', '小说文件不能超过 5 MiB，请拆分后导入。', 413);
    }
    if (typeof input.title !== 'string' || !input.title.trim() || input.title.trim().length > 200 ||
        typeof input.filename !== 'string' || !input.filename.trim() || input.filename.length > 255) {
      throw new AppError('INVALID_SOURCE', '请输入 1–200 字的小说标题和有效文件名（最多 255 字）。');
    }
    const filename = input.filename.trim();
    const extension = filename.slice(filename.lastIndexOf('.')).toLowerCase();
    if (extension !== '.txt' && extension !== '.json') {
      throw new AppError('UNSUPPORTED_FORMAT', '仅支持 TXT 或原小说项目完整导出的 JSON 文件。', 415);
    }
    const { text, encoding } = decodeSource(input.bytes, input.encoding);
    const chapters = extension === '.json' ? parseNovelExport(text) : parseTextChapters(text);
    const document: SourceDocument = {
      id: randomUUID(), title: input.title.trim(), filename, encoding, chapters,
      chapterCount: chapters.length,
      charCount: chapters.reduce((count, entry) => count + entry.paragraphs.reduce((sum, paragraph) => sum + paragraph.text.length, 0), 0),
      createdAt: new Date().toISOString(),
    };
    this.repository.save(document, input.bytes);
    return document;
  }

  list(): SourceSummary[] { return this.repository.list(); }

  get(id: string): SourceDocument {
    const document = this.repository.get(id);
    if (!document) throw new AppError('SOURCE_NOT_FOUND', '小说来源不存在。', 404);
    return document;
  }
}
