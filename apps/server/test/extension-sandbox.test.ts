import test from 'node:test';
import assert from 'node:assert/strict';
import { boundedFocusEffect, exampleSteadyCondition, checkExtensionDeclaration, extensionTests, matches, applyEffects, type AdventureState } from '@novel-game/play-runtime';
import { checkWorldExtensions } from '@novel-game/play-runtime/sim';

const state = (): AdventureState => ({schemaVersion: 1, id: 'test', worldRevisionId: 'rev', turn: 0, elapsed: 0, locationId: 'home', facts: {}, knownFactIds: [], resources: {focus: 10}, takenTags: [], npcs: {}, performedActionIds: [], triggeredEventIds: [], history: [], createdAt: '', updatedAt: '', rng: {seed: 42, cursor: 0}});
const effect = (code: string, writes: typeof boundedFocusEffect.writes = boundedFocusEffect.writes) => ({...boundedFocusEffect, id: 'test-effect', writes, code,
  tests: boundedFocusEffect.tests.map((item, index) => ({...item, expected: index === 0 ? [{kind: 'resource', resourceId: 'focus', delta: -12}] : index === 1 ? [{kind: 'resource', resourceId: 'focus', delta: 0}] : [{kind: 'resource', resourceId: 'focus', delta: 6}]}))});

test('static contract checks declaration and routes failed rewrites to human after three rounds', () => {
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
