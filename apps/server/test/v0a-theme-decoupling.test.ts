import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { worldContentSchema, type WorldContent, type WorldRevision } from '@novel-game/contracts';
import { resourceLabelsForWorld, XIANXIA_LABEL_PRESET } from '@novel-game/rules';
import { btgWorldFileToContent, lintWorld } from '@novel-game/rules/preflight';
import { createAdventureState, formatCalendar, formatMonths, projectAdventure } from '@novel-game/play-runtime';
import { defaultStrategies, simulateWorld } from '@novel-game/play-runtime/sim';

const NOW = '2026-10-29T00:00:00Z';
const shoudeng = (): WorldContent => worldContentSchema.parse(btgWorldFileToContent(JSON.parse(readFileSync(
  new URL('../../../docs/samples/shoudeng/shoudeng.batch3.world.json', import.meta.url), 'utf8'))));
const diner = (): WorldContent => worldContentSchema.parse(JSON.parse(readFileSync(
  new URL('../../../fixtures/v0a/diner.world.json', import.meta.url), 'utf8')));
const rev = (content: WorldContent): WorldRevision => ({id: 'rev-v0a', draftId: 'd', sourceId: 's', content, version: 1, createdAt: NOW});

const DEFAULT_STRATEGIES = [
  {id: 'random', label: '随机'},
  {id: 'greedy-xiuwei', label: '只顾修为'},
  {id: 'greedy-lingshi', label: '只顾灵石'},
  {id: 'modao', label: '魔道优先'},
  {id: 'merchant', label: '跑商（攒灵石）'},
  {id: 'lazy', label: '只修炼'},
];
const SIM_BASELINE = {
  endingRates: {
    random: {guifan: 1 / 3, liushi: 1 / 6, xuedeng: 1 / 6, tiwen: 1 / 6, rumo: 1 / 6},
    'greedy-xiuwei': {jiedan: 1 / 6, rumo: 1 / 3, huandeng: 1 / 6, zuohua: 1 / 3},
    'greedy-lingshi': {tiwen: 1 / 6, rumo: 1 / 6, liushi: 1 / 6, xuedeng: 1 / 2},
    modao: {xuedeng: 2 / 3, rumo: 1 / 3},
    merchant: {wanbao: 1},
    lazy: {liushi: 1},
  },
  medians: {
    random: {decisions: 279, uniqueChars: 18520, months: 353},
    'greedy-xiuwei': {decisions: 300, uniqueChars: 19294, months: 528},
    'greedy-lingshi': {decisions: 235, uniqueChars: 19214, months: 257},
    modao: {decisions: 52, uniqueChars: 7205, months: 40},
    merchant: {decisions: 88, uniqueChars: 3695, months: 175},
    lazy: {decisions: 720, uniqueChars: 945, months: 720},
  },
  pacing: {belowLine: false, random: {decisions: 279, uniqueChars: 18520, months: 353}},
};

test('V0a: 仙侠默认策略的 id 与 label 保持改前基线', () => {
  assert.deepEqual(defaultStrategies(shoudeng()).map(({id, label}) => ({id, label})), DEFAULT_STRATEGIES);
});

test('V0a: 仙侠同种子模拟结局与节奏保持改前基线且可重放', async () => {
  const options = {seeds: 6, maxSteps: 900, routes: false as const, now: NOW};
  const run = async () => {
    const report = await simulateWorld(rev(shoudeng()), options);
    return {endingRates: report.endingRates, medians: report.medians,
      pacing: {belowLine: report.pacing?.belowLine, random: report.pacing?.random}};
  };
  const a = await run(); const b = await run();
  assert.deepEqual(a, b);
  assert.deepEqual(a, SIM_BASELINE);
});

