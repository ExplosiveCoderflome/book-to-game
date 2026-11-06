import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BLOCKS, checkWorldLedgerInputSchema, worldContentSchema, type WorldContent } from '@novel-game/contracts';
import { checkLedgerAssertion, validateS1References } from '@novel-game/rules';
import { createAdventureState, advanceAdventure } from '@novel-game/play-runtime';
import { checkWorldLedger } from '../src/modules/worlds/index.js';
import { createCommands } from '../src/app/commands/index.js';

function world(kind: 'commerce' | 'mystery'): WorldContent {
  const item = kind === 'commerce' ? 'stock' : 'clue';
  return worldContentSchema.parse({schemaVersion: 1, mode: 'open', title: kind, premise: 'p', playerRole: 'r', goal: 'g', ledgerVersion: 1,
    worldRules: ['rule'], adaptationNotes: '', sourceChapterIds: ['chapter'], initialLocationId: 'start', timeLimit: 10, timeoutEnding: 'time',
    locations: ['start', 'store', 'end'].map(id => ({id, title: id, text: id, origin: 'adapted', evidence: []})),
    facts: [{id: item, label: item, description: '', kind: 'item', initialValue: false, playerKnown: false, origin: 'adapted', evidence: []},
      {id: 'done', label: 'done', description: '', kind: 'event', initialValue: false, playerKnown: false, origin: 'adapted', evidence: []}],
    npcs: [], resources: {coin: 2}, actions: [
      {id: 'acquire', label: 'acquire', description: '', locationId: 'start', availableWhen: [], requires: [], blockedReason: 'blocked', risk: '', timeCost: 1, once: true, origin: 'adapted', evidence: [],
        effects: [{kind: 'set', factId: item, value: true}, {kind: 'reveal', factId: item}, {kind: 'ledger', factId: item, operation: 'acquire'}], text: 'acquired',
        ledgerAssertions: [{id: 'claim-have', factId: item, claim: 'holds'}]},
      {id: 'consume', label: 'consume', description: '', locationId: 'start', availableWhen: [], requires: [{kind: 'known', factId: item}, {kind: 'fact', factId: item, value: true}], blockedReason: 'blocked', risk: '', timeCost: 1, once: true, origin: 'adapted', evidence: [],
        effects: [{kind: 'set', factId: item, value: false}, {kind: 'ledger', factId: item, operation: 'consume'}, {kind: 'set', factId: 'done', value: true}, {kind: 'move', locationId: 'end'}], text: 'consume',
        ledgerAssertions: [{id: 'claim-consumed', factId: item, claim: 'consumed'}]},
      {id: 'upload', label: 'upload', description: '', locationId: 'store', availableWhen: [], requires: [{kind: 'known', factId: item}, {kind: 'fact', factId: item, value: true}], blockedReason: 'blocked', risk: '', timeCost: 1, once: true, origin: 'adapted', evidence: [],
        effects: [{kind: 'move', locationId: 'end'}], text: 'upload', ledgerAssertions: [{id: 'claim-uploaded', factId: item, claim: 'holds'}]},
    ], events: [], endings: [{id: 'ending', title: 'end', text: 'end', when: [{kind: 'fact', factId: 'done', value: true}]}]});
}

test('ledger contract composes in two genres and flags invalid fact references', () => {
  assert.ok(BLOCKS.some(block => block.id === 'fact-evidence-ledger' && block.provides.includes('ledger-assertions')));
  for (const genre of ['commerce', 'mystery'] as const) assert.equal(validateS1References(world(genre)).some(issue => issue.ruleId.startsWith('ledger.')), false);
  const invalid = structuredClone(world('mystery'));
  invalid.actions[0]!.ledgerAssertions = [{id: 'bad', factId: 'missing', claim: 'holds'}];
  assert.ok(validateS1References(invalid).some(issue => issue.ruleId === 'ledger.unknown-fact'));
});

