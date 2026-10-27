import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  analyzeReachability,
  annotatePlayability,
  assessPlayability,
  type GameContent,
} from '@novel-game/contracts';
import { validateGame } from '../src/modules/games/domain/validate-game.js';
import { playableStory } from './helpers/playable-story.js';

const evidence = [{ chapterId: 'c1', paragraphId: 'p1' }];

const source = {
  id: 'src', title: 's', filename: 's.txt', encoding: 'utf8', chapterCount: 1,
  charCount: 10, createdAt: '2026-10-10T00:00:00Z',
  chapters: [{ id: 'c1', index: 0, title: '一', paragraphs: [{ id: 'p1', index: 0, text: '文' }] }],
};

/** Trust-gated branches: help raises trust; good ending requires trust≥1; betrayal stays at 0. */
function trustBranchStory(): GameContent {
  return {
    title: '信任岔路', mode: 'story', premise: '是否取得信任', adaptationNotes: '测试条件锁路',
    startSceneId: 'dock', variables: { trust: 0 },
    scenes: [
      {
        id: 'dock', title: '渡口', text: '船夫打量着你。', origin: 'source', evidence,
        choices: [
          {
            id: 'help', label: '帮船夫修好缆绳换取信任', targetSceneId: 'dock',
            conditions: [{ type: 'variable.equals', variable: 'trust', value: 0 }],
            effects: [{ type: 'variable.increment', variable: 'trust', value: 1 }],
          },
          {
            id: 'betray', label: '强行夺船逃走', targetSceneId: 'reef',
            effects: [{ type: 'variable.set', variable: 'trust', value: 0 }],
          },
          {
            id: 'ask', label: '出示修好缆绳后获得的通行令', targetSceneId: 'ferry',
            conditions: [{ type: 'variable.gte', variable: 'trust', value: 1 }],
          },
        ],
      },
      {
        id: 'reef', title: '暗礁', text: '船底擦过石头。', origin: 'adapted', evidence: [],
        choices: [
          { id: 'crash', label: '硬闯暗礁', targetSceneId: 'bad' },
          { id: 'turn', label: '回头求情', targetSceneId: 'dock' },
        ],
      },
      {
        id: 'ferry', title: '摆渡口', text: '雾散后的渡口更安静。', origin: 'adapted', evidence: [],
        choices: [
          { id: 'home', label: '付钱直达城中', targetSceneId: 'good' },
          {
            id: 'bribe', label: '再加一笔船资', targetSceneId: 'good',
            effects: [{ type: 'variable.increment', variable: 'trust', value: 1 }],
          },
        ],
      },
      { id: 'good', title: '平安', text: '抵达。', origin: 'adapted', evidence: [], choices: [], ending: '信任换来的平安' },
      { id: 'bad', title: '沉没', text: '船裂了。', origin: 'adapted', evidence: [], choices: [], ending: '夺船沉没' },
    ],
  };
}

/** Good ending requires trust≥1 but nothing ever raises trust — condition-blocked. */
function lockedGoodEnding(): GameContent {
  return {
    title: '锁死好结局', mode: 'story', premise: '测', adaptationNotes: '测',
    startSceneId: 'start', variables: { trust: 0 },
    scenes: [
      {
        id: 'start', title: '岔路', text: '前方。', origin: 'adapted', evidence: [],
        choices: [
          { id: 'left', label: '走左边去营地', targetSceneId: 'camp' },
          { id: 'right', label: '走右边去崖边', targetSceneId: 'cliff' },
        ],
      },
      {
        id: 'camp', title: '营地', text: '篝火。', origin: 'adapted', evidence: [],
        choices: [
          {
            id: 'gate', label: '凭信物进城（需要信任）', targetSceneId: 'good',
            conditions: [{ type: 'variable.gte', variable: 'trust', value: 1 }],
          },
          { id: 'flee', label: '连夜逃走', targetSceneId: 'bad' },
        ],
      },
      {
        id: 'cliff', title: '崖边', text: '风很大。', origin: 'adapted', evidence: [],
        choices: [
          { id: 'jump', label: '冒险跳崖抄近路', targetSceneId: 'bad' },
          { id: 'back', label: '退回营地', targetSceneId: 'camp' },
        ],
      },
      { id: 'good', title: '好', text: '进城。', origin: 'adapted', evidence: [], choices: [], ending: '信物进城' },
      { id: 'bad', title: '坏', text: '失败。', origin: 'adapted', evidence: [], choices: [], ending: '连夜逃走' },
    ],
  };
}

