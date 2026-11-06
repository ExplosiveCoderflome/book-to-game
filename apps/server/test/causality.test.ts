import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {worldContentSchema, type WorldContent} from '@novel-game/contracts';
import {advanceAdventure, createAdventureState, projectAdventure} from '@novel-game/play-runtime';
import {worldCommands} from '../src/app/commands/worlds.js';
import {checkWorldCausality} from '../src/modules/worlds/index.js';

function fixture(): WorldContent {
  return worldContentSchema.parse(JSON.parse(readFileSync(new URL('../../../fixtures/s1/route-coverage.engine.json', import.meta.url), 'utf8')));
}
const check = (content: WorldContent, maxStates = 1000) => checkWorldCausality({get: () => ({id: 'world', sourceId: 'source', version: 3,
  updatedAt: '2026-11-06T00:00:00.000Z', content})} as never, {worldId: 'world', expectedVersion: 3, maxStates});

test('causality flags a resource counter that no condition or threshold reads', () => {
  const world = fixture();
  world.resourceDefs = {...world.resourceDefs, trinkets: {label: 'Trinkets', min: 0, max: 20, initial: 0}};
  world.causalClaims = {keyResourceIds: ['trinkets'], keyChoiceIds: [], commitments: []};
  world.actions = [{...world.actions[0]!, id: 'collect', effects: [{kind: 'resource', resourceId: 'trinkets', delta: 1}]}];
  const report = check(world);
  assert.equal(report.status, 'fail');
  assert.ok(report.findings.some(item => item.code === 'causality.resource-unread'));
});

