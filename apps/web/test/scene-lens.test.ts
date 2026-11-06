import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AdventureResourceMeta, AdventureView, SessionView } from '@novel-game/contracts';
import { ReaderPlaySurface } from '../src/components/play/ReaderPlaySurface';
import { AdventurePlaySurface } from '../src/components/play/AdventurePlaySurface';
import { SceneLensFeedback } from '../src/components/play/SceneLens';
import { hasLensFeedback, pickLensStats, splitPrimaryActions } from '../src/lib/scene-lens';
import { englishTranslations } from '../src/lib/locale';
import type { VariableDelta } from '../src/lib/variable-delta';

test('pickLensStats prefers declared resource meta and keeps at most four rows', () => {
  const meta: AdventureResourceMeta[] = [
    { id: 'qi', label: '修为', value: 12, min: 0, max: 100, display: 'bar' },
    { id: 'coin', label: '银两', value: 8, min: 0, display: 'number', unit: '两' },
    { id: 'calamity', label: '劫数', value: 65, min: 0, max: 100, display: 'bar', warn: 'high' },
    { id: 'sect_trust', label: '门派信任', value: 3, min: 0, max: 20, display: 'number' },
    { id: 'extra', label: '杂项', value: 1, min: 0, display: 'number' },
  ];
  const stats = pickLensStats({ resourceMeta: meta, countdownId: 'qi' });
  assert.ok(stats.length <= 4);
  assert.equal(stats[0].key, 'qi', 'countdown/time resource leads the HUD');
  assert.ok(stats.some(s => s.key === 'calamity' && s.warn), 'declared danger keeps its warn flag');
  assert.ok(stats.some(s => s.key === 'coin'), 'money-like resource stays in the top row');
  const extra = stats.find(s => s.key === 'extra');
  assert.equal(extra, undefined, 'overflow resources drop out of the compact HUD');
  assert.ok(stats.every(s => !s.label.includes('qi')), 'labels are display labels, never raw ids');
});

test('pickLensStats falls back to first numeric story variables and carries a delta', () => {
  const deltas: VariableDelta[] = [
    { name: 'calamity', from: 4, to: 5, line: '劫数 +1' },
  ];
  const stats = pickLensStats({
    variables: { promise_kept: true, qi: 3, calamity: 5 },
    deltas,
    statTemplateId: 'xianxia_pressure',
    statTemplateVersion: 1,
  });
  assert.deepEqual(stats.map(s => s.key), ['calamity', 'qi'], 'two numeric stats already fill the HUD');
  assert.equal(stats[0].label, '劫数');
  assert.equal(stats[0].delta?.tone, 'pressure');
  assert.equal(stats[0].delta?.direction, 'up');
  assert.ok(stats.every(s => s.fillPercent !== undefined));

  const single = pickLensStats({
    variables: { promise_kept: true, qi: 3 },
    statTemplateId: 'xianxia_pressure',
    statTemplateVersion: 1,
  });
  assert.deepEqual(single.map(s => s.key), ['qi', 'promise_kept'], 'a lone numeric stat is topped up with a flag');
  assert.equal(single[1].fillPercent, undefined, 'booleans have no meter fill');
});

test('pickLensStats handles resources without meta (open worlds without S1)', () => {
  const stats = pickLensStats({
    resources: { fs_hidden: 1, coin: 7, herb: 2 },
    resourceLabels: { coin: '银两', herb: '药草' },
  });
  assert.deepEqual(stats.map(s => s.key), ['coin', 'herb'], 'hidden fs_* pools never surface');
  assert.equal(stats[0].label, '银两');
});

test('splitPrimaryActions keeps enabled order, caps the dock and moves the rest to overflow', () => {
  const items = [
    { id: 'a', enabled: true },
    { id: 'b', enabled: false },
    { id: 'c', enabled: true },
    { id: 'd', enabled: true },
    { id: 'e', enabled: true },
    { id: 'f', enabled: true },
  ];
  const split = splitPrimaryActions(items, item => item.enabled, 3);
  assert.deepEqual(split.primary.map(i => i.id), ['a', 'c', 'd']);
  assert.deepEqual(split.overflow.map(i => i.id), ['e', 'f', 'b']);
});

test('splitPrimaryActions still shows disabled rows when nothing is actionable', () => {
  const split = splitPrimaryActions([{ id: 'locked', enabled: false }], item => item.enabled, 4);
  assert.deepEqual(split.primary.map(i => i.id), ['locked']);
  assert.deepEqual(split.overflow, []);
});

test('hasLensFeedback only true when the last beat changed something', () => {
  assert.equal(hasLensFeedback(null, null), false);
  assert.equal(hasLensFeedback([], { newlyAvailable: [], newlyUnavailable: [] }), false);
  assert.equal(hasLensFeedback([{ name: 'qi', from: 0, to: 1, line: '修为 +1' }], null), true);
  assert.equal(hasLensFeedback(null, { newlyAvailable: ['推门'], newlyUnavailable: [] }), true);
  assert.equal(hasLensFeedback(null, null, [{ key: 'qi-0', line: '修为 +1', tone: 'gain' }]), true);
});

