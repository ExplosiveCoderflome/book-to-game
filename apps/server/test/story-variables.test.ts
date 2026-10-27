import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteDatabase as Database } from '../src/platform/database.js';
import { GameService, SqliteGameRepository } from '../src/modules/games/index.js';
import { SessionService, SqliteSessionRepository } from '../src/modules/sessions/index.js';
import { AppError } from '../src/shared/errors.js';
import { gameContentSchema, type GameContent, type SourceDocument } from '@novel-game/contracts';

const source: SourceDocument = {id: 'source-story', title: '关卡', filename: 'gate.txt', encoding: 'utf8',
  chapterCount: 1, charCount: 8, createdAt: '2026-10-10T00:00:00Z',
  chapters: [{id: 'c1', index: 0, title: '第一章', paragraphs: [{id: 'p1', index: 0, text: '关卡需要一张通行证。'}]}]};
function content(): GameContent {
  return {title: '关卡', mode: 'story', premise: '寻找通行机会', adaptationNotes: '测试规则', startSceneId: 'gate',
    variables: {courage: 0, clue: false, role: 'visitor'}, scenes: [
      {id: 'gate', title: '关卡', text: '你来到关卡。', origin: 'source', evidence: [{chapterId: 'c1', paragraphId: 'p1'}], choices: [
        {id: 'train', label: '准备一下', targetSceneId: 'gate', effects: [
          {type: 'variable.increment', variable: 'courage', value: 1}, {type: 'variable.set', variable: 'role', value: 'scout'},
        ]},
        {id: 'search', label: '寻找通行证', targetSceneId: 'gate', effects: [{type: 'variable.set', variable: 'clue', value: true}]},
        {id: 'enter', label: '出示通行证', targetSceneId: 'safe', conditions: [
          {type: 'variable.gte', variable: 'courage', value: 2}, {type: 'variable.equals', variable: 'clue', value: true},
          {type: 'variable.equals', variable: 'role', value: 'scout'},
        ]},
        {id: 'leave', label: '离开', targetSceneId: 'lost'},
      ]},
      {id: 'safe', title: '通过', text: '你顺利通过。', origin: 'adapted', evidence: [], choices: [], ending: '抵达城中'},
      {id: 'lost', title: '离开', text: '你离开了关卡。', origin: 'adapted', evidence: [], choices: [], ending: '踏上另一条路'},
    ]};
}
function setup(db: Database) {
  const games = new GameService(new SqliteGameRepository(db), {get: () => structuredClone(source)});
  return {games, sessions: new SessionService(new SqliteSessionRepository(db), games)};
}
function start(db: Database, game = content()) {
  const services = setup(db); const draft = services.games.create({sourceId: source.id, content: game});
  const revision = services.games.publish(draft.id, {version: 1});
  return {...services, draft, revision, view: services.sessions.start({gameRevisionId: revision.id})};
}
const action = (choiceId: string, expectedTurn: number) => ({choiceId, expectedTurn, requestId: randomUUID()});
const code = (expected: string) => (error: unknown) => error instanceof AppError && error.code === expected;

test('story conditions require every variable condition; locked choices stay private and forged actions do not commit', () => {
  const db = new Database(':memory:');
  try {
    const {games, draft, sessions, view} = start(db);
    const validated = games.validate(draft.id);
    assert.equal(validated.valid, true);
    assert.ok(!validated.warnings.some(w => /仅拓扑可达|从未可解锁/.test(w)), validated.warnings.join(';'));
    assert.deepEqual(view.variables, {courage: 0, clue: false, role: 'visitor'});
    assert.deepEqual(view.scene.choices.map(choice => choice.id), ['train', 'search', 'leave']);
    for (const secret of ['targetSceneId', 'conditions', 'effects', '出示通行证']) assert.equal(JSON.stringify(view).includes(secret), false);
    const forged = action('enter', 0);
    assert.throws(() => sessions.act(view.id, forged), code('CHOICE_LOCKED'));
    assert.deepEqual(sessions.get(view.id), view);
    assert.equal((db.prepare('SELECT count(*) AS n FROM session_events').get() as {n: number}).n, 0);
    let current = sessions.act(view.id, {...forged, choiceId: 'train'});
    current = sessions.act(view.id, action('train', current.turn));
    assert.equal(current.variables?.courage, 2);
    assert.equal(current.scene.choices.some(choice => choice.id === 'enter'), false);
    current = sessions.act(view.id, action('search', current.turn));
    assert.equal(current.scene.choices.some(choice => choice.id === 'enter'), true);
    const ended = sessions.act(view.id, action('enter', current.turn));
    assert.equal(ended.ended, true); assert.equal(ended.scene.ending, '抵达城中'); assert.deepEqual(ended.scene.choices, []);
  } finally {db.close();}
});