test('causality accepts a real resource route and identifies an unconditional all-ending menu', async () => {
  const meaningful = fixture();
  meaningful.resourceDefs = {...meaningful.resourceDefs, cargo: {label: 'Cargo', min: 0, max: 2, initial: 0}};
  meaningful.causalClaims = {keyResourceIds: ['cargo'], keyChoiceIds: [], commitments: []};
  meaningful.actions = [
    {...meaningful.actions[0]!, id: 'gather', once: true, effects: [{kind: 'resource', resourceId: 'cargo', delta: 1}]},
    {...meaningful.actions[0]!, id: 'spend-cargo', once: true, requires: [{kind: 'resource', resourceId: 'cargo', atLeast: 1}], effects: [{kind: 'resource', resourceId: 'cargo', delta: -1}]},
    {...meaningful.actions[0]!, id: 'keep-cargo', once: true, requires: [{kind: 'resource', resourceId: 'cargo', atLeast: 1}], effects: [{kind: 'resource', resourceId: 'cargo', delta: 0}]},
     {...meaningful.actions[0]!, id: 'cargo-gated', once: true, requires: [{kind: 'resource', resourceId: 'cargo', atLeast: 1}], effects: [{kind: 'move', locationId: meaningful.locations.find(location => location.id !== meaningful.initialLocationId)!.id}]},
  ];
  meaningful.actions.forEach(action => { action.locationId = meaningful.initialLocationId; });
  meaningful.actions[1]!.requires = [{kind: 'resource', resourceId: 'cargo', atLeast: 1}];
  meaningful.actions[2]!.requires = [{kind: 'resource', resourceId: 'cargo', atLeast: 1}];
  meaningful.actions[3]!.requires = [{kind: 'resource', resourceId: 'cargo', atLeast: 1}];
  const accepted = check(meaningful);
  assert.ok(!accepted.findings.some(item => item.code === 'causality.resource-no-witness'), JSON.stringify(accepted.findings));
  const witness = accepted.findings.find(item => item.code === 'causality.resource-witness')?.witness;
  assert.ok(witness?.actionIds.includes('spend-cargo'));
  assert.ok(witness?.alternateActionIds?.includes('keep-cargo'));
  const finalStates = [];
  for (const actionIds of [witness!.actionIds, witness!.alternateActionIds!]) {
    let state = createAdventureState({id: 'draft-world', draftId: 'world', sourceId: 'source', version: 3,
      content: meaningful, createdAt: '2026-11-06T00:00:00.000Z'}, `verify-${actionIds.at(-1)}`, '2026-11-06T00:00:00.000Z', {}, witness!.seed);
    for (const actionId of actionIds) state = advanceAdventure({...state, history: []},
      {actionId, expectedTurn: state.turn, requestId: '00000000-0000-4000-8000-000000000002'}, meaningful, '2026-11-06T00:00:00.000Z');
    finalStates.push(state);
  }
  assert.notEqual(finalStates[0]!.resources.cargo, finalStates[1]!.resources.cargo);
  assert.notDeepEqual(projectAdventure(finalStates[0]!, {id: 'draft-world', draftId: 'world', sourceId: 'source', version: 3, content: meaningful, createdAt: '2026-11-06T00:00:00.000Z'}).actions.filter(action => action.enabled).map(action => action.id),
    projectAdventure(finalStates[1]!, {id: 'draft-world', draftId: 'world', sourceId: 'source', version: 3, content: meaningful, createdAt: '2026-11-06T00:00:00.000Z'}).actions.filter(action => action.enabled).map(action => action.id));
  const targetStates = [];
  for (const actionIds of [witness!.actionIds, witness!.alternateActionIds!]) {
    let state = createAdventureState({id: 'draft-world', draftId: 'world', sourceId: 'source', version: 3,
      content: meaningful, createdAt: '2026-11-06T00:00:00.000Z'}, `target-${actionIds.at(-1)}`, '2026-11-06T00:00:00.000Z', {}, witness!.seed);
    for (const actionId of actionIds) state = advanceAdventure({...state, history: []},
      {actionId, expectedTurn: state.turn, requestId: '00000000-0000-4000-8000-000000000002'}, meaningful, '2026-11-06T00:00:00.000Z');
    targetStates.push(projectAdventure(state, {id: 'draft-world', draftId: 'world', sourceId: 'source', version: 3,
      content: meaningful, createdAt: '2026-11-06T00:00:00.000Z'}).actions.find(action => action.id === 'cargo-gated')!.enabled);
  }
  assert.deepEqual(targetStates, finalStates[0]!.resources.cargo > finalStates[1]!.resources.cargo ? [true, false] : [false, true]);
  assert.ok(accepted.exploredStates > 0);
  assert.equal(accepted.status, 'pass');

  const menu = fixture();
  menu.endings = [{id: 'a', title: 'A', text: 'A', when: [], kind: 'ending'}, {id: 'b', title: 'B', text: 'B', when: [], kind: 'ending'}];
  menu.actions = menu.endings.map(ending => ({...menu.actions[0]!, id: `choose-${ending.id}`, requires: [], effects: [{kind: 'ending' as const, endingId: ending.id}]}));
  const rejected = check(menu);
  assert.ok(rejected.findings.some(item => item.code === 'causality.ending-menu'));
});

test('directly different endings and an irrelevant resource read cannot form a resource witness', () => {
  const world = fixture();
  world.resourceDefs = {...world.resourceDefs, token: {label: 'Token', min: 0, max: 2, initial: 0}};
  world.causalClaims = {keyResourceIds: ['token'], keyChoiceIds: [], commitments: []};
  world.actions = [
    {...world.actions[0]!, id: 'take-token', once: true, effects: [{kind: 'resource', resourceId: 'token', delta: 1}]},
    {...world.actions[0]!, id: 'leave-token', once: true, effects: [{kind: 'resource', resourceId: 'token', delta: 0}]},
    {...world.actions[0]!, id: 'end-a', effects: [{kind: 'ending', endingId: world.endings[0]!.id}]},
    {...world.actions[0]!, id: 'end-b', effects: [{kind: 'ending', endingId: world.endings[0]!.id}]},
    {...world.actions[0]!, id: 'irrelevant-gate', requires: [{kind: 'resource', resourceId: 'token', atLeast: 1}], effects: [{kind: 'set', factId: world.facts[0]!.id, value: true}]},
  ];
  world.actions.forEach(action => { action.locationId = world.initialLocationId; });
  const report = check(world);
  assert.equal(report.status, 'fail');
  assert.ok(report.findings.some(item => item.code === 'causality.resource-no-witness'));
});

