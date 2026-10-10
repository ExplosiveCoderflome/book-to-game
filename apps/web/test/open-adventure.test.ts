import test from 'node:test';
import assert from 'node:assert/strict';
import { PendingAdventure, restoreAdventure, adventurePendingKey } from '../src/lib/pending-adventure.ts';
import { selectedChapters } from '../src/lib/generation-scope.ts';

test('uncertain adventure action survives reload and never changes session, turn or request', () => {
  const first = new PendingAdventure();
  const input = first.begin('save-a', 'talk', 2);
  const restored = new PendingAdventure(JSON.parse(JSON.stringify(first.value)));
  assert.deepEqual(restored.begin('save-a', 'talk', 3), input);
  assert.throws(() => restored.begin('save-b', 'talk', 2), /确认/);
  assert.throws(() => restored.begin('save-a', 'leave', 2), /确认/);
  restored.confirm();
  assert.notEqual(restored.begin('save-a', 'leave', 3).requestId, input.requestId);
});

test('generation scope preserves source order and refuses empty or stale selections', () => {
  const chapters = [{id: 'a'}, {id: 'b'}, {id: 'c'}];
  assert.deepEqual(selectedChapters(chapters, ['c', 'a']), ['a', 'c']);
  assert.throws(() => selectedChapters(chapters, []), /章节/);
  assert.throws(() => selectedChapters(chapters, ['foreign']), /章节/);
  assert.throws(() => selectedChapters(chapters, ['a', 'a']), /章节/);
});

test('persisted adventure restore keeps valid pending input and ignores malformed browser records', () => {
  const first = new PendingAdventure(); first.begin('save-a', 'talk', 2);
  const getItem = (key: string) => key === adventurePendingKey ? JSON.stringify(first.value) : null;
  assert.deepEqual(restoreAdventure({getItem}), first.value);
  assert.equal(restoreAdventure({getItem: () => 'not json'}), null);
  assert.equal(restoreAdventure({getItem: () => JSON.stringify({sessionId: 'save-a', input: {actionId: 'talk', expectedTurn: 2, requestId: 'invalid'}})}), null);
});
