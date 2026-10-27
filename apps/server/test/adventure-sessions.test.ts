import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteDatabase as Database } from '../src/platform/database.js';
import { WorldService, SqliteWorldRepository } from '../src/modules/worlds/index.js';
import { AdventureService, SqliteAdventureRepository } from '../src/modules/adventure-sessions/index.js';
import { source, content } from './helpers/open-fixture.js';
import type { WorldContent } from '@novel-game/contracts';
import { AppError } from '../src/shared/errors.js';
const status = (n: number) => (e: unknown) => e instanceof AppError && e.status === n;
function setup(db: Database) {
  const worlds = new WorldService(new SqliteWorldRepository(db), {get: () => structuredClone(source)});
  return {worlds, adventures: new AdventureService(new SqliteAdventureRepository(db), worlds)};
}
function start(db: Database, world: WorldContent = content()) {
  const services = setup(db); const draft = services.worlds.create({sourceId: source.id, content: world});
  const revision = services.worlds.publish(draft.id, {version: 1});
  return {...services, draft, revision, view: services.adventures.start({worldRevisionId: revision.id})};
}
const input = (actionId: string, expectedTurn: number) => ({actionId, expectedTurn, requestId: randomUUID()});

test('a stranded player can wait one tick, advance events and reach timeout without a soft lock', () => {
  const db = new Database(':memory:'); try {
    // Bypass publish opening-density gate: insert a stranded revision directly (all authored actions elsewhere).
    const worlds = new WorldService(new SqliteWorldRepository(db), {get: () => structuredClone(source)});
    const adventures = new AdventureService(new SqliteAdventureRepository(db), worlds);
    const draft = worlds.create({sourceId: source.id, content: content()});
    const stranded = content();
    stranded.actions.forEach(action => {action.locationId = 'market';});
    stranded.timeLimit = 3;
    const revision = new SqliteWorldRepository(db).publish({
      id: randomUUID(), draftId: draft.id, sourceId: source.id, version: draft.version,
      content: stranded, createdAt: new Date().toISOString(),
    });
    const view = adventures.start({worldRevisionId: revision.id});
    assert.equal(view.actions.find(action => action.id === '__wait__')?.enabled, true);
    assert.ok(view.actions.filter(a => a.id !== '__wait__' && a.enabled).length === 0);
    let current = view;
    for (let i = 0; i < 3; i++) current = adventures.act(view.id, input('__wait__', current.turn));
    assert.equal(current.ending?.id, 'timeout'); assert.equal(current.elapsed, 3); assert.equal(current.turn, 3);
    assert.equal(current.history.filter(entry => entry.text.includes('钟声响起')).length, 1);
    assert.deepEqual(current.actions, []);
  } finally {db.close();}
});

test('requires-locked actions stay visible but disabled with blockedReason; enabled acts do not ACTION_BLOCKED', () => {
  const db = new Database(':memory:'); try {
    const {adventures, view} = start(db);
    const ask = view.actions.find(a => a.id === 'ask');
    assert.ok(ask, 'ask should be visible at start');
    assert.equal(ask.enabled, false);
    assert.equal(ask.blockedReason, '缺少线索');
    assert.throws(
      () => adventures.act(view.id, input('ask', 0)),
      (e: unknown) => e instanceof AppError && e.code === 'ACTION_BLOCKED' && /缺少线索/.test(e.message),
    );
    // Enabled opening actions must succeed without ACTION_BLOCKED
    const enabled = view.actions.filter(a => a.enabled && a.id !== '__wait__');
    assert.ok(enabled.length >= 3, `expected ≥3 enabled openers, got ${enabled.map(a => a.id)}`);
    const moved = adventures.act(view.id, input(enabled.find(a => a.id === 'search')!.id, 0));
    assert.equal(moved.turn, 1);
    assert.ok(moved.actions.find(a => a.id === 'ask')?.enabled === true || moved.facts.some(f => f.id === 'secret'));
  } finally {db.close();}
});

test('the system wait action ID cannot be overridden by an authored world', () => {
  const db = new Database(':memory:'); try {
    const {worlds} = setup(db); const world = content(); world.actions[0].id = '__wait__';
    const draft = worlds.create({sourceId: source.id, content: world});
    assert.equal(worlds.validate(draft.id).valid, false);
  } finally {db.close();}
});