test('a rule reading a resource without an observed consequences path does not pass; alternate valid branch is returned', () => {
  const world = fixture();
  world.resourceDefs = {...world.resourceDefs, stock: {label: 'Stock', min: 0, max: 4, initial: 0}};
  world.causalClaims = {keyResourceIds: ['stock'], keyChoiceIds: [], commitments: []};
  world.actions = [
    {...world.actions[0]!, id: 'raise', effects: [{kind: 'resource', resourceId: 'stock', delta: 1}]},
    {...world.actions[0]!, id: 'read-only-dead-end', requires: [{kind: 'resource', resourceId: 'stock', atLeast: 1}], effects: [{kind: 'move', locationId: world.initialLocationId}]},
    {...world.actions[0]!, id: 'finish', effects: [{kind: 'ending', endingId: world.endings[0]!.id}]},
  ];
  world.actions[0]!.once = true;
  world.actions[1]!.locationId = world.initialLocationId;
  world.actions[2]!.requires = [{kind: 'resource', resourceId: 'stock', atLeast: 1}];
  world.actions[2]!.effects = [{kind: 'ending', endingId: world.endings[0]!.id}];
  world.actions.forEach(action => { action.locationId = world.initialLocationId; });
  world.actions[1]!.effects = [{kind: 'move', locationId: world.initialLocationId}];
  world.actions = world.actions.filter(action => action.id !== 'finish');
  const report = check(world);
  assert.ok(report.findings.some(item => item.code === 'causality.resource-no-witness'));
});

test('resource branch once differences without a resource-gated target do not pass', () => {
  const world = fixture();
  world.resourceDefs = {...world.resourceDefs, token: {label: 'Token', min: 0, max: 2, initial: 0}};
  world.causalClaims = {keyResourceIds: ['token'], keyChoiceIds: [], commitments: []};
  world.actions = [
    {...world.actions[0]!, id: 'take', once: true, effects: [{kind: 'resource', resourceId: 'token', delta: 1}]},
    {...world.actions[0]!, id: 'skip', once: true, effects: [{kind: 'resource', resourceId: 'token', delta: 0}]},
    {...world.actions[0]!, id: 'once-a', once: true, effects: [{kind: 'set', factId: world.facts[0]!.id, value: true}]},
    {...world.actions[0]!, id: 'once-b', once: true, effects: [{kind: 'set', factId: world.facts[0]!.id, value: false}]},
    {...world.actions[0]!, id: 'finish', effects: [{kind: 'ending', endingId: world.endings[0]!.id}]},
  ];
  world.actions[0]!.requires = [];
  world.actions[1]!.requires = [];
  world.actions[2]!.requires = [{kind: 'resource', resourceId: 'token', atLeast: 1}];
  world.actions[3]!.requires = [{kind: 'resource', resourceId: 'token', atMost: 0}];
  world.actions.forEach(action => { action.locationId = world.initialLocationId; });
  assert.ok(check(world).findings.some(item => item.code === 'causality.resource-no-witness'));
});

test('a resource-gated no-op target does not establish a witness', () => {
  const world = fixture();
  world.resourceDefs = {...world.resourceDefs, token: {label: 'Token', min: 0, max: 2, initial: 0}};
  world.causalClaims = {keyResourceIds: ['token'], keyChoiceIds: [], commitments: []};
  world.actions = [
    {...world.actions[0]!, id: 'take', once: true, effects: [{kind: 'resource', resourceId: 'token', delta: 1}]},
    {...world.actions[0]!, id: 'skip', once: true, effects: [{kind: 'resource', resourceId: 'token', delta: 0}]},
    {...world.actions[0]!, id: 'gated-noop', requires: [{kind: 'resource', resourceId: 'token', atLeast: 1}], effects: [{kind: 'set', factId: world.facts[0]!.id, value: true}]},
  ];
  world.actions.forEach(action => { action.locationId = world.initialLocationId; });
  assert.ok(check(world).findings.some(item => item.code === 'causality.resource-no-witness'));
});

