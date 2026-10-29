import assert from 'node:assert/strict';
import {test} from 'node:test';
import {searchWorkspace, matchesJobFilter, draftSwitchIssue, type WorkspaceSearchEntry} from '../src/lib/workspace-search';

test('workspace search finds saved entities across surfaces and treats punctuation as literal text', () => {
  const entries: WorkspaceSearchEntry[] = [
    {key: 'world:w1', title: '同福客栈 [v4]', detail: '世界草稿', tab: 'worlds', entityId: 'w1'},
    {key: 'job:j1', title: '同福客栈', detail: '制作任务 · Pending Review', tab: 'generation', entityId: 'j1'},
    {key: 'source:s1', title: '其他原作', detail: '原作资料', tab: 'sources', entityId: 's1'},
  ];
  assert.deepEqual(searchWorkspace(entries, '同福 世界').map(entry => entry.entityId), ['w1']);
  assert.deepEqual(searchWorkspace(entries, ' pending REVIEW ').map(entry => entry.entityId), ['j1']);
  assert.equal(searchWorkspace(entries, '[')[0]?.key, 'world:w1');
  assert.equal(searchWorkspace(entries, '不存在').length, 0);
  assert.equal(searchWorkspace(Array.from({length: 50}, (_, i) => ({...entries[0], key: String(i)})), '').length, 30);
});

test('task filters keep author review, recovery and completion distinct', () => {
  const job = {productionBrief: {title: '同福客栈'}, playerRole: '白展堂', stage: '准备审阅', status: 'awaiting_review'};
  assert.equal(matchesJobFilter(job, 'review', '白展堂'), true);
  assert.equal(matchesJobFilter(job, 'active', ''), false);
  assert.equal(matchesJobFilter(job, 'done', ''), false);
  assert.equal(matchesJobFilter({...job, status: 'cancelled'}, 'failed', ''), true);
  assert.equal(matchesJobFilter({...job, status: 'succeeded'}, 'done', '另一作品'), false);
});

test('cross-surface draft opening preserves unsaved or in-flight work, including a new unnamed draft', () => {
  assert.equal(draftSwitchIssue('world-a', 'world-b', true, false), 'dirty');
  assert.equal(draftSwitchIssue('', 'world-b', true, false), 'dirty');
  assert.equal(draftSwitchIssue('story-a', 'story-b', false, true), 'busy');
  assert.equal(draftSwitchIssue('world-a', 'world-a', true, true), null);
  assert.equal(draftSwitchIssue('story-a', 'story-b', false, false), null);
});
