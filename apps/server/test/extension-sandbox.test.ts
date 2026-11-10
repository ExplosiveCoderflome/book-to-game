import test from 'node:test';
import assert from 'node:assert/strict';
import { boundedFocusEffect, exampleSteadyCondition, checkExtensionDeclaration, extensionTests, matches, applyEffects, type AdventureState } from '@novel-game/play-runtime';
import { checkWorldExtensions } from '@novel-game/play-runtime/sim';
import { extensionDeclarationSchema, worldContentSchema, type WorldContent, type WorldRevision } from '@novel-game/contracts';
import { createExtensionReviewer, type ExtensionRejectionCounterPort } from '../src/modules/extensions/index.js';

const state = (): AdventureState => ({schemaVersion: 1, id: 'test', worldRevisionId: 'rev', turn: 0, elapsed: 0, locationId: 'home', facts: {}, knownFactIds: [], resources: {focus: 10}, takenTags: [], npcs: {}, performedActionIds: [], triggeredEventIds: [], history: [], createdAt: '', updatedAt: '', rng: {seed: 42, cursor: 0}});
const effect = (code: string, writes: typeof boundedFocusEffect.writes = boundedFocusEffect.writes) => ({...boundedFocusEffect, id: 'test-effect', writes, code,
  tests: boundedFocusEffect.tests.map((item, index) => ({...item, expected: index === 0 ? [{kind: 'resource', resourceId: 'focus', delta: -12}] : index === 1 ? [{kind: 'resource', resourceId: 'focus', delta: 0}] : [{kind: 'resource', resourceId: 'focus', delta: 6}]}))});

test('legacy static helper retains caller round hints; it is not the server-owned rejection gate', () => {
  assert.equal(checkExtensionDeclaration(exampleSteadyCondition).status, 'pass');
  assert.equal(checkExtensionDeclaration({...exampleSteadyCondition, tests: []}, 2).status, 'rewrite');
  assert.equal(checkExtensionDeclaration({...exampleSteadyCondition, tests: []}, 3).status, 'human');
  assert.match(checkExtensionDeclaration({...exampleSteadyCondition, code: '() => fetch("x")'}).issues[0]!.code, /api/);
});

test('example condition executes only after QuickJS wasm is ready and reads declared state only', async () => {
  await extensionTests(exampleSteadyCondition);
  const w = {extensions: [exampleSteadyCondition], resourceDefs: {money: {min: 0, max: 200}}} as never;
  const low = state(); low.resources.money = 10;
  assert.equal(matches([{kind: 'extension', extensionId: exampleSteadyCondition.id, params: {minimum: 5}}], low, w), true);
  const s = state(); s.resources.money = 12;
  assert.equal(matches([{kind: 'extension', extensionId: exampleSteadyCondition.id, params: {minimum: 11}}], s, w), true);
});

test('each bundled extension passes its three declared contract cases', async () => {
  assert.equal((await extensionTests(exampleSteadyCondition)).passed, 3);
  assert.equal((await extensionTests(boundedFocusEffect)).passed, 3);
});

test('bounded effect applies its declared delta and clamps to resource bounds', async () => {
  const s = state(); const w = {extensions: [boundedFocusEffect], resourceDefs: {focus: {label: 'Focus', min: 0, max: 20}}} as never;
  applyEffects([{kind: 'extension', extensionId: boundedFocusEffect.id, params: {delta: 12}}], s, w);
  assert.equal(s.resources.focus, 20);
});

test('an undeclared write discards the entire effect and records an error', async () => {
  const declaration = effect('() => [{kind:"resource",resourceId:"focus",delta:2},{kind:"resource",resourceId:"other",delta:1}]');
  const s = state(); const w = {extensions: [declaration]} as never;
  applyEffects([{kind: 'extension', extensionId: declaration.id, params: {delta: 2}}], s, w);
  assert.equal(s.resources.focus, 10);
  assert.equal(s.extensionAudit?.length, 1);
});

test('effect output outside declared delta range is rejected without mutation', async () => {
  const declaration = effect('() => [{kind:"resource",resourceId:"focus",delta:13}]');
  const s = state(); const w = {extensions: [declaration]} as never;
  applyEffects([{kind: 'extension', extensionId: declaration.id, params: {delta: 1}}], s, w);
  assert.equal(s.resources.focus, 10);
  assert.equal(s.extensionAudit?.[0]?.code, 'extension.invalid-result');
});

test('world extension gate runs multi-seed simulation and rejects a broken declaration', async () => {
  const result = await checkWorldExtensions({content: {extensions: [{...exampleSteadyCondition, code: '() => true'}]} as never} as never, 3, {seeds: 3, strategies: ['random']});
  assert.equal(result.status, 'human');
  assert.equal(result.passed, false);
});

