import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findLeafSceneIds } from '../src/lib/leaf-scenes.ts';

test('findLeafSceneIds returns scenes with empty choices, capped', () => {
  const content = {
    scenes: [
      { id: 'a', choices: [{ id: '1', label: 'x', targetSceneId: 'b' }] },
      { id: 'b', choices: [] },
      { id: 'c', choices: [] },
      { id: 'd', choices: [{ id: '2', label: 'y', targetSceneId: 'c' }] },
    ],
  };
  assert.deepEqual(findLeafSceneIds(content as never), ['b', 'c']);
  assert.deepEqual(findLeafSceneIds(content as never, 1), ['b']);
});
