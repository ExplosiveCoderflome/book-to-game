import assert from 'node:assert/strict';
import { test } from 'node:test';
import { filterItemAssets } from '../src/lib/item-catalog-filter.ts';
import type { ItemAsset } from '@novel-game/contracts';

const sample: ItemAsset[] = [
  { id: 'bread', version: 1, label: '面包', category: 'consumable', tags: ['食物'], blurb: '干粮' },
  { id: 'ore', version: 1, label: '铁矿', category: 'material', tags: ['矿'] },
  { id: 'key_a', version: 1, label: '铜钥匙', category: 'key', stack: { unique: true } },
];

test('filterItemAssets by category and query', () => {
  assert.equal(filterItemAssets(sample, 'all', '').length, 3);
  assert.equal(filterItemAssets(sample, 'consumable', '').length, 1);
  assert.equal(filterItemAssets(sample, 'all', '钥匙').length, 1);
  assert.equal(filterItemAssets(sample, 'material', '面包').length, 0);
  assert.equal(filterItemAssets(sample, 'all', 'ore').length, 1);
});
