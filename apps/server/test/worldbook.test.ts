import assert from 'node:assert/strict';
import { test } from 'node:test';
import {gameContentSchema, validateWorldbookContent, type GameContent} from '@novel-game/contracts';
import {worldbookBlockReason, worldbookIncrementCap} from '@novel-game/rules';
import { validateGame } from '../src/modules/games/domain/validate-game.js';
import { applyChoiceEffects, choiceAllowed } from '../src/modules/sessions/domain/story-variables.js';
import { projectSession } from '../src/modules/sessions/domain/project-session.js';
import type { SessionState } from '../src/modules/sessions/domain/session-state.js';
import type { SourceDocument } from '@novel-game/contracts';

const source: SourceDocument = {
  id: 'src', title: 't', filename: 't.txt', encoding: 'utf-8',
  chapterCount: 1, charCount: 10, createdAt: '2020-01-01T00:00:00.000Z',
  chapters: [{ id: 'ch1', index: 0, title: '一', paragraphs: [{ id: 'p1', index: 0, text: '雾。' }] }],
};

function baseGame(over: Partial<GameContent> = {}): GameContent {
  return {
    title: '世界书试玩',
    mode: 'story',
    premise: '渡口一夜',
    adaptationNotes: 'wb',
    variables: { qi: 0, fame: 0 },
    startSceneId: 'dock',
    scenes: [
      {
        id: 'dock', title: '渡口', text: '雾起。', origin: 'adapted', evidence: [],
        choices: [
          { id: 'train', label: '闭关修炼', targetSceneId: 'yard', tags: ['upgrade'], effects: [{ type: 'variable.increment', variable: 'qi', value: 5 }] },
          { id: 'fight', label: '拔刀相向', targetSceneId: 'duel', tags: ['combat'] },
          { id: 'talk', label: '与船夫闲聊', targetSceneId: 'yard' },
        ],
      },
      { id: 'yard', title: '空坪', text: '露水未干。', origin: 'adapted', evidence: [], choices: [{ id: 'back', label: '回渡口', targetSceneId: 'end_a' }] },
      { id: 'duel', title: '决斗', text: '刀光一闪。', origin: 'adapted', evidence: [], choices: [], ending: '血溅渡口' },
      { id: 'end_a', title: '平安夜', text: '船靠岸。', origin: 'adapted', evidence: [], choices: [], ending: '安然抵达对岸' },
    ],
    worldbook: {
      entries: [
        {
          id: 'power-1', title: '战力门槛', keys: ['战力'], content: '未通脉不可拔刀。', kind: 'power',
          scope: { type: 'global' },
          constraints: [
            { type: 'gate_tagged_choices', tags: ['combat'], variable: 'qi', min: 3, message: '战力不足，无法拔刀。' },
            { type: 'cap_variable_increment', variable: 'qi', maxDelta: 1 },
          ],
        },
        {
          id: 'rule-1', title: '禁令', keys: ['禁'], content: '渡口不许私斗。', kind: 'rule',
          scope: { type: 'scenes', sceneIds: ['dock'] },
          constraints: [
            { type: 'forbid_choice_tags', tags: ['combat'], message: '渡口禁武，此行不可。' },
          ],
        },
      ],
    },
    ...over,
  };
}

test('gameContentSchema accepts worldbook + choice tags', () => {
  const parsed = gameContentSchema.safeParse(baseGame());
  assert.equal(parsed.success, true, JSON.stringify(parsed.error?.format()));
});

test('validateWorldbookContent catches missing variables and bad range', () => {
  const bad = validateWorldbookContent({
    worldbook: {
      entries: [{
        id: 'x', title: '坏门控', keys: [], content: '', kind: 'power', scope: { type: 'global' },
        constraints: [{ type: 'gate_tagged_choices', tags: ['combat'], variable: 'missing', min: 5, max: 1, message: 'x' }],
      }],
    },
    sceneIds: new Set(['dock']),
    variables: { qi: 0 },
    choiceTags: new Set(['combat']),
  });
  assert.ok(bad.errors.some(e => e.includes('不存在的变量')));
  assert.ok(bad.errors.some(e => e.includes('min > max')));
});

test('validateGame surfaces worldbook errors in zh-CN', () => {
  const game = baseGame({
    worldbook: {
      entries: [{
        id: 'bad', title: '幽灵场景', keys: [], content: '', kind: 'rule',
        scope: { type: 'scenes', sceneIds: ['nope'] },
        constraints: [],
      }],
    },
  });
  const result = validateGame(game, source);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('不存在的场景')));
});

