import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AgentChatConversation, AgentChatMessage } from '@novel-game/contracts';
import { AgentMessageBody } from '../src/components/agent/AgentMessageBody';
import { AgentTimeline } from '../src/components/agent/AgentTimeline';
import { conversationLabel, splitUserContext, toolReceipt } from '../src/components/agent/agent-presenter';
import { workbenchTabFromHash, workspacePages } from '../src/lib/workbench-navigation';
import { translate } from '../src/lib/locale';

const message = (value: unknown): AgentChatMessage => ({id: 'receipt', role: 'tool', content: JSON.stringify(value), createdAt: ''});

test('agent workspace: readable receipts distinguish pending, skipped, partial and failed work from completion', () => {
  assert.equal(toolReceipt(message({status: 'awaiting_author_confirmation'})).status, 'pending');
  assert.equal(toolReceipt(message({status: 'not_executed', reason: 'resolve pending action'})).status, 'skipped');
  assert.equal(toolReceipt(message({truncated: true, preview: '{'})).status, 'partial');
  assert.equal(toolReceipt(message({error: 'CHAT_ACTION_STALE'})).status, 'failed');
  assert.equal(toolReceipt(message({report: {blocking: true, errors: 2, warnings: 3}})).status, 'failed');
  assert.equal(toolReceipt(message([{}, {}]), (key, params) => translate('en-US', key, params)).summary, '2 records read');
  assert.doesNotMatch(toolReceipt(message({data: {entries: [], nextOffset: null}})).summary, /继续翻页/);
});

test('agent workspace: model formatting is readable while model HTML remains inert text', () => {
  const html = renderToStaticMarkup(createElement(AgentMessageBody, {text: '**三条路线**\n\n- 合作\n- 谈判\n\n`world_id`\n\n<script>alert(1)</script>'}));
  assert.match(html, /<strong>三条路线<\/strong>/); assert.match(html, /<ul>/); assert.match(html, /<code>world_id<\/code>/);
  assert.match(html, /&lt;script&gt;/); assert.doesNotMatch(html, /<script>/);
});

test('agent workspace: approval stays beside its proposal, failure preserves its result and hides execution controls', () => {
  const conversation: AgentChatConversation = {id: 'chat', title: '测试', version: 1, status: 'idle', leaseUntil: 0, createdAt: '', updatedAt: '',
    messages: [{id: 'proposal', role: 'assistant', content: '建议修改标题。', createdAt: '', toolCalls: [{id: 'call', name: 'edit_world_summary', arguments: {id: 'world'}}]},
      {...message({status: 'awaiting_author_confirmation'}), toolCallId: 'call', toolName: 'edit_world_summary'}],
    actions: [{id: 'action', callId: 'call', toolName: 'edit_world_summary', arguments: {id: 'world', version: 4, title: '新标题'}, summary: '测试草稿 v4，标题旧值 → 新标题', status: 'pending', createdAt: '', updatedAt: ''}]};
  const pending = renderToStaticMarkup(createElement(AgentTimeline, {conversation, running: false, onDecide: () => {}}));
  assert.ok(pending.indexOf('建议修改标题') < pending.indexOf('待你确认'));
  assert.match(pending, /标题旧值/); assert.match(pending, /确认执行/); assert.match(pending, /拒绝/);
  conversation.actions[0]!.status = 'failed'; conversation.actions[0]!.result = '目标版本已变化';
  const failed = renderToStaticMarkup(createElement(AgentTimeline, {conversation, running: false, onDecide: () => {}}));
  assert.match(failed, /执行失败/); assert.match(failed, /目标版本已变化/); assert.doesNotMatch(failed, /确认执行<\/button>/);
});

test('agent workspace: every author surface is deep-linkable and Agent is the new default', () => {
  assert.equal(workbenchTabFromHash(''), 'agent');
  for (const page of workspacePages) assert.equal(workbenchTabFromHash(`#${page.id}`), page.id);
  assert.equal(translate('en-US', 'Agent 工作区'), 'Agent workspace');
});

test('agent workspace: context metadata stays separate from readable user content and legacy titles', () => {
  const context = '【当前世界草稿：同福旧账｜ID：draft-private-id｜版本：4】';
  assert.deepEqual(splitUserContext(`检查玩法\n\n${context}`), {text: '检查玩法', context});
  assert.deepEqual(splitUserContext(`${context}\n\n检查玩法`), {text: '检查玩法', context});
  assert.equal(conversationLabel('【当前世界草稿：同福旧账｜ID：draft-priva'), '同福旧账');
  assert.deepEqual(splitUserContext('正常消息\n\n第二段'), {text: '正常消息\n\n第二段', context: null});
});
