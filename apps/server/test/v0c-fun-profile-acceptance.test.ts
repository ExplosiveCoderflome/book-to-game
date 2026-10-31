import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  GRINDING_FUN_PROFILE, HEALING_FUN_PROFILE, worldContentSchema,
  type WorldContent, type WorldRevision,
} from '@novel-game/contracts';
import { lintWorld } from '@novel-game/rules/preflight';
import { simulateWorld } from '@novel-game/play-runtime/sim';

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
  assert.deepEqual(report.checks.map(check => check.id), ['G1', 'G4', 'G8', 'failure-free-ending-rate']);
  assert.ok(report.checks.every(check => check.pass), JSON.stringify(report.checks));
});

test('V0c: 刷怪成长夹具的主资源中位曲线逐段单调上升', async () => {
  const world = fixture('grinding.world.json');
  assert.equal(lintWorld(world).errors, 0);
  const report = await simulateWorld(rev(world), {...options, profile: GRINDING_FUN_PROFILE});
  assert.equal(report.profileId, 'grinding');
  assert.deepEqual(report.checks.map(check => check.id), ['G4', 'G8', 'growth-monotonic']);
  assert.ok(report.checks.every(check => check.pass), JSON.stringify(report.checks));
  const curve = report.resourceBands.xp!.points.map(point => point.p50);
  assert.equal(curve.length, 5);
  assert.ok(curve.at(-1)! > curve[0]!);
  assert.ok(curve.every((value, index) => index === 0 || value >= curve[index - 1]!), curve.join(' → '));
  assert.match(report.checks.find(check => check.id === 'growth-monotonic')!.line, /历练/);
});
