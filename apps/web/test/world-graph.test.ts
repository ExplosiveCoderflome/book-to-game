import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { WorldContent } from '@novel-game/contracts';
import { buildWorldEdges, layoutWorldNodes, openingActionDensity } from '../src/lib/world-graph.ts';

const sample: WorldContent = {
  schemaVersion: 1, mode: 'open', title: '试', premise: 'p', playerRole: 'r', goal: 'g',
  worldRules: ['rule'], adaptationNotes: '', sourceChapterIds: ['c1'],
  initialLocationId: 'dock', timeLimit: 12, timeoutEnding: 'timeout',
  locations: [
    { id: 'dock', title: '渡口', text: 't', origin: 'adapted', evidence: [] },
    { id: 'warehouse', title: '仓库', text: 't', origin: 'adapted', evidence: [] },
    { id: 'gate', title: '关卡', text: 't', origin: 'adapted', evidence: [] },
  ],
  facts: [], npcs: [],
  actions: [
    { id: 'go_wh', label: '去仓库', description: '', locationId: 'dock', availableWhen: [], requires: [], blockedReason: '不能', risk: '', timeCost: 1, once: false, effects: [{ kind: 'move', locationId: 'warehouse' }], text: '去', origin: 'adapted', evidence: [] },
    { id: 'go_gate', label: '去关卡', description: '', locationId: 'dock', availableWhen: [], requires: [], blockedReason: '不能', risk: '', timeCost: 1, once: false, effects: [{ kind: 'move', locationId: 'gate' }], text: '去', origin: 'adapted', evidence: [] },
    { id: 'talk', label: '交谈', description: '', locationId: 'dock', availableWhen: [], requires: [], blockedReason: '不能', risk: '', timeCost: 1, once: false, effects: [{ kind: 'reveal', factId: 'f1' }], text: '谈', origin: 'adapted', evidence: [] },
    { id: 'return', label: '回渡口', description: '', locationId: 'warehouse', availableWhen: [{ kind: 'fact', factId: 'f1', value: true }], requires: [], blockedReason: '不能', risk: '', timeCost: 1, once: false, effects: [{ kind: 'move', locationId: 'dock' }], text: '回', origin: 'adapted', evidence: [] },
  ],
  events: [], endings: [{ id: 'e1', title: '结局', text: '完', when: [{ kind: 'time', atLeast: 12 }] }],
};

test('openingActionDensity errors below three immediately executable start actions', () => {
  const dense = openingActionDensity(sample);
  assert.equal(dense.count, 3);
  assert.equal(dense.warning, null);
  assert.equal(dense.error, null);
  const sparse = openingActionDensity({
    ...sample,
    actions: sample.actions.filter(a => a.id !== 'talk'),
  });
  assert.equal(sparse.count, 2);
  assert.equal(sparse.warning, null);
  assert.match(sparse.error ?? '', /开局可执行行动不足/);
  // requires-locked visible actions do not count
  const locked = openingActionDensity({
    ...sample,
    actions: sample.actions.map(a => a.id === 'talk'
      ? {...a, requires: [{kind: 'fact' as const, factId: 'missing', value: true}], blockedReason: '未满足'}
      : a),
  });
  assert.equal(locked.count, 2);
  assert.match(locked.error ?? '', /开局可执行行动不足/);
});

test('layoutWorldNodes and buildWorldEdges map moves between locations', () => {
  const nodes = layoutWorldNodes(sample);
  assert.equal(nodes.length, 3);
  assert.ok(nodes.find(n => n.id === 'dock')?.isStart);
  const edges = buildWorldEdges(sample, nodes);
  assert.equal(edges.length, 3);
  assert.ok(edges.some(e => e.fromId === 'dock' && e.toId === 'warehouse'));
  assert.ok(edges.some(e => e.fromId === 'warehouse' && e.toId === 'dock'));
  const withSaved = layoutWorldNodes(sample, { dock: { x: 10, y: 20 } });
  assert.equal(withSaved.find(n => n.id === 'dock')?.x, 10);
});
