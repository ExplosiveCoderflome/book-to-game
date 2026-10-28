import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PlayEndingPanel } from '../src/components/PlayEndingPanel';
import { AdventureActionRow } from '../src/components/play/AdventureActionRow';

const base = { mode: 'adventure' as const, title: '结丹', body: '第一段。\n第二段。', onReplay: () => {}, kind: 'ending' as const };

test('K15 / ending page: body then passages (only when present), reading typography, eyebrow states only the type', () => {
  const html = renderToStaticMarkup(createElement(PlayEndingPanel, { ...base, kind: 'failure', title: '走火入魔', passages: [{ id: 'yabo_oil', text: '哑伯的油。' }, { id: 'xiaoman', text: '小满甲。\n小满乙。' }], recap: [] }));
  assert.ok(html.indexOf('第二段。') < html.indexOf('哑伯的油。'));
  assert.match(html, /class="play-ending-body reader-text"/);
  assert.match(html, /class="play-ending-passages reader-text"/);
  assert.deepEqual([...html.matchAll(/data-passage="([a-z_]+)"/g)].map(m => m[1]), ['yabo_oil', 'xiaoman', 'xiaoman']);
  assert.match(html, /<p class="play-ending-eyebrow">失败结局<\/p>/, 'E3: no 「· 走火入魔」 repeat');
  assert.match(html, /<h4 class="play-ending-title" tabindex="-1">走火入魔<\/h4>/);
  assert.ok(!html.includes('play-ending-recap'), 'recap: [] → no block');
  const none = renderToStaticMarkup(createElement(PlayEndingPanel, { ...base, passages: [] }));
  assert.ok(!none.includes('play-ending-passages'), 'no passages → no extra group / spacing');
});

test('K15 / ending page: 「这一生」 after the prose, then one-line 本局收束, hint, actions; replaces 「走过的路」 (E1)', () => {
  const summary = [{ label: '时间', value: '第5年 7月' }, { label: '寿元', value: '40/40' }];
  const html = renderToStaticMarkup(createElement(PlayEndingPanel, { ...base, summary, path: ['入门', '旧账'], recap: [{ id: 'a', text: '你欠哑伯一盏油。' }, { id: 'b', text: '你见过苏师姐的灯。' }] }));
  assert.match(html, /data-testid="play-ending-recap"/);
  assert.match(html, /<h5>这一生<\/h5>/);
  assert.deepEqual([...html.matchAll(/data-recap="([a-z])"/g)].map(m => m[1]), ['a', 'b']);
  assert.ok(!html.includes('play-ending-path'), 'world with recap[] → no 「走过的路」');
  const order = ['play-ending-body', 'play-ending-recap', 'play-ending-summary', 'play-ending-hint', 'play-ending-actions'].map(c => html.indexOf(c));
  assert.deepEqual([...order].sort((x, y) => x - y), order);
  assert.ok(!html.includes('play-ending-chip'), 'summary is one line of text, no pills');
  assert.match(html, /<span class="play-ending-stat">时间 第5年 7月<\/span><span class="play-ending-stat"> · 寿元 40\/40<\/span>/);
  const empty = renderToStaticMarkup(createElement(PlayEndingPanel, { ...base, path: ['入门'], recap: [] }));
  assert.ok(!empty.includes('play-ending-recap') && !empty.includes('play-ending-path'), 'recap [] hides the block, no fallback');
  const legacy = renderToStaticMarkup(createElement(PlayEndingPanel, { ...base, path: ['入门', '旧账'] }));
  assert.match(legacy, /data-testid="play-ending-path"/);
  assert.match(legacy, /<span class="play-ending-step">旧账<\/span>|<span class="play-ending-step">→ 旧账<\/span>/, 'each step is a nowrap unit (M4)');
});

test('G9 UI: a locked option is visible, not clickable, and shows the generated reason verbatim', () => {
  const locked = renderToStaticMarkup(createElement(AdventureActionRow, { onClick: () => {}, timeUnit: 'month', action: {
    id: 'buy', label: '买培元丹', timeCost: 0, enabled: false, blockedReason: '灵石不足：需 ≥ 30，现有 12', blockedReasonKind: 'generated' } }));
  assert.match(locked, /is-locked/);
  assert.match(locked, /<button type="button" disabled="">/);
  assert.match(locked, /买培元丹/);
  assert.match(locked, /<p class="blocked-reason" data-reason-kind="generated">灵石不足：需 ≥ 30，现有 12<\/p>/);
  const open = renderToStaticMarkup(createElement(AdventureActionRow, { onClick: () => {}, timeUnit: 'month', action: {
    id: 'buy', label: '买培元丹', timeCost: 0, enabled: true } }));
  assert.ok(!open.includes('disabled') && !open.includes('blocked-reason'), 'enabled = clickable, no reason');
});