test('story increments replay once, reject stale turns, survive reopening and stay pinned to the published variables', () => {
  const dir = mkdtempSync(join(tmpdir(), 'story-variables-')); const path = join(dir, 'test.sqlite'); let db = new Database(path);
  try {
    let {games, sessions, view, draft, revision} = start(db);
    const input = action('train', 0); const first = sessions.act(view.id, input);
    assert.equal(first.variables?.courage, 1); assert.equal(first.variables?.role, 'scout');
    assert.deepEqual(sessions.act(view.id, input), first);
    assert.throws(() => sessions.act(view.id, action('train', 0)), code('SESSION_TURN_CONFLICT'));
    assert.throws(() => sessions.act(view.id, {...input, choiceId: 'search'}), code('REQUEST_ID_CONFLICT'));
    sessions.act(view.id, action('train', 1));
    const changed = content(); changed.variables!.courage = 99;
    games.update(draft.id, {version: 1, content: changed}); games.publish(draft.id, {version: 2});
    db.close(); db = new Database(path); ({games, sessions} = setup(db));
    assert.deepEqual(sessions.act(view.id, input), first);
    const restored = sessions.get(view.id);
    assert.equal(restored.variables?.courage, 2); assert.equal(restored.gameRevisionId, revision.id); assert.equal(restored.turn, 2);
    assert.equal(games.getRevision(revision.id).content.variables?.courage, 0);
    const next = sessions.act(view.id, action('search', restored.turn));
    assert.equal(next.variables?.courage, 2); assert.equal(next.variables?.clue, true);
  } finally {db.close(); rmSync(dir, {recursive: true, force: true});}
});

test('failed SQLite state writes roll back variable effects and replay records; retry increments once', () => {
  const db = new Database(':memory:');
  try {
    const {sessions, view} = start(db); const input = action('train', 0);
    db.exec("CREATE TRIGGER reject_story BEFORE UPDATE ON sessions BEGIN SELECT RAISE(ABORT, 'write failure'); END");
    assert.throws(() => sessions.act(view.id, input), /write failure/);
    assert.deepEqual(sessions.get(view.id), view);
    assert.equal((db.prepare('SELECT count(*) AS n FROM session_events').get() as {n: number}).n, 0);
    db.exec('DROP TRIGGER reject_story');
    const result = sessions.act(view.id, input);
    assert.equal(result.variables?.courage, 1); assert.deepEqual(sessions.act(view.id, input), result);
  } finally {db.close();}
});

test('legacy published games, stored sessions and action responses without variable fields continue unchanged', () => {
  const db = new Database(':memory:');
  try {
    const old = content(); delete old.variables;
    for (const scene of old.scenes) for (const choice of scene.choices) {delete choice.conditions; delete choice.effects;}
    const {games, revision, sessions, view} = start(db, old);
    assert.equal(Object.hasOwn(games.getRevision(revision.id).content, 'variables'), false);
    db.prepare("UPDATE sessions SET data=json_remove(data, '$.variables') WHERE id=?").run(view.id);
    assert.deepEqual(sessions.get(view.id).variables, {});
    const input = action('train', 0); const response = sessions.act(view.id, input);
    assert.deepEqual(response.variables, {});
    const legacyResponse = {...response}; delete legacyResponse.variables;
    db.prepare('UPDATE session_events SET response=? WHERE session_id=? AND request_id=?')
      .run(JSON.stringify(legacyResponse), view.id, input.requestId);
    assert.deepEqual(sessions.act(view.id, input), legacyResponse);
    const ended = sessions.act(view.id, action('enter', 1));
    assert.equal(ended.ended, true); assert.deepEqual(ended.variables, {});
  } finally {db.close();}
});

test('publication rejects missing variable references and incompatible operation types before gameplay', () => {
  const db = new Database(':memory:');
  try {
    const {games} = setup(db);
    const cases: [string, (game: GameContent) => void][] = [
      ['missing reference', game => {game.scenes[0].choices[0].effects![0].variable = 'missing';}],
      ['gte string', game => {game.scenes[0].choices[2].conditions![0].variable = 'role';}],
      ['increment boolean', game => {game.scenes[0].choices[0].effects![0].variable = 'clue';}],
      ['equals wrong type', game => {game.scenes[0].choices[2].conditions![1].value = 'true';}],
      ['set wrong type', game => {game.scenes[0].choices[1].effects![0].value = 'true';}],
      ['inherited missing reference', game => {game.scenes[0].choices[0].effects![0].variable = 'constructor';}],
    ];
    for (const [name, mutate] of cases) {
      const game = content(); mutate(game); const draft = games.create({sourceId: source.id, content: game});
      assert.equal(games.validate(draft.id).valid, false, name);
      assert.throws(() => games.publish(draft.id, {version: 1}), code('INVALID_GAME'), name);
    }
    assert.equal(games.listRevisions().length, 0);
  } finally {db.close();}
});

test('story contracts reject nonfinite numbers and runtime overflow leaves variables and replay records unchanged', () => {
  for (const value of [Infinity, -Infinity, NaN]) {
    const game = content(); game.variables!.courage = value;
    assert.equal(gameContentSchema.safeParse(game).success, false);
    const condition = content(); condition.scenes[0].choices[2].conditions![0].value = value;
    assert.equal(gameContentSchema.safeParse(condition).success, false);
    const effect = content(); effect.scenes[0].choices[0].effects![0].value = value;
    assert.equal(gameContentSchema.safeParse(effect).success, false);
  }
  const db = new Database(':memory:');
  try {
    const game = content(); game.variables!.courage = Number.MAX_VALUE;
    game.variables!.clue = true; game.variables!.role = 'scout';
    game.scenes[0].choices[0].effects![0].value = Number.MAX_VALUE;
    const {sessions, view} = start(db, game); const input = action('train', 0);
    assert.throws(() => sessions.act(view.id, input), code('INVALID_VARIABLE_STATE'));
    assert.deepEqual(sessions.get(view.id), view);
    assert.equal((db.prepare('SELECT count(*) AS n FROM session_events').get() as {n: number}).n, 0);
    assert.equal(sessions.act(view.id, {...input, choiceId: 'leave'}).ended, true);
  } finally {db.close();}
});
