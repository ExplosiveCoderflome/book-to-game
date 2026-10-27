import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nextSceneSelection } from '../src/lib/multi-select.ts';

test('nextSceneSelection replaces without additive', () => {
  assert.deepEqual(nextSceneSelection(['a', 'b'], 'c', false), ['c']);
});

test('nextSceneSelection toggles with additive', () => {
  assert.deepEqual(nextSceneSelection(['a'], 'b', true), ['a', 'b']);
  assert.deepEqual(nextSceneSelection(['a', 'b'], 'a', true), ['b']);
});
