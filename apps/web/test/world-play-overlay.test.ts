import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { WorldContent } from '@novel-game/contracts';
import { blockedWorldActions, worldPlayOverlayFromAdventure, worldTrailFromHistory } from '../src/lib/world-play-overlay.ts';

const content: WorldContent = {
  schemaVersion: 1, mode: 'open', title: '试', premise: 'p', playerRole: 'r', goal: 'g',
  worldRules: ['rule'], adaptationNotes: '', sourceChapterIds: ['c1'],
  initialLocationId: 'dock', timeLimit: 12, timeoutEnding: 'timeout',
  locations: [
    { id: 'dock', title: '渡口', text: 't', origin: 'adapted', evidence: [] },
    { id: 'warehouse', title: '仓库', text: 't', origin: 'adapted', evidence: [] },
  ],
  facts: [{ id: 'plank', label: '木板', description: '', kind: 'item', initialValue: false, playerKnown: false, origin: 'adapted', evidence: [] }],
  npcs: [],
  actions: [
    { id: 'fetch', label: '去仓库搬木板', description: '', locationId: 'dock', availableWhen: [], requires: [], blockedReason: '不能', risk: '', timeCost: 1, once: false, effects: [{ kind: 'move', locationId: 'warehouse' }], text: '去', origin: 'adapted', evidence: [] },
    { id: 'talk', label: '与商队交谈', description: '', locationId: 'warehouse', availableWhen: [], requires: [], blockedReason: '不能', risk: '', timeCost: 1, once: false, effects: [{ kind: 'reveal', factId: 'plank' }], text: '谈', origin: 'adapted', evidence: [] },
    { id: 'return', label: '回渡口', description: '', locationId: 'warehouse', availableWhen: [{ kind: 'fact', factId: 'plank', value: true }], requires: [], blockedReason: '尚未拿到木板', risk: '', timeCost: 1, once: false, effects: [{ kind: 'move', locationId: 'dock' }], text: '回', origin: 'adapted', evidence: [] },
    { id: 'cross', label: '直接渡河', description: '', locationId: 'dock', availableWhen: [{ kind: 'fact', factId: 'plank', value: true }], requires: [], blockedReason: '船未修好', risk: '', timeCost: 1, once: false, effects: [{ kind: 'set', factId: 'plank', value: true }], text: '渡', origin: 'adapted', evidence: [] },
  ],
  events: [], endings: [{ id: 'e1', title: '结局', text: '完', when: [{ kind: 'time', atLeast: 12 }] }],
};

test('worldTrailFromHistory maps move action labels to edge keys', () => {
  const trail = worldTrailFromHistory(content, [
    { turn: 0, elapsed: 0, text: 'start' },
    { turn: 1, elapsed: 1, actionLabel: '去仓库搬木板', text: 'moved' },
    { turn: 2, elapsed: 2, actionLabel: '与商队交谈', text: 'talked' },
  ]);
  assert.deepEqual(trail.trailEdgeKeys, ['dock:fetch']);
  assert.deepEqual(trail.visitedLocationIds, ['dock', 'warehouse']);
  assert.equal(trail.inferredLocationId, 'warehouse');
});

test('blockedWorldActions dims disabled move edges and local actions', () => {
  const blocked = blockedWorldActions(content, 'warehouse', [
    { id: 'talk', label: '与商队交谈', description: '', timeCost: 1, risk: '', enabled: true },
    { id: 'return', label: '回渡口', description: '', timeCost: 1, risk: '', enabled: false, blockedReason: '尚未拿到木板' },
  ]);
  assert.deepEqual(blocked.blockedEdgeKeys, ['warehouse:return']);
  assert.deepEqual(blocked.blockedActionIds, []);
});

test('worldPlayOverlayFromAdventure highlights current location and trail', () => {
  const overlay = worldPlayOverlayFromAdventure(content, {
    location: { id: 'warehouse', title: '仓库', text: 't' },
    history: [
      { turn: 0, elapsed: 0, text: 'start' },
      { turn: 1, elapsed: 1, actionLabel: '去仓库搬木板', text: 'moved' },
    ],
    actions: [
      { id: 'talk', label: '与商队交谈', description: '', timeCost: 1, risk: '', enabled: true },
      { id: 'return', label: '回渡口', description: '', timeCost: 1, risk: '', enabled: false, blockedReason: '尚未拿到木板' },
    ],
  });
  assert.equal(overlay.currentLocationId, 'warehouse');
  assert.deepEqual(overlay.trailEdgeKeys, ['dock:fetch']);
  assert.ok(overlay.visitedLocationIds.includes('dock'));
  assert.ok(overlay.visitedLocationIds.includes('warehouse'));
  assert.deepEqual(overlay.blockedEdgeKeys, ['warehouse:return']);
});
