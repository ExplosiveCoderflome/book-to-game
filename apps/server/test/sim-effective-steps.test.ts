import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { worldContentSchema, type WorldContent, type WorldRevision } from '@novel-game/contracts';
import { simulateWorld } from '@novel-game/play-runtime/sim';

const NOW = '2026-11-06T00:00:00.000Z';
function fixture(): WorldContent {
  const content = worldContentSchema.parse(JSON.parse(readFileSync(new URL('../../../fixtures/s1/route-coverage.engine.json', import.meta.url), 'utf8')));
  content.storylets = [];
  content.endings = [{id: 'done', title: 'Done', text: 'Finished.', when: [], kind: 'ending'}];
  content.actions = [{...content.actions[0]!, id: 'wait', label: 'Wait', availableWhen: [], requires: [], once: false,
    timeCost: 1, text: 'A repeated line.', effects: [{kind: 'resource', resourceId: 'money', delta: 0}]}];
  content.endConditions = undefined;
  content.clock = undefined;
  return content;
}
const revision = (content: WorldContent): WorldRevision => ({id: 'ev', draftId: 'd', sourceId: 's', version: 1, createdAt: NOW, content});

test('evidence replay is deterministic and distinguishes raw idle steps from effective progress', async () => {
  const content = fixture();
  const options = {seeds: 1, strategies: ['random'], routes: false as const, pacing: false, now: NOW,
    evidence: {runs: 1, seed: 42, maxSteps: 14}};
  const a = await simulateWorld(revision(content), options);
  const b = await simulateWorld(revision(content), options);
  assert.deepEqual(a.evidence, b.evidence);
  assert.equal(a.evidence?.cappedWitnesses[0]?.rawSteps, 14);
  assert.equal(a.evidence?.cappedWitnesses[0]?.effectiveSteps, 0);
  assert.equal(a.evidence?.endingReachability[0]?.status, 'sampled-not-hit');
  assert.equal(a.evidence?.cappedRuns, 1);
});

test('a real ending witness includes a replayable action sequence and positive effective steps', async () => {
  const content = fixture();
  content.actions[0] = {...content.actions[0]!, id: 'finish', effects: [{kind: 'ending', endingId: 'done'}]};
  const report = await simulateWorld(revision(content), {seeds: 1, strategies: ['random'], routes: false, pacing: false, now: NOW,
    evidence: {runs: 1, seed: 7, maxSteps: 5}});
  assert.deepEqual(report.evidence?.witnesses[0]?.actionIds, ['__wait__', 'finish']);
  assert.equal(report.evidence?.witnesses[0]?.effectiveSteps, 1);
  assert.equal(report.evidence?.endingReachability[0]?.status, 'observed');
  assert.deepEqual(report.evidence?.endingReachability[0]?.witness?.actionIds, ['__wait__', 'finish']);
});

test('resource thresholds count as progress while same-location moves and counter resources do not', async () => {
  const threshold = fixture();
  threshold.resourceDefs = {...threshold.resourceDefs, fuel: {label: 'Fuel', min: 0, max: 3, initial: 0, display: 'number'}};
  threshold.actions = [
    {...threshold.actions[0]!, id: 'gather', label: 'Gather', once: true, effects: [{kind: 'resource', resourceId: 'fuel', delta: 2}]},
    {...threshold.actions[0]!, id: 'spend', label: 'Spend', once: true, requires: [{kind: 'resource', resourceId: 'fuel', atLeast: 2}], effects: [{kind: 'ending', endingId: 'done'}]},
  ];
  threshold.resources = {...threshold.resources, fuel: 0};
  const report = await simulateWorld(revision(threshold), {seeds: 1, strategies: ['random'], routes: false, pacing: false, now: NOW,
    evidence: {runs: 1, seed: 7, maxSteps: 4}});
  assert.equal(report.evidence?.samples[0]?.effectiveSteps, 2);

  const idle = fixture();
  idle.resourceDefs = {...idle.resourceDefs, counter: {label: 'Count', min: 0, max: 100, initial: 0, display: 'number'}};
  idle.actions = [{...idle.actions[0]!, id: 'decorate', effects: [
    {kind: 'move', locationId: idle.locations[0]!.id}, {kind: 'resource', resourceId: 'counter', delta: 1},
  ]}];
  idle.resources = {...idle.resources, counter: 0};
  const idleReport = await simulateWorld(revision(idle), {seeds: 1, strategies: ['random'], routes: false, pacing: false, now: NOW,
    evidence: {runs: 1, seed: 7, maxSteps: 14}});
  assert.equal(idleReport.evidence?.samples[0]?.effectiveSteps, 0);
});

