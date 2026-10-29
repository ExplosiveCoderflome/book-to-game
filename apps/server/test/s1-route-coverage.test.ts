/**
 * Route coverage (docs/next-work-2026-10-29.md, slice S1): goal-directed / route-following simulator strategies and the
 * preflight report that flags unreached / generic-starved endings and planned routes below the pacing line.
 * Fixture fixtures/s1/route-coverage.engine.json is SYNTHETIC (engine test only): three fact-gated routes at different
 * locations (合作 / 有限证据 / 武力) like the 《武林外传》 plan, plus onMin / onMax failures and a timeout.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { worldContentSchema, type WorldContent, type WorldRevision } from '@novel-game/contracts';
import { endingSources, PACING_LINE, simulateWorld, type SimRoute } from '@novel-game/play-runtime/sim';

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../../../fixtures/s1/${name}`, import.meta.url), 'utf8'));
const world = (): WorldContent => worldContentSchema.parse(fixture('route-coverage.engine.json'));
const plan = (): SimRoute[] => fixture('route-coverage.plan.json').routes;
const rev = (content: WorldContent): WorldRevision => ({id: 'rev', draftId: 'd', sourceId: 's', content, version: 1, createdAt: '2026-10-29T00:00:00Z'});
const now = '2026-10-29T00:00:00Z';

test('route coverage: generic strategies miss endings that goal-directed strategies reach; every planned ending is hit', async () => {
  const report = await simulateWorld(rev(world()), {seeds: 60, routes: plan(), routeSeeds: 20, now});
  const rc = report.routeCoverage!;
  assert.ok(rc, 'routeCoverage attached');
  // The G-contract is unchanged: same checks and the same generic strategies.
  assert.deepEqual(report.checks.map(c => c.id), ['G1', 'G2', 'G4', 'G6', 'G8']);
  assert.deepEqual(report.strategies.map(s => s.id), ['random', 'greedy-trust', 'greedy-money', 'modao', 'merchant', 'lazy']);
  const status = Object.fromEntries(rc.endings.map(e => [e.id, e.status]));
  // Before: no generic strategy reaches 联手破案 / 洞中一战 at ≥5% → they show up as goal-only (random-starved), not unreached.
  assert.equal(status.coop, 'goal-only'); assert.equal(status.duel, 'goal-only');
  assert.ok(rc.endings.filter(e => e.status !== 'covered').length >= 2, 'generic strategies miss at least two endings');
  // After: every ending has a goal strategy that reaches it; every planned route reaches its own endings.
  for (const e of rc.endings) assert.ok((e.goalRate ?? 0) > 0, `${e.id} reached by its goal strategy`);
  for (const r of rc.routes.filter(r => r.source === 'plan')) assert.ok(r.hitRate >= 0.5, `${r.id} hit ${r.hitRate}`);
  for (const id of ['coop', 'evidence', 'duel']) assert.ok(rc.routes.find(r => r.id === id && r.source === 'ending')!.hitRate >= 0.5, id);
  const issues = rc.issues.map(i => `${i.ruleId}:${i.endingId ?? i.routeId}`);
  assert.ok(issues.includes('route.random-starved:coop') && issues.includes('route.random-starved:duel'), issues.join(','));
  // Fixture routes are tiny → all planned routes are below the G1 pacing line; per-ending direct routes are never judged.
  assert.deepEqual(rc.pacing, PACING_LINE);
  assert.deepEqual(rc.issues.filter(i => i.ruleId === 'route.pacing').map(i => i.routeId).sort(), ['coop', 'duel', 'evidence']);
  assert.ok(!rc.issues.some(i => i.ruleId === 'route.no-trigger' || i.ruleId === 'route.unreached'));
  // Plan routes aim at their ordinary endings (failure endings listed on a route are not the target).
  assert.deepEqual(rc.routes.find(r => r.id === 'coop' && r.source === 'plan')!.endingIds, ['coop']);
});

test('route coverage: deterministic per seed', async () => {
  const a = await simulateWorld(rev(world()), {seeds: 8, routes: plan(), routeSeeds: 6, now});
  const b = await simulateWorld(rev(world()), {seeds: 8, routes: plan(), routeSeeds: 6, now});
  assert.deepEqual({...a, durationMs: 0}, {...b, durationMs: 0});
});

test('route coverage: flags endings nothing can fire, endings no strategy reaches, and weak planned routes', async () => {
  const w = world();
  w.endings.push({id: 'orphan', title: '无源结局', text: '测试。', when: []});
  // A gate on a fact nothing sets: statically has a trigger, but no strategy can get there.
  w.facts.push({id: 'never', label: '永不成立', description: '', kind: 'event', initialValue: false, playerKnown: true, origin: 'adapted', evidence: []});
  w.endings.push({id: 'sealed', title: '封死的结局', text: '测试。', when: []});
  w.actions.push({id: 'sealed_act', label: '封死的门', description: '', locationId: 'town', availableWhen: [], requires: [{kind: 'fact', factId: 'never', value: true}],
    blockedReason: '条件未满足', risk: '', timeCost: 1, once: false, effects: [{kind: 'ending', endingId: 'sealed'}], text: '测试。', origin: 'adapted', evidence: []});
  const content = worldContentSchema.parse(w);
  assert.equal(endingSources(content, 'orphan').length, 0);
  const routes = [...plan(), {id: 'sealed-route', name: '封死路线', endingIds: ['sealed']}];
  const rc = (await simulateWorld(rev(content), {seeds: 10, routes, routeSeeds: 6, now})).routeCoverage!;
  const by = Object.fromEntries(rc.endings.map(e => [e.id, e]));
  assert.equal(by.orphan!.status, 'no-trigger'); assert.equal(by.sealed!.status, 'unreached');
  assert.ok(rc.issues.some(i => i.ruleId === 'route.no-trigger' && i.endingId === 'orphan' && i.severity === 'error'));
  assert.ok(rc.issues.some(i => i.ruleId === 'route.unreached' && i.endingId === 'sealed' && i.severity === 'warning'));
  assert.ok(rc.issues.some(i => i.ruleId === 'route.plan-weak' && i.routeId === 'sealed-route'));
});

test('route coverage: routes:false skips it; auto runs one goal strategy per ending', async () => {
  assert.equal((await simulateWorld(rev(world()), {seeds: 2, routes: false, now})).routeCoverage, undefined);
  const rc = (await simulateWorld(rev(world()), {seeds: 4, now})).routeCoverage!;
  assert.equal(rc.seeds, 4, 'routeSeeds defaults to min(seeds, 20)');
  assert.deepEqual(rc.routes.map(r => r.strategyId), world().endings.map(e => `goal-${e.id}`));
  // 'uncovered' (production) only spends goal runs on endings no generic strategy covers.
  const lean = (await simulateWorld(rev(world()), {seeds: 40, routeSeeds: 6, routeEndings: 'uncovered', routes: plan(), now})).routeCoverage!;
  const covered = lean.endings.filter(e => e.status === 'covered');
  assert.ok(covered.length > 0 && covered.every(e => e.goalRate === undefined));
  assert.ok(lean.endings.filter(e => e.status === 'goal-only').every(e => (e.goalRate ?? 0) > 0));
  assert.equal(lean.routes.filter(r => r.source === 'plan').length, 3);
});