test('V0a: SimProfile 可选择策略、覆盖标签与节奏线', async () => {
  const report = await simulateWorld(rev(shoudeng()), {seeds: 1, maxSteps: 900, routes: false, pacing: false, now: NOW,
    profile: {strategyIds: ['random'], strategyLabels: {random: '随缘'}, pacingLine: {decisions: 1, uniqueChars: 1}}});
  assert.deepEqual(report.strategies, [{id: 'random', label: '随缘', runs: 1}]);
  assert.equal(report.checks.find(check => check.id === 'G1')?.pass, true);
  assert.equal(report.checks.find(check => check.id === 'G1')?.line, '「随机」首通中位数 ≥ 1 次决策且 ≥ 1 字不重复正文');
});

test('V0a: 旧月时钟缺省兼容，其他时钟单位使用中立文案', () => {
  const original = shoudeng(); const {unit: _unit, ...legacyClock} = original.clock!;
  const legacy = worldContentSchema.parse({...original, clock: legacyClock});
  assert.equal(legacy.clock?.unit, 'month');
  assert.equal(formatCalendar(legacy, 10), '第2年 1月');
  assert.equal(formatMonths(3), '3 个月');
  assert.equal(formatMonths(24), '2 年');
  assert.equal(formatMonths(14), '1 年 2 个月');
  for (const [unit, calendar, duration] of [['day', '第8天', '14 天'], ['week', '第8周', '14 周'], ['year', '第8年', '14 年']] as const) {
    const world = worldContentSchema.parse({...original, clock: {...original.clock!, unit}});
    assert.equal(formatCalendar(world, 7), calendar);
    assert.equal(formatMonths(14, unit), duration);
  }
});

test('V0a: 默认资源标签不含仙侠词，显式预设与世界覆盖顺序有效', () => {
  const generic = resourceLabelsForWorld(diner());
  assert.equal(generic.qi, undefined);
  assert.equal(resourceLabelsForWorld(undefined, {preset: XIANXIA_LABEL_PRESET}).qi, '修为');
  const world = {resourceDefs: {qi: {label: '真气'}}, map: {layers: {factions: {factions: [
    {stats: [{resourceId: 'qi', label: '气机'}]},
  ]}}}};
  assert.equal(resourceLabelsForWorld(world, {preset: XIANXIA_LABEL_PRESET}).qi, '真气');
});

test('V0a: 现代饭馆通过 schema 与 lint，日历和 HUD 不含仙侠标签', () => {
  const world = diner();
  assert.equal(world.clock?.unit, 'day');
  assert.equal(world.storylets?.length, 4);
  assert.deepEqual(world.endings.map(ending => ending.kind), ['ending', 'failure']);
  const lint = lintWorld(world);
  assert.equal(lint.errors, 0, lint.issues.filter(issue => issue.severity === 'error').map(issue => issue.message).join('\n'));
  assert.equal(formatCalendar(world, 7), '第8天');
  const revision = rev(world);
  const state = createAdventureState(revision, 'v0a-diner-view', NOW, {}, 7);
  const view = projectAdventure(state, revision);
  assert.equal(view.timeUnit, 'day');
  assert.equal(view.clock?.unit, 'day');
  assert.equal(view.clock?.label, '第1天');
  assert.deepEqual(view.resourceMeta?.map(meta => meta.label), ['钱', '心情', '熟客']);
  const visibleLabels = JSON.stringify({shared: resourceLabelsForWorld(world), calendar: view.clock?.label,
    hud: view.resourceMeta?.map(meta => meta.label)});
  assert.doesNotMatch(visibleLabels, /修为|灵石|心魔/);
});

test('V0a: 现代饭馆 20 seeds 模拟与路线预检无错误', async () => {
  const report = await simulateWorld(rev(diner()), {seeds: 20, routeSeeds: 5, maxSteps: 100, now: NOW});
  assert.equal(report.seeds, 20);
  assert.equal(report.timeUnit, 'day');
  assert.equal(report.deadEnds, 0);
  assert.deepEqual(report.endings.map(ending => ending.id), ['neighborhood_favorite', 'closed']);
  assert.deepEqual(report.routeCoverage?.issues.filter(issue => issue.severity === 'error'), []);
  assert.doesNotMatch(JSON.stringify(report.strategies), /修为|灵石|心魔|魔道|只修炼/);
});
