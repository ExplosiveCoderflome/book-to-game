import { test } from 'node:test';
import assert from 'node:assert/strict';
import { worldContentSchema } from '@novel-game/contracts';
import { sanitizeWorldCandidate } from '../src/platform/model/sanitize-world.js';

function action(partial: Record<string, unknown>) {
  return {
    id: 'act', label: '行动', description: '', locationId: 'dock', availableWhen: [], requires: [],
    blockedReason: '还不行', risk: '', timeCost: 1, once: false,
    effects: [{kind: 'move', locationId: 'dock'}], text: '你行动。', origin: 'adapted', evidence: [],
    ...partial,
  };
}

function minimalWorld(actions: Record<string, unknown>[]) {
  return {
    schemaVersion: 1, mode: 'open', title: '渡口', premise: '封港前过河', playerRole: '抄写员', goal: '过河',
    worldRules: ['时间有限'], adaptationNotes: '测试', sourceChapterIds: ['c1'],
    initialLocationId: 'dock', timeLimit: 12, timeoutEnding: '封港。',
    locations: [
      {id: 'dock', title: '渡口', text: '木栈桥', origin: 'adapted', evidence: []},
      {id: 'warehouse', title: '仓库', text: '木板', origin: 'adapted', evidence: []},
      {id: 'gate', title: '关卡', text: '哨所', origin: 'adapted', evidence: []},
    ],
    facts: [], npcs: [{id: 'boatman', name: '船夫', description: '修船', goal: '修船', initialLocationId: 'dock', knownFactIds: [], origin: 'adapted', evidence: []}],
    actions,
    events: [], endings: [{id: 'ok', title: '过河', text: '抵达对岸。', when: [{kind: 'time', atLeast: 1}]}],
  };
}

test('sanitize drops JSON null optional npcId and defaults empty blockedReason', () => {
  const raw = minimalWorld([
    action({id: 'talk', npcId: null, blockedReason: '', unused: null}),
    action({id: 'look', label: '环顾'}),
    action({id: 'waitish', label: '等待'}),
  ]);
  const cleaned = sanitizeWorldCandidate(raw) as {actions: {npcId?: string; blockedReason: string; unused?: unknown}[]};
  assert.equal('npcId' in cleaned.actions[0], false);
  assert.equal(cleaned.actions[0].blockedReason, '尚未满足执行条件。');
  assert.equal('unused' in cleaned.actions[0], false);
  const parsed = worldContentSchema.safeParse(cleaned);
  assert.equal(parsed.success, true, JSON.stringify(parsed.success ? [] : parsed.error.issues));
});

test('sanitize leaves valid npcId and blockedReason alone', () => {
  const raw = minimalWorld([
    action({id: 'ask', npcId: 'boatman', blockedReason: '船夫不在'}),
    action({id: 'look', label: '环顾'}),
    action({id: 'waitish', label: '等待'}),
  ]);
  const cleaned = sanitizeWorldCandidate(raw) as {actions: {npcId?: string; blockedReason: string}[]};
  assert.equal(cleaned.actions[0].npcId, 'boatman');
  assert.equal(cleaned.actions[0].blockedReason, '船夫不在');
});
