import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {ExtensionPublishService, SqliteExtensionReviewStore} from '../src/modules/extensions/index.js';
import type {ExtensionDeclaration, WorldContent, WorldDraft, WorldRevision} from '@novel-game/contracts';
import {worldContentSchema} from '@novel-game/contracts';
import {defaultStrategies} from '@novel-game/play-runtime/sim';
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

function setup(policy: 'real' | 'none' | 'noop' = 'real', wired = false) {
  const db = openDatabase(':memory:');
  const repository = new SqliteWorldRepository(db);
  const reports = new SqlitePreflightRepository(db);
  let gateCalls = 0;
  const worlds: WorldService = new WorldService(repository, {get: () => structuredClone(source)}, undefined,
    policy === 'none' ? undefined : {allowMockPublish: true, ...(wired ? {extensionPublishGate: new ExtensionPublishService(new SqliteExtensionReviewStore(db))} : {}), playtest: id => reports.get('world', id).playtest,
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
    assert.equal(publications, 0, 'async prepare fails closed before sync publication');
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


function acceptedContent(): WorldContent {
  const world = progressingContent();
  const ids = ['dock', 'first', 'second', 'third', 'fourth', 'final'];
  world.locations = ids.map((id, i) => ({id, title: `航道第${i}站`, text: `你来到航道第${i}站，船工逐项核对调查记录，下一段道路的标志清晰可见。`, origin: 'adapted', evidence: []}));
  world.initialLocationId = 'dock'; world.facts = []; world.npcs = []; world.events = [];
  world.endings = ['north', 'south', 'west'].map(id => ({id, title: `${id}航线抵达`, text: `你沿${id}航线核实了调查结果，与同行船工顺利抵达对岸。`, when: [{kind: 'fact' as const, factId: `outcome-${id}`, value: true}, ...Array.from({length: 5}, (_, i) => ({kind: 'fact' as const, factId: `progress-${i}`, value: true}))]}));
  world.facts = [...world.endings.map(e => ({id: `outcome-${e.id}`, label: e.title, description: '航线抵达状态', kind: 'event' as const, initialValue: false, playerKnown: true, origin: 'adapted' as const, evidence: []})),
    ...Array.from({length: 5}, (_, i) => ({id: `progress-${i}`, label: `航道传讯${i}`, description: '定时抵达的真实调查记录', kind: 'event' as const, initialValue: false, playerKnown: true, origin: 'adapted' as const, evidence: []}))];
  world.events = Array.from({length: 5}, (_, i) => ({id: `progress-message-${i}`, label: `航道消息${i}`, when: [{kind: 'time', atLeast: i+1}], effects: [{kind: 'set', factId: `progress-${i}`, value: true}], text: `航道第${i}段的船工送来新的水文记录，调查进展已经获得独立确认。`, visibility: 'public'}));
  const base = {description: '', availableWhen: [], requires: [], blockedReason: '暂不可用', risk: '', timeCost: 1, once: false, origin: 'adapted' as const, evidence: []};
  world.actions = [...ids.slice(0, -1).map((id, i) => ({...base, id: `move-${i}`, label: `前往航道第${i+1}站`, locationId: id,
    effects: [{kind: 'move' as const, locationId: ids[i+1]!}], text: `你仔细查看第${i}段航道的标志，沿安全的路线继续向前行进。`})),
    ...world.endings.map(e => ({...base, id: `finish-${e.id}`, label: `选择${e.title}`, locationId: 'final', effects: [{kind: 'set' as const, factId: `outcome-${e.id}`, value: true}], text: `你选择了${e.title}的航线，记录与同行者的证言相互印证。`}))];
  const first = world.actions[0]!;
  world.actions.push({...first, id: 'move-0-east', label: '沿东侧浮桥前往下一站'}, {...first, id: 'move-0-west', label: '沿西侧浮桥前往下一站'});
  world.timeLimit = 20; world.extensions = [declaration()];
  return worldContentSchema.parse(world);
}

test('wired publish: real contract cases + 2000-seed extended/baseline checks persist hash-bound evidence and shared command publishes', async () => {
  const s = setup('real', true);
  try {
    const draft = s.worlds.create({sourceId: source.id, content: acceptedContent()});
    assert.throws(() => s.worlds.publish(draft.id, {version: 1}), errorCode('EXTENSION_REVIEW_REQUIRED'));
    const report = await s.preflight.playtestWorldDraft({id: draft.id, expectedVersion: 1, seeds: 100, evidenceRuns: 20, strategies: ['random', 'greedy-growth', 'greedy-money', 'merchant', 'lazy']});
    assert.ok((report.evidence?.distribution.effectiveSteps.minimum ?? 0) >= 5, JSON.stringify(report.evidence?.distribution));
    assert.ok(report.evidence?.endingReachability.every(row => row.status === 'observed'), JSON.stringify(report.evidence?.endingReachability));
    const revision = await s.command.execute({id: draft.id, version: 1}) as WorldRevision;
    assert.equal(revision.draftId, draft.id); assert.equal(s.worlds.listRevisions().length, 1);
    const store = new SqliteExtensionReviewStore(s.db); assert.equal(store.count(draft.id), 0);
    const rows = s.db.prepare('SELECT data FROM extension_review_evidence WHERE scope=?').all(draft.id) as {data: string}[];
    assert.equal(rows.length, 1); const evidence = JSON.parse(rows[0]!.data);
    assert.equal(evidence.passed, true); assert.ok(evidence.simulation.report); assert.ok(evidence.simulation.baseline);
    assert.equal(evidence.simulation.report.seeds, 2000); assert.equal(evidence.simulation.baseline.seeds, 2000);
    const expectedStrategies = defaultStrategies(draft.content).map(strategy => strategy.id);
    assert.equal(expectedStrategies.length, 6); // Include modao too; do not prune the default simulator.
    assert.deepEqual(evidence.simulation.report.strategies.map((strategy: {id: string}) => strategy.id), expectedStrategies);
    assert.deepEqual(evidence.simulation.baseline.strategies.map((strategy: {id: string}) => strategy.id), expectedStrategies);
    assert.deepEqual(await s.command.execute({id: draft.id, version: 1}), revision);
    const gate = new ExtensionPublishService(store);
    assert.throws(() => gate.assertAccepted({...draft, version: 2}), errorCode('EXTENSION_REVIEW_REQUIRED'));
    assert.throws(() => gate.assertAccepted({...draft, content: {...draft.content, title: 'same-version tamper'}}), errorCode('EXTENSION_REVIEW_REQUIRED'));
  } finally {s.close();}
});

test('durable rejection: each failed review counts once, survives new connections and version/id/code changes; third is terminal', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'extension-rejections-')); const file = path.join(dir, 'review.sqlite');
  let draft: WorldDraft | undefined;
  try {
    for (let round = 1; round <= 4; round++) {
      const db = openDatabase(file);
      try {
        const repository = new SqliteWorldRepository(db);
        const gate = new ExtensionPublishService(new SqliteExtensionReviewStore(db));
        const worlds = new WorldService(repository, {get: () => source}, undefined, {allowMockPublish: true, extensionPublishGate: gate, publishQualityGate() {}});
        if (!draft) {draft = worlds.create({sourceId: source.id, content: acceptedContent()}); draft.content.extensions![0]!.tests = [];
          db.prepare('UPDATE world_drafts SET data=? WHERE id=?').run(JSON.stringify(draft), draft.id);}
        else {draft = structuredClone(draft); draft.version++; draft.content.extensions![0]!.id = `renamed-${round}`; draft.content.extensions![0]!.version = `1.0.${round}`;
          db.prepare('UPDATE world_drafts SET version=?,data=? WHERE id=?').run(draft.version, JSON.stringify(draft), draft.id);}
        const before = worlds.get(draft.id);
        await assert.rejects(worlds.preparePublish(draft.id, {version: draft.version}), errorCode(round < 3 ? 'EXTENSION_REVIEW_FAILED' : 'EXTENSION_REVIEW_REJECTED'));
        assert.equal(new SqliteExtensionReviewStore(db).count(draft.id), Math.min(round, 3));
        assert.deepEqual(worlds.get(draft.id), before); assert.deepEqual(worlds.listRevisions(), []);
      } finally {db.close();}
    }
  } finally {rmSync(dir, {recursive: true, force: true});}
});

