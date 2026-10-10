import test from 'node:test';
import assert from 'node:assert/strict';
import { PendingAction } from '../src/lib/pending-action.ts';

test('an uncertain action keeps its original request ID and turn on retry', () => {
  const pending = new PendingAction();
  const first = pending.begin('session-a', 'choice-a', 3);
  assert.deepEqual(pending.begin('session-a', 'choice-a', 4), first);
  assert.equal(first.expectedTurn, 3);
  assert.throws(() => pending.begin('session-a', 'choice-b', 3), /确认/);
  pending.confirm();
  assert.notEqual(pending.begin('session-a', 'choice-b', 4).requestId, first.requestId);
});

test('pending actions can survive page reload before server confirmation', () => {
  const first = new PendingAction().begin('session-a', 'choice-a', 3);
  const restored = new PendingAction({ sessionId: 'session-a', input: first });
  assert.deepEqual(restored.begin('session-a', 'choice-a', 3), first);
  assert.throws(() => restored.begin('session-b', 'choice-a', 0), /确认/);
});
