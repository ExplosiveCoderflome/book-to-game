import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Choice } from '@novel-game/contracts';
import { formatCondition, formatEffect, summarizeChoice } from '../src/lib/edge-summary.ts';

test('summarizeChoice formats full label, conditions and effects', () => {
  const choice: Choice = {
    id: 'boat',
    label: '修好渡船后趁夜色过河前往北城',
    targetSceneId: 'end',
    conditions: [{ type: 'variable.gte', variable: 'trust', value: 1 }],
    effects: [{ type: 'variable.increment', variable: 'trust', value: 2 }, { type: 'variable.set', variable: 'promised', value: true }],
  };
  const summary = summarizeChoice(choice);
  assert.equal(summary.fullLabel, choice.label);
  assert.ok(summary.shortLabel.endsWith('…'));
  assert.deepEqual(summary.conditions, ['trust ≥ 1']);
  assert.ok(summary.effects.includes('trust +2'));
  assert.ok(summary.effects.includes('promised → 真'));
  assert.ok(summary.lines[0]!.startsWith('条件：'));
  assert.ok(summary.lines[1]!.startsWith('效果：'));
  assert.equal(formatCondition({ type: 'variable.equals', variable: 'promised', value: false }), 'promised = 假');
  assert.equal(formatEffect({ type: 'variable.increment', variable: 'trust', value: -1 }), 'trust -1');
});
