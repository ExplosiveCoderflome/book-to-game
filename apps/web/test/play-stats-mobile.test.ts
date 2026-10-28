import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AdventureResourceMeta } from '@novel-game/contracts';
import { PlayStatsBar, PlayStatsCompact } from '../src/components/PlayStatsBar';
import { useCompactViewport } from '../src/lib/use-compact-viewport';

const meta: AdventureResourceMeta[] = [
  { id: 'xiuwei', label: '修为', value: 0, min: 0, max: 100, display: 'bar' },
  { id: 'shouyuan', label: '寿元', unit: '年', value: 40, min: 0, max: 40, display: 'bar' },
  { id: 'xinmo', label: '心魔', value: 85, min: 0, max: 100, display: 'bar', warn: 'high' },
  { id: 'lingshi', label: '灵石', value: 12, min: 0, display: 'number' },
];

test('stats bar tooltips never expose internal resource ids (scaled + legacy HUD)', () => {
  const scaled = renderToStaticMarkup(createElement(PlayStatsBar, { resourceMeta: meta }));
  assert.ok(!/title="(xiuwei|shouyuan|xinmo|lingshi)"/.test(scaled), scaled);
  const legacy = renderToStaticMarkup(createElement(PlayStatsBar, { resources: { lingshi: 3 }, resourceLabels: { lingshi: '灵石' } }));
  assert.match(legacy, /title="灵石"/);
  assert.ok(!legacy.includes('(lingshi)'));
});

test('phone stats line: countdown first, labels + values only, warn marked, no 已封顶', () => {
  const html = renderToStaticMarkup(createElement(PlayStatsCompact, { meta, countdownId: 'shouyuan' }));
  assert.match(html, /data-testid="play-stats-compact"/);
  const order = [...html.matchAll(/data-resource="([a-z]+)"/g)].map(m => m[1]);
  assert.deepEqual(order, ['shouyuan', 'xiuwei', 'xinmo', 'lingshi']);
  for (const word of ['寿元', '40/40', '修为', '心魔', '灵石', '12']) assert.ok(html.includes(word), word);
  assert.match(html, /play-stats-compact-item is-warn" data-resource="xinmo"/);
  assert.ok(!html.includes('已封顶') && !html.includes('title='));
  assert.equal(renderToStaticMarkup(createElement(PlayStatsCompact, { meta: [] })), '');
});

test('useCompactViewport is false without matchMedia (desktop / exe / SSR keep the desktop layout)', () => {
  let seen: boolean | undefined;
  renderToStaticMarkup(createElement(() => { seen = useCompactViewport(); return null; }));
  assert.equal(seen, false);
});
