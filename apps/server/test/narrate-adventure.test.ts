import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SqliteDatabase as Database } from '../src/platform/database.js';
import { WorldService, SqliteWorldRepository } from '../src/modules/worlds/index.js';
import { AdventureService, SqliteAdventureRepository } from '../src/modules/adventure-sessions/index.js';
import { clearAdventureNarrateCache, narrateAdventure } from '../src/modules/adventure-sessions/application/narrate.js';
import { source, content } from './helpers/open-fixture.js';
import type { WorldContent } from '@novel-game/contracts';
import { AppError } from '../src/shared/errors.js';

function withWorldbook(world: WorldContent): WorldContent {
  return {
    ...world,
    worldbook: {
      entries: [{
        id: 'lore-dock', title: '渡口雾约', keys: ['雾'], content: '雾日不开渡。', kind: 'lore',
        scope: { type: 'locations', locationIds: ['dock'] },
        constraints: [],
      }],
    },
  };
}

function setup() {
  clearAdventureNarrateCache();
  const db = new Database(':memory:');
  const worlds = new WorldService(new SqliteWorldRepository(db), { get: () => structuredClone(source) });
  const adventures = new AdventureService(new SqliteAdventureRepository(db), worlds);
  const draft = worlds.create({ sourceId: source.id, content: withWorldbook(content()) });
  const revision = worlds.publish(draft.id, { version: 1 });
  const view = adventures.start({ worldRevisionId: revision.id });
  return { db, worlds, adventures, view };
}

test('adventure narrate returns flavor text without mutating state', async () => {
  const { db, adventures, worlds, view } = setup();
  try {
    let called = 0;
    const before = structuredClone(adventures.get(view.id));
    const result = await narrateAdventure(adventures, worlds, view.id, { expectedTurn: 0 }, {
      async narrate(input) {
        called += 1;
        assert.equal(input.sceneTitle, 'dock');
        assert.ok(input.choices.some(c => c.id === 'search'));
        assert.ok(input.worldbookSnippets.some(s => s.title.includes('渡口')));
        return { narration: '江雾贴着木桩，渡口灯影一晃一晃。' };
      },
    });
    assert.equal(result.status, 'ok');
    assert.match(result.text ?? '', /江雾/);
    assert.equal(result.sceneId, 'dock');
    assert.equal(result.turn, 0);
    assert.deepEqual(adventures.get(view.id), before);
    assert.equal(called, 1);

    const cached = await narrateAdventure(adventures, worlds, view.id, { expectedTurn: 0 }, {
      async narrate() {
        called += 1;
        return { narration: '不应再次调用' };
      },
    });
    assert.equal(cached.cached, true);
    assert.equal(cached.text, result.text);
    assert.equal(called, 1);
  } finally { db.close(); clearAdventureNarrateCache(); }
});

test('adventure narrate soft-fails when model throws', async () => {
  const { db, adventures, worlds, view } = setup();
  try {
    const before = structuredClone(adventures.get(view.id));
    const result = await narrateAdventure(adventures, worlds, view.id, {}, {
      async narrate() { throw new AppError('MODEL_HTTP_ERROR', '模型挂了', 502); },
    });
    assert.equal(result.status, 'unavailable');
    assert.equal(result.text, null);
    assert.match(result.reason ?? '', /模型/);
    assert.deepEqual(adventures.get(view.id), before);
  } finally { db.close(); clearAdventureNarrateCache(); }
});

test('adventure narrate respects stale turn', async () => {
  const { db, adventures, worlds, view } = setup();
  try {
    await assert.rejects(
      () => narrateAdventure(adventures, worlds, view.id, { expectedTurn: 9 }, {
        async narrate() { return { narration: 'x' }; },
      }),
      (e: unknown) => e instanceof AppError && e.code === 'STALE_TURN',
    );
  } finally { db.close(); clearAdventureNarrateCache(); }
});
