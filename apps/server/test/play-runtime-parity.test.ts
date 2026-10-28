/**
 * M1b-1 parity (对拍): the server services (SQLite) and the offline LocalPlayPort run the SAME
 * @novel-game/play-runtime engine. Same revision + same script ⇒ identical views and error codes.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SqliteDatabase as Database } from '../src/platform/database.js';
import { GameService, SqliteGameRepository } from '../src/modules/games/index.js';
import { SessionService, SqliteSessionRepository } from '../src/modules/sessions/index.js';
import { WorldService, SqliteWorldRepository } from '../src/modules/worlds/index.js';
import { AdventureService, SqliteAdventureRepository } from '../src/modules/adventure-sessions/index.js';
import { AppError } from '../src/shared/errors.js';
import {
  AppError as RuntimeAppError, MemorySaveStore, createLocalAdventurePort, createLocalStoryPort,
} from '@novel-game/play-runtime';
import type { AdventureView, GameContent, SessionView, SourceDocument } from '@novel-game/contracts';
import { fillDemoWorld } from './helpers/fill-fixture.js';
import { content as openContent, source as openSource } from './helpers/open-fixture.js';

const storySource: SourceDocument = {id: 'source-story', title: '关卡', filename: 'gate.txt', encoding: 'utf8',
  chapterCount: 1, charCount: 8, createdAt: '2026-10-10T00:00:00Z',
  chapters: [{id: 'c1', index: 0, title: '第一章', paragraphs: [{id: 'p1', index: 0, text: '关卡需要一张通行证。'}]}]};
const storyContent = (): GameContent => ({title: '关卡', mode: 'story', premise: '寻找通行机会', adaptationNotes: '对拍', startSceneId: 'gate',
  variables: {courage: 0, clue: false, role: 'visitor'}, scenes: [
    {id: 'gate', title: '关卡', text: '你来到关卡。', origin: 'source', evidence: [{chapterId: 'c1', paragraphId: 'p1'}], choices: [
      {id: 'train', label: '准备一下', targetSceneId: 'gate', effects: [
        {type: 'variable.increment', variable: 'courage', value: 1}, {type: 'variable.set', variable: 'role', value: 'scout'}]},
      {id: 'search', label: '寻找通行证', targetSceneId: 'gate', effects: [{type: 'variable.set', variable: 'clue', value: true}]},
      {id: 'enter', label: '出示通行证', targetSceneId: 'safe', conditions: [
        {type: 'variable.gte', variable: 'courage', value: 2}, {type: 'variable.equals', variable: 'clue', value: true}]},
      {id: 'leave', label: '离开', targetSceneId: 'lost'},
    ]},
    {id: 'safe', title: '通过', text: '你顺利通过。', origin: 'adapted', evidence: [], choices: [], ending: '抵达城中'},
    {id: 'lost', title: '离开', text: '你离开了关卡。', origin: 'adapted', evidence: [], choices: [], ending: '踏上另一条路'},
  ]});

/** Deterministic ids + clock shared by both sides. */
function clock() {
  let n = 0; let ids = 0;
  return {
    now: () => new Date(Date.UTC(2026, 9, 28, 8, 0, n++)).toISOString(),
    newId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`,
    reset() { n = 0; ids = 0; },
  };
}
const rid = (i: number) => `11111111-1111-4111-8111-${String(i).padStart(12, '0')}`;

/** Run fn on both sides; both must return equal values or throw the same AppError code. */
function same<T>(label: string, server: () => T, local: () => T): T | undefined {
  let s: {ok: true; v: T} | {ok: false; code: string};
  let l: {ok: true; v: T} | {ok: false; code: string};
  try { s = {ok: true, v: server()}; } catch (e) { s = {ok: false, code: e instanceof AppError ? e.code : `non-app:${(e as Error).name}`}; }
  try { l = {ok: true, v: local()}; } catch (e) { l = {ok: false, code: e instanceof RuntimeAppError ? e.code : `non-app:${(e as Error).name}`}; }
  assert.deepEqual(l, s, `parity mismatch at ${label}`);
  return s.ok ? s.v : undefined;
}

test('parity: AppError is ONE class across server and runtime (instanceof holds)', () => {
  assert.equal(AppError, RuntimeAppError);
});

test('parity: story — start, locked choice, replay, request-id conflict, stale turn, ending', () => {
  const db = new Database(':memory:');
  try {
    const sc = clock(); const lc = clock();
    const games = new GameService(new SqliteGameRepository(db), {get: () => structuredClone(storySource)});
    const sessions = new SessionService(new SqliteSessionRepository(db), games, sc);
    const draft = games.create({sourceId: storySource.id, content: storyContent()});
    const revision = games.publish(draft.id, {version: 1});
    const local = createLocalStoryPort(structuredClone(revision), {packageId: 'pkg-story', store: new MemorySaveStore(), ...lc});

    let view = same('start', () => sessions.start({gameRevisionId: revision.id}), () => local.start(revision.id)) as SessionView;
    const id = view.id;
    same('locked enter', () => sessions.act(id, {choiceId: 'enter', expectedTurn: 0, requestId: rid(1)}), () => local.act(id, {choiceId: 'enter', expectedTurn: 0, requestId: rid(1)}));
    const script = ['train', 'search', 'train', 'enter'];
    for (const [i, choiceId] of script.entries()) {
      const input = {choiceId, expectedTurn: view.turn, requestId: rid(10 + i)};
      view = same(`act ${choiceId}`, () => sessions.act(id, input), () => local.act(id, input)) as SessionView;
      // Idempotent replay of the very same request → same response, no extra turn.
      same(`replay ${choiceId}`, () => sessions.act(id, input), () => local.act(id, input));
    }
    assert.equal(view.ended, true);
    same('request-id reuse with other input', () => sessions.act(id, {choiceId: 'leave', expectedTurn: 0, requestId: rid(10)}), () => local.act(id, {choiceId: 'leave', expectedTurn: 0, requestId: rid(10)}));
    same('stale turn', () => sessions.act(id, {choiceId: 'leave', expectedTurn: 0, requestId: rid(99)}), () => local.act(id, {choiceId: 'leave', expectedTurn: 0, requestId: rid(99)}));
    same('get', () => sessions.get(id), () => local.get(id));
    same('list', () => sessions.list(), () => local.list());
    same('missing', () => sessions.get('nope'), () => local.get('nope'));
  } finally { db.close(); }
});

function enabledActions(view: AdventureView) {
  return view.actions.filter(a => a.enabled !== false);
}

for (const [name, world, src] of [
  ['P1/P2 fill world (buy · supply · accept · encounter · loot)', fillDemoWorld(), openSource],
  ['open fixture world', openContent(), openSource],
] as const) {
  test(`parity: adventure — ${name}`, () => {
    const db = new Database(':memory:');
    try {
      const sc = clock(); const lc = clock();
      const worlds = new WorldService(new SqliteWorldRepository(db), {get: () => structuredClone(src)});
      const adventures = new AdventureService(new SqliteAdventureRepository(db), worlds, {}, sc);
      const draft = worlds.create({sourceId: src.id, content: structuredClone(world)});
      const revision = worlds.publish(draft.id, {version: 1});
      const local = createLocalAdventurePort(structuredClone(revision), {buildingLibrary: {schemaVersion: 1, assets: []} as never, itemCatalog: {schemaVersion: 1, items: []} as never}, {packageId: 'pkg-open', store: new MemorySaveStore(), ...lc});
      // Empty snapshot must behave exactly like "no catalogs" on the server.
      let view = same('start', () => adventures.start({worldRevisionId: revision.id}), () => local.start(revision.id)) as AdventureView;
      const id = view.id;
      const seen = new Set<string>();
      let lockedChecked = false;
      for (let step = 0; step < 24 && !view.ended; step++) {
        const locked = view.actions.find(a => a.enabled === false);
        if (locked && !lockedChecked) {
          lockedChecked = true;
          const input = {actionId: locked.id, expectedTurn: view.turn, requestId: rid(500 + step)};
          same(`locked ${locked.id}`, () => adventures.act(id, input), () => local.act(id, input));
        }
        const options = enabledActions(view);
        if (!options.length) break;
        // Prefer fill actions we have not tried yet, then rotate.
        const fresh = options.filter(a => !seen.has(a.id));
        const pick = (fresh.find(a => a.id.startsWith('fill_')) ?? fresh[0] ?? options[step % options.length])!;
        seen.add(pick.id);
        const input = {actionId: pick.id, expectedTurn: view.turn, requestId: rid(step + 1)};
        view = same(`step ${step} ${pick.id}`, () => adventures.act(id, input), () => local.act(id, input)) as AdventureView;
        same(`replay ${pick.id}`, () => adventures.act(id, input), () => local.act(id, input));
      }
      same('request-id conflict', () => adventures.act(id, {actionId: 'x_other', expectedTurn: 0, requestId: rid(1)}), () => local.act(id, {actionId: 'x_other', expectedTurn: 0, requestId: rid(1)}));
      same('stale turn', () => adventures.act(id, {actionId: [...seen][0]!, expectedTurn: 0, requestId: rid(900)}), () => local.act(id, {actionId: [...seen][0]!, expectedTurn: 0, requestId: rid(900)}));
      same('get', () => adventures.get(id), () => local.get(id));
      if (name.startsWith('P1')) {
        const tried = [...seen];
        for (const prefix of ['fill_buy_', 'fill_supply_', 'fill_quest_accept_']) {
          assert.ok(tried.some(a => a.startsWith(prefix)), `parity walk covered ${prefix}: ${tried.join(',')}`);
        }
        assert.ok(tried.some(a => a.startsWith('fill_enc_')), `parity walk covered an encounter: ${tried.join(',')}`);
      }
    } finally { db.close(); }
  });
}

test('parity: local port isolates packages and greys foreign-version saves instead of deleting', () => {
  const db = new Database(':memory:');
  try {
    const games = new GameService(new SqliteGameRepository(db), {get: () => structuredClone(storySource)});
    const draft = games.create({sourceId: storySource.id, content: storyContent()});
    const v1 = games.publish(draft.id, {version: 1});
    const v2 = {...structuredClone(v1), id: 'rev-v2', version: 2}; // re-export of a newer revision, same package line
    const store = new MemorySaveStore();
    const c = clock();
    const old = createLocalStoryPort(v1, {packageId: 'pkg', store, ...c});
    const saved = old.start(v1.id);
    const fresh = createLocalStoryPort(v2, {packageId: 'pkg', store, ...c});
    const slots = fresh.slots();
    assert.equal(slots.length, 1);
    assert.equal(slots[0]!.status, 'blocked');
    assert.equal(slots[0]!.status === 'blocked' && slots[0]!.blockedReason, 'old-version');
    assert.throws(() => fresh.act(saved.id, {choiceId: 'train', expectedTurn: 0, requestId: rid(1)}), (e: unknown) => e instanceof AppError && e.code === 'SAVE_INCOMPATIBLE');
    assert.ok(store.read(saved.id), 'old save kept');
    store.write('broken', '{not json');
    assert.ok(fresh.slots().some(s => s.id === 'broken' && s.status === 'blocked' && s.blockedReason === 'corrupt'));
    assert.deepEqual(fresh.list(), []);
  } finally { db.close(); }
});