test('evidence reports every sampled run and prose repetitions per run, not repeated visits', async () => {
  const content = fixture();
  const report = await simulateWorld(revision(content), {seeds: 1, strategies: ['random'], routes: false, pacing: false, now: NOW,
    evidence: {runs: 3, seed: 7, maxSteps: 2}});
  assert.equal(report.evidence?.samples.length, 3);
  assert.equal(report.evidence?.distribution.runs, 3);
  assert.equal(report.evidence?.distribution.rawSteps.average, 2);
  assert.ok(!report.evidence?.prose.repeatedBodies.includes('A repeated line.'));
});

test('fourteen permutation actions plus a final ending do not make all fifteen steps effective', async () => {
  const content = fixture();
  content.facts = [...content.facts, {id: 'a', label: 'A', description: '', kind: 'event', initialValue: false, playerKnown: false, origin: 'adapted', evidence: []}];
  content.actions = Array.from({length: 14}, (_, index) => ({...content.actions[0]!, id: `permute-${index}`, label: `P${index}`,
    effects: [{kind: 'set' as const, factId: 'a', value: false}]}));
  content.actions.push({...content.actions[0]!, id: 'finish-after-idle', effects: [{kind: 'ending', endingId: 'done'}]});
  const report = await simulateWorld(revision(content), {seeds: 1, strategies: ['random'], routes: false, pacing: false, now: NOW,
    evidence: {runs: 1, seed: 11, maxSteps: 30}});
  assert.ok((report.evidence?.witnesses[0]?.effectiveSteps ?? 99) < 15);
});

test('irrelevant known facts, same-location moves, and duplicate ledger sources do not create effective steps', async () => {
  const content = fixture();
  content.facts = [...content.facts, ...Array.from({length: 14}, (_, index) => ({id: `hidden-${index}`, label: `Hidden ${index}`,
    description: '', kind: 'event' as const, initialValue: false, playerKnown: false, origin: 'adapted' as const, evidence: []}))];
  content.actions = Array.from({length: 14}, (_, index) => ({...content.actions[0]!, id: `fact-${index}`, label: `Fact ${index}`,
    effects: [{kind: 'set' as const, factId: `hidden-${index}`, value: true}]}));
  content.actions.push({...content.actions[0]!, id: 'ending', effects: [{kind: 'ending', endingId: 'done'}]});
  const report = await simulateWorld(revision(content), {seeds: 1, strategies: ['random'], routes: false, pacing: false, now: NOW,
    evidence: {runs: 1, seed: 11, maxSteps: 30}});
  assert.equal(report.evidence?.witnesses[0]?.effectiveSteps, 1);

  const duplicate = fixture();
  duplicate.facts = [...duplicate.facts, {id: 'evidence', label: 'Evidence', description: '', kind: 'clue', initialValue: false,
    playerKnown: false, origin: 'adapted', evidence: []}];
  duplicate.ledgerVersion = 1;
  duplicate.actions = [{...duplicate.actions[0]!, id: 'acquire', once: true, effects: [{kind: 'ledger', operation: 'acquire', factId: 'evidence'}]},
    {...duplicate.actions[0]!, id: 'again', effects: [{kind: 'ledger', operation: 'acquire', factId: 'evidence'}]},
    {...duplicate.actions[0]!, id: 'ending', effects: [{kind: 'ending', endingId: 'done'}]}];
  duplicate.actions[0]!.effects = [{kind: 'ledger', operation: 'acquire', factId: 'evidence'}];
  assert.doesNotThrow(() => worldContentSchema.parse(duplicate));
  const duplicated = await simulateWorld(revision(duplicate), {seeds: 1, strategies: ['random'], routes: false, pacing: false, now: NOW,
    evidence: {runs: 1, seed: 11, maxSteps: 10}});
  assert.equal(duplicated.evidence?.witnesses[0]?.effectiveSteps, 2);
});