test('forbid_choice_tags blocks combat at dock even with enough qi', () => {
  const game = baseGame();
  const fight = game.scenes[0]!.choices.find(c => c.id === 'fight')!;
  const reason = worldbookBlockReason(fight, 'dock', { qi: 99 }, game.worldbook);
  assert.equal(reason, '渡口禁武，此行不可。');
  const allowed = choiceAllowed(fight, { qi: 99, fame: 0 }, 'dock', game.worldbook);
  assert.equal(allowed.ok, false);
});

test('gate_tagged_choices applies when forbid does not (other scene)', () => {
  // Remove forbid by using empty worldbook with only gate
  const game = baseGame({
    worldbook: {
      entries: [{
        id: 'power-1', title: '战力门槛', keys: [], content: '', kind: 'power', scope: { type: 'global' },
        constraints: [
          { type: 'gate_tagged_choices', tags: ['combat'], variable: 'qi', min: 3, message: '战力不足，无法拔刀。' },
        ],
      }],
    },
  });
  const fight = game.scenes[0]!.choices.find(c => c.id === 'fight')!;
  assert.equal(choiceAllowed(fight, { qi: 0, fame: 0 }, 'dock', game.worldbook).ok, false);
  assert.equal(choiceAllowed(fight, { qi: 3, fame: 0 }, 'dock', game.worldbook).ok, true);
});

test('cap_variable_increment clamps upgrade effect', () => {
  const game = baseGame();
  const train = game.scenes[0]!.choices.find(c => c.id === 'train')!;
  assert.equal(worldbookIncrementCap('qi', game.worldbook), 1);
  const next = applyChoiceEffects(train, { qi: 0, fame: 0 }, game.worldbook);
  assert.equal(next.qi, 1); // capped from +5
});

test('projectSession hides worldbook-blocked choices', () => {
  const game = baseGame();
  const revision = {
    id: 'rev', draftId: 'd', sourceId: 'src', version: 1, content: game,
    createdAt: '2020-01-01T00:00:00.000Z',
  };
  const state: SessionState = {
    id: 's1', gameRevisionId: 'rev', sceneId: 'dock', turn: 0, ended: false,
    variables: { qi: 0, fame: 0 },
    history: [], createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2020-01-01T00:00:00.000Z',
  };
  const view = projectSession(state, revision);
  const ids = view.scene.choices.map(c => c.id);
  assert.deepEqual(ids.sort(), ['talk', 'train'].sort()); // fight forbidden by dock rule
});

test('require_min_variable and require_max_variable gate tagged choices', () => {
  const game = baseGame({
    variables: { qi: 2, fame: 5, karma: 4 },
    worldbook: {
      entries: [{
        id: 'p', title: '战力与业力', keys: [], content: '', kind: 'power', scope: { type: 'global' },
        constraints: [
          { type: 'require_min_variable', tags: ['combat'], variable: 'qi', min: 3, message: '战力未达门槛。' },
          { type: 'require_max_variable', tags: ['holy'], variable: 'karma', max: 2, message: '业力过高。' },
        ],
      }],
    },
    scenes: [
      {
        id: 'dock', title: '渡口', text: '雾起。', origin: 'adapted', evidence: [],
        choices: [
          { id: 'fight', label: '拔刀', targetSceneId: 'duel', tags: ['combat'] },
          { id: 'pray', label: '祈福', targetSceneId: 'yard', tags: ['holy'] },
          { id: 'talk', label: '闲聊', targetSceneId: 'yard' },
        ],
      },
      { id: 'yard', title: '空坪', text: '露。', origin: 'adapted', evidence: [], choices: [] },
      { id: 'duel', title: '决斗', text: '刀。', origin: 'adapted', evidence: [], choices: [], ending: '终' },
    ],
  });
  const fight = game.scenes[0]!.choices.find(c => c.id === 'fight')!;
  const pray = game.scenes[0]!.choices.find(c => c.id === 'pray')!;
  assert.equal(choiceAllowed(fight, { qi: 2, fame: 5, karma: 4 }, 'dock', game.worldbook).ok, false);
  assert.equal(choiceAllowed(fight, { qi: 3, fame: 5, karma: 4 }, 'dock', game.worldbook).ok, true);
  assert.equal(choiceAllowed(pray, { qi: 3, fame: 5, karma: 4 }, 'dock', game.worldbook).ok, false);
  assert.equal(choiceAllowed(pray, { qi: 3, fame: 5, karma: 1 }, 'dock', game.worldbook).ok, true);
});

