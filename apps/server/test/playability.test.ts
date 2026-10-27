import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assessPlayability, assertExpandedHonorsSkeleton, assertPlayableSkeleton } from '../src/modules/games/index.js';
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
  assert.throws(() => assertPlayableSkeleton(shallow), /可玩性|空洞|路径|非结局/);
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
  assert.ok(result.warnings.some(text => text.includes('最短通关') || text.includes('路径')));
});
