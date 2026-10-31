import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SqliteDatabase as Database } from '../src/platform/database.js';
import { WorldService, SqliteWorldRepository } from '../src/modules/worlds/index.js';
import { source, content } from './helpers/open-fixture.js';
import { AppError } from '../src/shared/errors.js';
import type { Storylet, WorldContent, WorldDraft } from '@novel-game/contracts';
import { worldCommands } from '../src/app/commands/worlds.js';
import type { Workbench } from '../src/app/workbench.js';
const status = (n: number) => (e: unknown) => e instanceof AppError && e.status === n;
function setup(db: Database) { return new WorldService(new SqliteWorldRepository(db), {get: () => structuredClone(source)}); }

const fineCommandNames = [
  'add_world_location', 'update_world_location', 'add_world_storylet', 'update_world_storylet',
  'add_storylet_condition', 'remove_storylet_condition', 'add_storylet_effect', 'remove_storylet_effect',
  'add_world_resource_def', 'update_world_resource_def',
] as const;
function storyletFixture(id = 'card'): Storylet {
  return {id, title: id === 'card' ? '旧卡' : '新卡', text: '剧情正文', locationIds: ['dock'],
    when: [{kind: 'known', factId: 'secret'}],
    choices: [{id: 'choice', label: '选择', timeCost: 1, effects: [{kind: 'set', factId: 'bell', value: true}], text: '选择结果'}]};
}
function editingContent(): WorldContent {
  const world = content();
  world.storylets = [storyletFixture()];
  world.resourceDefs = {qi: {label: '修为', min: 0, max: 10, initial: 1}};
  return world;
}
function fineInput(name: typeof fineCommandNames[number], world: WorldContent, version: number): Record<string, unknown> {
  switch (name) {
    case 'add_world_location': return {version, location: {id: 'attic', title: '阁楼', text: '安静阁楼', origin: 'adapted', evidence: []}};
    case 'update_world_location': return {version, location: {...world.locations[0]!, title: '新渡口', text: '更新后的渡口'}};
    case 'add_world_storylet': return {version, storylet: storyletFixture('extra')};
    case 'update_world_storylet': return {version, storylet: {...world.storylets![0]!, title: '修改后的卡'}};
    case 'add_storylet_condition': return {version, storyletId: 'card', target: 'when', condition: {kind: 'fact', factId: 'permit', value: true}};
    case 'remove_storylet_condition': return {version, storyletId: 'card', target: 'when', conditionIndex: 0};
    case 'add_storylet_effect': return {version, storyletId: 'card', choiceId: 'choice', effect: {kind: 'reveal', factId: 'noticed'}};
    case 'remove_storylet_effect': return {version, storyletId: 'card', choiceId: 'choice', effectIndex: 0};
    case 'add_world_resource_def': return {version, resourceId: 'spirit', definition: {label: '灵力', min: 0, max: 20, initial: 2}};
    case 'update_world_resource_def': return {version, resourceId: 'qi', definition: {label: '真气', min: 0, max: 20, initial: 2}};
  }
}
function commandSetup(db: Database) {
  const worlds = setup(db);
  const commands = worldCommands({worlds} as unknown as Workbench);
  return {worlds, run(name: string, input: Record<string, unknown>) {
    const command = commands.find(item => item.name === name);
    assert.ok(command, `missing command ${name}`);
    return command.execute(input) as WorldDraft;
  }};
}

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
    const worlds = setup(db); const world = content();
    // Opening density intact; attic has no inbound move edge.
    world.locations.push({id: 'attic', title: 'attic', text: '孤立阁楼', origin: 'adapted', evidence: []});
    const draft = worlds.create({sourceId: source.id, content: world});
    const result = worlds.validate(draft.id);
    assert.equal(result.valid, true);
    assert.ok(result.warnings.some(w => w.includes('attic')), result.warnings.join(';'));
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

test('validateWorld rejects when opening location has fewer than 3 immediately executable actions', () => {
  const db = new Database(':memory:'); try {
    const worlds = setup(db); const world = content();
    // Lock non-wait opening actions behind availability gates → 0 executable (wait does not count).
    for (const action of world.actions) {
      if (action.locationId === world.initialLocationId && action.id !== 'wait') {
        action.availableWhen = [{kind: 'fact', factId: 'permit', value: true}];
      }
    }
    const draft = worlds.create({sourceId: source.id, content: world});
    const result = worlds.validate(draft.id);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => /开局可执行行动不足/.test(e)), result.errors.join(';'));
    assert.throws(() => worlds.publish(draft.id, {version: 1}), status(400));
  } finally {db.close();}
});

test('validateWorld does not count requires-locked visible actions toward opening density', () => {
  const db = new Database(':memory:'); try {
    const worlds = setup(db); const world = content();
    // Only search stays free; look/to_market/ask require unmet facts → executable = 1 (search).
    for (const action of world.actions) {
      if (['look', 'to_market'].includes(action.id)) {
        action.requires = [{kind: 'fact', factId: 'permit', value: true}];
        action.blockedReason = '还没有许可';
      }
    }
    const draft = worlds.create({sourceId: source.id, content: world});
    const result = worlds.validate(draft.id);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => /开局可执行行动不足：起始地点仅有 1 个/.test(e)), result.errors.join(';'));
  } finally {db.close();}
});