test('player projection hides private facts, NPC goals, unobserved events and rule data', () => {
  const db = new Database(':memory:'); try {
    const {adventures, view, draft} = start(db);
    for (const secret of ['秘密不可见', '秘密真相不可见', '私有目标不可见', 'knownFactIds', 'effects', 'availableWhen', 'time_bell', '隐藏行动不可见']) assert.equal(JSON.stringify(view).includes(secret), false, secret);
    assert.deepEqual(view.npcs, [{id: 'keeper', name: '守门人', description: '正在值守'}]);
    assert.equal(view.actions.find(a => a.id === 'ask')?.enabled, false);
    assert.equal(view.actions.find(a => a.id === 'ask')?.blockedReason, '缺少线索');
    assert.equal(adventures.list().length, 1); assert.throws(() => adventures.get('missing'), status(404));
    assert.throws(() => adventures.start({worldRevisionId: draft.id}), status(404));
  } finally {db.close();}
});
test('blocked, hidden, stale and unknown actions never mutate or reserve requests', () => {
  const db = new Database(':memory:'); try {
    const {adventures, view} = start(db); const requestId = randomUUID();
    for (const actionId of ['ask', 'hidden', 'absent']) assert.throws(() => adventures.act(view.id, {actionId, expectedTurn: 0, requestId}), status(400));
    assert.throws(() => adventures.act(view.id, {actionId: 'wait', expectedTurn: 9, requestId}), status(409));
    assert.deepEqual(adventures.get(view.id), view);
    const searched = adventures.act(view.id, {actionId: 'search', expectedTurn: 0, requestId});
    assert.equal(searched.turn, 1); assert.equal(searched.elapsed, 1);
    assert.equal(searched.facts.find(f => f.id === 'secret')?.value, true);
    assert.equal(searched.actions.some(a => a.id === 'search'), false);
    assert.throws(() => adventures.act(view.id, input('search', 1)), status(400));
  } finally {db.close();}
});
test('successful actions settle time events once, then endings and remain pinned to published version', () => {
  const db = new Database(':memory:'); try {
    const {adventures, worlds, view, draft, revision} = start(db);
    adventures.act(view.id, input('search', 0));
    const changed = content(); changed.actions[1].text = '后来版本'; worlds.update(draft.id, {version: 1, content: changed}); worlds.publish(draft.id, {version: 2});
    const ended = adventures.act(view.id, input('ask', 1));
    assert.equal(ended.turn, 2); assert.equal(ended.elapsed, 3); assert.equal(ended.worldRevisionId, revision.id);
    assert.equal(ended.ending?.id, 'success'); assert.equal(ended.history.at(-1)?.text, '守门人给予许可。\n钟声响起。');
    assert.throws(() => adventures.act(view.id, input('wait', 2)), status(409));
  } finally {db.close();}
});
test('event chains rescan in array order, hidden text stays private, first ending precedes timeout', () => {
  const db = new Database(':memory:'); try {
    const world = content(); world.timeLimit = 3; world.actions[0].timeCost = 3;
    world.events = [
      {id: 'first', label: 'first', when: [{kind: 'fact', factId: 'bell', value: true}], effects: [{kind: 'set', factId: 'permit', value: true}], text: '公开连锁。', visibility: 'public'},
      {id: 'second', label: 'second', when: [{kind: 'time', atLeast: 3}], effects: [{kind: 'set', factId: 'bell', value: true}], text: '隐藏事件不可见', visibility: 'hidden'},
    ];
    world.endings.push({id: 'later', title: '次序二', text: '不应该出现', when: [{kind: 'fact', factId: 'permit', value: true}]});
    const {adventures, view} = start(db, world); const ended = adventures.act(view.id, input('wait', 0));
    assert.equal(ended.ending?.id, 'success'); assert.equal(ended.history.at(-1)?.text, '你等待片刻。\n公开连锁。');
    assert.equal(JSON.stringify(ended).includes('隐藏事件不可见'), false);
  } finally {db.close();}
});
test('initial state settles event effects and endings before consuming any turns', () => {
  const db = new Database(':memory:'); try {
    const world = content(); world.events[0].when = [{kind: 'time', atLeast: 0}]; world.events[0].effects = [{kind: 'set', factId: 'permit', value: true}];
    const {view} = start(db, world); assert.equal(view.ended, true); assert.equal(view.ending?.id, 'success'); assert.equal(view.turn, 0); assert.equal(view.elapsed, 0);
    assert.equal(view.actions.length, 0); assert.ok(view.history[0].text.includes('钟声响起。'));
  } finally {db.close();}
});
test('events never refire on later actions and timeout refuses actions exceeding remaining time', () => {
  const db = new Database(':memory:'); try {
    const {adventures, view} = start(db); const once = adventures.act(view.id, input('wait', 0));
    assert.equal(once.facts.find(f => f.id === 'bell')?.value, true);
    const twice = adventures.act(view.id, input('wait', 1)); assert.equal(twice.facts.find(f => f.id === 'bell')?.value, false);
    assert.equal(twice.history.filter(h => h.text.includes('钟声响起。')).length, 1);
    const searched = adventures.act(view.id, input('search', 2)); assert.equal(searched.elapsed, 5);
    assert.equal(searched.actions.find(a => a.id === 'wait')?.enabled, false);
    assert.throws(() => adventures.act(view.id, input('wait', 3)), status(400)); assert.equal(adventures.get(view.id).elapsed, 5);
  } finally {db.close();}
});
test('NPC presence and current truth gate knowledge conditions, effects execute sequentially', () => {
  const db = new Database(':memory:'); try {
    const world = content(); world.npcs[0].initialLocationId = 'market';
    world.actions[2].effects = [{kind: 'set', factId: 'secret', value: false}, {kind: 'set', factId: 'secret', value: true}, {kind: 'reveal', factId: 'secret'}, {kind: 'npc_move', npcId: 'keeper', locationId: 'dock'}, {kind: 'npc_learn', npcId: 'keeper', factId: 'permit'}];
    const {adventures, view} = start(db, world); assert.equal(view.npcs.length, 0); assert.equal(view.actions.find(a => a.id === 'ask')?.enabled, false);
    assert.throws(() => adventures.act(view.id, input('ask', 0)), status(400));
    const searched = adventures.act(view.id, input('search', 0)); assert.equal(searched.npcs.length, 1); assert.equal(searched.actions.find(a => a.id === 'ask')?.enabled, true);
    assert.equal(adventures.act(view.id, input('ask', 1)).ending?.id, 'success');
  } finally {db.close();}
});
test('exact original action response replays after later moves and SQLite reopen, parameter reuse conflicts', () => {
  const directory = mkdtempSync(join(tmpdir(), 'open-replay-')); const path = join(directory, 'state.sqlite'); let db = new Database(path);
  try {
    let {adventures, view} = start(db); const action = input('wait', 0); const response = adventures.act(view.id, action);
    adventures.act(view.id, input('search', 1)); db.close(); db = new Database(path); ({adventures} = setup(db));
    assert.deepEqual(adventures.act(view.id, action), response); assert.equal(adventures.get(view.id).turn, 2);
    assert.throws(() => adventures.act(view.id, {...action, actionId: 'search'}), status(409));
    assert.throws(() => adventures.act(view.id, {...action, expectedTurn: 2}), status(409));
  } finally {db.close(); rmSync(directory, {recursive: true, force: true});}
});
test('failed write rolls back event settlement and replay, retry executes once', () => {
  const db = new Database(':memory:'); try {
    const {adventures, view} = start(db); const action = input('wait', 0);
    db.exec("CREATE TRIGGER reject_adventure BEFORE UPDATE ON adventure_sessions BEGIN SELECT RAISE(ABORT, 'write failure'); END");
    assert.throws(() => adventures.act(view.id, action), /write failure/); assert.deepEqual(adventures.get(view.id), view);
    assert.equal((db.prepare('SELECT count(*) AS count FROM adventure_events').get() as {count: number}).count, 0);
    db.exec('DROP TRIGGER reject_adventure'); const recovered = adventures.act(view.id, action);
    assert.equal(recovered.turn, 1); assert.equal(recovered.facts.find(f => f.id === 'bell')?.value, true);
    assert.deepEqual(adventures.act(view.id, action), recovered);
  } finally {db.close();}
});

