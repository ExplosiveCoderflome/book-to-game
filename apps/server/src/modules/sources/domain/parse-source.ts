import type { Chapter, Paragraph } from '@novel-game/contracts';
import { AppError } from '../../../shared/errors.js';

export type SourceEncoding = 'utf8' | 'utf16le' | 'utf16be' | 'gb18030';

const encodings: SourceEncoding[] = ['utf8', 'utf16le', 'utf16be', 'gb18030'];
const decoderLabels = { utf8: 'utf-8', utf16le: 'utf-16le', utf16be: 'utf-16be', gb18030: 'gb18030' };

function rejectBinaryControls(text: string): void {
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(text)) {
    throw new AppError('INVALID_SOURCE', '文件含二进制控制字符，请提供纯文本 TXT 或小说 JSON 导出。');
  }
}

/** Fatal decoders reject malformed sequences rather than inserting replacement characters. */
export function decodeSource(bytes: Uint8Array, requested?: SourceEncoding): { text: string; encoding: SourceEncoding } {
  if (requested !== undefined && !encodings.includes(requested)) {
    throw new AppError('INVALID_ENCODING', '请选择 utf8、utf16le、utf16be 或 gb18030 编码。');
  }
  if ((bytes[0] === 0xff && bytes[1] === 0xfe && bytes[2] === 0 && bytes[3] === 0) ||
      (bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 0xfe && bytes[3] === 0xff)) {
    throw new AppError('INVALID_ENCODING', '暂不支持 UTF-32，请转换为 UTF-8 TXT 后导入。');
  }
  const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? { encoding: 'utf8' as const, length: 3 }
    : bytes[0] === 0xff && bytes[1] === 0xfe ? { encoding: 'utf16le' as const, length: 2 }
    : bytes[0] === 0xfe && bytes[1] === 0xff ? { encoding: 'utf16be' as const, length: 2 } : undefined;
  if (requested && bom && requested !== bom.encoding) {
    throw new AppError('INVALID_ENCODING', '所选编码与文件 BOM 不一致，请选择匹配的编码。');
  }
  const candidates = requested ? [requested] : bom ? [bom.encoding] : ['utf8', 'gb18030'] as SourceEncoding[];
  for (const encoding of candidates) {
    let text: string;
    try {
      text = new TextDecoder(decoderLabels[encoding], { fatal: true }).decode(bom ? bytes.subarray(bom.length) : bytes);
    } catch {
      continue;
    }
    rejectBinaryControls(text);
    if (!text.trim()) throw new AppError('INVALID_SOURCE', '文件内容为空，请选择有正文的小说文件。');
    return { text: text.replace(/\r\n?/g, '\n'), encoding };
  }
  throw new AppError('INVALID_ENCODING', '文件不能无损解码，请指定正确编码或转换为 UTF-8 后导入。');
}

function paragraphs(text: string, chapterId: string): Paragraph[] {
  rejectBinaryControls(text);
  return text.replace(/\r\n?/g, '\n').split('\n').map((line) => line.trim()).filter(Boolean).map((line, index) => ({
    id: `${chapterId}-p${index + 1}`, index, text: line,
  }));
}

function chapter(title: string, text: string, index: number): Chapter {
  const id = `c${index + 1}`;
  return { id, index, title, paragraphs: paragraphs(text, id) };
}

export function parseTextChapters(text: string): Chapter[] {
  const result: Chapter[] = [];
  let heading: string | undefined;
  let lines: string[] = [];
  const flush = () => {
    const content = lines.join('\n');
    if (heading !== undefined || content.trim()) {
      result.push(chapter(heading ?? (result.length ? '正文' : '前言'), content, result.length));
    }
    lines = [];
  };
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (/^第[零〇一二三四五六七八九十百千万两\d]+[章节回卷部篇][^\n]{0,100}$/u.test(trimmed) ||
        /^chapter\s+(?:\d+|[ivxlcdm]+)\b[^\n]{0,100}$/iu.test(trimmed)) {
      flush();
      heading = trimmed;
    } else {
      lines.push(line);
    }
  }
  flush();
  if (heading === undefined && result.length === 1) result[0].title = '正文';
  requireContent(result);
  return result;
}

type JsonObject = Record<string, unknown>;
function object(value: unknown): value is JsonObject { return value !== null && typeof value === 'object' && !Array.isArray(value); }

/** Only the existing project's full export shape is accepted; chapter content stays inert text. */
export function parseNovelExport(text: string): Chapter[] {
  let raw: unknown;
  try { raw = JSON.parse(text); }
  catch { throw new AppError('INVALID_SOURCE', 'JSON 语法不完整，请重新从原小说项目导出完整 JSON。'); }
  if (!object(raw) || !object(raw.metadata) || !object(raw.data) || !object(raw.data.basic) ||
      !object(raw.data.basic.novel) || typeof raw.data.basic.novel.title !== 'string' || !raw.data.basic.novel.title.trim() ||
      !object(raw.data.chapter) || !Array.isArray(raw.data.chapter.chapters) || raw.data.chapter.chapters.length === 0) {
    throw new AppError('INVALID_SOURCE', '仅支持原小说项目的完整导出：metadata、data.basic.novel.title 和 data.chapter.chapters。');
  }
  const entries: { id: string; title: string; order: number; content: string }[] = [];
  const ids = new Set<string>();
  for (const [index, value] of raw.data.chapter.chapters.entries()) {
    if (!object(value) || typeof value.id !== 'string' || !value.id.trim() || ids.has(value.id) ||
        typeof value.title !== 'string' || !value.title.trim() || typeof value.order !== 'number' ||
        !Number.isSafeInteger(value.order) || value.order < 0 || typeof value.content !== 'string') {
      throw new AppError('INVALID_SOURCE', `导出章节 ${index + 1} 需要唯一字符串 id、标题、非负整数 order 和字符串 content。`);
    }
    ids.add(value.id);
    entries.push({ id: value.id, title: value.title.trim(), order: value.order, content: value.content });
  }
  const result = entries.sort((a, b) => a.order - b.order).map((entry, index) => chapter(entry.title, entry.content, index));
  requireContent(result);
  return result;
}

function requireContent(chapters: Chapter[]) {
  if (!chapters.some((entry) => entry.paragraphs.length > 0)) {
    throw new AppError('INVALID_SOURCE', '小说没有正文段落，请导入包含正文的文件。');
  }
}