test('archived world drafts leave the list but keep revisions readable', () => {
  const db = new Database(':memory:'); try {
    const worlds = setup(db); const draft = worlds.create({sourceId: source.id, content: content()});
    worlds.publish(draft.id, {version: 1});
    assert.deepEqual(worlds.archive(draft.id), {id: draft.id, archived: true});
    assert.equal(worlds.list().length, 0); assert.equal(worlds.listRevisions().length, 1);
    assert.equal(worlds.get(draft.id).id, draft.id);
    assert.throws(() => worlds.archive('missing'), status(404));
  } finally {db.close();}
});

test('all 10 fine-grained world commands execute their normal path with rules validation and CAS versions', () => {
  const db = new Database(':memory:'); try {
    const {worlds, run} = commandSetup(db);
    const draft = worlds.create({sourceId: source.id, content: editingContent()});
    fineCommandNames.forEach((name, index) => {
      const current = worlds.get(draft.id);
      const updated = run(name, {id: draft.id, ...fineInput(name, current.content, current.version)});
      assert.equal(updated.version, index + 2, name);
      assert.equal(worlds.validate(draft.id).valid, true, `${name}: ${worlds.validate(draft.id).errors.join(';')}`);
    });
    const result = worlds.get(draft.id);
    assert.equal(result.version, 11);
    assert.equal(result.content.locations.find(location => location.id === 'attic')?.title, '阁楼');
    assert.equal(result.content.locations.find(location => location.id === 'dock')?.title, '新渡口');
    assert.equal(result.content.storylets?.some(storylet => storylet.id === 'extra'), true);
    const card = result.content.storylets?.find(storylet => storylet.id === 'card');
    assert.equal(card?.title, '修改后的卡');
    assert.deepEqual(card?.when, [{kind: 'fact', factId: 'permit', value: true}]);
    assert.deepEqual(card?.choices[0]?.effects, [{kind: 'reveal', factId: 'noticed'}]);
    assert.deepEqual(result.content.resourceDefs?.spirit, {label: '灵力', min: 0, max: 20, initial: 2});
    assert.deepEqual(result.content.resourceDefs?.qi, {label: '真气', min: 0, max: 20, initial: 2});
  } finally {db.close();}
});

test('each fine-grained world command rejects schema or rules validation failures without saving', () => {
  const db = new Database(':memory:'); try {
    const {worlds, run} = commandSetup(db);
    const original = editingContent();
    const draft = worlds.create({sourceId: source.id, content: original});
    for (const name of fineCommandNames) {
      const input = fineInput(name, original, 1);
      let expected: 'rules' | 'schema' = 'rules';
      if (name === 'add_world_location' || name === 'update_world_location') {
        input.location = {...input.location as object, origin: 'source', evidence: []};
      } else if (name === 'add_world_storylet' || name === 'update_world_storylet') {
        input.storylet = {...input.storylet as object, locationIds: ['missing']};
      } else if (name === 'add_storylet_condition') {
        input.condition = {kind: 'fact', factId: 'missing', value: true};
      } else if (name === 'remove_storylet_condition') {
        input.conditionIndex = -1; expected = 'schema';
      } else if (name === 'add_storylet_effect') {
        input.effect = {kind: 'resource', resourceId: 'missing', delta: 1};
      } else if (name === 'remove_storylet_effect') {
        input.effectIndex = -1; expected = 'schema';
      } else if (name === 'add_world_resource_def' || name === 'update_world_resource_def') {
        input.definition = {...input.definition as object, initial: 99};
      }
      if (expected === 'rules') {
        assert.throws(() => run(name, {id: draft.id, ...input}),
          (error: unknown) => error instanceof AppError && error.code === 'INVALID_WORLD' && error.status === 400, name);
      } else {
        assert.throws(() => run(name, {id: draft.id, ...input}), name);
      }
      assert.equal(worlds.get(draft.id).version, 1, `${name} must not save a rejected edit`);
      assert.deepEqual(worlds.get(draft.id).content, original, name);
    }
  } finally {db.close();}
});

test('each fine-grained world command rejects a stale version before editing', () => {
  const db = new Database(':memory:'); try {
    const {worlds, run} = commandSetup(db);
    const original = editingContent();
    const draft = worlds.create({sourceId: source.id, content: original});
    for (const name of fineCommandNames) {
      assert.throws(() => run(name, {id: draft.id, ...fineInput(name, original, 2)}),
        (error: unknown) => error instanceof AppError && error.code === 'DRAFT_VERSION_CONFLICT' && error.status === 409, name);
      assert.equal(worlds.get(draft.id).version, 1, name);
      assert.deepEqual(worlds.get(draft.id).content, original, name);
    }
  } finally {db.close();}
});