test('ledger assertions follow runtime actions and reject unheld claims', () => {
  const content = world('mystery');
  const revision = {id: 'revision', draftId: 'draft', sourceId: 'source', version: 1, content, createdAt: '2026-01-01'};
  const state = createAdventureState(revision, 'save', '2026-01-01');
  const notHeld = checkLedgerAssertion(content, state, content.actions[0]!.ledgerAssertions![0]!, 'action.acquire');
  assert.equal(notHeld?.code, 'ledger.assertion.holds');
  const acquired = advanceAdventure(state, {actionId: 'acquire', expectedTurn: 0, requestId: '00000000-0000-4000-8000-000000000001'}, content, '2026-01-01');
  assert.equal(checkLedgerAssertion(content, acquired, content.actions[0]!.ledgerAssertions![0]!, 'action.acquire'), undefined);
  const trace: {kind: string; id: string; state: typeof acquired}[] = [];
  const witnessedAcquire = advanceAdventure(state, {actionId: 'acquire', expectedTurn: 0, requestId: '00000000-0000-4000-8000-000000000003'}, content, '2026-01-01', {observer: item => trace.push(item)});
  assert.equal(checkLedgerAssertion(content, trace[0]!.state, content.actions[0]!.ledgerAssertions![0]!, 'action.acquire'), undefined);
  assert.equal(witnessedAcquire.ledger?.sources[0]?.sourceId, 'acquire');
  const consumed = advanceAdventure(acquired, {actionId: 'consume', expectedTurn: 1, requestId: '00000000-0000-4000-8000-000000000002'}, content, '2026-01-01');
  assert.equal(checkLedgerAssertion(content, consumed, content.actions[0]!.ledgerAssertions![0]!, 'action.acquire')?.code, 'ledger.assertion.holds');
  assert.equal(checkLedgerAssertion(content, consumed, content.actions[1]!.ledgerAssertions![0]!, 'action.consume'), undefined);
  const legacySave = {...state}; delete (legacySave as Partial<typeof state>).ledger;
  assert.equal(checkLedgerAssertion(content, legacySave, content.actions[0]!.ledgerAssertions![0]!, 'legacy')?.code, 'ledger.assertion.holds');
  const fullRevision = {...revision, content: {...content, actions: content.actions.map(action => action.id === 'upload' ? {...action, locationId: 'start'} : action)}};
  const draft = {id: 'draft', sourceId: 'source', version: 1, updatedAt: '2026-01-01', content: fullRevision.content};
  const report = checkWorldLedger({get: () => draft} as never, {worldId: 'draft', expectedVersion: 1});
  assert.equal(report.status, 'unsupported');
  assert.ok(report.scope.observedAssertions >= 1);
  assert.equal(report.findings.some(issue => issue.code === 'ledger.assertion.holds' && issue.path === 'action:upload'), false);
  const legalContent = {...content, actions: content.actions.filter(action => action.id !== 'upload')};
  const legalDraft = {...draft, content: legalContent};
  const legalReport = checkWorldLedger({get: () => legalDraft} as never, {worldId: 'draft', expectedVersion: 1});
  assert.equal(legalReport.status, 'pass');
});