test('two SQLite connections serialize expected turns and share durable replays', () => {
  const directory = mkdtempSync(join(tmpdir(), 'open-concurrent-')); const path = join(directory, 'state.sqlite');
  const db1 = new Database(path); const db2 = new Database(path);
  try {
    const {adventures, view} = start(db1); const second = setup(db2).adventures;
    const action = input('wait', 0); const moved = adventures.act(view.id, action);
    assert.throws(() => second.act(view.id, input('search', 0)), status(409));
    assert.deepEqual(second.act(view.id, action), moved);
    assert.equal(second.get(view.id).history.length, 2);
  } finally {db1.close(); db2.close(); rmSync(directory, {recursive: true, force: true});}
});

test('movement changes available actions and present NPCs; timeout occurs after exactly remaining time', () => {
  const db = new Database(':memory:'); try {
    const world = content(); world.timeLimit = 3;
    world.npcs[0].initialLocationId = 'market';
    world.actions[2].effects = [{kind: 'move', locationId: 'market'}];
    world.actions[0].locationId = 'market';
    const {adventures, view} = start(db, world); const moved = adventures.act(view.id, input('search', 0));
    assert.equal(moved.location.id, 'market'); assert.deepEqual(moved.actions.map(a => a.id), ['wait', '__wait__']); assert.equal(moved.npcs[0].id, 'keeper');
    const ended = adventures.act(view.id, input('wait', 1));
    assert.equal(ended.elapsed, 3); assert.equal(ended.turn, 2); assert.equal(ended.ending?.id, 'timeout'); assert.equal(ended.ending?.text, '渡船已经离开。');
    assert.equal(ended.actions.length, 0); assert.deepEqual(adventures.get(view.id), ended);
  } finally {db.close();}
});

