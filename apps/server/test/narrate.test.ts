import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SqliteDatabase as Database } from '../src/platform/database.js';
import { GameService, SqliteGameRepository } from '../src/modules/games/index.js';
import { SessionService, SqliteSessionRepository } from '../src/modules/sessions/index.js';
import { clearNarrateCache, narrateSession } from '../src/modules/sessions/application/narrate.js';
import type { GameContent, SourceDocument } from '@novel-game/contracts';
import { AppError } from '../src/shared/errors.js';

const source: SourceDocument = {
  id: 'src', title: 't', filename: 't.txt', encoding: 'utf-8',
  chapterCount: 1, charCount: 10, createdAt: '2020-01-01T00:00:00.000Z',
  chapters: [{ id: 'ch1', index: 0, title: '一', paragraphs: [{ id: 'p1', index: 0, text: '雾。' }] }],
};

function game(): GameContent {
  return {
    title: 'L1试玩', mode: 'story', premise: '渡口', adaptationNotes: 'l1',
    variables: { qi: 1 },
    startSceneId: 'dock',
    scenes: [
      {
        id: 'dock', title: '渡口', text: '雾起。船影晃动。', origin: 'adapted', evidence: [],
        choices: [
          { id: 'talk', label: '与船夫闲聊', targetSceneId: 'yard' },
          { id: 'leave', label: '拔刀相向', targetSceneId: 'duel' },
        ],
      },
      { id: 'yard', title: '空坪', text: '露水。', origin: 'adapted', evidence: [], choices: [], ending: '安然' },
      { id: 'duel', title: '决斗', text: '刀光。', origin: 'adapted', evidence: [], choices: [], ending: '血溅' },
    ],
    worldbook: {
      entries: [{
        id: 'lore-1', title: '渡口旧约', keys: ['雾'], content: '雾日不开市。', kind: 'lore',
        scope: { type: 'scenes', sceneIds: ['dock'] },
        constraints: [],
      }],
    },
  };
}

function setup() {
  clearNarrateCache();
  const db = new Database(':memory:');
  const games = new GameService(new SqliteGameRepository(db), { get: () => structuredClone(source) });
  const sessions = new SessionService(new SqliteSessionRepository(db), games);
  const draft = games.create({ sourceId: source.id, content: game() });
  const revision = games.publish(draft.id, { version: 1 });
  const view = sessions.start({ gameRevisionId: revision.id });
  return { db, sessions, games, view };
}

test('narrate returns flavor text without mutating session', async () => {
  const { db, sessions, games, view } = setup();
  try {
    let called = 0;
    const result = await narrateSession(sessions, games, view.id, { expectedTurn: 0 }, {
      async narrate(input) {
        called += 1;
        assert.equal(input.sceneTitle, '渡口');
        assert.ok(input.choices.some(c => c.id === 'talk'));
        assert.equal(input.variables.qi, 1);
        assert.ok(input.worldbookSnippets.some(s => s.title.includes('渡口')));
        return { narration: '雾气低垂，船夫的灯影摇晃。' };
      },
    });
    assert.equal(result.status, 'ok');
    assert.match(result.text ?? '', /雾气/);
    assert.equal(result.sceneId, 'dock');
    assert.equal(result.turn, 0);
    assert.equal(sessions.get(view.id).turn, 0);
    assert.equal(sessions.get(view.id).scene.choices.length, 2);
    assert.equal(called, 1);

    const cached = await narrateSession(sessions, games, view.id, { expectedTurn: 0 }, {
      async narrate() {
        called += 1;
        return { narration: '不应再次调用' };
      },
    });
    assert.equal(cached.cached, true);
    assert.equal(cached.text, result.text);
    assert.equal(called, 1);
  } finally { db.close(); clearNarrateCache(); }
});

test('narrate soft-fails when model throws', async () => {
  const { db, sessions, games, view } = setup();
  try {
    const result = await narrateSession(sessions, games, view.id, {}, {
      async narrate() { throw new AppError('MODEL_HTTP_ERROR', '模型挂了', 502); },
    });
    assert.equal(result.status, 'unavailable');
    assert.equal(result.text, null);
    assert.match(result.reason ?? '', /模型/);
    assert.equal(sessions.get(view.id).turn, 0);
  } finally { db.close(); clearNarrateCache(); }
});

test('narrate respects stale turn', async () => {
  const { db, sessions, games, view } = setup();
  try {
    await assert.rejects(
      () => narrateSession(sessions, games, view.id, { expectedTurn: 9 }, {
        async narrate() { return { narration: 'x' }; },
      }),
      (e: unknown) => e instanceof AppError && e.code === 'STALE_TURN',
    );
  } finally { db.close(); clearNarrateCache(); }
});
