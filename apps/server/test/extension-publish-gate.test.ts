import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {ExtensionDeclaration, WorldContent, WorldDraft, WorldRevision} from '@novel-game/contracts';
import {worldContentSchema} from '@novel-game/contracts';
import {WorldService, SqliteWorldRepository, assertWorldPublishQuality} from '../src/modules/worlds/index.js';
import {PreflightService, SqlitePreflightRepository} from '../src/modules/preflight/index.js';
import {openDatabase} from '../src/platform/database.js';
import {worldCommands} from '../src/app/commands/worlds.js';
import type {Workbench} from '../src/app/workbench.js';
import {errorResponse} from '../src/adapters/errors.js';
import {AppError} from '../src/shared/errors.js';
import {content, source} from './helpers/open-fixture.js';

const unavailable = (e: unknown) => e instanceof AppError && e.code === 'EXTENSION_PUBLISH_UNAVAILABLE' && e.status === 503;
const errorCode = (code: string) => (e: unknown) => e instanceof AppError && e.code === code;
const reference = () => ({kind: 'extension' as const, extensionId: 'acceptance', params: {}});
function declaration(): ExtensionDeclaration {
  return {id: 'acceptance', version: '1.0.0', name: '验收夹具', point: 'condition', reads: ['elapsed'], writes: [],
    hooks: ['onTurn'], params: {}, reason: '服务端发布限制测试', code: '() => true',
    tests: [0, 1, 2].map(elapsed => ({input: {state: {elapsed}, params: {}, seed: 1}, expected: true}))};
}

/** Five real advances before the authored ending; unused declarations need no sandbox execution. */
function progressingContent(): WorldContent {
  const world = content();
  world.facts = Array.from({length: 5}, (_, i) => ({id: `clue-${i}`, label: `线索${i}`, description: '',
    kind: 'event', initialValue: false, playerKnown: true, origin: 'adapted', evidence: []}));
  world.npcs = [];
  world.actions = Array.from({length: 3}, (_, i) => ({id: `inspect-${i}`, label: `调查${i}`, description: '',
    locationId: 'dock', availableWhen: [], requires: [], blockedReason: '暂不可用', risk: '', timeCost: 1, once: false,
    effects: [{kind: 'set', factId: 'clue-0', value: true}],
    text: `你从第${i}处调查点核实了渡口消息，船工正在依次带回各段航道的独立调查结果。`, origin: 'adapted', evidence: []}));
  world.events = Array.from({length: 5}, (_, i) => ({id: `message-${i}`, label: `船工${i}`,
    when: [{kind: 'time', atLeast: i + 1}], effects: [{kind: 'set', factId: `clue-${i}`, value: true}],
    text: `第${i + 1}位船工带回了航道第${i}段的调查记录。`, visibility: 'public'}));
  world.endings = [{id: 'arrived', title: '抵达', text: '你核实全部航道消息，随船抵达对岸并完成渡河。',
    when: world.facts.map(fact => ({kind: 'fact', factId: fact.id, value: true}))}];
  world.timeLimit = 12;
  return worldContentSchema.parse(world);
}

function setup(policy: 'real' | 'none' | 'noop' = 'real') {
  const db = openDatabase(':memory:');
  const repository = new SqliteWorldRepository(db);
  const reports = new SqlitePreflightRepository(db);
  let gateCalls = 0;
  const worlds: WorldService = new WorldService(repository, {get: () => structuredClone(source)}, undefined,
    policy === 'none' ? undefined : {allowMockPublish: true, playtest: id => reports.get('world', id).playtest,
      publishQualityGate: draft => {
        gateCalls++;
        if (policy === 'real') assertWorldPublishQuality(worlds, draft, reports.get('world', draft.id).playtest);
      }});
  const preflight = new PreflightService(reports, {world: id => worlds.get(id), story: () => {throw new Error('unused');}});
  let playtests = 0;
  const playtest = preflight.playtestWorldDraft.bind(preflight);
  preflight.playtestWorldDraft = input => {playtests++; return playtest(input);};
  // Exercise the production shared command, never a replacement publish implementation.
  const command = worldCommands({worlds, preflight} as unknown as Workbench).find(c => c.name === 'publish_world_draft')!;
  function persist(draft: WorldDraft) {
    // Seed historical/corrupt records without tightening legacy read schemas.
    db.prepare('UPDATE world_drafts SET version=?,data=? WHERE id=?').run(draft.version, JSON.stringify(draft), draft.id);
  }
  function legacy(draft: WorldDraft) {const next = structuredClone(draft); delete next.qualityContractVersion; persist(next); return next;}
  return {db, repository, reports, worlds, preflight, command, persist, legacy,
    gateCalls: () => gateCalls, playtests: () => playtests, close: () => db.close()};
}

