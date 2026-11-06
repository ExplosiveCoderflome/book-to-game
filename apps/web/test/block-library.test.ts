import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { getBlock, getFunProfile, type CatalogEntry } from '@novel-game/contracts';
import {
  catalogEntryDescription, catalogEntryTitle, copyForCustom, filterCatalogEntries, suggestCustomId,
} from '../src/lib/block-library-utils.ts';
import { workbenchTabFromHash } from '../src/lib/workbench-navigation.ts';
import { translate } from '../src/lib/locale.ts';
import { I18nProvider } from '../src/lib/i18n.tsx';
import { BlockLibraryPage } from '../src/components/block-library/BlockLibraryPage.tsx';
import { upsertCatalogEntry } from '../src/lib/block-library-api.ts';

const entry = (id = 'clock', origin: 'builtin' | 'custom' = 'builtin'): CatalogEntry<'block'> => ({
  kind: 'block', id, version: 1, origin, data: {...getBlock('clock')!, id},
});

test('block library filters by funTag, query and author-facing text', () => {
  const entries = [entry(), entry('custom_clock', 'custom')];
  assert.equal(filterCatalogEntries(entries, '', 'healing-routine').length, 2);
  assert.equal(filterCatalogEntries(entries, '', 'grinding').length, 0);
  assert.equal(filterCatalogEntries(entries, 'custom').length, 1);
  assert.equal(filterCatalogEntries(entries, '推进时间').length, 2);
  assert.equal(catalogEntryTitle(entries[0]!), '时钟');
  assert.match(catalogEntryDescription(entries[0]!), /时间/);
});

test('block library copy creates a unique versioned id and does not mutate the built-in', () => {
  const entries = [entry(), entry('clock_custom', 'custom')];
  assert.equal(suggestCustomId(entries, 'clock'), 'clock_custom_2');
  const copied = copyForCustom(entries[0]!, entries);
  assert.equal(copied.id, 'clock_custom_2');
  assert.equal(copied.version, 1);
  copied.params[0]!.default = 'day';
  assert.equal(entries[0]!.data.params[0]!.default, 'month');
});

test('block library navigation and English copy are wired', () => {
  assert.equal(workbenchTabFromHash('#blocks'), 'blocks');
  assert.equal(translate('en-US', '积木库'), 'Block library');
  assert.match(translate('en-US', '高级定义（JSON）'), /Advanced definition/);
  const html = renderToString(createElement(I18nProvider, {initialLocale: 'en-US'}, createElement(BlockLibraryPage, {token: ''})));
  assert.match(html, /Block library/);
  assert.match(html, /Loading block library/);
  assert.match(html, /Fun profiles/);
  assert.match(html, /Simulation strategies/);
});

test('block library API sends full data and expectedVersion to the stable maintenance route', async () => {
  const previousFetch = globalThis.fetch;
  let requestedUrl = '';
  let requestedInit: RequestInit | undefined;
  globalThis.fetch = async (input, init) => {
    requestedUrl = String(input); requestedInit = init;
    return new Response(JSON.stringify(entry('clock_custom', 'custom')), {status: 200, headers: {'Content-Type': 'application/json'}});
  };
  try {
    const data = {...getBlock('clock')!, id: 'clock_custom'};
    await upsertCatalogEntry('', 'block', data, 3);
    assert.equal(requestedUrl, '/api/settings/block-library/blocks/clock_custom');
    assert.equal(requestedInit?.method, 'PUT');
    const body = JSON.parse(String(requestedInit?.body)) as {expectedVersion: number; data: {id: string}};
    assert.equal(body.expectedVersion, 3);
    assert.equal(body.data.id, 'clock_custom');
  } finally { globalThis.fetch = previousFetch; }
});

test('block library profile fixtures keep custom strategy ids as catalog data', () => {
  const profile = {...getFunProfile('default')!, id: 'author_profile', strategies: ['random_custom']};
  const custom: CatalogEntry<'fun-profile'> = {kind: 'fun-profile', id: profile.id, version: 1, origin: 'custom', data: profile};
  assert.deepEqual(custom.data.strategies, ['random_custom']);
  assert.equal(catalogEntryTitle(custom), '通用基线');
});
