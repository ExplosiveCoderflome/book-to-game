/**
 * M1b-2 windows-exe export: prebuilt player + the M1b-1 HTML byte-for-byte + 52-byte footer (slice §5.2),
 * export_targets capability query (X5), report through the same JSON channel (X7). No Rust involved.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { GameContent, GameRevision } from '@novel-game/contracts';
import {
  EXE_TRAILER_LENGTH, EXE_TRAILER_MAGIC, HOST_API_VERSION, decodeExeTrailer, encodeExeTrailer, hasExeTrailer, loadPackage,
  MANIFEST_SCRIPT_ID, CONTENT_SCRIPT_ID,
} from '@novel-game/play-runtime';
import { AppError } from '../src/shared/errors.js';
import {
  CONTENT_PLACEHOLDER, ExportService, FsWindowsPlayerReader, MANIFEST_PLACEHOLDER, appendPayload, checkPlayerBinary,
  exeFileName, extractPayload, type ExportRevisionSources, type WindowsPlayerReader,
} from '../src/modules/exports/index.js';
import { fillDemoWorld } from './helpers/fill-fixture.js';

const TEMPLATE = `<!doctype html><html><head><title>player</title></head><body><div id="root"></div>${MANIFEST_PLACEHOLDER}${CONTENT_PLACEHOLDER}<script type="module">/*player*/</script></body></html>`;
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
/** A fake PE: "MZ" + padding. Real player = Tauri release build (apps/player-host). */
const fakePlayer = (n = 4096) => { const b = new Uint8Array(n); b[0] = 0x4d; b[1] = 0x5a; for (let i = 2; i < n; i++) b[i] = i % 251; return b; };

const story = (): GameRevision => ({
  id: 'rev-game-2', draftId: 'draft-game', sourceId: 'src', version: 2, createdAt: '2026-10-28T00:00:00.000Z',
  content: {
    title: '雾港', mode: 'story', premise: 'p', adaptationNotes: '', startSceneId: 'a', variables: {},
    scenes: [
      { id: 'a', title: '渡口', text: '你在渡口。', origin: 'adapted', evidence: [], choices: [{ id: 'go', label: '走', targetSceneId: 'b' }] },
      { id: 'b', title: '灯塔', text: '到了。', origin: 'adapted', evidence: [], choices: [{ id: 'up', label: '上塔', targetSceneId: 'c' }] },
      { id: 'c', title: '塔顶', text: '风很大。', origin: 'adapted', evidence: [], choices: [], ending: '灯塔' },
    ],
  } as GameContent,
});

function make(player: WindowsPlayerReader | null) {
  const w = fillDemoWorld();
  const sources: ExportRevisionSources = {
    getGameRevision: id => { if (id !== 'rev-game-2') throw new AppError('GAME_REVISION_NOT_FOUND', 'x', 404); return story(); },
    getWorldRevision: id => { if (id !== 'rev-world-3') throw new AppError('WORLD_REVISION_NOT_FOUND', 'x', 404); return { id, draftId: 'draft-world', sourceId: 's', version: 3, createdAt: '2026-10-28T00:00:00.000Z', content: w }; },
    buildingLibrary: () => ({ schemaVersion: 1, assets: [] }),
    itemCatalog: () => ({ schemaVersion: 1, items: [] }),
  };
  return new ExportService(sources, { read: () => null }, { read: () => TEMPLATE }, {
    appVersion: '0.2.0', now: () => '2026-10-28T08:00:00.000Z', secrets: () => [],
  }, player);
}
const reader = (bytes: Uint8Array | null, meta: { version?: string; hostApiVersion?: number } = {}): WindowsPlayerReader => ({
  location: () => 'dist/player/btg-player-windows-x64.exe',
  read: () => bytes ? { bytes, ...meta } : null,
});

test('trailer: 52-byte footer = BTGPKG01 · u64 LE length · raw sha256 · u32 LE hostApiVersion; round-trips', () => {
  const payload = new TextEncoder().encode('<!doctype html>你好');
  const footer = encodeExeTrailer(payload.length, sha(payload), 1);
  assert.equal(footer.length, EXE_TRAILER_LENGTH);
  assert.equal(Buffer.from(footer.subarray(0, 8)).toString('latin1'), EXE_TRAILER_MAGIC);
  assert.equal(Buffer.from(footer).readBigUInt64LE(8), BigInt(payload.length));
  assert.equal(Buffer.from(footer.subarray(16, 48)).toString('hex'), sha(payload));
  assert.equal(Buffer.from(footer).readUInt32LE(48), 1);

  const { exe, payloadSha256 } = appendPayload(fakePlayer(), payload);
  assert.equal(payloadSha256, sha(payload));
  const t = decodeExeTrailer(exe)!;
  assert.deepEqual(t, { payloadOffset: 4096, payloadLength: payload.length, payloadSha256: sha(payload), hostApiVersion: HOST_API_VERSION });
  const out = extractPayload(exe);
  assert.ok(out.ok && out.intact);
  assert.deepEqual(Buffer.from(out.payload), Buffer.from(payload));
});

test('trailer: absent / truncated / bogus length ⇒ null (player then looks for game.btgpkg.html); tamper ⇒ not intact', () => {
  assert.equal(decodeExeTrailer(fakePlayer()), null);
  assert.equal(decodeExeTrailer(new Uint8Array(10)), null);
  const payload = new TextEncoder().encode('x'.repeat(100));
  const { exe } = appendPayload(fakePlayer(64), payload);
  // Empty trailer (player alone) and a footer claiming more bytes than exist are both "no trailer".
  const lying = exe.slice(); Buffer.from(lying.buffer).writeBigUInt64LE(BigInt(1e9), lying.length - EXE_TRAILER_LENGTH + 8);
  assert.equal(decodeExeTrailer(lying), null);
  const zero = exe.slice(); Buffer.from(zero.buffer).writeBigUInt64LE(0n, zero.length - EXE_TRAILER_LENGTH + 8);
  assert.equal(decodeExeTrailer(zero), null);
  const tampered = exe.slice(); tampered[64 + 5] ^= 1;
  const r = extractPayload(tampered);
  assert.ok(r.ok && !r.intact);
  assert.throws(() => encodeExeTrailer(0, sha(payload)));
  assert.throws(() => encodeExeTrailer(1, 'nothex'));
});

test('player check: must be MZ, must not already carry a game, must speak a known host API', () => {
  assert.deepEqual(checkPlayerBinary(fakePlayer()), { ok: true });
  assert.deepEqual(checkPlayerBinary(new TextEncoder().encode('#!/bin/sh\n'.padEnd(100))), { ok: false, reason: 'player-invalid' });
  const packaged = appendPayload(fakePlayer(), new TextEncoder().encode('<html>')).exe;
  assert.equal(hasExeTrailer(packaged), true);
  assert.deepEqual(checkPlayerBinary(packaged), { ok: false, reason: 'player-already-packaged' });
  assert.deepEqual(checkPlayerBinary(fakePlayer(), 99), { ok: false, reason: 'player-host-api' });
  assert.equal(exeFileName('雾港-v3.html'), '雾港-v3.exe');
});

test('windows-exe export: payload is byte-identical to the html export; footer sha = report sha; fileName/size/player', () => {
  const player = fakePlayer(8192);
  const service = make(reader(player, { version: '0.1.0', hostApiVersion: 1 }));
  const html = service.exportPlayPackage({ kind: 'game', revisionId: 'rev-game-2', target: 'html' });
  const exe = service.exportPlayPackage({ kind: 'game', revisionId: 'rev-game-2', target: 'windows-exe' });
  assert.equal(html.target, 'html');
  assert.equal(html.payloadSha256, sha(Buffer.from(html.html, 'utf8')));
  assert.equal(exe.target, 'windows-exe');
  assert.equal(exe.fileName, '雾港-v2.exe');
  assert.equal(exe.html, '');
  const bytes = new Uint8Array(Buffer.from(exe.fileBase64!, 'base64'));
  assert.equal(exe.size, bytes.length);
  assert.equal(bytes.length, player.length + Buffer.byteLength(html.html) + EXE_TRAILER_LENGTH);
  assert.deepEqual(Buffer.from(bytes.subarray(0, player.length)), Buffer.from(player));
  const out = extractPayload(bytes);
  assert.ok(out.ok && out.intact);
  assert.equal(Buffer.from(out.payload).toString('utf8'), html.html, 'payload must be the M1b-1 HTML byte-for-byte');
  assert.equal(exe.payloadSha256, html.payloadSha256);
  assert.equal(out.trailer.payloadSha256, exe.payloadSha256);
  assert.deepEqual(exe.player, { version: '0.1.0', hostApiVersion: 1 });
  // Same manifest/content inside: the offline loader accepts it.
  const grab = (id: string) => html.html.match(new RegExp(`<script id="${id}" type="application/json">([\\s\\S]*?)</script>`))?.[1] ?? null;
  assert.ok(loadPackage(grab(MANIFEST_SCRIPT_ID), grab(CONTENT_SCRIPT_ID)).ok);
  // World too.
  const world = service.exportPlayPackage({ kind: 'world', revisionId: 'rev-world-3', target: 'windows-exe' });
  assert.equal(world.mode, 'open');
  assert.match(world.fileName, /-v3\.exe$/);
});

test('windows-exe export without a usable player ⇒ EXPORT_TARGET_UNAVAILABLE (501) with details.playerPath; html unaffected', () => {
  for (const [service, reason] of [[make(null), 'player-missing'], [make(reader(null)), 'player-missing'], [make(reader(new Uint8Array(200))), 'player-invalid']] as const) {
    try { service.exportPlayPackage({ kind: 'game', revisionId: 'rev-game-2', target: 'windows-exe' }); assert.fail('expected'); } catch (e) {
      assert.ok(e instanceof AppError);
      assert.equal(e.code, 'EXPORT_TARGET_UNAVAILABLE');
      assert.equal(e.status, 501);
      assert.deepEqual(e.details, { target: 'windows-exe', playerPath: 'dist/player/btg-player-windows-x64.exe', unavailableReason: reason });
    }
    assert.equal(service.exportPlayPackage({ kind: 'game', revisionId: 'rev-game-2' }).target, 'html');
  }
});

test('export_targets (X5): availability + reason + player meta; never throws', () => {
  assert.deepEqual(make(null).exportTargets(), {
    html: { available: true },
    'windows-exe': { available: false, unavailableReason: 'player-missing', playerPath: 'dist/player/btg-player-windows-x64.exe' },
  });
  assert.deepEqual(make(reader(fakePlayer(), { version: '0.1.0' })).exportTargets()['windows-exe'],
    { available: true, playerPath: 'dist/player/btg-player-windows-x64.exe', version: '0.1.0', hostApiVersion: 1 });
  assert.equal(make(reader(fakePlayer(), { hostApiVersion: 7 })).exportTargets()['windows-exe'].unavailableReason, 'player-host-api');
});

test('FsWindowsPlayerReader: missing file ⇒ null; sidecar json supplies version/hostApiVersion; location is repo-relative', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'btg-player-'));
  const file = path.join(dir, 'dist', 'player', 'btg-player-windows-x64.exe');
  const r = new FsWindowsPlayerReader(file, dir);
  assert.equal(r.read(), null);
  assert.equal(r.location(), 'dist/player/btg-player-windows-x64.exe');
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, fakePlayer());
  writeFileSync(file.replace(/\.exe$/, '.json'), JSON.stringify({ version: '0.1.0', hostApiVersion: 1 }));
  const got = r.read()!;
  assert.equal(got.bytes.length, 4096);
  assert.equal(got.version, '0.1.0');
  assert.equal(got.hostApiVersion, 1);
});