const publicationWorld = (extensions = [boundedFocusEffect]): WorldContent => ({
  extensions, resourceDefs: {focus: {label: 'Focus', min: 0, max: 100}, money: {label: 'Money', min: 0, max: 200}}, facts: [{id: 'ready'}],
} as unknown as WorldContent);

test('publish policy requires actual world bounds, not parameter bounds, while legacy schema still reads', async () => {
  const legacy = {...boundedFocusEffect, tests: boundedFocusEffect.tests.map(t => ({...t, input: {...t.input, state: {'resource:focus': 50}},
    expected: [{kind: 'resource', resourceId: 'focus', delta: Number(t.input.params.delta) > 0 ? 8 : t.input.params.delta}]}))};
  assert.equal(extensionDeclarationSchema.safeParse(legacy).success, true);
  assert.equal((await extensionTests(legacy)).passed, 3);
  const result = await extensionTests(legacy, publicationWorld());
  assert.equal(result.passed, 3);
  assert.ok(result.issues.some(i => i.code === 'extension.test-boundary'));
  assert.deepEqual((await extensionTests(boundedFocusEffect, publicationWorld())).issues, []);
  assert.deepEqual((await extensionTests(exampleSteadyCondition, publicationWorld([exampleSteadyCondition]))).issues, []);
});

test('state boundary must belong to a declared, defined, in-range resource; no omitted-state shortcut', async () => {
  const states: Record<string, number>[] = [{'resource:focus': 101}, {'resource:focus': -1}, {}, {'resource:focus': 50}];
  for (const stateInput of states) {
    const d = {...boundedFocusEffect, code: '() => []', tests: boundedFocusEffect.tests.map(t => ({...t, input: {...t.input, state: stateInput}, expected: []}))};
    const world = publicationWorld([d]);
    if (stateInput['resource:focus'] === 50) delete world.resourceDefs;
    const result = await extensionTests(d, world);
    assert.equal(result.passed, 3); // Coverage failures still execute all cases.
    assert.ok(result.issues.some(i => i.code === 'extension.test-boundary'));
  }
  const d = {...boundedFocusEffect, tests: boundedFocusEffect.tests.map(t => ({...t, input: {...t.input, state: {'resource:other': 0}}}))};
  assert.ok((await extensionTests(d, publicationWorld())).issues.length);
});

test('effects need empty or truly state-preserving expected output, including fact writes', async () => {
  const d = {...boundedFocusEffect, code: '() => [{kind:"resource",resourceId:"focus",delta:1}]',
    tests: boundedFocusEffect.tests.map(t => ({...t, expected: [{kind: 'resource', resourceId: 'focus', delta: 1}]}))};
  assert.ok((await extensionTests(d, publicationWorld())).issues.some(i => i.code === 'extension.test-noop'));
  const empty = {...d, code: '() => []', tests: d.tests.map(t => ({...t, expected: []}))};
  assert.deepEqual((await extensionTests(empty, publicationWorld())).issues, []);
  const fact = {...empty, reads: ['resource:focus', 'fact:ready'], writes: [{state: 'fact:ready', minDelta: 0, maxDelta: 1}],
    code: '() => [{kind:"set",factId:"ready",value:true}]',
    tests: empty.tests.map(t => ({...t, input: {...t.input, state: {...t.input.state, 'fact:ready': true}},
      expected: [{kind: 'set', factId: 'ready', value: true}]}))};
  assert.deepEqual((await extensionTests(fact, publicationWorld())).issues, []);
  assert.ok((await extensionTests({...fact, tests: fact.tests.map(t => ({...t, input: {...t.input, state: {'resource:focus': 100}}}))}, publicationWorld()))
    .issues.some(i => i.code === 'extension.test-noop'));
});

test('all declared cases really execute after first failure, including more than three cases', async () => {
  const d = {...boundedFocusEffect, tests: [...boundedFocusEffect.tests, {...boundedFocusEffect.tests[0]!, expected: []}]};
  const result = await extensionTests(d, publicationWorld());
  assert.equal(result.passed, 3);
  assert.match(result.issues.find(i => i.code === 'extension.test')!.message, /test 4/);
  const first = {...d, tests: [{...d.tests[0]!, expected: []}, ...d.tests.slice(1)]};
  const next = await extensionTests(first, publicationWorld());
  assert.equal(next.passed, 2);
  assert.equal(next.issues.filter(i => i.code === 'extension.test').length, 2);
});

// Test double only: production must supply a durable multi-process lock/counter adapter.
function counterFixture() {
  let count = 0; let queue = Promise.resolve();
  const port: ExtensionRejectionCounterPort = {withReview<T>(_scope: string, work: Parameters<ExtensionRejectionCounterPort['withReview']>[1]): Promise<T> {
    const result = queue.then(() => work({read: async () => count, increment: async () => ++count}));
    queue = result.then(() => undefined, () => undefined);
    return result as Promise<T>;
  }};
  return {port, count: () => count};
}

