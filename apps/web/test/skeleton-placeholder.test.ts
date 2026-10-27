import assert from 'node:assert/strict';
import { test } from 'node:test';
import { playableSkeleton } from '../../server/test/helpers/playable-story.ts';
import { shouldShowSkeletonPlaceholder, skeletonToCanvasContent } from '../src/lib/skeleton-placeholder.ts';

test('skeletonToCanvasContent fills empty prose and keeps explicit edges only', () => {
  const sk = playableSkeleton([{ chapterId: 'c1', paragraphId: 'p1' }]);
  const content = skeletonToCanvasContent(sk);
  assert.equal(content.mode, 'story');
  assert.equal(content.startSceneId, sk.startSceneId);
  assert.equal(content.scenes.length, sk.scenes.length);
  for (const scene of content.scenes) {
    assert.ok(scene.text.trim().length > 0);
  }
  const dock = content.scenes.find(s => s.id === 'dock')!;
  assert.equal(dock.choices.length, 3);
  assert.deepEqual(dock.choices.map(c => c.targetSceneId), sk.scenes.find(s => s.id === 'dock')!.choices.map(c => c.targetSceneId));
});

test('shouldShowSkeletonPlaceholder only while running without draft', () => {
  const sk = playableSkeleton([{ chapterId: 'c1', paragraphId: 'p1' }]);
  assert.equal(shouldShowSkeletonPlaceholder({ status: 'running', draftId: null, skeleton: sk }), true);
  assert.equal(shouldShowSkeletonPlaceholder({ status: 'running', draftId: null, skeleton: sk }, { dirty: true }), false);
  assert.equal(shouldShowSkeletonPlaceholder({ status: 'succeeded', draftId: 'd', skeleton: sk }), false);
  assert.equal(shouldShowSkeletonPlaceholder({ status: 'running', draftId: null, skeleton: null }), false);
});