test('spend_on_choice blocks when broke and decrements on act effects', () => {
  const game = baseGame({
    variables: { qi: 2, fame: 0, mana: 1 },
    worldbook: {
      entries: [{
        id: 'p', title: '施法耗蓝', keys: [], content: '', kind: 'power', scope: { type: 'global' },
        constraints: [
          { type: 'spend_on_choice', tags: ['cast'], variable: 'mana', amount: 2, message: '灵力不足。' },
        ],
      }],
    },
    scenes: [
      {
        id: 'dock', title: '渡口', text: '雾。', origin: 'adapted', evidence: [],
        choices: [
          { id: 'bolt', label: '雷咒', targetSceneId: 'yard', tags: ['cast'] },
          { id: 'talk', label: '闲聊', targetSceneId: 'yard' },
        ],
      },
      { id: 'yard', title: '空坪', text: '露。', origin: 'adapted', evidence: [], choices: [] },
    ],
  });
  const bolt = game.scenes[0]!.choices.find(c => c.id === 'bolt')!;
  assert.equal(choiceAllowed(bolt, { qi: 2, fame: 0, mana: 1 }, 'dock', game.worldbook).ok, false);
  assert.equal(choiceAllowed(bolt, { qi: 2, fame: 0, mana: 2 }, 'dock', game.worldbook).ok, true);
  const next = applyChoiceEffects(bolt, { qi: 2, fame: 0, mana: 5 }, game.worldbook, 'dock');
  assert.equal(next.mana, 3);
});

test('one_path_lock hides forbid tags after whenTags taken', () => {
  const game = baseGame({
    worldbook: {
      entries: [{
        id: 'r', title: '正邪不两立', keys: [], content: '', kind: 'rule', scope: { type: 'global' },
        constraints: [
          { type: 'one_path_lock', whenTags: ['path_evil'], forbidTags: ['path_holy'], message: '已入邪途。' },
        ],
      }],
    },
    scenes: [
      {
        id: 'dock', title: '渡口', text: '雾。', origin: 'adapted', evidence: [],
        choices: [
          { id: 'evil', label: '投靠黑市', targetSceneId: 'yard', tags: ['path_evil'] },
          { id: 'holy', label: '拜庙祈福', targetSceneId: 'yard', tags: ['path_holy'] },
        ],
      },
      { id: 'yard', title: '空坪', text: '露。', origin: 'adapted', evidence: [],
        choices: [
          { id: 'holy2', label: '再拜', targetSceneId: 'end_a', tags: ['path_holy'] },
          { id: 'rest', label: '歇息', targetSceneId: 'end_a' },
        ],
      },
      { id: 'end_a', title: '终', text: '完。', origin: 'adapted', evidence: [], choices: [], ending: '完' },
    ],
  });
  const holy = game.scenes[0]!.choices.find(c => c.id === 'holy')!;
  assert.equal(choiceAllowed(holy, { qi: 0, fame: 0 }, 'dock', game.worldbook, []).ok, true);
  assert.equal(choiceAllowed(holy, { qi: 0, fame: 0 }, 'dock', game.worldbook, ['path_evil']).ok, false);
  const holy2 = game.scenes[1]!.choices.find(c => c.id === 'holy2')!;
  assert.equal(worldbookBlockReason(holy2, 'yard', { qi: 0 }, game.worldbook, ['path_evil']), '已入邪途。');
});

