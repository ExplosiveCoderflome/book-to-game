import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { SqliteDatabase as Database } from '../src/platform/database.js';
import iconv from 'iconv-lite';
import { SourceService, SqliteSourceRepository } from '../src/modules/sources/index.js';
import { AppError } from '../src/shared/errors.js';

function workspace(t: test.TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'novel-sources-'));
  const path = join(directory, 'sources.sqlite');
  const database = new Database(path);
  const repository = new SqliteSourceRepository(database);
  const service = new SourceService(repository);
  t.after(() => { if (database.open) database.close(); rmSync(directory, { recursive: true, force: true }); });
  return { database, repository, service, path };
}

test('imports BOM text with preface, Chinese and English chapter boundaries and preserves original bytes', (t) => {
  const { service, repository } = workspace(t);
  const bytes = Buffer.from('\ufeff前言\r\n说明一。\r\n\r\n第一章 初遇\r\n第一段。\r\n第二段。\r\nChapter 2: Return\r\nThe end.', 'utf8');
  const source = service.importFile({ title: '测试小说', filename: 'novel.TXT', bytes });
  assert.equal(source.encoding, 'utf8');
  assert.equal(source.title, '测试小说');
  assert.deepEqual(source.chapters.map((c) => c.title), ['前言', '第一章 初遇', 'Chapter 2: Return']);
  assert.deepEqual(source.chapters.map((c) => c.paragraphs.map((p) => p.text)), [['前言', '说明一。'], ['第一段。', '第二段。'], ['The end.']]);
  assert.deepEqual(source.chapters.map((c) => c.index), [0, 1, 2]);
  assert.equal(new Set(source.chapters.map((c) => c.id)).size, 3);
  assert.equal(new Set(source.chapters.flatMap((c) => c.paragraphs.map((p) => p.id))).size, 5);
  assert.deepEqual(repository.getOriginalBytes(source.id), bytes);
  assert.equal(service.list()[0].chapterCount, 3);
  assert.ok(source.charCount > 0);
});

test('reopening SQLite preserves immutable document references and caller mutation cannot change storage', (t) => {
  const { service, database, path } = workspace(t);
  const source = service.importFile({ title: 'Book', filename: 'book.txt', bytes: Buffer.from('Only one paragraph.') });
  const saved = structuredClone(source);
  source.chapters[0].paragraphs[0].text = 'Mutated';
  assert.deepEqual(service.get(saved.id), saved);
  database.close();
  const reopened = new Database(path);
  try {
    const fresh = new SourceService(new SqliteSourceRepository(reopened));
    assert.deepEqual(fresh.get(saved.id), saved);
    assert.equal(fresh.get(saved.id).chapters[0].title, '正文');
  } finally { reopened.close(); }
});

for (const encoding of ['utf16le', 'utf16be', 'gb18030'] as const) {
  test(`imports ${encoding} text without character loss`, (t) => {
    const { service, repository } = workspace(t);
    const text = '第一章 雪夜\n张三走进古城。𠀀';
    const encoded = iconv.encode(text, encoding);
    const bytes = encoding === 'gb18030' ? encoded : Buffer.concat([Buffer.from(encoding === 'utf16le' ? [0xff, 0xfe] : [0xfe, 0xff]), encoded]);
    const source = service.importFile({ title: '雪夜', filename: '雪夜.txt', bytes });
    assert.equal(source.encoding, encoding);
    assert.equal(source.chapters[0].paragraphs[0].text, '张三走进古城。𠀀');
    assert.deepEqual(repository.getOriginalBytes(source.id), bytes);
  });
}

test('supports explicit UTF16 without a BOM and rejects a mismatched BOM', (t) => {
  const { service } = workspace(t);
  const source = service.importFile({ title: 'Explicit', filename: 'book.txt', encoding: 'utf16be', bytes: iconv.encode('Chapter 1\nSnow falls.', 'utf16be') });
  assert.equal(source.chapters[0].paragraphs[0].text, 'Snow falls.');
  assert.throws(() => service.importFile({ title: 'Wrong', filename: 'book.txt', encoding: 'utf8', bytes: Buffer.from([0xff, 0xfe, 0x61, 0]) }), (error: unknown) => error instanceof AppError && error.status === 400);
});

test('imports only the recognized full novel JSON export and orders its chapters', (t) => {
  const { service, repository } = workspace(t);
  const bytes = Buffer.from(JSON.stringify({
    metadata: { version: '1.0', exportedAt: '2026-10-10' },
    data: { basic: { novel: { title: '原小说', genre: '奇幻' } }, chapter: { chapters: [
      { id: 'old-2', title: '第二章', order: 2, content: '<p>雪停了。</p>\n<p><script>alert(1)</script>回家。</p>' },
      { id: 'old-1', title: '第一章', order: 1, content: '雪下了。\r灯亮着。' },
    ] } },
  }));
  const source = service.importFile({ title: '导入小说', filename: 'export.json', bytes });
  assert.deepEqual(source.chapters.map((c) => c.title), ['第一章', '第二章']);
  assert.equal(source.chapters[0].paragraphs[0].text, '雪下了。');
  assert.equal(source.chapters[0].paragraphs[1].text, '灯亮着。');
  assert.ok(source.chapters[1].paragraphs[0].text.includes('雪停了。'));
  assert.deepEqual(service.get(source.id), source);
  assert.deepEqual(repository.getOriginalBytes(source.id), bytes);
});

test('failed imports leave no rows and reject empty, binary, unsupported and oversized input', (t) => {
  const { service } = workspace(t);
  const cases = [
    { filename: 'empty.txt', bytes: Buffer.from(' \n\t') },
    { filename: 'binary.txt', bytes: Buffer.from([0, 1, 2, 3, 4, 5]) },
    { filename: 'binary.txt', bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
    { filename: 'bad.txt', bytes: Buffer.from([0xff]), encoding: 'utf8' as const },
    { filename: 'book.pdf', bytes: Buffer.from('Plain text') },
    { filename: 'huge.txt', bytes: Buffer.alloc(5 * 1024 * 1024 + 1, 0x61) },
    { filename: 'other.json', bytes: Buffer.from('{"chapters":[{"content":"not an export"}]}') },
    { filename: 'invalid.json', bytes: Buffer.from('{') },
    { filename: 'bad-export.json', bytes: Buffer.from(JSON.stringify({ metadata: {}, data: { basic: { novel: { title: 'Book' } }, chapter: { chapters: [{ id: 'x', title: 'One', order: 1, content: 123 }] } } })) },
  ];
  for (const candidate of cases) {
    assert.throws(() => service.importFile({ title: 'Rejected', ...candidate }), (error: unknown) => error instanceof AppError && [400, 413, 415].includes(error.status), candidate.filename);
  }
  assert.deepEqual(service.list(), []);
});

test('a missing source reports a structured 404', (t) => {
  const { service } = workspace(t);
  assert.throws(() => service.get('missing'), (error: unknown) => error instanceof AppError && error.status === 404);
});

test('rejects escaped binary controls inside JSON chapter content without saving a source', (t) => {
  const { service } = workspace(t);
  const bytes = Buffer.from(JSON.stringify({ metadata: {}, data: {
    basic: { novel: { title: 'Book' } },
    chapter: { chapters: [{ id: 'one', title: 'One', order: 0, content: '正文\u0000隐藏二进制' }] },
  } }));
  assert.throws(() => service.importFile({ title: 'Book', filename: 'export.json', bytes }),
    (error: unknown) => error instanceof AppError && error.status === 400);
  assert.deepEqual(service.list(), []);
});
