import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  COLLECTION_FUN_PROFILE, DEFAULT_FUN_PROFILE, FUN_PROFILES, GRINDING_FUN_PROFILE, HEALING_FUN_PROFILE,
  PRESSURE_FUN_PROFILE, funProfileSchema, getFunProfile, worldContentSchema,
  type FunProfile, type WorldContent, type WorldRevision,
} from '@novel-game/contracts';
import { btgWorldFileToContent } from '@novel-game/rules/preflight';
import { simulateWorld } from '@novel-game/play-runtime/sim';

const NOW = '2026-10-29T00:00:00Z';
const read = (path: string) => JSON.parse(readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8'));
const shoudeng = (): WorldContent => worldContentSchema.parse(btgWorldFileToContent(read('docs/samples/shoudeng/shoudeng.batch3.world.json')));
const diner = (): WorldContent => worldContentSchema.parse(read('fixtures/v0a/diner.world.json'));
const rev = (content: WorldContent): WorldRevision => ({id: 'rev-v0b', draftId: 'd', sourceId: 's', content, version: 1, createdAt: NOW});
const withoutTimingAndProfile = (report: Awaited<ReturnType<typeof simulateWorld>>) => {
  const {durationMs: _durationMs, profileId: _profileId, ...rest} = report;
  return rest;
};

test('V0b: FunProfile 契约校验五个内置画像与阈值边界', () => {
  assert.deepEqual(FUN_PROFILES.map(profile => profile.id), ['default', 'pressure', 'healing', 'grinding', 'collection']);
  for (const profile of FUN_PROFILES) assert.deepEqual(funProfileSchema.parse(profile), profile);
  assert.equal(getFunProfile('healing'), HEALING_FUN_PROFILE);
  assert.equal(getFunProfile('missing'), undefined);
  const custom = funProfileSchema.parse({...HEALING_FUN_PROFILE, id: 'custom-healing', thresholds: {minFailureFreeEndingRate: 0.9}});
  assert.equal(custom.thresholds.minFailureFreeEndingRate, 0.9);
  assert.equal(custom.thresholds.minEndingRate, 0.05, 'omitted thresholds use the legacy defaults');
  assert.throws(() => funProfileSchema.parse({...HEALING_FUN_PROFILE, thresholds: {...HEALING_FUN_PROFILE.thresholds, minFailureFreeEndingRate: 1.1}}));
  assert.throws(() => funProfileSchema.parse({...HEALING_FUN_PROFILE, metricMatrix: {unknown: true}}));
  assert.throws(() => funProfileSchema.parse({...HEALING_FUN_PROFILE, metricMatrix: {G1: false}}));
});

test('V0b: 不传 profile 保持同种子基线，default 的验收与完整报告逐字段一致', async () => {
  const options = {seeds: 6, maxSteps: 900, routes: false as const, now: NOW};
  const legacy = await simulateWorld(rev(shoudeng()), options);
  const namedDefault = await simulateWorld(rev(shoudeng()), {...options, profile: DEFAULT_FUN_PROFILE});
  assert.equal(legacy.profileId, undefined);
  assert.equal(namedDefault.profileId, 'default');
  assert.deepEqual(legacy.checks.map(check => [check.id, check.pass]), [
    ['G1', true], ['G2', true], ['G4', false], ['G6', true], ['G8', true],
  ]);
  assert.deepEqual(legacy.medians.random, {decisions: 279, uniqueChars: 18520, months: 353});
  assert.deepEqual(legacy.endingRates.random, {guifan: 1 / 3, liushi: 1 / 6, xuedeng: 1 / 6, tiwen: 1 / 6, rumo: 1 / 6});
  assert.deepEqual(namedDefault.checks, legacy.checks, 'default keeps every legacy simulator acceptance row');
  assert.deepEqual(withoutTimingAndProfile(namedDefault), withoutTimingAndProfile(legacy));
});

test('V0b: healing 饭馆指标可计算并通过，严格阈值使同一指标失败且不改模拟结果', async () => {
  const options = {seeds: 20, maxSteps: 100, routes: false as const, pacing: false as const, now: NOW};
  const passing = await simulateWorld(rev(diner()), {...options, profile: HEALING_FUN_PROFILE});
  assert.equal(passing.profileId, 'healing');
  assert.deepEqual(passing.checks.map(check => check.id), ['G1', 'G4', 'G8', 'failure-free-ending-rate']);
  assert.ok(passing.checks.every(check => check.pass), JSON.stringify(passing.checks));
  const metric = passing.checks.find(check => check.id === 'failure-free-ending-rate')!;
  assert.equal(metric.line, '「随机」零失败结局率 ≥ 80%');
  assert.equal(metric.measured, '零失败结局率 85% · 失败结局 15%');
  const strictProfile = funProfileSchema.parse({...HEALING_FUN_PROFILE, id: 'healing-strict',
    thresholds: {...HEALING_FUN_PROFILE.thresholds, minFailureFreeEndingRate: 0.9}});
  const failing = await simulateWorld(rev(diner()), {...options, profile: strictProfile});
  const strictMetric = failing.checks.find(check => check.id === 'failure-free-ending-rate')!;
  assert.equal(strictMetric.pass, false);
  assert.equal(strictMetric.measured, metric.measured);
  assert.deepEqual(failing.endingRates, passing.endingRates, 'acceptance thresholds never change seeded play');
});

test('V0b: pressure / grinding / collection 均可按各自矩阵运行', async () => {
  const profiles: FunProfile[] = [PRESSURE_FUN_PROFILE, GRINDING_FUN_PROFILE, COLLECTION_FUN_PROFILE];
  for (const profile of profiles) {
    const report = await simulateWorld(rev(diner()), {seeds: 2, routeSeeds: 2, maxSteps: 100, now: NOW,
      routes: profile.id === 'collection' ? 'auto' : false, pacing: false, profile});
    assert.equal(report.profileId, profile.id);
    assert.deepEqual(report.checks.map(check => check.id), Object.entries(profile.metricMatrix)
      .filter(([, enabled]) => enabled).map(([id]) => id));
    if (profile.id === 'grinding') assert.ok(!report.strategies.some(strategy => strategy.id === 'merchant'));
    if (profile.id === 'collection') assert.ok(report.routeCoverage);
  }
});
