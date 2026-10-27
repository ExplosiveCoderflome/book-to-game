import assert from 'node:assert/strict';
import { test } from 'node:test';
import { annotatePlayability, assessPlayability, assertExpandedHonorsSkeleton, assertPlayableSkeleton } from '../src/modules/games/index.js';
import { playableSkeleton, playableStory, unreachableSkeleton } from './helpers/playable-story.js';

const evidence = [{chapterId: 'c1', paragraphId: 'p1'}];

test('skeleton playability accepts a deep branching graph and rejects shallow shells', () => {
  assert.doesNotThrow(() => assertPlayableSkeleton(playableSkeleton(evidence)));
  assert.equal(assessPlayability(playableStory(evidence), 'publish').valid, true);

  const shallow = playableSkeleton(evidence);
  shallow.scenes = [
    {id: 'a', title: 'A', text: '', origin: 'adapted', evidence: [], choices: [
      {id: 'x', label: '继续', targetSceneId: 'b'},
      {id: 'y', label: '随便看看', targetSceneId: 'c'},
    ]},
    {id: 'b', title: 'B', text: '', origin: 'adapted', evidence: [], choices: [], ending: '好'},
    {id: 'c', title: 'C', text: '', origin: 'adapted', evidence: [], choices: [], ending: '坏'},
  ];
  shallow.startSceneId = 'a';
  assert.throws(() => assertPlayableSkeleton(shallow), /可玩性|空洞|路径|非结局|走廊/);
});

test('unreachable skeleton fails topology before expand', () => {
  assert.throws(() => assertPlayableSkeleton(unreachableSkeleton(evidence)), /不可达|分支|开局/);
});

test('expand must not rewrite locked edges', () => {
  const skeleton = playableSkeleton(evidence);
  const expanded = playableStory(evidence);
  assert.doesNotThrow(() => assertExpandedHonorsSkeleton(skeleton, expanded));
  const mutated = structuredClone(expanded);
  mutated.scenes[0].choices[1].targetSceneId = 'hill';
  assert.throws(() => assertExpandedHonorsSkeleton(skeleton, mutated), /连线|改写/);
});

test('publish mode keeps short hand-authored graphs valid with warnings', () => {
  const short = {
    title: '岔路', mode: 'story' as const, premise: '决定', adaptationNotes: '手写',
    startSceneId: 'start',
    scenes: [
      {id: 'start', title: '岔路口', text: '前方有两条路。', origin: 'adapted' as const, evidence: [],
        choices: [
          {id: 'left', label: '走左边回家', targetSceneId: 'safe'},
          {id: 'right', label: '走右边冒险', targetSceneId: 'lost'},
        ]},
      {id: 'safe', title: '归来', text: '你回到村庄。', origin: 'adapted' as const, evidence: [], choices: [], ending: '平安归来'},
      {id: 'lost', title: '迷途', text: '你在森林迷路。', origin: 'adapted' as const, evidence: [], choices: [], ending: '迷失森林'},
    ],
  };
  const result = assessPlayability(short, 'publish');
  assert.equal(result.valid, true);
  assert.ok(result.warnings.some(text => text.includes('最短通关') || text.includes('路径') || text.includes('深度')));
});

test('skeleton rejects corridor graphs that lack independent ending routes', () => {
  const corridor = playableSkeleton(evidence);
  corridor.scenes = [
    {id: 'a', title: 'A', text: '', origin: 'adapted', evidence: [], choices: [
      {id: 'n1', label: '往前探路', targetSceneId: 'b'},
      {id: 'n2', label: '再确认一下方向后往前', targetSceneId: 'b'},
    ]},
    {id: 'b', title: 'B', text: '', origin: 'adapted', evidence: [], choices: [
      {id: 'n3', label: '继续深入河谷', targetSceneId: 'c'},
      {id: 'n4', label: '沿着河谷边缘前进', targetSceneId: 'c'},
    ]},
    {id: 'c', title: 'C', text: '', origin: 'adapted', evidence: [], choices: [
      {id: 'good', label: '接受招安回城', targetSceneId: 'e1', effects: [{type: 'variable.set', variable: 'trust', value: 1}]},
      {id: 'bad', label: '拒绝招安逃走', targetSceneId: 'e2'},
    ]},
    {id: 'e1', title: 'E1', text: '', origin: 'adapted', evidence: [], choices: [], ending: '回城'},
    {id: 'e2', title: 'E2', text: '', origin: 'adapted', evidence: [], choices: [], ending: '逃走'},
  ];
  corridor.startSceneId = 'a';
  corridor.variables = {trust: 0};
  // Opening fanout fails (both to b) — corridor / opening
  assert.throws(() => assertPlayableSkeleton(corridor), /开局|走廊|分叉|可玩性/);
});