test('extension declaration blocks sync publish despite matching real server playtest (A1)', async () => {
  const s = setup();
  try {
    const world = progressingContent(); world.extensions = [declaration()];
    const draft = s.worlds.create({sourceId: source.id, content: world});
    assert.equal(s.worlds.validate(draft.id).valid, true);
    const report = await s.preflight.playtestWorldDraft({id: draft.id, expectedVersion: 1, seeds: 6,
      strategies: ['random', 'greedy-growth', 'greedy-money', 'merchant', 'lazy'], evidenceRuns: 6, maxSteps: 300});
    assert.equal(report.evidence?.status, 'observed');
    assert.doesNotThrow(() => assertWorldPublishQuality(s.worlds, draft, report));
    const before = s.worlds.get(draft.id);
    assert.throws(() => s.worlds.publish(draft.id, {version: 1}), unavailable);
    assert.equal(s.gateCalls(), 0);
    assert.deepEqual(s.worlds.get(draft.id), before);
    assert.deepEqual(s.worlds.listRevisions(), []);
  } finally {s.close();}
});

test('mandatory restriction covers legacy, absent/noop policies and mock permission (A2–A3)', async t => {
  for (const policy of ['real', 'none', 'noop'] as const) for (const legacy of [false, true]) {
    await t.test(`${policy} policy; legacy=${legacy}`, () => {
      const s = setup(policy);
      try {
        const world = progressingContent(); world.extensions = [declaration()]; world.provenance = {generator: 'mock'};
        const draft = s.worlds.create({sourceId: source.id, content: world});
        if (legacy) s.legacy(draft);
        assert.throws(() => s.worlds.publish(draft.id, {version: 1}), unavailable);
        assert.equal(s.gateCalls(), 0);
        assert.deepEqual(s.worlds.listRevisions(), []);
      } finally {s.close();}
    });
  }
});

test('structural references block without declarations or with an empty array (A4)', async t => {
  const cases: [string, (world: WorldContent) => void][] = [
    ['action effect', w => {w.actions[0]!.effects.push(reference());}],
    ['condition anyOf', w => {w.actions[0]!.requires = [{kind: 'anyOf', conditions: [reference()]}];}],
    ['roll success', w => {w.actions[0]!.effects.push({kind: 'roll', chance: {base: 0.5}, success: [reference()], failure: []});}],
    ['roll failure', w => {w.actions[0]!.effects.push({kind: 'roll', chance: {base: 0.5}, success: [], failure: [reference()]});}],
    ['event condition', w => {w.events[0]!.when.push(reference());}],
    ['event effect', w => {w.events[0]!.effects.push(reference());}],
    ['ending condition', w => {w.endings[0]!.when.push(reference());}],
    ['end condition', w => {w.endings.push({id: 'lost', title: '错过渡船', text: '渡船离开了。', kind: 'failure', when: [{kind: 'time', atLeast: 12}]});
      w.endConditions = {source: 'author-custom', severity: 'reshapes-game',
        win: [{id: 'win', kind: 'win', label: '抵达', endingId: 'arrived', when: [reference()]}],
        lose: [{id: 'lose', kind: 'lose', label: '错过', endingId: 'lost', when: [{kind: 'time', atLeast: 12}]}]};}],
    ['storylet choice', w => {w.storylets = [{id: 'card', title: '卡片', text: '调查所得的记录。',
      choices: [{id: 'read', label: '阅读', timeCost: 1, effects: [reference()], text: '你读完记录。'}]}];}],
    ['storylet text case', w => {w.storylets = [{id: 'card', title: '卡片', text: '调查记录。',
      textCases: [{when: [reference()], text: '另一段记录。'}],
      choices: [{id: 'read', label: '阅读', timeCost: 1, effects: [], text: '读完记录。'}]}];}],
    ['resource threshold', w => {w.resourceDefs = {coin: {label: '钱', min: 0, max: 10, onMax: {effects: [reference()]}}};}],
    ['clock rule', w => {w.clock = {unit: 'month', startYear: 1, startMonth: 1, limitMonths: 12,
      rules: [{everyMonths: 1, effects: [reference()]}]};}],
    ['ending passage', w => {w.endings[0]!.passages = [{id: 'passage', when: [reference()], text: '调查后记。'}];}],
    ['recap', w => {w.recap = [{id: 'recap', when: [reference()], text: '你记下渡河经历。'}];}],
  ];
  for (const [label, edit] of cases) for (const empty of [false, true]) await t.test(`${label}; empty=${empty}`, () => {
    const s = setup('noop');
    try {
      const world = progressingContent(); if (empty) world.extensions = []; edit(world);
      const draft = s.worlds.create({sourceId: source.id, content: worldContentSchema.parse(world)});
      assert.throws(() => s.worlds.publish(draft.id, {version: 1}), unavailable);
      assert.deepEqual(s.worlds.listRevisions(), []);
    } finally {s.close();}
  });
});

