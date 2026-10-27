import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SqliteDatabase as Database } from '../src/platform/database.js';
import { GameService, SqliteGameRepository } from '../src/modules/games/index.js';
import { fillDraftSceneText } from '../src/modules/generation/application/fill-scene-text.js';
import type { GameContent, SourceDocument } from '@novel-game/contracts';
import { AppError } from '../src/shared/errors.js';

const source: SourceDocument = {
  id: 'src', title: 't', filename: 't.txt', encoding: 'utf-8',
  chapterCount: 1, charCount: 20, createdAt: '2020-01-01T00:00:00.000Z',
  chapters: [{ id: 'ch1', index: 0, title: '一', paragraphs: [{ id: 'p1', index: 0, text: '江雾如纱。' }] }],
};

function game(): GameContent {
  return {
    title: '补全文试玩', mode: 'story', premise: '渡口', adaptationNotes: 'fill',
    startSceneId: 'dock',
    scenes: [
      {
        id: 'dock', title: '渡口', text: '雾起。', origin: 'source',
        evidence: [{ chapterId: 'ch1', paragraphId: 'p1' }],
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
        scope: { type: 'scenes', sceneIds: ['dock'] }, constraints: [],
      }],
    },
  };
}

function setup() {
  const db = new Database(':memory:');
  const games = new GameService(new SqliteGameRepository(db), { get: () => structuredClone(source) });
  const draft = games.create({ sourceId: source.id, content: game() });
  return { db, games, draft, sources: { get: () => structuredClone(source) } };
}

test('fill deepens body text without mutating draft choices or topology', async () => {
  const { db, games, draft, sources } = setup();
  try {
    let called = 0;
    const result = await fillDraftSceneText(games, sources, {
      id: draft.id, sceneId: 'dock', currentText: '雾起。',
    }, {
      async fillSceneText(input) {
        called += 1;
        assert.equal(input.scene.title, '渡口');
        assert.ok(input.scene.choiceLabels.includes('与船夫闲聊'));
        assert.ok(input.sourceExcerpts.some(e => e.text.includes('江雾')));
        assert.ok(input.worldbookSnippets.some(s => s.title.includes('旧约')));
        assert.ok(input.neighborHints.some(n => n.id === 'yard'));
        return { text: '雾气贴着江面，船夫的灯影摇晃。你听见远处更鼓。' };
      },
    });
    assert.equal(result.status, 'ok');
    assert.match(result.text ?? '', /灯影/);
    const after = games.get(draft.id);
    assert.equal(after.content.scenes.find(s => s.id === 'dock')?.text, '雾起。', 'server draft unchanged');
    assert.equal(after.content.scenes.find(s => s.id === 'dock')?.choices.length, 2);
    assert.equal(called, 1);
  } finally { db.close(); }
});

test('fill soft-fails when model throws', async () => {
  const { db, games, draft, sources } = setup();
  try {
    const result = await fillDraftSceneText(games, sources, { id: draft.id, sceneId: 'dock' }, {
      async fillSceneText() { throw new AppError('MODEL_HTTP_ERROR', '模型挂了', 502); },
    });
    assert.equal(result.status, 'unavailable');
    assert.equal(result.text, null);
    assert.match(result.reason ?? '', /模型/);
  } finally { db.close(); }
});

test('fill rejects missing scene', async () => {
  const { db, games, draft, sources } = setup();
  try {
    await assert.rejects(
      () => fillDraftSceneText(games, sources, { id: draft.id, sceneId: 'nope' }, {
        async fillSceneText() { return { text: 'x' }; },
      }),
      (e: unknown) => e instanceof AppError && e.code === 'SCENE_NOT_FOUND',
    );
  } finally { db.close(); }
});
