import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { TIANDAO_CORRECT_SYSTEM, withTiandaoCorrect, NARRATE_SYSTEM, PROPOSE_ACT_SYSTEM } from '../src/platform/model/prompts.js';
import { ChatCompletionsProvider } from '../src/platform/model/chat-completions.js';
import { SqliteDatabase as Database } from '../src/platform/database.js';
import { GameService, SqliteGameRepository } from '../src/modules/games/index.js';
import { SessionService, SqliteSessionRepository } from '../src/modules/sessions/index.js';
import { clearNarrateCache, narrateSession } from '../src/modules/sessions/application/narrate.js';
import { proposeActSession } from '../src/modules/sessions/application/propose-act.js';
import type { GameContent, SourceDocument } from '@novel-game/contracts';

test('withTiandaoCorrect appends block only when enabled', () => {
  assert.equal(withTiandaoCorrect(NARRATE_SYSTEM, false), NARRATE_SYSTEM);
  assert.equal(withTiandaoCorrect(NARRATE_SYSTEM, undefined), NARRATE_SYSTEM);
  const on = withTiandaoCorrect(NARRATE_SYSTEM, true);
  assert.ok(on.startsWith(NARRATE_SYSTEM));
  assert.ok(on.includes(TIANDAO_CORRECT_SYSTEM));
  assert.ok(on.includes('天道修正'));
  assert.ok(withTiandaoCorrect(PROPOSE_ACT_SYSTEM, true).includes('天道修正'));
});

const source: SourceDocument = {
  id: 'src', title: 't', filename: 't.txt', encoding: 'utf-8',
  chapterCount: 1, charCount: 10, createdAt: '2020-01-01T00:00:00.000Z',
  chapters: [{ id: 'ch1', index: 0, title: '一', paragraphs: [{ id: 'p1', index: 0, text: '雾。' }] }],
};

function game(): GameContent {
  return {
    title: '天道试玩', mode: 'story', premise: '渡口', adaptationNotes: 'td',
    startSceneId: 'dock',
    scenes: [
      {
        id: 'dock', title: '渡口', text: '雾起。', origin: 'adapted', evidence: [],
        choices: [
          { id: 'talk', label: '与船夫闲聊', targetSceneId: 'yard' },
          { id: 'leave', label: '拔刀相向', targetSceneId: 'duel' },
        ],
      },
      { id: 'yard', title: '空坪', text: '露水。', origin: 'adapted', evidence: [], choices: [], ending: '安然' },
      { id: 'duel', title: '决斗', text: '刀光。', origin: 'adapted', evidence: [], choices: [], ending: '血溅' },
    ],
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

test('narrate passes tiandaoCorrect flag to model', async () => {
  const { db, sessions, games, view } = setup();
  try {
    let seen: boolean | undefined;
    await narrateSession(sessions, games, view.id, { tiandaoCorrect: true, force: true }, {
      async narrate(input) {
        seen = input.tiandaoCorrect;
        return { narration: '雾气被天道轻轻按住。' };
      },
    });
    assert.equal(seen, true);

    seen = undefined;
    await narrateSession(sessions, games, view.id, { tiandaoCorrect: false, force: true }, {
      async narrate(input) {
        seen = input.tiandaoCorrect;
        return { narration: '普通旁白。' };
      },
    });
    assert.equal(seen, false);
  } finally { db.close(); clearNarrateCache(); }
});

test('propose-act passes tiandaoCorrect flag to model', async () => {
  const { db, sessions, view } = setup();
  try {
    let seen: boolean | undefined;
    await proposeActSession(sessions, view.id, {
      text: '我想改规则无敌',
      expectedTurn: 0,
      requestId: randomUUID(),
      autoAct: false,
      tiandaoCorrect: true,
    }, {
      async proposeAct(input) {
        seen = input.tiandaoCorrect;
        return { choiceId: 'none', rationale: '天道不容' };
      },
    });
    assert.equal(seen, true);
  } finally { db.close(); }
});

test('provider appends 天道修正 to narrate system when flag on', async () => {
  let request: { messages: { role: string; content: string }[] } | undefined;
  const server = createServer(async (req, res) => {
    let body = ''; for await (const part of req) body += part;
    request = JSON.parse(body);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ narration: '天道低语。' }) } }] }));
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address() as { port: number };
    const provider = new ChatCompletionsProvider({
      baseUrl: `http://127.0.0.1:${address.port}/v1`, model: 'test-only-model', apiKey: '', timeoutMs: 2000,
    });
    await provider.narrate({
      sceneTitle: '渡口', sceneText: '雾。', choices: [{ id: 'talk', label: '闲聊' }],
      variables: {}, worldbookSnippets: [], tiandaoCorrect: true,
    }, AbortSignal.timeout(2000));
    assert.ok(request);
    const system = request!.messages[0].content;
    assert.ok(system.startsWith('你是文字冒险的表演旁白'));
    assert.ok(system.includes('【天道修正'));
    assert.ok(system.includes('天道不容') || system.includes('不合天地'));
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test('provider omits 天道修正 from narrate system when flag off', async () => {
  let request: { messages: { role: string; content: string }[] } | undefined;
  const server = createServer(async (req, res) => {
    let body = ''; for await (const part of req) body += part;
    request = JSON.parse(body);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ narration: '普通。' }) } }] }));
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address() as { port: number };
    const provider = new ChatCompletionsProvider({
      baseUrl: `http://127.0.0.1:${address.port}/v1`, model: 'test-only-model', apiKey: '', timeoutMs: 2000,
    });
    await provider.narrate({
      sceneTitle: '渡口', sceneText: '雾。', choices: [], variables: {}, worldbookSnippets: [],
    }, AbortSignal.timeout(2000));
    assert.ok(request);
    assert.ok(!request!.messages[0].content.includes('【天道修正'));
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
