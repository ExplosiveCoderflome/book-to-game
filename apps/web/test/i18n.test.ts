import { test } from 'node:test';
import assert from 'node:assert/strict';
import { persistLocale, readLocale, resolveLocale, translate } from '../src/lib/locale';

test('locale resolution prefers supported language and falls back to Chinese', () => {
  assert.equal(resolveLocale(['fr-FR', 'en-GB']), 'en-US');
  assert.equal(resolveLocale('zh-TW'), 'zh-CN');
  assert.equal(resolveLocale('fr-FR'), 'zh-CN');
  assert.equal(translate('en-US', '工作台配置 · v{version}', {version: 3}), 'Workshop settings · v3');
  assert.equal(translate('zh-CN', '工作台配置 · v{version}', {version: 3}), '工作台配置 · v3');
});

test('locale persistence tolerates unavailable or corrupt browser storage', () => {
  let saved = '';
  const storage = {getItem: () => 'en-US', setItem: (_key: string, value: string) => {saved = value;}};
  assert.equal(readLocale(storage, ['zh-CN']), 'en-US');
  persistLocale(storage, 'zh-CN');
  assert.equal(saved, 'zh-CN');
  assert.equal(readLocale({getItem: () => 'broken'}, ['en-US']), 'en-US');
  assert.doesNotThrow(() => persistLocale({setItem: () => {throw new Error('blocked');}}, 'en-US'));
  assert.equal(readLocale({getItem: () => {throw new Error('blocked');}}, ['en-US']), 'en-US');
});
