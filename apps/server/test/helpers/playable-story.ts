import type { BranchSkeleton, GameContent } from '@novel-game/contracts';

/** Depth ≥3, true branch, dual endings, some effects — passes skeleton playability. */
export function playableStory(evidence: {chapterId: string; paragraphId: string}[]): GameContent {
  return {
    title: '雾渡', mode: 'story', premise: '决定航向', adaptationNotes: '仅改编渡口片段',
    startSceneId: 'dock', variables: {trust: 0},
    scenes: [
      {id: 'dock', title: '渡口', text: '你登上哪条船？船夫看着你。', origin: 'source', evidence,
        choices: [
          {id: 'help', label: '帮船夫修好缆绳以换取信任', targetSceneId: 'dock',
            conditions: [{type: 'variable.equals', variable: 'trust', value: 0}],
            effects: [{type: 'variable.increment', variable: 'trust', value: 1}]},
          {id: 'white', label: '冒险登上白船，可能更快却更险', targetSceneId: 'channel',
            effects: [{type: 'variable.set', variable: 'trust', value: 0}]},
          {id: 'black', label: '跟随商队走黑船绕路', targetSceneId: 'camp'},
        ]},
      {id: 'channel', title: '航道', text: '白船驶入薄雾。', origin: 'adapted', evidence: [],
        choices: [
          {id: 'push', label: '催促船夫强行穿雾', targetSceneId: 'reef'},
          {id: 'wait', label: '等待雾散并支付额外船资', targetSceneId: 'ferry',
            effects: [{type: 'variable.increment', variable: 'trust', value: 1}]},
        ]},
      {id: 'camp', title: '商队营地', text: '篝火旁有人讨价还价。', origin: 'adapted', evidence: [],
        choices: [
          {id: 'deal', label: '答应下次护送货物换船位', targetSceneId: 'ferry',
            effects: [{type: 'variable.set', variable: 'trust', value: 1}]},
          {id: 'refuse', label: '拒绝人情，改走危险小径', targetSceneId: 'reef'},
        ]},
      {id: 'reef', title: '暗礁', text: '船底擦过石头。', origin: 'adapted', evidence: [],
        choices: [
          {id: 'rush', label: '硬闯暗礁驶向城中', targetSceneId: 'city'},
          {id: 'detour', label: '绕路去山里避险', targetSceneId: 'hill'},
        ]},
      {id: 'ferry', title: '摆渡口', text: '雾散后的渡口更安静。', origin: 'adapted', evidence: [],
        choices: [
          {id: 'home', label: '付钱直达城中', targetSceneId: 'city'},
          {id: 'scenic', label: '多走一程去山里', targetSceneId: 'hill',
            effects: [{type: 'variable.increment', variable: 'trust', value: 1}]},
        ]},
      {id: 'city', title: '城中', text: '抵达城中。', origin: 'adapted', evidence: [], choices: [], ending: '匆忙回家'},
      {id: 'hill', title: '山里', text: '抵达山里。', origin: 'adapted', evidence: [], choices: [], ending: '代价换来的平安'},
    ],
  };
}

export function playableSkeleton(evidence: {chapterId: string; paragraphId: string}[]): BranchSkeleton {
  const game = playableStory(evidence);
  return {
    ...game,
    scenes: game.scenes.map(scene => ({...scene, text: scene.ending ? scene.text : ''})),
  };
}

/** Missing opening density + unreachable camp — fails skeleton gate. */
export function unreachableSkeleton(evidence: {chapterId: string; paragraphId: string}[]): BranchSkeleton {
  const skeleton = playableSkeleton(evidence);
  const dock = skeleton.scenes.find(scene => scene.id === 'dock')!;
  dock.choices = [{id: 'white', label: '只上一艘白船', targetSceneId: 'channel'}];
  return skeleton;
}