test('declared commitment with no later consequence fails and explicit decorative resources remain allowed', () => {
  const world = fixture();
  world.facts = [...world.facts, {id: 'promise', label: 'Promise', description: '', kind: 'relationship', initialValue: false,
    playerKnown: false, origin: 'adapted', evidence: []}];
  world.ledgerVersion = 1;
  world.actions = [{...world.actions[0]!, id: 'promise-now', once: true,
    effects: [{kind: 'ledger', operation: 'commit', factId: 'promise'}]}, {...world.actions[0]!, id: 'later', once: true,
    effects: [{kind: 'ending', endingId: world.endings[0]!.id}]}];
  world.causalClaims = {keyResourceIds: [], keyChoiceIds: [], commitments: [{id: 'promise-claim', actionId: 'promise-now', factId: 'promise'}]};
  const report = check(world);
  assert.ok(report.findings.some(item => item.code === 'causality.commitment-unsupported'));

  world.causalClaims = {keyResourceIds: [], keyChoiceIds: [], commitments: []};
  world.resourceDefs = {...world.resourceDefs, decorative: {label: 'Decorative', min: 0, max: 9, initial: 0}};
  world.actions[0] = {...world.actions[0]!, effects: [{kind: 'resource', resourceId: 'decorative', delta: 1}]};
  assert.equal(check(world).findings.some(item => item.code === 'causality.resource-unread'), false);
});

test('second non-Jupiter mystery fixture supplies a legitimate clue-dependent route', () => {
  const world = fixture();
  const clue = world.facts[0]!;
  world.causalClaims = {keyResourceIds: [], keyChoiceIds: [], commitments: []};
  world.actions = [
    {...world.actions[0]!, id: 'inspect', effects: [{kind: 'set', factId: clue.id, value: true}, {kind: 'reveal', factId: clue.id}]},
    {...world.actions[0]!, id: 'confront', requires: [{kind: 'fact', factId: clue.id, value: true}], effects: [{kind: 'ending', endingId: world.endings[0]!.id}]},
    {...world.actions[0]!, id: 'leave', effects: [{kind: 'move', locationId: world.initialLocationId}]},
  ];
  const report = check(world);
  assert.ok(report.exploredStates > 0);
  assert.equal(report.findings.some(item => item.code === 'causality.unknown-choice'), false);
});

test('causality budget exhaustion is inconclusive and report identity binds hash and budget', () => {
  const world = fixture();
  const limited = check(world, 100);
  assert.equal(limited.status, 'inconclusive');
  const replayed = check(world, 100);
  assert.equal(replayed.contentHash, limited.contentHash);
  assert.equal(replayed.reportId, limited.reportId);
  assert.ok(limited.findings.some(item => item.code === 'causality.search-budget-exhausted'));
});

test('world version mismatch fails closed', () => {
  assert.throws(() => checkWorldCausality({get: () => ({id: 'world', version: 2})} as never,
    {worldId: 'world', expectedVersion: 3, maxStates: 1000}), error => (error as {code?: string}).code === 'DRAFT_VERSION_CONFLICT');
});

test('causality command is registered as an automatic read-only tool', () => {
  const command = worldCommands({} as never).find(item => item.name === 'check_world_causality');
  assert.ok(command);
  assert.equal(command.readOnly, true);
  assert.deepEqual(command.inputSchema.parse({worldId: 'w', expectedVersion: 1}), {worldId: 'w', expectedVersion: 1, maxStates: 1000});
  assert.throws(() => command.inputSchema.parse({worldId: 'w', expectedVersion: 1, maxStates: 99}));
  assert.throws(() => command.inputSchema.parse({worldId: 'w', expectedVersion: 1, witnessReportId: '00000000-0000-4000-8000-000000000000'}));
});