test('durable review lock: competing connection cannot execute work; storage errors and expired ownership fail closed', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'extension-lock-')); const file = path.join(dir, 'review.sqlite');
  const a = openDatabase(file); const b = openDatabase(file);
  try {
    const first = new SqliteExtensionReviewStore(a); const second = new SqliteExtensionReviewStore(b);
    let release!: () => void; const wait = new Promise<void>(r => {release = r;});
    const run = first.withReview('draft-lock', async counter => {await wait; return counter.increment();});
    await assert.rejects(second.withReview('draft-lock', async () => {assert.fail('competing work must never execute');}), errorCode('EXTENSION_REVIEW_BUSY'));
    release(); assert.equal(await run, 1); assert.equal(second.count('draft-lock'), 1);
    await assert.rejects(first.withReview('draft-lock', async counter => {
      b.prepare('UPDATE extension_review_scopes SET owner=? WHERE scope=?').run('different-owner', 'draft-lock'); return counter.increment();
    }), errorCode('EXTENSION_REVIEW_STORAGE'));
    assert.equal(second.count('draft-lock'), 1);
  } finally {a.close(); b.close(); rmSync(dir, {recursive: true, force: true});}
});

test('wired publish: two passing cases or no boundary rejects before any revision and records one round only', async () => {
  for (const kind of ['two-cases', 'no-boundary'] as const) {
    const s = setup('noop', true);
    try {
      const draft = s.worlds.create({sourceId: source.id, content: acceptedContent()});
      const extension = draft.content.extensions![0]!;
      if (kind === 'two-cases') extension.tests = extension.tests.slice(0, 2);
      else extension.tests = extension.tests.map(t => ({...t, input: {...t.input, state: {elapsed: 10}}}));
      s.persist(draft);
      await assert.rejects(s.command.execute({id: draft.id, version: 1}) as Promise<unknown>, errorCode('EXTENSION_REVIEW_FAILED'));
      assert.equal(new SqliteExtensionReviewStore(s.db).count(draft.id), 1); assert.deepEqual(s.worlds.listRevisions(), []);
    } finally {s.close();}
  }
});


