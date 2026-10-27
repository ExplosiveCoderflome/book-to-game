import assert from 'node:assert/strict';
import { test } from 'node:test';
import { playableStory } from './helpers/playable-story.js';
import { mergeSceneExtension } from '../src/modules/generation/domain/merge-scene-extension.js';

test('mergeSceneExtension attaches neighbors without wiping unrelated scenes', () => {
  const base = playableStory([{chapterId: 'c1', paragraphId: 'p1'}]);
  const beforeIds = base.scenes.map(s => s.id).sort();
  const merged = mergeSceneExtension(base, 'dock', {
    scenes: [
      {id: 'warehouse', title: '货仓', text: '木箱堆成墙。', origin: 'adapted', evidence: [], choices: [
        {id: 'back', label: '返回渡口', targetSceneId: 'dock'},
      ]},
    ],
    anchorChoices: [{id: 'to_wh', label: '去货仓查走私线索', targetSceneId: 'warehouse'}],
  });
  assert.ok(merged.scenes.some(s => s.id === 'warehouse'));
  assert.ok(merged.scenes.find(s => s.id === 'dock')!.choices.some(c => c.id === 'to_wh'));
  assert.deepEqual(merged.scenes.filter(s => s.id !== 'warehouse').map(s => s.id).sort(), beforeIds);
  assert.ok(merged.canvasLayout?.warehouse);
});

test('mergeSceneExtension rejects colliding scene ids', () => {
  const base = playableStory([{chapterId: 'c1', paragraphId: 'p1'}]);
  assert.throws(() => mergeSceneExtension(base, 'dock', {
    scenes: [{id: 'camp', title: '冲突', text: 'x', origin: 'adapted', evidence: [], choices: []}],
    anchorChoices: [{id: 'x', label: '去营地', targetSceneId: 'camp'}],
  }), /冲突/);
});
