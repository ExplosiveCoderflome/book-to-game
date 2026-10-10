import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { GameService, SqliteGameRepository } from '../src/modules/games/index.js';
import { AppError } from '../src/shared/errors.js';
import type { GameContent, SourceDocument } from '@novel-game/contracts';

const source: SourceDocument = {
  id: 'source-1', title: '故事', filename: 'story.txt', encoding: 'utf8', chapterCount: 1,
  charCount: 20, createdAt: '2026-10-10T00:00:00Z', chapters: [{ id: 'chapter-1', index: 0,
    title: '第一章', paragraphs: [{ id: 'paragraph-1', index: 0, text: '主人公走到了岔路口。' }] }],
};
const sourceReader = { get(id: string) {
  if (id !== source.id) throw new AppError('SOURCE_NOT_FOUND', 'Missing source', 404);
  return structuredClone(source);
} };
function content(): GameContent {
  return { title: '岔路', mode: 'story', premise: '决定旅途方向', adaptationNotes: '两种结局为改编', startSceneId: 'start',
    scenes: [
      { id: 'start', title: '岔路口', text: '前方有两条路。', origin: 'source', evidence: [{ chapterId: 'chapter-1', paragraphId: 'paragraph-1' }],
        choices: [{ id: 'left', label: '走左边', targetSceneId: 'safe' }, { id: 'right', label: '走右边', targetSceneId: 'lost' }] },
      { id: 'safe', title: '归来', text: '你回到村庄。', origin: 'adapted', evidence: [], choices: [], ending: '平安归来' },
      { id: 'lost', title: '迷途', text: '你在森林迷路。', origin: 'adapted', evidence: [], choices: [], ending: '迷失森林' },
    ] };
}
function setup() {
  const db = new Database(':memory:');
  return { db, games: new GameService(new SqliteGameRepository(db), sourceReader) };
}
const status = (expected: number) => (error: unknown) => error instanceof AppError && error.status === expected;

test('drafts accept incomplete graphs but reject malformed content and unknown sources', () => {
  const { db, games } = setup();
  try {
    const incomplete = content(); incomplete.scenes[0].choices[0].targetSceneId = 'missing';
    const draft = games.create({ sourceId: source.id, content: incomplete });
    assert.equal(draft.version, 1);
    assert.equal(games.validate(draft.id).valid, false);
    assert.throws(() => games.publish(draft.id, { version: 1 }), status(400));
    assert.throws(() => games.create({ sourceId: 'missing', content: content() }), status(404));
    assert.throws(() => games.create({ sourceId: source.id, content: { ...content(), title: '' } }));
    assert.equal(games.list().length, 1);
  } finally { db.close(); }
});

test('optimistic draft updates preserve earlier content and reject stale versions', () => {
  const { db, games } = setup();
  try {
    const draft = games.create({ sourceId: source.id, content: content() });
    const changed = content(); changed.title = '新的岔路';
    const updated = games.update(draft.id, { version: 1, content: changed });
    assert.equal(updated.version, 2); assert.equal(updated.content.title, '新的岔路');
    assert.throws(() => games.update(draft.id, { version: 1, content: content() }), status(409));
    assert.throws(() => games.update(draft.id, { version: 2, content: { ...content(), scenes: [] } }));
    assert.equal(games.get(draft.id).content.title, '新的岔路');
    assert.throws(() => games.publish(draft.id, { version: 1 }), status(409));
    assert.throws(() => games.get('missing'), status(404));
  } finally { db.close(); }
});

test('evidence must match the paragraph within its specified chapter', () => {
  const db = new Database(':memory:');
  try {
    const document = structuredClone(source);
    document.chapters.push({ id: 'chapter-2', index: 1, title: '第二章', paragraphs: [{ id: 'paragraph-2', index: 0, text: '后来发生的事情。' }] });
    const games = new GameService(new SqliteGameRepository(db), { get: () => document });
    const game = content(); game.scenes[0].evidence[0].paragraphId = 'paragraph-2';
    const draft = games.create({ sourceId: document.id, content: game });
    assert.equal(games.validate(draft.id).valid, false);
  } finally { db.close(); }
});