test('async preparation rejects draft mutation during review, even without a version bump', async () => {
  const db = openDatabase(':memory:');
  try {
    const repository = new SqliteWorldRepository(db);
    const worlds = new WorldService(repository, {get: () => source}, undefined, {extensionPublishGate: {
      review: async draft => {const changed = {...draft, content: {...draft.content, title: 'changed during review'}};
        db.prepare('UPDATE world_drafts SET data=? WHERE id=?').run(JSON.stringify(changed), draft.id);}, assertAccepted() {},
    }});
    const draft = worlds.create({sourceId: source.id, content: acceptedContent()});
    await assert.rejects(worlds.preparePublish(draft.id, {version: 1}), errorCode('DRAFT_VERSION_CONFLICT'));
    assert.deepEqual(worlds.listRevisions(), []);
  } finally {db.close();}
});


test('durable lease: expired async owner cannot borrow a replacement review owner or release its lock', async () => {
  const db = openDatabase(':memory:');
  try {
    const store = new SqliteExtensionReviewStore(db);
    let releaseOld!: () => void; const oldWait = new Promise<void>(r => {releaseOld = r;});
    const oldRun = store.withReview('expired', async counter => {await oldWait; return counter.increment();});
    db.prepare('UPDATE extension_review_scopes SET lease_until=0 WHERE scope=?').run('expired');
    let releaseNew!: () => void; const newWait = new Promise<void>(r => {releaseNew = r;});
    const newRun = store.withReview('expired', async counter => {await newWait; return counter.increment();});
    releaseOld(); await assert.rejects(oldRun, errorCode('EXTENSION_REVIEW_STORAGE'));
    await assert.rejects(store.withReview('expired', async () => assert.fail('replacement lock must remain held')), errorCode('EXTENSION_REVIEW_BUSY'));
    releaseNew(); assert.equal(await newRun, 1); assert.equal(store.count('expired'), 1);
  } finally {db.close();}
});

test('durable count: corrupt fractional counts fail closed even before cached pass lookup', async () => {
  const db = openDatabase(':memory:');
  try {
    const store = new SqliteExtensionReviewStore(db);
    await store.withReview('corrupt', async counter => counter.increment());
    db.prepare('UPDATE extension_review_scopes SET rejections=0.5 WHERE scope=?').run('corrupt');
    assert.throws(() => store.count('corrupt'), errorCode('EXTENSION_REVIEW_STORAGE'));
    const candidate = {id: 'corrupt', version: 1, content: acceptedContent()} as WorldDraft;
    await assert.rejects(new ExtensionPublishService(store).review(candidate), errorCode('EXTENSION_REVIEW_STORAGE'));
  } finally {db.close();}
});