test('ledger rejects self-declared commits, never-acquired consumed claims, and upload without held evidence', () => {
  const content = world('mystery');
  const revision = {id: 'revision', draftId: 'draft', sourceId: 'source', version: 1, content, createdAt: '2026-01-01'};
  const state = createAdventureState(revision, 'save', '2026-01-01');
  const consumedAssertion = {id: 'fake-consumed', factId: 'clue', claim: 'consumed'} as const;
  const commitAssertion = {id: 'fake-commit', factId: 'clue', claim: 'committed'} as const;
  assert.equal(checkLedgerAssertion(content, state, consumedAssertion, 'test')?.code, 'ledger.assertion.consumed');
  assert.equal(checkLedgerAssertion(content, state, commitAssertion, 'test')?.code, 'ledger.assertion.committed');
  assert.equal(checkLedgerAssertion(content, state, {id: 'unknown', factId: 'missing', claim: 'world-false'}, 'test')?.code, 'ledger.unknown-fact');
  const selfDeclared = {...state, performedActionIds: ['upload'], ledger: {version: 1 as const, heldFactIds: [], consumedFactIds: [], committedFactIds: ['clue'], sources: []}};
  assert.equal(checkLedgerAssertion(content, selfDeclared, commitAssertion, 'test')?.code, 'ledger.assertion.committed');
  const upload = {...content.actions.find(action => action.id === 'upload')!, ledgerAssertions: [{id: 'upload-proof', factId: 'clue', claim: 'holds' as const}]};
  const invalidContent = {...content, actions: content.actions.map(action => action.id === 'acquire' ? {...action, locationId: 'store'} : action.id === 'upload' ? {...upload, locationId: 'start', requires: []} : action)};
  const invalidDraft = {id: 'draft', sourceId: 'source', version: 1, updatedAt: '2026-01-01', content: invalidContent};
  const uploadReport = checkWorldLedger({get: () => invalidDraft} as never, {worldId: 'draft', expectedVersion: 1});
  assert.equal(uploadReport.status, 'fail');
  assert.ok(uploadReport.findings.some(issue => issue.code === 'ledger.assertion.holds'));
  const forgedConsume = {...content.actions.find(action => action.id === 'consume')!, id: 'forged-consume', once: false, locationId: 'start', requires: [], ledgerAssertions: [{id: 'consume-proof', factId: 'clue', claim: 'consumed' as const}]};
  const forgedContent = {...content, actions: [forgedConsume, ...content.actions.filter(action => action.id !== 'consume' && action.id !== 'acquire' && action.id !== 'upload')],
    facts: content.facts.map(fact => fact.id === 'clue' ? {...fact, playerKnown: true} : fact)};
  forgedContent.events = [{id: 'unlock', label: 'unlock', when: [{kind: 'fact', factId: 'done', value: true}], effects: [{kind: 'set', factId: 'done', value: false}], text: '', visibility: 'hidden', ledgerAssertions: [{id: 'event-fix', factId: 'clue', claim: 'consumed'}]}];
  forgedContent.actions = forgedContent.actions.map(action => action.id === 'forged-consume' ? {...action, effects: [{kind: 'set', factId: 'done', value: true}, ...action.effects]} : action.id === 'upload' ? {...action, locationId: 'elsewhere'} : action);
  const forgedDraft = {id: 'draft', sourceId: 'source', version: 1, updatedAt: '2026-01-01', content: forgedContent};
  const forgedReport = checkWorldLedger({get: () => forgedDraft} as never, {worldId: 'draft', expectedVersion: 1});
  assert.equal(forgedReport.status, 'fail');
  assert.ok(forgedReport.findings.some(issue => issue.code === 'ledger.assertion.consumed' && issue.path.includes('consume-proof')));
  const consumeFailure = forgedReport.findings.find(issue => issue.code === 'ledger.assertion.consumed' && issue.path.includes('consume-proof'));
  assert.ok(consumeFailure && 'witness' in consumeFailure && consumeFailure.witness);
  assert.deepEqual(consumeFailure.witness.actionIds, ['forged-consume']);
  assert.ok(forgedReport.findings.some(issue => issue.code === 'ledger.assertion.consumed' && issue.path.includes('event-fix')));
  const acquired = advanceAdventure(state, {actionId: 'acquire', expectedTurn: 0, requestId: '00000000-0000-4000-8000-000000000004'}, content, '2026-01-01');
  const attemptedConsume = advanceAdventure({...state, knownFactIds: ['clue']}, {actionId: 'forged-consume', expectedTurn: 0, requestId: '00000000-0000-4000-8000-000000000005'}, forgedContent, '2026-01-01');
  assert.deepEqual(attemptedConsume.ledger?.consumedFactIds, []);
  assert.equal(attemptedConsume.ledger?.sources.some(source => source.operation === 'consume'), false);
  assert.equal(checkLedgerAssertion(content, acquired, commitAssertion, 'test')?.code, 'ledger.assertion.committed');
});

