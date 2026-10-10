import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { GameService, SqliteGameRepository } from '../src/modules/games/index.js';
import { SessionService, SqliteSessionRepository } from '../src/modules/sessions/index.js';
import { AppError } from '../src/shared/errors.js';
import type { GameContent, SourceDocument } from '@novel-game/contracts';

const source: SourceDocument = { id: 'source-1', title: '故事', filename: 'story.txt', encoding: 'utf8', chapterCount: 1,
  charCount: 20, createdAt: '2026-10-10T00:00:00Z', chapters: [{ id: 'chapter-1', index: 0, title: '第一章',
    paragraphs: [{ id: 'paragraph-1', index: 0, text: '前方有两条路。' }] }] };
function content(): GameContent {
  return { title: '岔路', mode: 'story', premise: '决定旅途方向', adaptationNotes: '结局为改编', startSceneId: 'start', scenes: [
    { id: 'start', title: '岔路口', text: '前方有两条路。', origin: 'source', evidence: [{ chapterId: 'chapter-1', paragraphId: 'paragraph-1' }],
      choices: [{ id: 'left', label: '走左边', targetSceneId: 'safe' }, { id: 'right', label: '走右边', targetSceneId: 'lost' }, { id: 'wait', label: '等一会', targetSceneId: 'start' }] },
    { id: 'safe', title: '归来', text: '你回到村庄。', origin: 'adapted', evidence: [], choices: [], ending: '平安归来' },
    { id: 'lost', title: '迷途', text: '你在森林迷路。', origin: 'adapted', evidence: [], choices: [], ending: '迷失森林' },
  ] };
}
function setup(db: Database.Database) {
  const games = new GameService(new SqliteGameRepository(db), { get: () => structuredClone(source) });
  const sessions = new SessionService(new SqliteSessionRepository(db), games);
  return { games, sessions };
}
const status = (expected: number) => (error: unknown) => error instanceof AppError && error.status === expected;

test('sessions require a published revision and expose only the current scene and visited history', () => {
  const db = new Database(':memory:');
  try {
    const { games, sessions } = setup(db);
    const draft = games.create({ sourceId: source.id, content: content() });
    assert.throws(() => sessions.start({ gameRevisionId: draft.id }), status(404));
    const revision = games.publish(draft.id, { version: 1 });
    const view = sessions.start({ gameRevisionId: revision.id });
    assert.equal(view.turn, 0); assert.equal(view.ended, false);
    assert.deepEqual(view.scene.choices[0], { id: 'left', label: '走左边' });
    assert.deepEqual(view.history.map(entry => entry.sceneId), ['start']);
    const serialized = JSON.stringify(view);
    assert.equal(serialized.includes('targetSceneId'), false);
    assert.equal(serialized.includes('迷失森林'), false);
    assert.equal(serialized.includes('premise'), false);
    assert.equal(sessions.list().length, 1);
    assert.throws(() => sessions.get('missing'), status(404));
  } finally { db.close(); }
});

test('choice transitions append history, end the session, and remain pinned to the original revision', () => {
  const db = new Database(':memory:');
  try {
    const { games, sessions } = setup(db);
    const draft = games.create({ sourceId: source.id, content: content() });
    const revision = games.publish(draft.id, { version: 1 });
    const start = sessions.start({ gameRevisionId: revision.id });
    const changed = content(); changed.scenes[1].text = '后来的新版本。';
    games.update(draft.id, { version: 1, content: changed }); games.publish(draft.id, { version: 2 });
    const result = sessions.act(start.id, { choiceId: 'left', expectedTurn: 0, requestId: randomUUID() });
    assert.equal(result.turn, 1); assert.equal(result.ended, true);
    assert.equal(result.scene.text, '你回到村庄。'); assert.equal(result.gameRevisionId, revision.id);
    assert.deepEqual(result.history.map(entry => [entry.turn, entry.sceneId, entry.choiceLabel]), [[0, 'start', undefined], [1, 'safe', '走左边']]);
    assert.throws(() => sessions.act(start.id, { choiceId: 'left', expectedTurn: 1, requestId: randomUUID() }), status(409));
    assert.equal(sessions.get(start.id).turn, 1);
  } finally { db.close(); }
});

