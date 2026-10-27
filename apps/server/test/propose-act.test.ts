import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { SqliteDatabase as Database } from '../src/platform/database.js';
import { GameService, SqliteGameRepository } from '../src/modules/games/index.js';
import { SessionService, SqliteSessionRepository } from '../src/modules/sessions/index.js';
import { proposeActSession } from '../src/modules/sessions/application/propose-act.js';
import { resolveProposedId, type GameContent, type SourceDocument } from '@novel-game/contracts';
import { AppError } from '../src/shared/errors.js';

const source: SourceDocument = {
  id: 'src', title: 't', filename: 't.txt', encoding: 'utf-8',
  chapterCount: 1, charCount: 10, createdAt: '2020-01-01T00:00:00.000Z',
  chapters: [{ id: 'ch1', index: 0, title: '一', paragraphs: [{ id: 'p1', index: 0, text: '雾。' }] }],
};

function game(): GameContent {
  return {
    title: 'L2试玩', mode: 'story', premise: '渡口', adaptationNotes: 'l2',
    variables: { qi: 0 },
    startSceneId: 'dock',
    scenes: [
      {
        id: 'dock', title: '渡口', text: '雾起。', origin: 'adapted', evidence: [],
        choices: [
          { id: 'talk', label: '与船夫闲聊', targetSceneId: 'yard' },
          { id: 'fight', label: '拔刀相向', targetSceneId: 'duel', tags: ['combat'] },
          { id: 'train', label: '闭关修炼', targetSceneId: 'yard', tags: ['upgrade'],
            effects: [{ type: 'variable.increment', variable: 'qi', value: 5 }] },
        ],
      },
      { id: 'yard', title: '空坪', text: '露水。', origin: 'adapted', evidence: [], choices: [], ending: '安然' },
      { id: 'duel', title: '决斗', text: '刀光。', origin: 'adapted', evidence: [], choices: [], ending: '血溅' },
    ],
    worldbook: {
      entries: [{
        id: 'rule-1', title: '渡口禁武', keys: ['禁'], content: '不许私斗', kind: 'rule',
        scope: { type: 'scenes', sceneIds: ['dock'] },
        constraints: [{ type: 'forbid_choice_tags', tags: ['combat'], message: '渡口禁武，此行不可。' }],
      }],
    },
  };
}

function setup() {
  const db = new Database(':memory:');
  const games = new GameService(new SqliteGameRepository(db), { get: () => structuredClone(source) });
  const sessions = new SessionService(new SqliteSessionRepository(db), games);
  const draft = games.create({ sourceId: source.id, content: game() });
  const revision = games.publish(draft.id, { version: 1 });
  const view = sessions.start({ gameRevisionId: revision.id });
  return { db, sessions, view };
}

test('resolveProposedId accepts only candidate ids', () => {
  const c = [{ id: 'talk', label: '闲聊' }];
  assert.equal(resolveProposedId('talk', c).status, 'mapped');
  assert.equal(resolveProposedId('none', c).status, 'none');
  assert.equal(resolveProposedId('fight', c).status, 'rejected');
});

test('propose maps free text to visible choice and auto-acts', async () => {
  const { db, sessions, view } = setup();
  try {
    assert.ok(!view.scene.choices.some(c => c.id === 'fight'), 'worldbook must hide combat');
    const result = await proposeActSession(sessions, view.id, {
      text: '我想和船夫聊聊',
      expectedTurn: 0,
      requestId: randomUUID(),
      autoAct: true,
    }, {
      async proposeAct() { return { choiceId: 'talk' }; },
    });
    assert.equal(result.status, 'acted');
    assert.equal(result.choiceId, 'talk');
    assert.equal((result.session as { turn: number }).turn, 1);
    assert.equal(sessions.get(view.id).scene.id, 'yard');
  } finally { db.close(); }
});

test('propose rejects model id missing from worldbook-filtered projection', async () => {
  const { db, sessions, view } = setup();
  try {
    const result = await proposeActSession(sessions, view.id, {
      text: '拔刀！',
      expectedTurn: 0,
      requestId: randomUUID(),
      autoAct: true,
    }, {
      async proposeAct() { return { choiceId: 'fight' }; },
    });
    assert.equal(result.status, 'rejected');
    assert.equal(sessions.get(view.id).turn, 0, 'must not advance');
    assert.match(result.reason ?? '', /不可用|世界书/);
  } finally { db.close(); }
});

test('propose none returns candidate fallback list without acting', async () => {
  const { db, sessions, view } = setup();
  try {
    const result = await proposeActSession(sessions, view.id, {
      text: '随便',
      expectedTurn: 0,
      requestId: randomUUID(),
      autoAct: true,
    }, {
      async proposeAct() { return { choiceId: 'none' }; },
    });
    assert.equal(result.status, 'none');
    assert.ok(result.candidates.length >= 2);
    assert.equal(sessions.get(view.id).turn, 0);
  } finally { db.close(); }
});

test('propose respects stale turn', async () => {
  const { db, sessions, view } = setup();
  try {
    await assert.rejects(
      () => proposeActSession(sessions, view.id, {
        text: '闲聊', expectedTurn: 9, requestId: randomUUID(), autoAct: true,
      }, { async proposeAct() { return { choiceId: 'talk' }; } }),
      (e: unknown) => e instanceof AppError && e.code === 'STALE_TURN',
    );
  } finally { db.close(); }
});
