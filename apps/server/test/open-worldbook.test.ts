import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  worldContentSchema,
  validateWorldbookContent,
  type WorldContent,
} from '@novel-game/contracts';
import { validateWorld } from '../src/modules/worlds/domain/validate-world.js';
import { source, content as baseContent } from './helpers/open-fixture.js';
import { advanceAdventure } from '@novel-game/play-runtime';
import { projectAdventure } from '@novel-game/play-runtime';
import type { AdventureState } from '@novel-game/play-runtime';
import type { WorldRevision } from '@novel-game/contracts';

const adapted = { origin: 'adapted' as const, evidence: [] };

function powerWorld(): WorldContent {
  const w = baseContent();
  return {
    ...w,
    title: '开放世界书战力',
    resources: { qi: 0, mana: 2 },
    actions: [
      ...w.actions.map(a => a.id === 'ask' ? { ...a, tags: ['cast'] } : a),
      {
        id: 'meditate', label: '吐纳', description: '涨气', locationId: 'dock',
        availableWhen: [], requires: [], blockedReason: '不能吐纳', risk: '', timeCost: 1, once: false,
        effects: [{ kind: 'resource', resourceId: 'qi', delta: 5 }],
        text: '你感到气机微动。', tags: ['upgrade'], ...adapted,
      },
      {
        id: 'bolt', label: '雷咒', description: '耗蓝', locationId: 'dock',
        availableWhen: [], requires: [], blockedReason: '不能施法', risk: '', timeCost: 1, once: false,
        effects: [{ kind: 'set', factId: 'noticed', value: true }],
        text: '雷光一闪。', tags: ['cast'], ...adapted,
      },
      {
        id: 'evil', label: '黑市接头', description: '', locationId: 'dock',
        availableWhen: [], requires: [], blockedReason: '不能接头', risk: '', timeCost: 1, once: true,
        effects: [{ kind: 'set', factId: 'noticed', value: true }],
        text: '你沾上了黑市气味。', tags: ['path_evil'], ...adapted,
      },
      {
        id: 'holy', label: '拜庙', description: '', locationId: 'dock',
        availableWhen: [], requires: [], blockedReason: '不能拜', risk: '', timeCost: 1, once: false,
        effects: [{ kind: 'set', factId: 'noticed', value: true }],
        text: '香火一缕。', tags: ['path_holy'], ...adapted,
      },
      {
        id: 'sword', label: '基础剑式', description: '', locationId: 'dock',
        availableWhen: [], requires: [], blockedReason: '未解锁', risk: '', timeCost: 1, once: false,
        effects: [{ kind: 'set', factId: 'noticed', value: true }],
        text: '剑光平平。', tags: ['skill_basic'], ...adapted,
      },
    ],
    worldbook: {
      entries: [
        {
          id: 'power-1', title: '战力与消耗', keys: ['战力'], content: '气满三成开剑式；施法耗蓝；吐纳有上限。',
          kind: 'power', scope: { type: 'global' },
          constraints: [
            { type: 'spend_on_choice', tags: ['cast'], variable: 'mana', amount: 2, message: '灵力不足，无法施展。' },
            { type: 'cap_variable_increment', variable: 'qi', maxDelta: 1 },
            {
              type: 'upgrade_ladder', variable: 'qi',
              steps: [{ threshold: 3, tags: ['skill_basic'] }],
              message: '修为未至，招式尚未解锁。',
            },
          ],
        },
        {
          id: 'rule-1', title: '正邪', keys: [], content: '', kind: 'rule',
          scope: { type: 'locations', locationIds: ['dock'] },
          constraints: [
            { type: 'one_path_lock', whenTags: ['path_evil'], forbidTags: ['path_holy'], message: '已入邪途。' },
          ],
        },
      ],
    },
  };
}

function freshState(world: WorldContent, revisionId = 'rev'): AdventureState {
  const now = '2020-01-01T00:00:00.000Z';
  return {
    schemaVersion: 1, id: 'a1', worldRevisionId: revisionId, turn: 0, elapsed: 0,
    locationId: world.initialLocationId,
    facts: Object.fromEntries(world.facts.map(f => [f.id, f.initialValue])),
    knownFactIds: world.facts.filter(f => f.playerKnown).map(f => f.id),
    resources: { ...(world.resources ?? {}) },
    takenTags: [],
    npcs: Object.fromEntries(world.npcs.map(n => [n.id, { locationId: n.initialLocationId, knownFactIds: [...n.knownFactIds] }])),
    performedActionIds: [], triggeredEventIds: [], history: [], createdAt: now, updatedAt: now,
  };
}