test('malformed persisted declarations fail closed before other gates (A4)', async t => {
  for (const extensions of [null, {}, 'extension', 1, false, [null], [{}]]) await t.test(JSON.stringify(extensions), () => {
    const s = setup('none');
    try {
      const draft = s.worlds.create({sourceId: source.id, content: progressingContent()});
      s.persist({...draft, content: {...draft.content, extensions} as unknown as WorldContent});
      assert.throws(() => s.worlds.publish(draft.id, {version: 1}), unavailable);
      assert.deepEqual(s.worlds.listRevisions(), []);
    } finally {s.close();}
  });
});

test('absent/empty declarations and extension prose still publish (A5)', async t => {
  for (const empty of [false, true]) await t.test(`empty=${empty}`, () => {
    const s = setup('noop');
    try {
      const world = progressingContent();
      if (empty) world.extensions = [];
      world.adaptationNotes = 'extensions: [{kind: "extension"}] is prose only';
      world.actions[0]!.text += ' 记录中写着 kind: extension。';
      const draft = s.worlds.create({sourceId: source.id, content: world});
      const revision = s.worlds.publish(draft.id, {version: 1});
      assert.equal(revision.version, 1);
      assert.equal(s.gateCalls(), 1);
      assert.deepEqual(s.worlds.publish(draft.id, {version: 1}), revision);
    } finally {s.close();}
  });
});

test('historical extension revisions reject repeat publication but remain readable (A6)', () => {
  const s = setup('none');
  try {
    const world = progressingContent(); world.extensions = [declaration()];
    const draft = s.worlds.create({sourceId: source.id, content: world});
    const revision: WorldRevision = {id: 'historical-extension', draftId: draft.id, sourceId: draft.sourceId,
      version: 1, content: draft.content, createdAt: draft.createdAt};
    s.repository.publish(revision);
    const next = {...draft, version: 2, content: progressingContent()}; s.persist(next);
    assert.throws(() => s.worlds.publish(draft.id, {version: 1}), unavailable);
    assert.deepEqual(s.worlds.getRevision(revision.id), revision);
    assert.deepEqual(s.worlds.listRevisions(), [revision]);
    assert.deepEqual(s.worlds.get(draft.id), next);
  } finally {s.close();}
});

test('historical extension-free revision ignores extensions in current draft (A6)', () => {
  const s = setup('noop');
  try {
    const draft = s.worlds.create({sourceId: source.id, content: progressingContent()});
    const revision = s.worlds.publish(draft.id, {version: 1});
    s.persist({...draft, version: 2, content: {...draft.content, extensions: [declaration()]}});
    assert.deepEqual(s.worlds.publish(draft.id, {version: 1}), revision);
    assert.throws(() => s.worlds.publish(draft.id, {version: 2}), unavailable);
    assert.deepEqual(s.worlds.listRevisions(), [revision]);
  } finally {s.close();}
});

test('shared command propagates extension 503 without preflight or retry (A7–A8)', async () => {
  const s = setup();
  try {
    const world = progressingContent(); world.extensions = [declaration()];
    const draft = s.worlds.create({sourceId: source.id, content: world});
    let publications = 0;
    const publish = s.worlds.publish.bind(s.worlds);
    s.worlds.publish = (id, input) => {publications++; return publish(id, input);};
    await assert.rejects(async () => s.command.execute({id: draft.id, version: 1}), error => {
      assert.ok(unavailable(error));
      assert.equal(errorResponse(error).status, 503);
      assert.equal(errorResponse(error).body.error.code, 'EXTENSION_PUBLISH_UNAVAILABLE');
      return true;
    });
    assert.equal(publications, 1);
    assert.equal(s.playtests(), 0);
    assert.deepEqual(s.worlds.listRevisions(), []);
  } finally {s.close();}
});

test('extension-free stale quality evidence still triggers command preflight and retry (A7)', async () => {
  const s = setup();
  try {
    const draft = s.worlds.create({sourceId: source.id, content: progressingContent()});
    assert.throws(() => s.worlds.publish(draft.id, {version: 1}), errorCode('PUBLISH_QUALITY_STALE'));
    const revision = await s.command.execute({id: draft.id, version: 1}) as WorldRevision;
    assert.equal(revision.draftId, draft.id);
    assert.equal(s.playtests(), 1);
    assert.equal(s.worlds.listRevisions().length, 1);
  } finally {s.close();}
});

test('stale version cannot publish and extension rejection leaves records untouched (A9)', () => {
  const s = setup('noop');
  try {
    const draft = s.worlds.create({sourceId: source.id, content: progressingContent()});
    const next = {...draft, version: 2, content: {...draft.content, extensions: [declaration()]}}; s.persist(next);
    const baseline = s.worlds.getPreservationBaseline(draft.id);
    assert.throws(() => s.worlds.publish(draft.id, {version: 1}), errorCode('DRAFT_VERSION_CONFLICT'));
    assert.throws(() => s.worlds.publish(draft.id, {version: 2}), unavailable);
    assert.deepEqual(s.worlds.get(draft.id), next);
    assert.deepEqual(s.worlds.getPreservationBaseline(draft.id), baseline);
    assert.deepEqual(s.worlds.listRevisions(), []);
  } finally {s.close();}
});
