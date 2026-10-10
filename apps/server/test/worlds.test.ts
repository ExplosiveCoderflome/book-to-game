import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SqliteDatabase as Database } from '../src/platform/database.js';
import { WorldService, SqliteWorldRepository } from '../src/modules/worlds/index.js';
import { source, content } from './helpers/open-fixture.js';
import { AppError } from '../src/shared/errors.js';
const status = (n: number) => (e: unknown) => e instanceof AppError && e.status === n;
function setup(db: Database) { return new WorldService(new SqliteWorldRepository(db), {get: () => structuredClone(source)}); }

test('world drafts permit incomplete references but refuse publishing them', () => {
  const db = new Database(':memory:'); try {
    const worlds = setup(db); const world = content(); world.actions[0].effects = [{kind: 'move', locationId: 'absent'}];
    const draft = worlds.create({sourceId: source.id, content: world});
    assert.equal(worlds.list().length, 1); assert.equal(worlds.validate(draft.id).valid, false);
    assert.throws(() => worlds.publish(draft.id, {version: 1}), status(400));
    assert.equal(worlds.listRevisions().length, 0);
    worlds.update(draft.id, {version: 1, content: content()});
    assert.equal(worlds.validate(draft.id).valid, true);
    assert.throws(() => worlds.update(draft.id, {version: 1, content: content()}), status(409));
  } finally {db.close();}
});
test('provenance must belong to selected chapters, source-origin entries require evidence', () => {
  const db = new Database(':memory:'); try {
    const worlds = setup(db); const world = content();
    world.locations[0] = {...world.locations[0], origin: 'source', evidence: [{chapterId: 'ch2', paragraphId: 'p2'}]};
    const draft = worlds.create({sourceId: source.id, content: world});
    assert.equal(worlds.validate(draft.id).valid, false);
    world.locations[0].evidence = [{chapterId: 'ch1', paragraphId: 'p1'}];
    const updated = worlds.update(draft.id, {version: 1, content: world}); assert.equal(worlds.validate(draft.id).valid, true);
    world.locations[0].evidence = []; worlds.update(draft.id, {version: updated.version, content: world});
    assert.equal(worlds.validate(draft.id).valid, false);
  } finally {db.close();}
});
test('world validation catches duplicate IDs, chapter selections, NPC and condition references', () => {
  const db = new Database(':memory:'); try {
    const worlds = setup(db); const world = content(); world.sourceChapterIds = ['ch1', 'ch1', 'absent'];
    world.actions[1].npcId = 'absent'; world.actions[1].requires = [{kind: 'npc_knows', npcId: 'absent', factId: 'missing'}];
    world.facts.push(structuredClone(world.facts[0])); world.npcs[0].knownFactIds = ['missing'];
    world.events[0].effects = [{kind: 'npc_move', npcId: 'absent', locationId: 'absent'}];
    const result = worlds.validate(worlds.create({sourceId: source.id, content: world}).id);
    assert.equal(result.valid, false); assert.ok(result.errors.length >= 8);
  } finally {db.close();}
});
test('unreachable locations warn conservatively without rejecting valid declarative worlds', () => {
  const db = new Database(':memory:'); try {
    const worlds = setup(db); const draft = worlds.create({sourceId: source.id, content: content()});
    const result = worlds.validate(draft.id); assert.equal(result.valid, true); assert.ok(result.warnings.some(w => w.includes('market')));
  } finally {db.close();}
});
test('world publication is immutable and idempotent even after later draft edits', () => {
  const db = new Database(':memory:'); try {
    const worlds = setup(db); const draft = worlds.create({sourceId: source.id, content: content()});
    const revision = worlds.publish(draft.id, {version: 1}); const changed = content(); changed.title = '更新';
    worlds.update(draft.id, {version: 1, content: changed});
    assert.deepEqual(worlds.publish(draft.id, {version: 1}), revision);
    assert.equal(worlds.getRevision(revision.id).content.title, '渡口');
    assert.equal(worlds.publish(draft.id, {version: 2}).content.title, '更新');
    assert.equal(worlds.listRevisions().length, 2);
    assert.throws(() => db.prepare('UPDATE world_revisions SET data=? WHERE id=?').run('{}', revision.id), /immutable/);
    assert.throws(() => db.prepare('DELETE FROM world_revisions WHERE id=?').run(revision.id), /immutable/);
    assert.throws(() => worlds.getRevision(draft.id), status(404)); assert.throws(() => worlds.get('missing'), status(404));
    assert.throws(() => worlds.publish(draft.id, {version: 0}), status(400));
  } finally {db.close();}
});

test('schema versions and malformed rule effects cannot enter even an editable draft', () => {
  const db = new Database(':memory:'); try {
    const worlds = setup(db); const world = content();
    assert.throws(() => worlds.create({sourceId: source.id, content: {...world, schemaVersion: 2} as unknown as typeof world}));
    assert.equal(worlds.list().length, 0);
    const draft = worlds.create({sourceId: source.id, content: world});
    const bad = {...world, actions: [{...world.actions[0], timeCost: 0}, ...world.actions.slice(1)]};
    assert.throws(() => worlds.update(draft.id, {version: 1, content: bad}));
    assert.equal(worlds.get(draft.id).version, 1);
  } finally {db.close();}
});

test('prototype-like references require declared entities rather than inherited object members', () => {
  const db = new Database(':memory:'); try {
    const worlds = setup(db); const world = content();
    world.actions[1].npcId = 'constructor'; world.actions[1].requires = [{kind: 'fact', factId: '__proto__', value: true}];
    world.actions[2].effects = [{kind: 'move', locationId: 'toString'}];
    const draft = worlds.create({sourceId: source.id, content: world});
    const result = worlds.validate(draft.id); assert.equal(result.valid, false);
    assert.ok(result.errors.some(error => error.includes('__proto__'))); assert.ok(result.errors.some(error => error.includes('constructor')));
    assert.ok(result.errors.some(error => error.includes('toString'))); assert.throws(() => worlds.publish(draft.id, {version: 1}), status(400));
  } finally {db.close();}
});
