/**
 * S2 route guidance, S3 pacing diagnosis, S5 plan check (docs/next-work-2026-10-29.md). All offline: synthetic engine
 * fixtures (fixtures/s1, fixtures/s3, fixtures/s5 — no story content) plus the 《寿灯》 batch3 gold world; no model calls.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { worldContentSchema, type WorldContent, type WorldRevision } from '@novel-game/contracts';
import { btgWorldFileToContent } from '@novel-game/rules/preflight';
import { applyGuidance, checkPlanWorld, estimateMinSteps, simulateWorld, type SimRoute } from '@novel-game/play-runtime/sim';

const read = (p: string) => JSON.parse(readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8'));
const routeWorld = (): WorldContent => worldContentSchema.parse(read('fixtures/s1/route-coverage.engine.json'));
const routePlan = (): SimRoute[] => read('fixtures/s1/route-coverage.plan.json').routes;
const rev = (content: WorldContent): WorldRevision => ({id: 'rev', draftId: 'd', sourceId: 's', content, version: 1, createdAt: '2026-10-29T00:00:00Z'});
const now = '2026-10-29T00:00:00Z';

test('S2: guidance lifts random play to the coop ending from 0% to ≥ 5% on the synthetic fixture; suggestions only', async () => {
  const w = routeWorld();
  const before = JSON.stringify(w);
  const report = await simulateWorld(rev(w), {seeds: 100, routeSeeds: 20, guidance: true, now});
  assert.equal(JSON.stringify(w), before, 'the world passed in is never modified');
  const hints = report.routeCoverage!.guidance!;
  assert.ok(hints.length >= 1 && hints.length <= 3);
  const coop = hints.find(h => h.endingId === 'coop')!;
  assert.ok(coop, 'coop gets a hint');
  assert.equal(coop.randomBefore, 0);
  assert.ok(coop.randomAfter >= 0.05, `random coop after hints ${coop.randomAfter}`);
  assert.ok(coop.edits.some(e => e.kind === 'gate-trap' && e.target.actionId === 'sell_out'), 'the betrayal trap is gated');
  assert.deepEqual(coop.keySteps.length >= 2, true);
  assert.ok(report.routeCoverage!.issues.some(i => i.ruleId === 'route.guidance' && i.endingId === 'coop'));
  // Re-measure independently: applying the edits gives the same rate on the same seeds, and the patched copy is schema-valid.
  const patched = worldContentSchema.parse(applyGuidance(w, coop.edits));
  const again = await simulateWorld(rev(patched), {seeds: coop.seeds, strategies: ['random'], routes: false, now});
  assert.equal(again.endingRates.random?.coop ?? 0, coop.randomAfter);
  assert.ok(patched.storylets!.filter(s => s.id.startsWith('guide_')).every(s => s.text!.startsWith('（路线提示，待改写）')), 'nudge cards carry placeholder prose');
  // Deterministic.
  const twice = await simulateWorld(rev(routeWorld()), {seeds: 100, routeSeeds: 20, guidance: true, now});
  assert.deepEqual(twice.routeCoverage!.guidance, hints);
  // Off by default.
  const plain = await simulateWorld(rev(routeWorld()), {seeds: 20, routeSeeds: 5, now});
  assert.equal(plain.routeCoverage!.guidance, undefined);
});

test('S2: 《寿灯》 batch3 gets at most 3 guidance hints', async () => {
  const w = worldContentSchema.parse(btgWorldFileToContent(read('docs/samples/shoudeng/shoudeng.batch3.world.json')));
  const report = await simulateWorld(rev(w), {seeds: 30, routeSeeds: 8, guidance: {seeds: 30}, now, maxSteps: 900});
  assert.ok((report.routeCoverage!.guidance ?? []).length <= 3);
});

test('S3: a synthetic ~30-step world reports concrete causes with fixes; static minimum steps match the simulation', async () => {
  const w = worldContentSchema.parse(read('fixtures/s3/short-world.engine.json'));
  const report = await simulateWorld(rev(w), {seeds: 100, routeSeeds: 20, now});
  const pc = report.pacing!;
  assert.ok(pc.belowLine);
  assert.ok(pc.random!.decisions >= 20 && pc.random!.decisions <= 40, `median ${pc.random!.decisions}`);
  const rules = new Set(pc.causes.map(c => c.ruleId));
  for (const r of ['pacing.early-ending', 'pacing.clock-short', 'pacing.repeat-no-variants', 'pacing.thin-text'] as const) assert.ok(rules.has(r), `missing ${r}`);
  const early = pc.causes.find(c => c.ruleId === 'pacing.early-ending')!;
  assert.equal(early.endingId, 'renown'); assert.equal(early.resourceId, 'fame');
  assert.match(early.message, /声望≥8/);
  assert.ok(pc.causes.every(c => c.suggestion.length > 10));
  assert.ok(pc.causes.find(c => c.ruleId === 'pacing.repeat-no-variants' && c.storyletId === 'beggar'));
  // Static estimate (plan-stage number) within 20% of the simulated minimum for every ordinary ending.
  for (const row of pc.estimate.rows.filter(r => r.kind !== 'failure' && r.kind !== 'timeout')) {
    assert.ok(row.simulatedMin, `${row.endingId} reached`);
    assert.ok(Math.abs(row.estimateMin - row.simulatedMin!) / row.simulatedMin! <= 0.2, `${row.endingId}: est ${row.estimateMin} vs sim ${row.simulatedMin}`);
  }
  // The G-contract is unchanged.
  assert.deepEqual(report.checks.map(c => c.id), ['G1', 'G2', 'G4', 'G6', 'G8']);
});

test('S3: Wulin-shaped fixture — static minimum within 20% of the simulated minimum for the planned ordinary endings', async () => {
  const w = routeWorld();
  const report = await simulateWorld(rev(w), {seeds: 100, routes: routePlan(), routeSeeds: 20, now});
  const est = estimateMinSteps(w);
  for (const id of ['coop', 'evidence', 'duel']) {
    const row = report.pacing!.estimate.rows.find(r => r.endingId === id)!;
    assert.equal(row.estimateMin, est[id]);
    assert.ok(Math.abs(row.estimateMin - row.simulatedMin!) / row.simulatedMin! <= 0.2, `${id}: est ${row.estimateMin} vs sim ${row.simulatedMin}`);
  }
  assert.ok(report.pacing!.causes.some(c => c.ruleId === 'pacing.clock-short'));
});

test('S5: the original (pre-hand-fix) synthetic plan reports each class of problem; the revised plan has no errors', () => {
  const original = read('fixtures/s5/plan-original.json');
  const r = checkPlanWorld(worldContentSchema.parse(original.world), original.routes, {probeSeeds: 8});
  assert.ok(r.blocking);
  const by = (rule: string) => r.issues.filter(i => i.ruleId === rule);
  assert.ok(by('plan.fact-unsettable').some(i => i.target === 'ally_met' && i.severity === 'error'), 'key task nobody can perform');
  assert.ok(by('plan.threshold-open').some(i => i.target === 'clue' && i.endingId === 'evidence'), 'evidence does not add up');
  assert.ok(by('plan.threshold-open').some(i => i.target === 'strength' && /上限/.test(i.message)), 'threshold above max');
  assert.ok(by('plan.draw-locked').some(i => i.target === 'has_letter'), 'main line behind one card draw');
  assert.ok(by('plan.routes-dead').length === 1, 'every planned route dead → blocking');
  assert.ok(r.issues.every(i => i.suggestion.length > 5));
  const revised = read('fixtures/s5/plan-revised.json');
  const ok = checkPlanWorld(worldContentSchema.parse(revised.world), revised.routes, {probeSeeds: 8});
  assert.equal(ok.errors, 0); assert.equal(ok.blocking, false);
  assert.ok(ok.routes.every(x => x.hitRate > 0));
});

test('S5: passive-only key step and a short plan are warnings, not errors', () => {
  const w = routeWorld();
  // ally_trust only via an automatic event (no action can set it).
  const plead = w.actions.find(a => a.id === 'plead')!;
  w.actions = w.actions.filter(a => a.id !== 'plead');
  w.events = [{id: 'ev_plead', label: '旧识自证', when: [...plead.availableWhen, ...plead.requires], effects: plead.effects, text: '旧识自己去县衙说清了。', visibility: 'public'} as WorldContent['events'][number]];
  const r = checkPlanWorld(worldContentSchema.parse(w), routePlan(), {probe: false});
  assert.ok(r.issues.some(i => i.ruleId === 'plan.passive-only' && i.target === 'ally_trust' && i.severity === 'warning'));
  assert.ok(r.issues.some(i => i.ruleId === 'plan.pacing-short' && i.severity === 'warning'));
  assert.equal(r.errors, 0);
});