test('trust-branch: both endings reachable under legal sequences', () => {
  const story = trustBranchStory();
  const reach = analyzeReachability(story);
  assert.equal(reach.truncated, false);
  assert.ok(reach.stateEndingIds.includes('good'));
  assert.ok(reach.stateEndingIds.includes('bad'));
  assert.equal(reach.conditionBlockedEndingIds.length, 0);
  assert.ok(reach.stateEndingTexts.length >= 2);
  // ask edge unlocks after help; betray path does not need it
  assert.ok(!reach.deadConditionalEdgeKeys.includes('dock:ask'));
  assert.ok(!reach.deadConditionalEdgeKeys.includes('dock:help'));
  const play = assessPlayability(story, 'publish');
  assert.equal(play.valid, true);
  assert.ok(!play.warnings.some(w => w.includes('忽略变量条件')));
  assert.ok(!play.errors.some(e => e.includes('变量可达结局不足')));
});

test('condition-blocked ending flagged; few state endings soft-gate on publish', () => {
  const story = lockedGoodEnding();
  const reach = analyzeReachability(story);
  assert.deepEqual(reach.conditionBlockedEndingIds.sort(), ['good']);
  assert.deepEqual(reach.stateEndingIds, ['bad']);
  assert.ok(reach.deadConditionalEdgeKeys.includes('camp:gate'));
  assert.equal(reach.stateEndingTexts.length, 1);

  const ann = annotatePlayability(story, 'publish');
  assert.ok(ann.issues.some(i => i.code === 'CONDITION_BLOCKED_ENDING'));
  assert.ok(ann.issues.some(i => i.code === 'FEW_STATE_ENDINGS' && i.severity === 'warning'));
  assert.ok(ann.flaggedSceneIds.includes('good'));
  assert.ok(ann.flaggedEdgeKeys.includes('camp:gate'));
  // D3 soft-gate: publish warns instead of hard-rejecting on playability alone
  assert.equal(ann.result.valid, true);

  const skel = annotatePlayability(story, 'skeleton');
  assert.ok(skel.issues.some(i => i.code === 'FEW_STATE_ENDINGS' && i.severity === 'error'));
  assert.equal(skel.result.valid, false);

  const validated = validateGame(story, source);
  assert.equal(validated.valid, true);
  assert.ok(validated.warnings.some(w => /变量条件.*结局不足|可达结局不足/.test(w)), validated.warnings.join(';'));
  assert.ok(validated.warnings.some(w => w.includes('good') && w.includes('拓扑可达')));
});

test('playableStory fixture still proves dual endings with trust conditions', () => {
  const story = playableStory(evidence);
  const reach = analyzeReachability(story);
  assert.ok(reach.stateEndingIds.includes('city'));
  assert.ok(reach.stateEndingIds.includes('hill'));
  assert.equal(reach.conditionBlockedEndingIds.length, 0);
  const play = assessPlayability(story, 'skeleton');
  assert.equal(play.valid, true, play.errors.join(';'));
});

test('graphs without conditions skip condition issues and match topology', () => {
  const story: GameContent = {
    title: '无变量', mode: 'story', premise: '测', adaptationNotes: '',
    startSceneId: 'a',
    scenes: [
      { id: 'a', title: 'A', text: 'x', origin: 'adapted', evidence: [], choices: [
        { id: 'l', label: '左边回家', targetSceneId: 'b' },
        { id: 'r', label: '右边冒险', targetSceneId: 'c' },
      ]},
      { id: 'b', title: 'B', text: 'y', origin: 'adapted', evidence: [], choices: [], ending: '回家' },
      { id: 'c', title: 'C', text: 'z', origin: 'adapted', evidence: [], choices: [], ending: '冒险' },
    ],
  };
  const reach = analyzeReachability(story);
  assert.deepEqual(reach.stateEndingIds.sort(), ['b', 'c']);
  assert.equal(reach.conditionBlockedEndingIds.length, 0);
  const ann = annotatePlayability(story, 'publish');
  assert.ok(!ann.issues.some(i => i.code.startsWith('CONDITION') || i.code === 'FEW_STATE_ENDINGS' || i.code === 'DEAD_CONDITIONAL_EDGE'));
});
