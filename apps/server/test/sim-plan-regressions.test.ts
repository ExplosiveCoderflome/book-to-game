import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { worldContentSchema, type WorldContent, type WorldEffect, type WorldRevision } from '@novel-game/contracts';
import { advanceAdventure, createAdventureState } from '@novel-game/play-runtime';
import { checkPlanWorld, estimateMinSteps } from '@novel-game/play-runtime/sim';

const NOW = '2026-10-29T00:00:00Z';
const ROUTES = [{id: 'win', name: 'Complete the task', endingIds: ['win']}];

function world(): WorldContent {
  const input = worldContentSchema.parse(JSON.parse(readFileSync(new URL('../../../fixtures/s1/route-coverage.engine.json', import.meta.url), 'utf8')));
  const action = input.actions[0]!;
  return worldContentSchema.parse({...input, timeLimit: 100, clock: undefined, worldbook: undefined, map: undefined,
    facts: [], npcs: [], events: [], storylets: [], resources: {money: 0},
    resourceDefs: {money: {min: 0, max: 5, initial: 0, label: 'Money'}},
    endings: [{id: 'win', title: 'Task complete', text: 'The task is complete.', when: [], kind: 'ending'}],
    actions: ['finish', 'work', 'upgrade'].map(id => ({...action, id, label: id, locationId: input.initialLocationId,
      availableWhen: [], requires: [], timeCost: 1, once: false, text: 'Test action.',
      effects: [{kind: 'resource', resourceId: 'money', delta: 0}]})),
  });
}

function playToEnd(content: WorldContent, actions: string[]) {
  const revision: WorldRevision = {id: 'regression', draftId: 'd', sourceId: 's', version: 1, createdAt: NOW, content};
  let state = createAdventureState(revision, 'regression', NOW, {}, 1);
  for (const actionId of actions) state = advanceAdventure(state,
    {actionId, expectedTurn: state.turn, requestId: crypto.randomUUID()}, content, NOW);
  return state;
}

test('route guidance terminates with unique schema-valid IDs when long action names collide with existing guide cards', () => {
  const worlds = [64, 80].map(length => {
    const input = world();
    const actionId = 'a'.repeat(length);
    input.actions[0] = {...input.actions[0]!, id: actionId, effects: [{kind: 'ending', endingId: 'win'}]};
    input.storylets = [`guide_${'a'.repeat(64)}`, `guide_${'a'.repeat(62)}_2`].map(id => ({id, title: 'Existing guide',
      kind: 'trigger', text: 'An existing card.', choices: [{id: 'leave', label: 'Leave', timeCost: 1, text: 'Leave.', effects: []}]}));
    return worldContentSchema.parse(input);
  });
  // A bounded subprocess makes the original infinite loop fail the test instead of hanging the entire suite.
  const script = `
    import {readFileSync} from 'node:fs';
    import {worldContentSchema} from '@novel-game/contracts';
    import {candidateEdits, applyGuidance} from '@novel-game/play-runtime/sim';
    const results = JSON.parse(readFileSync(0, 'utf8')).map(input => {
      const world = worldContentSchema.parse(input);
      const original = JSON.stringify(world);
      const edits = candidateEdits(world, 'win').edits;
      const patched = worldContentSchema.parse(applyGuidance(world, edits));
      const ids = patched.storylets.map(card => card.id);
      return {ids, added: ids.filter(id => !world.storylets.some(card => card.id === id)), unchanged: JSON.stringify(world) === original};
    });
    process.stdout.write(JSON.stringify(results));
  `;
  const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], {
    cwd: fileURLToPath(new URL('../../../', import.meta.url)), input: JSON.stringify(worlds),
    encoding: 'utf8', timeout: 5000, windowsHide: true,
  });
  assert.ifError(child.error);
  assert.equal(child.status, 0, child.stderr);
  const results = JSON.parse(child.stdout) as {ids: string[]; added: string[]; unchanged: boolean}[];
  assert.equal(results.length, 2);
  for (const result of results) {
    assert.equal(result.unchanged, true);
    assert.equal(result.added.length, 1);
    assert.equal(new Set(result.ids).size, result.ids.length);
    assert.ok(result.ids.every(id => /^[a-zA-Z0-9_-]{1,80}$/.test(id)));
  }
});