test('ReaderPlaySurface renders the scene-lens shell: HUD, capped dock, overflow drawer', () => {
  const session: SessionView = {
    id: 's1', gameRevisionId: 'r1', turn: 3, ended: false,
    variables: { trust: 4, risk: 2 },
    scene: {
      id: 'kitchen', title: '后厨', text: '灯还亮着。',
      choices: [
        { id: 'c1', label: '递纸条' }, { id: 'c2', label: '问白展堂' },
        { id: 'c3', label: '藏起来' }, { id: 'c4', label: '去大堂' }, { id: 'c5', label: '上楼' },
      ],
    },
    history: [], createdAt: '', updatedAt: '',
  };
  const html = renderToStaticMarkup(createElement(ReaderPlaySurface, {
    session, revision: null, busy: false, onAct() {}, onReplay() {},
  }));
  assert.match(html, /data-testid="scene-lens-hud"/);
  assert.match(html, /data-testid="scene-lens-actions"/);
  assert.match(html, /scene-lens-more/);
  assert.match(html, /data-testid="scene-lens-drawer"/);
  const primaryChoices = html.slice(html.indexOf('scene-lens-primary'), html.indexOf('scene-lens-more'));
  assert.equal((primaryChoices.match(/data-testid="reader-choice"/g) ?? []).length, 4, 'dock caps at four primary choices');
  assert.match(html, /更多选择/);
});

test('ReaderPlaySurface keeps an existing-save start hint as plain text without the empty-state diamond', () => {
  const html = renderToStaticMarkup(createElement(ReaderPlaySurface, {
    session: null, revision: null, busy: false, emptyHint: '选择左侧存档继续，或开始新存档。', onAct() {}, onReplay() {},
  }));
  assert.match(html, /class="reader-empty-hint"/);
  assert.ok(!html.includes('class="empty"') && !html.includes('◇'));
});

test('pickLensStats puts a declared danger ahead of money even without a countdown', () => {
  const meta: AdventureResourceMeta[] = [
    { id: 'coin', label: '银两', value: 30, min: 0, display: 'number' },
    { id: 'herb', label: '药草', value: 2, min: 0, display: 'number' },
    { id: 'danger', label: '追兵', value: 4, min: 0, max: 5, display: 'bar', warn: 'high' },
  ];
  const stats = pickLensStats({ resourceMeta: meta });
  assert.deepEqual(stats.map(s => s.key), ['danger', 'coin', 'herb'], 'danger leads, money follows, plain resource last');
  assert.equal(stats[0].warn, true);
});

test('AdventurePlaySurface renders the scene-lens shell for open play', () => {
  const session: AdventureView = {
    id: 'a1', worldRevisionId: 'w1', turn: 2, elapsed: 3, timeLimit: 10, ended: false,
    playerRole: '夜行人', goal: '在天亮前出城',
    location: { id: 'gate', title: '城门', text: '门还没关。' },
    facts: [], npcs: [], history: [], createdAt: '', updatedAt: '',
    resources: { coin: 12 },
    resourceMeta: [
      { id: 'curfew', label: '宵禁', value: 7, min: 0, max: 10, display: 'bar', warn: 'high' },
      { id: 'coin', label: '银两', value: 12, min: 0, display: 'number' },
    ],
    clock: undefined,
    actions: [
      { id: 'a', label: '贿赂门卒', description: '', timeCost: 1, risk: '', enabled: true },
      { id: 'b', label: '翻墙', description: '', timeCost: 1, risk: '', enabled: true },
      { id: 'c', label: '等天亮', description: '', timeCost: 1, risk: '', enabled: true },
      { id: 'd', label: '混进商队', description: '', timeCost: 1, risk: '', enabled: true },
      { id: 'e', label: '走水路', description: '', timeCost: 1, risk: '', enabled: true },
      { id: 'f', label: '出示令牌', description: '', timeCost: 1, risk: '', enabled: false, blockedReason: '缺少所需物品' },
    ],
  };
  const html = renderToStaticMarkup(createElement(AdventurePlaySurface, {
    session, revision: null, busy: false, onAct() {}, onReplay() {},
  }));
  assert.match(html, /data-testid="scene-lens-hud"/);
  assert.match(html, /data-testid="scene-lens-actions"/);
  assert.match(html, /data-testid="scene-lens-drawer"/);
  assert.match(html, /宵禁/, 'declared danger appears in the HUD');
  const primary = html.slice(html.indexOf('scene-lens-primary'), html.indexOf('scene-lens-more'));
  assert.equal((primary.match(/data-testid="adventure-action-row"/g) ?? []).length, 4, 'dock caps at four primary actions');
  assert.match(html, /更多选择（2）/);
  assert.ok(html.indexOf('data-testid="scene-lens-hud"') < html.indexOf('城门'), 'HUD sits above the location title');
  assert.ok(html.indexOf('城门') < html.indexOf('data-testid="adventure-result"'), 'prose sits above last-beat result');
});

test('SceneLensFeedback shows a change line once even when a diff and chip describe it', () => {
  const html = renderToStaticMarkup(createElement(SceneLensFeedback, {
    deltas: [{ name: 'qi', line: '修为 +1' }],
    chips: [{ key: 'qi-0', line: '修为 +1', tone: 'gain' }],
  }));
  assert.equal((html.match(/修为 \+1/g) ?? []).length, 1);
  assert.match(html, /刚刚变化/);
});

test('every scene-lens label has an English translation', () => {
  for (const key of ['刚刚变化', '更多选择', '更多选择（{n}）', '更多信息 · 状态与记录', '打开选择', '新可选：{labels}', '已不可用：{labels}', '状态']) {
    assert.ok(englishTranslations[key], `missing en-US: ${key}`);
  }
});
