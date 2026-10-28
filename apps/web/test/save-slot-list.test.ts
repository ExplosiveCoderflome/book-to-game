import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SaveSlotList, type SaveSlot } from '../src/components/player/SaveSlotList';

const slots: SaveSlot[] = Array.from({ length: 18 }, (_, index) => ({
  id: `internal-save-${index + 1}`, title: `进度 ${index + 1}`, summary: `第 ${index + 1} 幕`, updatedAt: '',
}));
const render = (items: SaveSlot[], selectedId?: string, busy = false) => renderToStaticMarkup(
  createElement(SaveSlotList, { slots: items, selectedId, busy, onSelect: () => {} }),
);

test('save list limits long lists to eight rows with accessible page controls', () => {
  const html = render(slots);
  assert.equal((html.match(/data-testid="save-slot"/g) ?? []).length, 8);
  assert.match(html, /第 1 \/ 3 页/);
  assert.match(html, /disabled="">上一页/);
  assert.doesNotMatch(html, /disabled="">下一页/);
  assert.doesNotMatch(html, /进度 9|internal-save-/);
  assert.match(html, /aria-label="存档分页"/);
});

test('resuming a save opens its page; busy and last-page controls are disabled', () => {
  const html = render(slots, 'internal-save-18');
  assert.match(html, /第 3 \/ 3 页/);
  assert.equal((html.match(/data-testid="save-slot"/g) ?? []).length, 2);
  assert.match(html, /aria-current="true"/);
  assert.match(html, /disabled="">下一页/);
  const busy = render(slots, undefined, true);
  assert.match(busy, /disabled="">下一页/);
});

test('unreadable saves stay listed after playable saves; short and empty lists need no pager', () => {
  const blocked: SaveSlot = { ...slots[0]!, blockedReason: 'corrupt' };
  const html = render([blocked, slots[1]!]);
  assert.ok(html.indexOf('进度 2') < html.indexOf('进度 1'));
  assert.match(html, /data-testid="save-slot-blocked"/);
  assert.match(html, /存档已损坏，无法继续/);
  assert.doesNotMatch(html, /存档分页/);
  assert.match(render([]), /开始新存档后会出现在这里/);
});