for (const initialValue of [true, false]) test(`plan checks and pacing accept initially known facts whose value is ${initialValue}`, () => {
  const content = world();
  content.facts = [{id: 'clue', label: 'Opening clue', description: '', kind: 'clue', initialValue, playerKnown: true, origin: 'adapted', evidence: []}];
  content.actions[0]!.requires = [{kind: 'known', factId: 'clue'}];
  content.actions[0]!.effects = [{kind: 'ending', endingId: 'win'}];
  assert.equal(playToEnd(content, ['finish']).ending?.id, 'win');
  const report = checkPlanWorld(content, ROUTES, {probeSeeds: 2});
  assert.equal(report.blocking, false, JSON.stringify(report.issues));
  assert.equal(report.routes[0]!.hitRate, 1);
  assert.equal(estimateMinSteps(content).win, 1);
});

test('plan checks still reject knowledge that is neither initially available nor revealable', () => {
  const content = world();
  content.facts = [{id: 'clue', label: 'Hidden clue', description: '', kind: 'clue', initialValue: true, playerKnown: false, origin: 'adapted', evidence: []}];
  content.actions[0]!.requires = [{kind: 'known', factId: 'clue'}];
  content.actions[0]!.effects = [{kind: 'ending', endingId: 'win'}];
  assert.throws(() => playToEnd(content, ['finish']), (error: Error & {code?: string}) => error.code === 'ACTION_BLOCKED');
  const report = checkPlanWorld(content, ROUTES, {probe: false});
  assert.equal(report.blocking, true);
  assert.ok(report.issues.some(issue => issue.severity === 'error' && issue.ruleId === 'plan.fact-unsettable'));
});

for (const scenario of [
  {name: 'a one-time absolute cap upgrade', effect: {kind: 'resource_max', resourceId: 'money', set: 20}, once: true, upgrades: 1, target: 10},
  {name: 'a one-time additive cap upgrade', effect: {kind: 'resource_max', resourceId: 'money', delta: 5}, once: true, upgrades: 1, target: 10},
  {name: 'repeated additive cap upgrades', effect: {kind: 'resource_max', resourceId: 'money', delta: 2}, once: false, upgrades: 3, target: 11},
]) test(`plan checks allow a resource gate reachable after ${scenario.name}`, () => {
  const content = world();
  content.actions[0]!.requires = [{kind: 'resource', resourceId: 'money', atLeast: scenario.target}];
  content.actions[0]!.effects = [{kind: 'ending', endingId: 'win'}];
  content.actions[1]!.effects = [{kind: 'resource', resourceId: 'money', delta: 1}];
  content.actions[2]!.effects = [scenario.effect as WorldEffect];
  content.actions[2]!.once = scenario.once;
  const parsed = worldContentSchema.parse(content);
  const actions = [...Array<string>(scenario.upgrades).fill('upgrade'), ...Array<string>(scenario.target).fill('work'), 'finish'];
  assert.equal(playToEnd(parsed, actions).ending?.id, 'win');
  const report = checkPlanWorld(parsed, ROUTES, {probe: false});
  assert.equal(report.blocking, false, JSON.stringify(report.issues));
});

for (const scenario of [
  {name: 'a fixed cap', effects: [{kind: 'resource', resourceId: 'money', delta: 0}], target: 6},
  {name: 'a smaller absolute upgrade', effects: [{kind: 'resource_max', resourceId: 'money', set: 9}], target: 10},
  {name: 'a one-time additive upgrade', effects: [{kind: 'resource_max', resourceId: 'money', delta: 5}], target: 11},
  {name: 'a decreasing cap', effects: [{kind: 'resource_max', resourceId: 'money', delta: -1}], target: 6},
]) test(`plan checks retain hard errors for a gate beyond ${scenario.name}`, () => {
  const content = world();
  content.actions[0]!.requires = [{kind: 'resource', resourceId: 'money', atLeast: scenario.target}];
  content.actions[0]!.effects = [{kind: 'ending', endingId: 'win'}];
  content.actions[1]!.effects = [{kind: 'resource', resourceId: 'money', delta: 1}];
  content.actions[2]!.effects = scenario.effects as WorldEffect[];
  content.actions[2]!.once = true;
  const report = checkPlanWorld(worldContentSchema.parse(content), ROUTES, {probe: false});
  assert.equal(report.blocking, true);
  assert.ok(report.issues.some(issue => issue.severity === 'error' && issue.ruleId === 'plan.threshold-open'));
});