test('one failed review is one rejection; third hardfails, caller rewriteRound and code/version changes cannot reset it', async () => {
  const fixture = counterFixture();
  const revision = {content: publicationWorld([{...boundedFocusEffect, code: '() => []'}])} as WorldRevision;
  for (let i = 1; i <= 4; i++) {
    const reviewer = createExtensionReviewer(fixture.port); // Recreate service against same durable port.
    const result = await reviewer.review('server-draft-1', revision, {seeds: 2, rewriteRound: 0} as never);
    assert.equal(result.status, i < 3 ? 'rewrite' : 'hardfail');
    assert.equal(result.rejections, Math.min(i, 3));
    assert.equal(result.simulation, undefined);
    revision.content.extensions![0]!.version = `1.0.${i}`;
  }
  assert.equal(fixture.count(), 3);
  const corrected = {content: publicationWorld()} as WorldRevision;
  assert.equal((await createExtensionReviewer(fixture.port).review('server-draft-1', corrected)).status, 'hardfail');
  assert.equal(fixture.count(), 3);
});

test('concurrent reviews share the server lock and never execute a fourth rejected review', async () => {
  const fixture = counterFixture(); const reviewer = createExtensionReviewer(fixture.port);
  const revision = {content: publicationWorld([{...boundedFocusEffect, tests: []}])} as WorldRevision;
  const results = await Promise.all(Array.from({length: 5}, () => reviewer.review('server-draft-1', revision)));
  assert.deepEqual(results.map(r => r.status), ['rewrite', 'rewrite', 'hardfail', 'hardfail', 'hardfail']);
  assert.equal(fixture.count(), 3);
});

test('only all-pass declarations reach the existing simulation; simulation failure counts once too', async () => {
  const fixture = counterFixture(); const reviewer = createExtensionReviewer(fixture.port);
  // Deliberately incomplete world: actual simulation must fail, after all contract tests pass.
  const result = await reviewer.review('server-draft-1', {content: publicationWorld()} as WorldRevision, {seeds: 2});
  assert.ok(result.simulation);
  assert.equal(result.status, 'rewrite');
  assert.equal(fixture.count(), 1);
  assert.ok(result.issues.some(i => i.code === 'extension.sim-crash'));
});

test('counter storage failures fail closed before simulation and do not become a pass', async () => {
  const port: ExtensionRejectionCounterPort = {withReview: async (_scope, work) => work({read: async () => {throw new Error('storage unavailable');}, increment: async () => 0})};
  await assert.rejects(createExtensionReviewer(port).review('server-draft-1', {content: publicationWorld()} as WorldRevision), /storage unavailable/);
});

test('all-pass review runs real extended/baseline simulation without resetting previous rejections or mutating revision', async () => {
  const fixture = counterFixture(); const reviewer = createExtensionReviewer(fixture.port);
  const content = worldContentSchema.parse({
    ...publicationWorld(), schemaVersion: 1, mode: 'open', title: 'Acceptance fixture', premise: 'Test', playerRole: 'Tester', goal: 'Finish',
    worldRules: ['Native engine rules'], adaptationNotes: '', sourceChapterIds: ['fixture'], initialLocationId: 'home', timeLimit: 3, timeoutEnding: 'Done',
    locations: ['home', 'road', 'end'].map(id => ({id, title: id, text: id, origin: 'adapted', evidence: []})),
    facts: [{id: 'ready', label: 'Ready', description: '', kind: 'event', initialValue: true, playerKnown: true, origin: 'adapted', evidence: []}],
    npcs: [], events: [], actions: ['a', 'b', 'c'].map(id => ({id, label: id, description: '', locationId: 'home', availableWhen: [], requires: [],
      blockedReason: 'Unavailable', risk: '', timeCost: 1, once: false, effects: [{kind: 'extension', extensionId: boundedFocusEffect.id, params: {delta: 0}}],
      text: 'Done', origin: 'adapted', evidence: []})),
    endings: [{id: 'done', title: 'Done', text: 'Done', when: [{kind: 'fact', factId: 'ready', value: true}]}],
  });
  const revision: WorldRevision = {id: 'rev', draftId: 'draft', sourceId: 'fixture', version: 1, createdAt: '', content};
  const bad = structuredClone(revision); bad.content.extensions![0]!.tests = [];
  assert.equal((await reviewer.review('server-draft-1', bad)).rejections, 1);
  const before = structuredClone(revision);
  const result = await reviewer.review('server-draft-1', revision, {seeds: 2, maxEndingRate: 1, strategies: ['random']});
  assert.equal(result.status, 'pass', JSON.stringify(result.issues));
  assert.equal(result.rejections, 1);
  assert.ok(result.simulation?.report);
  assert.ok(result.simulation?.baseline);
  assert.deepEqual(revision, before);
  assert.equal(fixture.count(), 1);
});