test('lost action responses replay the exact original view after later moves and SQLite reopening', () => {
  const directory = mkdtempSync(join(tmpdir(), 'novel-sessions-'));
  const path = join(directory, 'sessions.sqlite');
  let db = new Database(path);
  try {
    let { games, sessions } = setup(db);
    const draft = games.create({ sourceId: source.id, content: content() });
    const revision = games.publish(draft.id, { version: 1 });
    const start = sessions.start({ gameRevisionId: revision.id });
    const input = { choiceId: 'wait', expectedTurn: 0, requestId: randomUUID() };
    const first = sessions.act(start.id, input);
    assert.deepEqual(sessions.act(start.id, input), first);
    const ended = sessions.act(start.id, { choiceId: 'right', expectedTurn: 1, requestId: randomUUID() });
    assert.equal(ended.turn, 2); assert.equal(ended.ended, true);
    db.close(); db = new Database(path);
    ({ games, sessions } = setup(db));
    assert.deepEqual(sessions.act(start.id, input), first);
    assert.equal(sessions.get(start.id).turn, 2);
    assert.equal(sessions.get(start.id).history.length, 3);
    assert.throws(() => sessions.act(start.id, { ...input, choiceId: 'left' }), status(409));
    assert.throws(() => sessions.act(start.id, { ...input, expectedTurn: 1 }), status(409));
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('unknown choices and stale turns do not mutate state or reserve request IDs', () => {
  const db = new Database(':memory:');
  try {
    const { games, sessions } = setup(db);
    const draft = games.create({ sourceId: source.id, content: content() });
    const start = sessions.start({ gameRevisionId: games.publish(draft.id, { version: 1 }).id });
    const requestId = randomUUID();
    assert.throws(() => sessions.act(start.id, { choiceId: 'absent', expectedTurn: 0, requestId }), status(400));
    assert.equal(sessions.get(start.id).history.length, 1);
    assert.throws(() => sessions.act(start.id, { choiceId: 'left', expectedTurn: 9, requestId }), status(409));
    const moved = sessions.act(start.id, { choiceId: 'wait', expectedTurn: 0, requestId });
    assert.equal(moved.turn, 1);
    assert.throws(() => sessions.act(start.id, { choiceId: 'left', expectedTurn: 0, requestId: randomUUID() }), status(409));
    assert.equal(sessions.get(start.id).turn, 1);
    assert.equal(sessions.get(start.id).history.length, 2);
    assert.throws(() => sessions.act(start.id, { choiceId: 'left', expectedTurn: -1, requestId: randomUUID() }));
  } finally { db.close(); }
});

test('sessions on two SQLite connections serialize actions against the same expected turn', () => {
  const directory = mkdtempSync(join(tmpdir(), 'novel-session-concurrency-'));
  const path = join(directory, 'sessions.sqlite');
  const db1 = new Database(path); const db2 = new Database(path);
  try {
    const first = setup(db1); const second = setup(db2);
    const draft = first.games.create({ sourceId: source.id, content: content() });
    const start = first.sessions.start({ gameRevisionId: first.games.publish(draft.id, { version: 1 }).id });
    const input = { choiceId: 'wait', expectedTurn: 0, requestId: randomUUID() };
    const moved = first.sessions.act(start.id, input);
    assert.throws(() => second.sessions.act(start.id, { choiceId: 'left', expectedTurn: 0, requestId: randomUUID() }), status(409));
    assert.deepEqual(second.sessions.act(start.id, input), moved);
    assert.equal(second.sessions.get(start.id).history.length, 2);
  } finally { db1.close(); db2.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('a failed state write rolls back its action event and replay response', () => {
  const db = new Database(':memory:');
  try {
    const { games, sessions } = setup(db);
    const draft = games.create({ sourceId: source.id, content: content() });
    const start = sessions.start({ gameRevisionId: games.publish(draft.id, { version: 1 }).id });
    const input = { choiceId: 'left', expectedTurn: 0, requestId: randomUUID() };
    db.exec("CREATE TRIGGER reject_session_update BEFORE UPDATE ON sessions BEGIN SELECT RAISE(ABORT, 'write failure'); END");
    assert.throws(() => sessions.act(start.id, input), /write failure/);
    assert.equal(sessions.get(start.id).turn, 0);
    assert.equal(sessions.get(start.id).history.length, 1);
    db.exec('DROP TRIGGER reject_session_update');
    const recovered = sessions.act(start.id, input);
    assert.equal(recovered.turn, 1); assert.equal(recovered.ended, true);
    assert.deepEqual(sessions.act(start.id, input), recovered);
  } finally { db.close(); }
});