test('cap upgrades do not make a resource reachable without any income source', () => {
  const content = world();
  content.actions[0]!.requires = [{kind: 'resource', resourceId: 'money', atLeast: 10}];
  content.actions[0]!.effects = [{kind: 'ending', endingId: 'win'}];
  content.actions[2]!.effects = [{kind: 'resource_max', resourceId: 'money', set: 20}];
  const report = checkPlanWorld(content, ROUTES, {probe: false});
  assert.equal(report.blocking, true);
  assert.ok(report.issues.some(issue => issue.severity === 'error' && issue.ruleId === 'plan.threshold-open'));
});

test('cap upgrades in roll branches remain reachable', () => {
  const content = world();
  content.actions[0]!.requires = [{kind: 'resource', resourceId: 'money', atLeast: 10}];
  content.actions[0]!.effects = [{kind: 'ending', endingId: 'win'}];
  content.actions[1]!.effects = [{kind: 'resource', resourceId: 'money', delta: 1}];
  content.actions[2]!.effects = [{kind: 'roll', chance: {base: 1},
    success: [{kind: 'resource_max', resourceId: 'money', set: 20}], failure: []}];
  content.actions[2]!.once = true;
  const parsed = worldContentSchema.parse(content);
  assert.equal(playToEnd(parsed, ['upgrade', ...Array<string>(10).fill('work'), 'finish']).ending?.id, 'win');
  assert.equal(checkPlanWorld(parsed, ROUTES, {probe: false}).blocking, false);
});

test('clock-based cap growth is counted only for the available clock periods', () => {
  const content = world();
  content.clock = {unit: 'month', startYear: 1, startMonth: 1, limitMonths: 20,
    rules: [{everyMonths: 1, effects: [{kind: 'resource_max', resourceId: 'money', delta: 1}]}]};
  content.actions[0]!.requires = [{kind: 'resource', resourceId: 'money', atLeast: 10}];
  content.actions[0]!.effects = [{kind: 'ending', endingId: 'win'}];
  content.actions[1]!.effects = [{kind: 'resource', resourceId: 'money', delta: 1}];
  const parsed = worldContentSchema.parse(content);
  assert.equal(playToEnd(parsed, [...Array<string>(10).fill('work'), 'finish']).ending?.id, 'win');
  assert.equal(checkPlanWorld(parsed, ROUTES, {probe: false}).blocking, false);
  parsed.actions[0]!.requires = [{kind: 'resource', resourceId: 'money', atLeast: 26}];
  assert.equal(checkPlanWorld(parsed, ROUTES, {probe: false}).blocking, true, 'initial max 5 + at most 20 clock increases cannot reach 26');
});

test('limited repeat cards do not supply unlimited cap growth', () => {
  for (const maxTimes of [2, 3]) {
    const content = world();
    content.actions[0]!.requires = [{kind: 'resource', resourceId: 'money', atLeast: 10}];
    content.actions[0]!.effects = [{kind: 'ending', endingId: 'win'}];
    content.actions[1]!.effects = [{kind: 'resource', resourceId: 'money', delta: 1}];
    content.storylets = [{id: 'cap', title: 'Training', text: 'Improve the capacity.', repeat: {cooldownTurns: 0, maxTimes},
      choices: [{id: 'train', label: 'Train', text: 'Capacity improved.', timeCost: 1,
        effects: [{kind: 'resource_max', resourceId: 'money', delta: 2}]}]}];
    const parsed = worldContentSchema.parse(content);
    const preparation = Array.from({length: maxTimes}, () => ['sl__cap__train', 'work']).flat();
    if (maxTimes === 3) assert.equal(playToEnd(parsed, [...preparation, ...Array<string>(10).fill('work'), 'finish']).ending?.id, 'win');
    const report = checkPlanWorld(parsed, ROUTES, {probe: false});
    assert.equal(report.blocking, maxTimes === 2, 'two +2 upgrades cap at 9; three cap at 11');
  }
});