function revisionOf(world: WorldContent): WorldRevision {
  return {
    id: 'rev', draftId: 'd', sourceId: 'source', version: 1, content: world,
    createdAt: '2020-01-01T00:00:00.000Z',
  };
}

test('worldContentSchema accepts resources + action tags + worldbook', () => {
  const parsed = worldContentSchema.safeParse(powerWorld());
  assert.equal(parsed.success, true, JSON.stringify(parsed.error?.format()));
});

test('validateWorld surfaces missing open resources in zh-CN', () => {
  const world = powerWorld();
  world.worldbook = {
    entries: [{
      id: 'bad', title: '坏消耗', keys: [], content: '', kind: 'power', scope: { type: 'global' },
      constraints: [{ type: 'spend_on_choice', tags: ['cast'], variable: 'nope', amount: 1, message: 'x' }],
    }],
  };
  const result = validateWorld(world, source);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('资源') && e.includes('nope')));
});

test('validateWorldbookContent checks location scope', () => {
  const bad = validateWorldbookContent({
    worldbook: {
      entries: [{
        id: 'x', title: '幽灵地点', keys: [], content: '', kind: 'rule',
        scope: { type: 'locations', locationIds: ['ghost'] }, constraints: [],
      }],
    },
    locationIds: new Set(['dock']),
    variables: { qi: 0 },
    choiceTags: new Set(),
    numericLabel: '资源',
  });
  assert.ok(bad.errors.some(e => e.includes('不存在的地点')));
});

test('projectAdventure disables cast when mana insufficient and sword before ladder', () => {
  const world = powerWorld();
  world.resources = { qi: 0, mana: 1 };
  const view = projectAdventure(freshState(world), revisionOf(world));
  const bolt = view.actions.find(a => a.id === 'bolt')!;
  const sword = view.actions.find(a => a.id === 'sword')!;
  const look = view.actions.find(a => a.id === 'look')!;
  assert.equal(bolt.enabled, false);
  assert.match(bolt.blockedReason ?? '', /灵力不足/);
  assert.equal(sword.enabled, false);
  assert.match(sword.blockedReason ?? '', /修为未至/);
  assert.equal(look.enabled, true);
});

test('advanceAdventure spends mana, caps qi, and path-locks holy', () => {
  const world = powerWorld();
  const rev = revisionOf(world);
  let state = freshState(world);
  // meditate: +5 qi capped to +1
  state = advanceAdventure(state, { actionId: 'meditate', expectedTurn: 0, requestId: '00000000-0000-4000-8000-000000000001' }, world, '2020-01-01T00:00:01.000Z');
  assert.equal(state.resources.qi, 1);
  assert.deepEqual(state.takenTags, ['upgrade']);
  // evil path
  state = advanceAdventure(state, { actionId: 'evil', expectedTurn: 1, requestId: '00000000-0000-4000-8000-000000000002' }, world, '2020-01-01T00:00:02.000Z');
  assert.ok(state.takenTags.includes('path_evil'));
  const view = projectAdventure(state, rev);
  const holy = view.actions.find(a => a.id === 'holy');
  assert.ok(holy);
  assert.equal(holy!.enabled, false);
  assert.match(holy!.blockedReason ?? '', /已入邪途/);
  // enough mana to cast
  state.resources.mana = 2;
  state = advanceAdventure(state, { actionId: 'bolt', expectedTurn: 2, requestId: '00000000-0000-4000-8000-000000000003' }, world, '2020-01-01T00:00:03.000Z');
  assert.equal(state.resources.mana, 0);
});

test('advanceAdventure rejects worldbook-blocked action', () => {
  const world = powerWorld();
  world.resources = { qi: 0, mana: 1 };
  const state = freshState(world);
  assert.throws(
    () => advanceAdventure(state, { actionId: 'bolt', expectedTurn: 0, requestId: '00000000-0000-4000-8000-000000000099' }, world, '2020-01-01T00:00:01.000Z'),
    (err: { code?: string }) => err.code === 'ACTION_BLOCKED',
  );
});
