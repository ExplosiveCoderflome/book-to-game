/** M1b-1 runtime pieces used by the offline player: sha256, package loader, guarded saves, replay window. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import {
  GuardedSaveStore, MemorySaveStore, PACKAGE_FORMAT_VERSION, contentHashOf, createLocalStoryPort, loadPackage,
  scriptSafeJson, sha256Hex, type SaveStore,
} from '@novel-game/play-runtime';
import type { GameRevision } from '@novel-game/contracts';

test('sha256Hex (pure, browser-safe) matches node:crypto', () => {
  for (const text of ['', 'abc', '中文 · 存档', 'x'.repeat(1000), '\u2028emoji😀', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64)]) {
    assert.equal(sha256Hex(text), createHash('sha256').update(text, 'utf8').digest('hex'), JSON.stringify(text.slice(0, 10)));
  }
});

const content = scriptSafeJson({ revision: { id: 'r1', content: { title: 'T' } } });
const manifest = (over: Record<string, unknown> = {}) => JSON.stringify({
  formatVersion: PACKAGE_FORMAT_VERSION, packageId: 'btg-game-d', mode: 'story', title: 'T', contentHash: contentHashOf(content), ...over,
});

test('loadPackage: ok / corrupt (missing, garbled, hash mismatch) / format-newer', () => {
  assert.equal(loadPackage(manifest(), content).ok, true);
  assert.deepEqual(loadPackage(null, content), { ok: false, kind: 'corrupt', reason: 'missing-script' });
  assert.equal((loadPackage('{oops', content) as { kind: string }).kind, 'corrupt');
  const tampered = content.replace('"T"', '"U"');
  assert.deepEqual(loadPackage(manifest(), tampered), { ok: false, kind: 'corrupt', reason: 'content-hash', title: 'T' });
  const newer = loadPackage(manifest({ formatVersion: PACKAGE_FORMAT_VERSION + 1 }), content);
  assert.equal(newer.ok, false);
  assert.equal((newer as { kind: string }).kind, 'format-newer');
  assert.equal((loadPackage(manifest({ mode: 'other' }), content) as { kind: string }).kind, 'corrupt');
  assert.equal((loadPackage(manifest({ mode: 'open' }), content) as { reason: string }).reason, 'catalog-missing');
});

class FullStore extends MemorySaveStore {
  write(): void { throw new DOMException('quota', 'QuotaExceededError'); }
}

test('GuardedSaveStore: no storage ⇒ memory + reason unavailable; quota ⇒ write-failed, listeners told, isUnsaved', () => {
  const none = new GuardedSaveStore(null);
  assert.deepEqual(none.status, { persistent: false, reason: 'unavailable', where: 'browser' });
  none.write('a', '1');
  assert.equal(none.read('a'), '1');
  assert.equal(none.isUnsaved('a'), true);

  const full = new FullStore();
  const guarded = new GuardedSaveStore(full as SaveStore);
  const seen: unknown[] = [];
  guarded.onStatus(s => seen.push(s));
  assert.equal(guarded.status.persistent, true);
  guarded.write('b', '2');
  assert.deepEqual(guarded.status, { persistent: false, reason: 'write-failed', where: 'browser' });
  assert.deepEqual(seen, [{ persistent: false, reason: 'write-failed', where: 'browser' }]);
  assert.equal(guarded.read('b'), '2');
  assert.deepEqual(guarded.list(), ['b']);
});

const rev: GameRevision = {
  id: 'r1', draftId: 'd', sourceId: 's', version: 1, createdAt: '2026-10-28T00:00:00.000Z',
  content: { title: 'Loop', mode: 'story', premise: 'p', adaptationNotes: '', startSceneId: 'a', variables: {}, scenes: [
    { id: 'a', title: 'A', text: 'a', origin: 'adapted', evidence: [], choices: [{ id: 'stay', label: '留下', targetSceneId: 'a' }, { id: 'go', label: '走', targetSceneId: 'b' }] },
    { id: 'b', title: 'B', text: 'b', origin: 'adapted', evidence: [], choices: [], ending: 'E' },
    { id: 'c', title: 'C', text: 'c', origin: 'adapted', evidence: [], choices: [], ending: 'E2' },
  ] },
};

test('local save keeps only the last N events (replay window) and is partitioned by packageId', () => {
  const store = new MemorySaveStore();
  let n = 0;
  const port = createLocalStoryPort(rev, { packageId: 'p1', store, newId: () => `id-${++n}`, eventLimit: 3 });
  const s = port.start('r1');
  let view = s;
  const rid = (i: number) => `11111111-1111-4111-8111-${String(i).padStart(12, '0')}`;
  for (let i = 1; i <= 5; i++) view = port.act(s.id, { choiceId: 'stay', expectedTurn: view.turn, requestId: rid(i) });
  const record = JSON.parse(store.read(s.id)!);
  assert.equal(record.events.length, 3);
  assert.deepEqual(record.events.map((e: { requestId: string }) => e.requestId), [rid(3), rid(4), rid(5)]);
  // replay of a kept request returns the same view; a different input is a conflict
  assert.deepEqual(port.act(s.id, { choiceId: 'stay', expectedTurn: 4, requestId: rid(5) }), view);
  assert.throws(() => port.act(s.id, { choiceId: 'go', expectedTurn: 4, requestId: rid(5) }), /同一请求/);

  const other = createLocalStoryPort(rev, { packageId: 'p2', store, newId: () => 'x' });
  assert.equal(other.slots()[0].status, 'blocked'); // another package's save is never playable here
});

test('GuardedSaveStore tiers (M1b-2): host → fallback → memory; same id in two tiers ⇒ newer (turn, updatedAt) wins', async () => {
  const { detectHost } = await import('@novel-game/play-runtime');
  const host = new MemorySaveStore();
  const fallback = new MemorySaveStore();
  host.write('s', JSON.stringify({ state: { turn: 9, updatedAt: 'z' } }));
  fallback.write('s', JSON.stringify({ state: { turn: 10, updatedAt: 'a' } }));
  const g = new GuardedSaveStore({ store: host, where: 'host-file' }, { fallback: { store: fallback, where: 'host-fallback' } });
  assert.equal(JSON.parse(g.read('s')!).state.turn, 10, 'numeric turn, not string compare');
  assert.equal(g.isFallback('s'), true);
  assert.deepEqual(g.list(), ['s']);
  const failing = new FullStore();
  const chain = new GuardedSaveStore({ store: failing as SaveStore, where: 'host-file' }, { fallback: { store: new FullStore() as SaveStore, where: 'host-fallback' } });
  const seen: unknown[] = [];
  chain.onStatus(s => seen.push(s));
  chain.write('a', '{}');
  assert.deepEqual(seen, [
    { persistent: true, where: 'host-fallback', fallbackReason: 'host-write-failed' },
    { persistent: false, reason: 'write-failed', where: 'host-fallback', fallbackReason: 'host-write-failed' },
  ]);
  assert.equal(chain.isUnsaved('a'), true);
  assert.equal(detectHost({}).kind, 'none');
  assert.equal(detectHost({ __BTG_HOST__: { hostApiVersion: 99 } }).kind, 'unsupported');
  const fns = { saveList: async () => [], saveRead: async () => null, saveWrite: async () => {}, saveDelete: async () => {} };
  assert.equal(detectHost({ __BTG_HOST__: { hostApiVersion: 1, ...fns } }).kind, 'ok');
  assert.equal(detectHost({ __BTG_HOST__: { hostApiVersion: 1, payloadHostApiVersion: 1, ...fns } }).kind, 'ok');
  assert.equal(detectHost({ __BTG_HOST__: { hostApiVersion: 1, payloadHostApiVersion: 2, ...fns } }).kind, 'unsupported',
    'player and footer disagree ⇒ host-fallback');
});