test('published revisions are immutable, idempotent per version, and survive reopening', () => {
  const directory = mkdtempSync(join(tmpdir(), 'novel-games-'));
  const path = join(directory, 'games.sqlite');
  let db = new Database(path);
  try {
    let games = new GameService(new SqliteGameRepository(db), sourceReader);
    const draft = games.create({ sourceId: source.id, content: content() });
    assert.equal(games.validate(draft.id).valid, true);
    const published = games.publish(draft.id, { version: 1 });
    assert.equal(games.publish(draft.id, { version: 1 }).id, published.id);
    const changed = content(); changed.scenes[0].text = '草稿被重新写过。';
    games.update(draft.id, { version: 1, content: changed });
    const second = games.publish(draft.id, { version: 2 });
    assert.notEqual(second.id, published.id);
    assert.equal(games.publish(draft.id, { version: 1 }).id, published.id);
    published.content.scenes[0].text = '调用方尝试修改。';
    db.close(); db = new Database(path);
    games = new GameService(new SqliteGameRepository(db), sourceReader);
    assert.equal(games.getRevision(published.id).content.scenes[0].text, '前方有两条路。');
    assert.equal(games.get(draft.id).version, 2);
    assert.equal(games.listRevisions().length, 2);
    assert.throws(() => games.getRevision('missing'), status(404));
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});

const invalidCases: [string, (game: GameContent) => void][] = [
  ['missing start', game => { game.startSceneId = 'absent'; }],
  ['duplicate scenes', game => { game.scenes[2].id = 'safe'; }],
  ['duplicate choices', game => { game.scenes[0].choices[1].id = 'left'; }],
  ['missing targets', game => { game.scenes[0].choices[0].targetSceneId = 'absent'; }],
  ['unreachable scenes', game => { game.scenes.push({ ...game.scenes[1], id: 'unreachable' }); }],
  ['dead ends', game => { delete game.scenes[1].ending; }],
  ['closed loops', game => { delete game.scenes[1].ending; game.scenes[1].choices = [{ id: 'loop', label: '原地转圈', targetSceneId: 'safe' }]; }],
  ['ending has choices', game => { game.scenes[1].choices = [{ id: 'leave', label: '离开', targetSceneId: 'lost' }]; }],
  ['no meaningful branch', game => { game.scenes[0].choices[1].targetSceneId = 'safe'; }],
  ['same ending outcome', game => { game.scenes[2].ending = '平安归来'; }],
  ['source scene lacks evidence', game => { game.scenes[0].evidence = []; }],
  ['unknown chapter evidence', game => { game.scenes[0].evidence[0].chapterId = 'absent'; }],
  ['unknown paragraph evidence', game => { game.scenes[0].evidence[0].paragraphId = 'absent'; }],
  ['adapted scene contains fabricated evidence', game => { game.scenes[1].evidence = [{ chapterId: 'chapter-1', paragraphId: 'absent' }]; }],
];
for (const [name, mutate] of invalidCases) {
  test(`publication rejects ${name}`, () => {
    const { db, games } = setup();
    try {
      const game = content(); mutate(game);
      const draft = games.create({ sourceId: source.id, content: game });
      const result = games.validate(draft.id);
      assert.equal(result.valid, false); assert.ok(result.errors.length > 0);
      assert.throws(() => games.publish(draft.id, { version: draft.version }), status(400));
      assert.equal(games.listRevisions().length, 0);
    } finally { db.close(); }
  });
}

test('loops with an available ending remain playable', () => {
  const { db, games } = setup();
  try {
    const game = content();
    game.scenes[0].choices.push({ id: 'wait', label: '等一会儿', targetSceneId: 'start' });
    const draft = games.create({ sourceId: source.id, content: game });
    assert.equal(games.validate(draft.id).valid, true);
  } finally { db.close(); }
});