test('knowledge does not override current false truth; all requirements are AND and NPC learning unlocks actions', () => {
  const db = new Database(':memory:'); try {
    const world = content(); world.npcs[0].knownFactIds = []; world.facts[1].initialValue = false; world.facts[1].playerKnown = true;
    world.actions[2].effects = [{kind: 'npc_learn', npcId: 'keeper', factId: 'secret'}];
    world.actions[0].effects = [{kind: 'set', factId: 'secret', value: true}];
    const {adventures, view} = start(db, world);
    const learned = adventures.act(view.id, input('search', 0));
    assert.equal(learned.actions.find(a => a.id === 'ask')?.enabled, false);
    assert.throws(() => adventures.act(view.id, input('ask', 1)), status(400));
    const truth = adventures.act(view.id, input('wait', 1)); assert.equal(truth.actions.find(a => a.id === 'ask')?.enabled, true);
    assert.equal(adventures.act(view.id, input('ask', 2)).ending?.id, 'success');
  } finally {db.close();}
});

test('unknown persisted schema versions fail explicitly instead of silently misinterpreting state', () => {
  const db = new Database(':memory:'); try {
    const {adventures, view} = start(db);
    db.prepare("UPDATE adventure_sessions SET data=json_set(data, '$.schemaVersion', 2) WHERE id=?").run(view.id);
    assert.throws(() => adventures.get(view.id), e => e instanceof AppError && e.code === 'UNSUPPORTED_ADVENTURE_STATE');
  } finally {db.close();}
});

test('prototype-like identifiers remain ordinary own keys through effects, persistence and replay', () => {
  const db = new Database(':memory:'); try {
    const world = content(); world.facts[1].id = '__proto__'; world.npcs[0].id = 'constructor'; world.npcs[0].knownFactIds = ['__proto__'];
    world.initialLocationId = 'toString'; world.locations[0].id = 'toString'; world.npcs[0].initialLocationId = 'toString';
    for (const action of world.actions) if (action.locationId === 'dock') action.locationId = 'toString';
    world.actions[1].npcId = 'constructor'; world.actions[1].requires = [
      {kind: 'known', factId: '__proto__'}, {kind: 'npc_knows', npcId: 'constructor', factId: '__proto__'}, {kind: 'fact', factId: '__proto__', value: true},
    ];
    world.actions[2].effects = [{kind: 'set', factId: '__proto__', value: false}, {kind: 'set', factId: '__proto__', value: true}, {kind: 'reveal', factId: '__proto__'}, {kind: 'npc_learn', npcId: 'constructor', factId: '__proto__'}];
    const {adventures, view} = start(db, world);
    const action = input('search', 0); const searched = adventures.act(view.id, action);
    assert.equal(searched.location.id, 'toString'); assert.equal(searched.npcs[0].id, 'constructor');
    assert.equal(searched.facts.find(f => f.id === '__proto__')?.value, true);
    assert.equal(searched.actions.find(a => a.id === 'ask')?.enabled, true);
    assert.deepEqual(adventures.get(view.id), searched); assert.deepEqual(adventures.act(view.id, action), searched);
    assert.equal(adventures.act(view.id, input('ask', 1)).ending?.id, 'success');
    assert.equal(Object.prototype.hasOwnProperty.call(Object.prototype, 'knownFactIds'), false);
  } finally {db.close();}
});
