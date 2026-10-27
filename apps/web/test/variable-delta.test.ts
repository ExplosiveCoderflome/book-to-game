import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Choice } from '@novel-game/contracts';
import {
  choiceCostHint,
  diffVariables,
  formatDeltaSummary,
  formatVariableValue,
} from '../src/lib/variable-delta.ts';

test('formatVariableValue maps booleans to 真/假', () => {
  assert.equal(formatVariableValue(true), '真');
  assert.equal(formatVariableValue(false), '假');
  assert.equal(formatVariableValue(3), '3');
  assert.equal(formatVariableValue('dock'), 'dock');
});

test('diffVariables reports numeric increments with signed delta', () => {
  const deltas = diffVariables(
    { caravan_trust: 0, guard_suspicion: 1, has_materials: false },
    { caravan_trust: 1, guard_suspicion: 1, has_materials: true },
  );
  assert.deepEqual(deltas.map(d => d.line), ['caravan_trust +1', 'has_materials → 真']);
});

test('diffVariables reports decrements and new keys', () => {
  const deltas = diffVariables(
    { trust: 2 },
    { trust: 0, route: 'ferry' },
  );
  assert.equal(deltas.find(d => d.name === 'trust')?.line, 'trust -2');
  assert.equal(deltas.find(d => d.name === 'route')?.line, 'route → ferry');
});

test('diffVariables ignores unchanged keys', () => {
  assert.deepEqual(diffVariables({ a: 1, b: true }, { a: 1, b: true }), []);
});

test('formatDeltaSummary prefixes joined lines', () => {
  const deltas = diffVariables({ trust: 0 }, { trust: 1 });
  assert.equal(formatDeltaSummary(deltas), '状态变化：trust +1');
  assert.equal(formatDeltaSummary([]), null);
});

test('choiceCostHint formats effects only; empty when none', () => {
  const withEffects: Choice = {
    id: 'help',
    label: '帮忙',
    targetSceneId: 'dock',
    effects: [
      { type: 'variable.increment', variable: 'caravan_trust', value: 1 },
      { type: 'variable.set', variable: 'has_materials', value: true },
    ],
  };
  assert.equal(choiceCostHint(withEffects), 'caravan_trust +1 · has_materials → 真');
  assert.equal(choiceCostHint({ effects: undefined }), '');
  assert.equal(choiceCostHint({ effects: [] }), '');
});
