import assert from 'node:assert/strict';
import { test } from 'node:test';
import { authorReadSchema } from '@novel-game/contracts';
import { readAuthorValue } from '../src/shared/author-read.js';

test('author reads: collection pages preserve every entry and large children have explicit followable references', () => {
  const cards = Array.from({length: 23}, (_, i) => ({id: `card-${i}`, title: `剧情卡${i}`, text: '正文'.repeat(1000), effects: [{kind: 'ending', endingId: `e${i}`}]}));
  let offset = 0; const ids: string[] = [];
  do {
    const page = readAuthorValue({cards}, authorReadSchema.parse({path: ['cards'], offset, limit: 7}));
    assert.equal(page.type, 'array'); assert.ok(JSON.stringify(page).length < 16000);
    for (const entry of page.entries!) {
      assert.equal(entry.reference, true); assert.equal('value' in entry, false);
      const exact = readAuthorValue({cards}, authorReadSchema.parse({path: entry.path}));
      assert.equal(exact.type, 'value'); assert.deepEqual(exact.value, cards[Number(entry.key)]);
      ids.push((exact.value as {id: string}).id);
    }
    offset = page.nextOffset ?? cards.length;
  } while (offset < cards.length);
  assert.deepEqual(ids, cards.map(c => c.id));
});

test('author reads: long text and large objects can be read completely without slicing JSON', () => {
  const text = '客栈里的线索。'.repeat(2400), root = {texts: Object.fromEntries(Array.from({length: 12}, (_, i) => [`unit:${i}`, text]))};
  const directory = readAuthorValue(root, authorReadSchema.parse({path: ['texts']}));
  assert.equal(directory.type, 'object'); assert.equal(directory.nextOffset, 5);
  assert.equal(directory.entries![0]!.reference, true);
  let restored = '', offset: number | null = 0;
  while (offset !== null) {
    const page = readAuthorValue(root, authorReadSchema.parse({path: ['texts', 'unit:0'], offset}));
    assert.ok(JSON.stringify(page).length < 16000); restored += page.value; offset = page.nextOffset!;
  }
  assert.equal(restored, text);
  assert.throws(() => readAuthorValue(root, authorReadSchema.parse({path: ['constructor']})), {code: 'READ_PATH_NOT_FOUND'});
  assert.throws(() => readAuthorValue(root, authorReadSchema.parse({path: ['texts', 'missing']})), {code: 'READ_PATH_NOT_FOUND'});
});

test('author reads: deep paths still fit a tool receipt and empty/beyond-end pages terminate', () => {
  const path = Array.from({length: 15}, (_, i) => `${i}${'x'.repeat(150)}`);
  const leaf = Array.from({length: 30}, (_, i) => ({id: String(i), text: '长文'.repeat(1000)}));
  let root: unknown = leaf; for (const key of [...path].reverse()) root = {[key]: root};
  const page = readAuthorValue(root, authorReadSchema.parse({path, limit: 10}));
  assert.ok(JSON.stringify(page).length < 16000); assert.ok(page.entries!.length < 10);
  assert.equal(page.nextOffset, page.entries!.length);
  const end = readAuthorValue([], authorReadSchema.parse({path: [], offset: 100}));
  assert.deepEqual(end.entries, []); assert.equal(end.nextOffset, null);
  assert.throws(() => readAuthorValue([], authorReadSchema.parse({path: ['length']})), {code: 'READ_PATH_NOT_FOUND'});
});