test('upgrade_ladder unlocks tag sets by variable thresholds', () => {
  const game = baseGame({
    variables: { qi: 2, fame: 0 },
    worldbook: {
      entries: [{
        id: 'u', title: '剑诀阶梯', keys: [], content: '', kind: 'upgrade', scope: { type: 'global' },
        constraints: [{
          type: 'upgrade_ladder',
          variable: 'qi',
          steps: [
            { threshold: 3, tags: ['skill_basic'] },
            { threshold: 8, tags: ['skill_advanced'] },
          ],
          message: '修为未至，招式尚未解锁。',
        }],
      }],
    },
    scenes: [
      {
        id: 'dock', title: '渡口', text: '雾。', origin: 'adapted', evidence: [],
        choices: [
          { id: 'basic', label: '基础剑式', targetSceneId: 'yard', tags: ['skill_basic'] },
          { id: 'adv', label: '进阶剑式', targetSceneId: 'yard', tags: ['skill_advanced'] },
          { id: 'talk', label: '闲聊', targetSceneId: 'yard' },
        ],
      },
      { id: 'yard', title: '空坪', text: '露。', origin: 'adapted', evidence: [], choices: [] },
    ],
  });
  const basic = game.scenes[0]!.choices.find(c => c.id === 'basic')!;
  const adv = game.scenes[0]!.choices.find(c => c.id === 'adv')!;
  assert.equal(choiceAllowed(basic, { qi: 2, fame: 0 }, 'dock', game.worldbook).ok, false);
  assert.equal(choiceAllowed(basic, { qi: 3, fame: 0 }, 'dock', game.worldbook).ok, true);
  assert.equal(choiceAllowed(adv, { qi: 3, fame: 0 }, 'dock', game.worldbook).ok, false);
  assert.equal(choiceAllowed(adv, { qi: 8, fame: 0 }, 'dock', game.worldbook).ok, true);
});

test('validateWorldbookContent catches spend and ladder variable errors', () => {
  const bad = validateWorldbookContent({
    worldbook: {
      entries: [{
        id: 'x', title: '坏消耗', keys: [], content: '', kind: 'power', scope: { type: 'global' },
        constraints: [
          { type: 'spend_on_choice', tags: ['cast'], variable: 'mana', amount: 1, message: 'x' },
          { type: 'upgrade_ladder', variable: 'qi', steps: [{ threshold: 1, tags: ['a'] }], message: 'y' },
        ],
      }],
    },
    sceneIds: new Set(['dock']),
    variables: { qi: 0 },
    choiceTags: new Set(['cast', 'a']),
  });
  assert.ok(bad.errors.some(e => e.includes('mana')));
});

test('advanceSession applies spend and records takenTags for path lock', async () => {
  const { advanceSession } = await import('../src/modules/sessions/domain/advance-session.js');
  const game = baseGame({
    variables: { qi: 0, fame: 0, mana: 3 },
    worldbook: {
      entries: [
        {
          id: 'p', title: '耗蓝', keys: [], content: '', kind: 'power', scope: { type: 'global' },
          constraints: [
            { type: 'spend_on_choice', tags: ['cast'], variable: 'mana', amount: 2, message: '灵力不足。' },
          ],
        },
        {
          id: 'r', title: '正邪', keys: [], content: '', kind: 'rule', scope: { type: 'global' },
          constraints: [
            { type: 'one_path_lock', whenTags: ['cast'], forbidTags: ['holy'], message: '术士不得入庙。' },
          ],
        },
      ],
    },
    scenes: [
      {
        id: 'dock', title: '渡口', text: '雾。', origin: 'adapted', evidence: [],
        choices: [
          { id: 'bolt', label: '雷咒', targetSceneId: 'yard', tags: ['cast'] },
          { id: 'pray', label: '祈福', targetSceneId: 'yard', tags: ['holy'] },
        ],
      },
      {
        id: 'yard', title: '空坪', text: '露。', origin: 'adapted', evidence: [],
        choices: [
          { id: 'pray2', label: '再祈', targetSceneId: 'end_a', tags: ['holy'] },
          { id: 'rest', label: '歇息', targetSceneId: 'end_a' },
        ],
      },
      { id: 'end_a', title: '终', text: '完。', origin: 'adapted', evidence: [], choices: [], ending: '完' },
    ],
  });
  const revision = {
    id: 'rev', draftId: 'd', sourceId: 'src', version: 1, content: game,
    createdAt: '2020-01-01T00:00:00.000Z',
  };
  const state = {
    id: 's1', gameRevisionId: 'rev', sceneId: 'dock', turn: 0, ended: false,
    variables: { qi: 0, fame: 0, mana: 3 },
    takenTags: [] as string[],
    history: [], createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2020-01-01T00:00:00.000Z',
  };
  const next = advanceSession(state, { choiceId: 'bolt', expectedTurn: 0, requestId: '00000000-0000-4000-8000-000000000001' }, revision, '2020-01-01T00:00:01.000Z');
  assert.equal(next.variables?.mana, 1);
  assert.deepEqual(next.takenTags, ['cast']);
  assert.equal(next.sceneId, 'yard');
  const blocked = choiceAllowed(
    game.scenes[1]!.choices.find(c => c.id === 'pray2')!,
    next.variables!,
    'yard',
    game.worldbook,
    next.takenTags,
  );
  assert.equal(blocked.ok, false);
});
