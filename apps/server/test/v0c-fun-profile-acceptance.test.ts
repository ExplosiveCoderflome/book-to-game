import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  GRINDING_FUN_PROFILE, HEALING_FUN_PROFILE, worldContentSchema,
  type WorldContent, type WorldRevision,
} from '@novel-game/contracts';
import { lintWorld } from '@novel-game/rules/preflight';
import { advanceAdventure, createAdventureState, projectAdventure } from '@novel-game/play-runtime';
import { semanticDependencyState, simulateWorld } from '@novel-game/play-runtime/sim';

const NOW = '2026-10-30T00:00:00Z';
const fixture = (name: string): WorldContent => worldContentSchema.parse(JSON.parse(readFileSync(new URL(`../../../fixtures/v0c/${name}`, import.meta.url), 'utf8')));
const rev = (content: WorldContent): WorldRevision => ({id: 'rev-v0c', draftId: 'd', sourceId: 's', content, version: 1, createdAt: NOW});
const options = {seeds: 20, maxSteps: 100, routes: false as const, pacing: false as const, now: NOW};

test('V0c: 治愈经营夹具用日时钟与低节奏线验收，不被默认 60 决策线卡住', async () => {
  const world = fixture('healing.world.json');
  assert.equal(lintWorld(world).errors, 0);
  const legacy = await simulateWorld(rev(world), options);
  const report = await simulateWorld(rev(world), {...options, profile: HEALING_FUN_PROFILE});
  assert.equal(report.profileId, 'healing');
  assert.equal(report.timeUnit, 'day');
  assert.ok(report.medians.random!.decisions < 60, JSON.stringify(report.medians.random));
  assert.equal(legacy.checks.find(check => check.id === 'G1')?.pass, false);
  assert.equal(report.checks.find(check => check.id === 'G1')?.pass, true);
  assert.deepEqual(report.checks.map(check => check.id), ['G1', 'G4', 'G8', 'failure-free-ending-rate', 'minimum-run-length']);
  assert.ok(report.checks.every(check => check.pass), JSON.stringify(report.checks));
});

test('V0c: 刷怪成长夹具的主资源中位曲线逐段单调上升', async () => {
  const world = fixture('grinding.world.json');
  assert.equal(lintWorld(world).errors, 0);
  const report = await simulateWorld(rev(world), {...options, profile: GRINDING_FUN_PROFILE});
  assert.equal(report.profileId, 'grinding');
  assert.deepEqual(report.checks.map(check => check.id), ['G4', 'G8', 'growth-monotonic', 'minimum-run-length']);
  assert.deepEqual(report.strategies.map(strategy => strategy.id), ['random', 'greedy-xp', 'greedy-coins', 'modao', 'lazy']);
  assert.ok(report.checks.every(check => check.pass), JSON.stringify(report.checks));
  const curve = report.resourceBands.xp!.points.map(point => point.p50);
  assert.equal(curve.length, 5);
  assert.ok(curve.at(-1)! > curve[0]!);
  assert.ok(curve.every((value, index) => index === 0 || value >= curve[index - 1]!), curve.join(' → '));
  assert.match(report.checks.find(check => check.id === 'growth-monotonic')!.line, /历练/);
});

test('V0c: 五种成长策略的诊断步数与逐动作独立回放一致，不把原始步数当有效推进', async () => {
  const revision = rev(fixture('grinding.world.json'));
  const report = await simulateWorld(revision, {...options, seeds: 2, profile: GRINDING_FUN_PROFILE,
    evidence: {runs: 2, seed: 1, maxSteps: 100}});
  const evidence = report.evidence;
  assert.ok(evidence);
  assert.deepEqual(evidence.strategies, ['random', 'greedy-xp', 'greedy-coins', 'modao', 'lazy']);
  assert.equal(evidence.samples.length, 10);
  let repeatedStates = 0;
  let noProgressRuns = 0;
  for (const strategy of evidence.strategies) {
    assert.deepEqual(evidence.samples.filter(sample => sample.strategy === strategy).map(sample => sample.seed), [1, 2]);
  }
  for (const sample of evidence.samples) {
    let state = createAdventureState(revision, `sim-${sample.strategy}-${sample.seed}`, NOW, {}, sample.seed);
    const seen = new Set([semanticDependencyState(state, projectAdventure(state, revision), revision.content)]);
    let effectiveSteps = 0;
    for (const actionId of sample.actionIds) {
      const before = semanticDependencyState(state, projectAdventure(state, revision), revision.content);
      state = advanceAdventure({...state, history: []}, {actionId, expectedTurn: state.turn,
        requestId: '00000000-0000-4000-8000-000000000000'}, revision.content, NOW);
      const after = semanticDependencyState(state, projectAdventure(state, revision), revision.content);
      if (seen.has(after)) repeatedStates++;
      else if (after !== before) effectiveSteps++;
      seen.add(after);
    }
    assert.equal(sample.rawSteps, sample.actionIds.length);
    assert.equal(sample.rawSteps, state.turn);
    assert.equal(sample.effectiveSteps, effectiveSteps);
    assert.equal(sample.endingId, state.ending?.id);
    assert.equal(sample.outcome, 'ending', 'this fixture must finish under all five strategies');
    if (sample.rawSteps > 0 && effectiveSteps === 0) noProgressRuns++;
  }
  const stats = (values: number[]) => ({minimum: Math.min(...values),
    average: values.reduce((sum, value) => sum + value, 0) / values.length, maximum: Math.max(...values)});
  assert.deepEqual(evidence.distribution, {runs: 10, rawSteps: stats(evidence.samples.map(sample => sample.rawSteps)),
    effectiveSteps: stats(evidence.samples.map(sample => sample.effectiveSteps))});
  assert.equal(evidence.repeatedStates, repeatedStates);
  assert.equal(evidence.noProgressRuns, noProgressRuns);
  assert.equal(evidence.cappedRuns, 0);
  assert.deepEqual(evidence.cappedWitnesses, []);
  assert.deepEqual(evidence.deadEnds, []);
  assert.ok(evidence.samples.some(sample => sample.effectiveSteps < sample.rawSteps), 'diagnostics distinguish repetition from effective progress');
  for (const witness of evidence.witnesses) {
    const sample: (typeof evidence.samples)[number] | undefined = evidence.samples.find(candidate => candidate.strategy === witness.strategy && candidate.seed === witness.seed);
    assert.ok(sample);
    assert.deepEqual(witness, {strategy: sample.strategy, seed: sample.seed, endingId: sample.endingId,
      rawSteps: sample.rawSteps, effectiveSteps: sample.effectiveSteps, actionIds: sample.actionIds});
  }
});