test('ledger checks each opening, action, event, and ending occurrence snapshot', () => {
  const content = world('mystery');
  content.events = [
    {id: 'opening-a', label: 'A', when: [{kind: 'fact', factId: 'done', value: false}], effects: [{kind: 'set', factId: 'done', value: true}], text: '', visibility: 'hidden', ledgerAssertions: [{id: 'opening-wrong', factId: 'clue', claim: 'holds'}]},
    {id: 'opening-b', label: 'B', when: [{kind: 'fact', factId: 'done', value: true}], effects: [{kind: 'ledger', factId: 'clue', operation: 'acquire'}], text: '', visibility: 'hidden', ledgerAssertions: [{id: 'opening-proof', factId: 'clue', claim: 'holds'}]},
  ];
  content.endings[0]!.when = [{kind: 'fact', factId: 'done', value: true}];
  content.endings[0]!.ledgerAssertions = [{id: 'opening-ending-proof', factId: 'clue', claim: 'holds'}];
  const openingDraft = {id: 'draft', sourceId: 'source', version: 1, updatedAt: '2026-01-01', content};
  const opening = checkWorldLedger({get: () => openingDraft} as never, {worldId: 'draft', expectedVersion: 1});
  assert.equal(opening.status, 'fail');
  assert.ok(opening.findings.some(issue => issue.path.includes('opening-wrong') && issue.code === 'ledger.assertion.holds'));
  assert.equal(opening.findings.some(issue => issue.path.includes('opening-proof') && issue.code === 'ledger.assertion.holds'), false);
  assert.equal(opening.findings.some(issue => issue.path.includes('opening-ending-proof') && issue.code === 'ledger.assertion.holds'), false);

  const actionWorld = world('mystery');
  actionWorld.actions = actionWorld.actions.map(action => action.id === 'acquire' ? {...action, effects: [{kind: 'set' as const, factId: 'done', value: true}], ledgerAssertions: [{id: 'action-wrong', factId: 'clue', claim: 'holds' as const}]} : action);
  actionWorld.events = [{id: 'action-repair', label: 'repair', when: [{kind: 'fact', factId: 'done', value: true}], effects: [{kind: 'ledger', factId: 'clue', operation: 'acquire'}], text: '', visibility: 'hidden', ledgerAssertions: [{id: 'event-proof', factId: 'clue', claim: 'holds'}]}];
  const actionDraft = {id: 'draft', sourceId: 'source', version: 1, updatedAt: '2026-01-01', content: actionWorld};
  const afterAction = checkWorldLedger({get: () => actionDraft} as never, {worldId: 'draft', expectedVersion: 1});
  assert.ok(afterAction.findings.some(issue => issue.path.includes('action-wrong') && issue.code === 'ledger.assertion.holds'));
  assert.equal(afterAction.findings.some(issue => issue.path.includes('event-proof') && issue.code === 'ledger.assertion.holds'), false);
  assert.equal(afterAction.findings.some(issue => issue.path.includes('ending:ending') && issue.code === 'ledger.assertion.holds'), false);

  const historical = createAdventureState({...{id: 'revision', draftId: 'draft', sourceId: 'source', version: 1, content, createdAt: '2026-01-01'}}, 'historical', '2026-01-01');
  historical.ledger!.heldFactIds = ['clue']; historical.ledger!.sources = [{factId: 'clue', operation: 'acquire', sourceId: 'opening-b', turn: 0}];
  const historicalAssertion = {id: 'old-event-holds', factId: 'clue', claim: 'holds' as const};
  assert.equal(checkLedgerAssertion(content, historical, historicalAssertion, 'event:old'), undefined);
});

test('check_world_ledger is strict, versioned, server-read and reports unobserved assertions unsupported', () => {
  assert.throws(() => checkWorldLedgerInputSchema.parse({worldId: 'w'}));
  assert.throws(() => checkWorldLedgerInputSchema.parse({worldId: 'w', expectedVersion: 1, inventory: ['claim']}));
  const content = world('commerce');
  content.actions = content.actions.map(action => ({...action, locationId: 'end'}));
  content.actions = content.actions.map(action => ({...action, effects: [{kind: 'move', locationId: 'end'}]}));
  const draft = {id: 'w', sourceId: 's', version: 2, updatedAt: '2026-01-01', content};
  const worlds = {get: () => draft};
  assert.throws(() => checkWorldLedger(worlds as never, {worldId: 'w', expectedVersion: 1}), /更新/);
  const report = checkWorldLedger(worlds as never, {worldId: 'w', expectedVersion: 2});
  assert.match(report.contentHash, /^[a-f0-9]{64}$/);
  assert.equal(report.status, 'unsupported');
  assert.ok(report.findings.some(issue => issue.code === 'ledger.assertion.unobserved'));
  const command = createCommands({worlds} as never).find(item => item.name === 'check_world_ledger')!;
  assert.ok(command.readOnly);
  assert.equal((command.execute({worldId: 'w', expectedVersion: 2}) as typeof report).contentHash, report.contentHash);
});
