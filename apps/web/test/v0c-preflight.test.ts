import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { test } from 'node:test';
import { translate } from '../src/lib/locale';
import { PassLineTable, PlaytestProfileNote, funProfileLabel } from '../src/components/preflight/PreflightTables';

test('V0c: preflight explains the active FunProfile without changing legacy reports', () => {
  assert.equal(funProfileLabel('healing'), '治愈型经营');
  assert.equal(funProfileLabel('custom-profile'), 'custom-profile');
  const html = renderToStaticMarkup(createElement(PlaytestProfileNote, {profileId: 'grinding'}));
  assert.match(html, /data-profile-id="grinding"/);
  assert.match(html, /升级刷怪/);
  assert.match(html, /指标矩阵/);
  assert.equal(renderToStaticMarkup(createElement(PlaytestProfileNote, {})), '');
});

test('V0c: profile metric rows remain report-driven and English copy is available', () => {
  const checks = [
    {id: 'G4', label: '卡池', line: '连续两回合同一张 = 0 次', measured: '连续重复 0 次', pass: true},
    {id: 'growth-monotonic', label: '成长曲线', line: '主资源中位数逐段单调上升', measured: '0 → 6 → 12', pass: true},
  ];
  const html = renderToStaticMarkup(createElement(PassLineTable, {checks}));
  assert.match(html, /growth-monotonic/);
  assert.match(html, /主资源中位数逐段单调上升/);
  assert.match(html, /0 → 6 → 12/);
  const english = translate('en-US', '画像：{profile} · 本次模拟按画像指标矩阵验收，未启用的通用指标不参与模拟结论。', {profile: translate('en-US', '治愈型经营')});
  assert.match(english, /Profile: Healing management/);
  assert.match(english, /metric matrix/);
});