test('annotatePlayability flags opening and empty-label scenes for the canvas', () => {
  const weak = {
    title: '弱图', mode: 'story' as const, premise: '测', adaptationNotes: '',
    startSceneId: 'a',
    scenes: [
      {id: 'a', title: 'A', text: 'x', origin: 'adapted' as const, evidence: [], choices: [
        {id: 'c1', label: '继续', targetSceneId: 'b'},
      ]},
      {id: 'b', title: 'B', text: 'y', origin: 'adapted' as const, evidence: [], choices: [
        {id: 'c2', label: '随便看看', targetSceneId: 'e1'},
        {id: 'c3', label: '下一步', targetSceneId: 'e2'},
      ]},
      {id: 'e1', title: 'E1', text: 'z', origin: 'adapted' as const, evidence: [], choices: [], ending: '甲'},
      {id: 'e2', title: 'E2', text: 'w', origin: 'adapted' as const, evidence: [], choices: [], ending: '乙'},
    ],
  };
  const ann = annotatePlayability(weak, 'skeleton');
  assert.equal(ann.result.valid, false);
  assert.ok(ann.flaggedSceneIds.includes('a'));
  assert.ok(ann.issues.some(i => i.code === 'OPENING_DENSITY' || i.code === 'EMPTY_LABELS' || i.code === 'TOO_FEW_SCENES' || i.code === 'TOO_SHORT'));
});

test('skeleton rejects opening that only points to one target', () => {
  const oneTarget = playableSkeleton(evidence);
  const dock = oneTarget.scenes.find(s => s.id === 'dock')!;
  dock.choices = [
    {id: 'a', label: '匆忙登上白船冒险前行', targetSceneId: 'channel', effects: [{type: 'variable.set', variable: 'trust', value: 0}]},
    {id: 'b', label: '犹豫片刻后仍登上白船', targetSceneId: 'channel'},
    {id: 'c', label: '改走商队黑船绕路', targetSceneId: 'camp'},
  ];
  // Still only 2 distinct targets from start — but wait, channel+camp = 2. Force both labels to channel only and keep camp via channel side path.
  dock.choices = [
    {id: 'a', label: '匆忙登上白船冒险前行', targetSceneId: 'channel', effects: [{type: 'variable.set', variable: 'trust', value: 0}]},
    {id: 'b', label: '犹豫片刻后仍登上白船', targetSceneId: 'channel'},
  ];
  // Keep camp reachable from channel so topology does not fail first
  const channel = oneTarget.scenes.find(s => s.id === 'channel')!;
  channel.choices = [
    {id: 'toCamp', label: '改道去商队营地', targetSceneId: 'camp', effects: [{type: 'variable.increment', variable: 'trust', value: 1}]},
    {id: 'push', label: '催促船夫强行穿雾', targetSceneId: 'reef'},
    {id: 'wait', label: '等待雾散并支付额外船资', targetSceneId: 'ferry', effects: [{type: 'variable.increment', variable: 'trust', value: 1}]},
  ];
  const play = assessPlayability(oneTarget, 'skeleton');
  assert.equal(play.valid, false);
  assert.ok(play.errors.some(text => /开局|分叉|真实/.test(text)), play.errors.join(';'));
});


test('publish soft-gates low average out-degree and low effects coverage', () => {
  // Non-ending degrees: a=2, b=1, c=1, d=2, f=1 → avg 1.4 < 1.5; effects 1/7 < 15%
  const sparse = {
    title: '低出度', mode: 'story' as const, premise: '测', adaptationNotes: '',
    startSceneId: 'a',
    variables: { trust: 0 },
    scenes: [
      {id: 'a', title: 'A', text: 'x', origin: 'adapted' as const, evidence: [], choices: [
        {id: 'toB', label: '去仓库查货', targetSceneId: 'b'},
        {id: 'toC', label: '去营地谈价', targetSceneId: 'c', effects: [{type: 'variable.set' as const, variable: 'trust', value: 1}]},
      ]},
      {id: 'b', title: 'B', text: 'y', origin: 'adapted' as const, evidence: [], choices: [
        {id: 'toD', label: '继续往渡口', targetSceneId: 'd'},
      ]},
      {id: 'c', title: 'C', text: 'z', origin: 'adapted' as const, evidence: [], choices: [
        {id: 'toF', label: '绕路中继', targetSceneId: 'f'},
      ]},
      {id: 'f', title: 'F', text: '中继', origin: 'adapted' as const, evidence: [], choices: [
        {id: 'toD2', label: '赶到渡口', targetSceneId: 'd'},
      ]},
      {id: 'd', title: 'D', text: 'w', origin: 'adapted' as const, evidence: [], choices: [
        {id: 'good', label: '付钱回家', targetSceneId: 'e1'},
        {id: 'bad', label: '硬闯逃走', targetSceneId: 'e2'},
      ]},
      {id: 'e1', title: 'E1', text: 'ok', origin: 'adapted' as const, evidence: [], choices: [], ending: '平安'},
      {id: 'e2', title: 'E2', text: 'bad', origin: 'adapted' as const, evidence: [], choices: [], ending: '逃走'},
    ],
  };
  const publish = assessPlayability(sparse, 'publish');
  assert.equal(publish.valid, true);
  assert.ok(publish.warnings.some(w => /平均出度/.test(w)), publish.warnings.join(';'));
  assert.ok(publish.warnings.some(w => /带状态后果的选项偏少|effects/.test(w)), publish.warnings.join(';'));
  const ann = annotatePlayability(sparse, 'publish');
  assert.ok(ann.issues.some(i => i.code === 'LOW_OUT_DEGREE'));
  assert.ok(ann.issues.some(i => i.code === 'LOW_EFFECTS'));
  assert.ok(ann.flaggedSceneIds.includes('b') || ann.flaggedSceneIds.includes('c'));
});
