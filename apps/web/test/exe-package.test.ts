/**
 * M1b-2 page side: host save store (preload + write-behind, X11), tiered fallback, stable numbering (X14),
 * exe copy, and the author-side exe report helpers (X5/X7). The host here is a fake `__BTG_HOST__`.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { HOST_INDEX_ID, RUNTIME_VERSION, type BtgHost, type GameRevision, type PackageManifest } from '@novel-game/play-runtime';
import { HostFileSaveStore } from '../src/package/host-file-save-store';
import { openPackageSaveStore } from '../src/package/open-save-store';
import { packageStoryPort, ordinals } from '../src/package/package-ports';
import {
  EXE_PACKAGE_COPY, FORBIDDEN_PACKAGE_WORDS, SAVE_LOCATION_COPY, packageErrorMessage,
} from '../src/package/package-copy';
import { saveFolderPath } from '../src/package/SaveLocationHint';
import { bootPackage } from '../src/package/boot';
import { classifyExportError, exportHint, reportFileBytes, reportMime } from '../src/lib/export-report';
import { availabilityOf } from '../src/lib/export-targets';
import { englishTranslations } from '../src/lib/locale';

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length() { return this.map.size; }
  clear() { this.map.clear(); }
  getItem(k: string) { return this.map.get(k) ?? null; }
  key(i: number) { return [...this.map.keys()][i] ?? null; }
  removeItem(k: string) { this.map.delete(k); }
  setItem(k: string, v: string) { this.map.set(k, v); }
}

/** Fake Windows host: one folder per packageId, async like Tauri invoke; can be made read-only. */
class FakeHost implements BtgHost {
  hostApiVersion = 1;
  readonly dirs = new Map<string, Map<string, string>>();
  readOnly = false;
  listFails = false;
  writes: string[] = [];
  dir(p: string) { if (!this.dirs.has(p)) this.dirs.set(p, new Map()); return this.dirs.get(p)!; }
  async saveList(p: string) { if (this.listFails) throw new Error('io'); return [...this.dir(p).keys()].sort(); }
  async saveRead(p: string, id: string) { return this.dir(p).get(id) ?? null; }
  async saveWrite(p: string, id: string, json: string) {
    await Promise.resolve();
    if (this.readOnly) throw new Error('EACCES');
    this.writes.push(id);
    this.dir(p).set(id, json);
  }
  async saveDelete(p: string, id: string) { this.dir(p).delete(id); }
}

const rev: GameRevision = {
  id: 'r1', draftId: 'd', sourceId: 's', version: 1, createdAt: '2026-10-28T00:00:00.000Z',
  content: { title: '雾港', mode: 'story', premise: 'p', adaptationNotes: '', startSceneId: 'a', variables: {}, scenes: [
    { id: 'a', title: 'A', text: 'a', origin: 'adapted', evidence: [], choices: [{ id: 'stay', label: '留下', targetSceneId: 'a' }, { id: 'go', label: '走', targetSceneId: 'b' }] },
    { id: 'b', title: 'B', text: 'b', origin: 'adapted', evidence: [], choices: [], ending: 'E' },
    { id: 'c', title: 'C', text: 'c', origin: 'adapted', evidence: [], choices: [], ending: 'E2' },
  ] },
} as GameRevision;
const manifest = { packageId: 'btg-game-d', title: '雾港', runtimeVersion: RUNTIME_VERSION, revision: { id: 'r1', version: 1 } } as unknown as PackageManifest;
const PKG = manifest.packageId;
const scope = (host?: Partial<BtgHost>) => (host ? { __BTG_HOST__: host } : {});

describe('HostFileSaveStore (exe saves folder, X11/X14)', () => {
  it('preloads every save; order = index.json, then files not in the index by name; reserved id never listed', async () => {
    const host = new FakeHost();
    const dir = host.dir(PKG);
    dir.set('zz', '{"n":3}'); dir.set('aa', '{"n":1}'); dir.set('copied-in', '{"n":9}');
    dir.set(HOST_INDEX_ID, JSON.stringify(['zz', 'aa', 'gone']));
    const { store, probeOk } = await HostFileSaveStore.open(host, PKG);
    assert.equal(probeOk, true);
    assert.deepEqual(store.list(), ['zz', 'aa', 'copied-in']);
    assert.equal(store.read('aa'), '{"n":1}');
    assert.deepEqual(JSON.parse(dir.get(HOST_INDEX_ID)!), ['zz', 'aa', 'copied-in'], 'probe rewrote the index atomically');
  });

  it('writes are visible synchronously and flushed in order; repeated writes to one id coalesce; index tracks creation order', async () => {
    const host = new FakeHost();
    const { store } = await HostFileSaveStore.open(host, PKG);
    host.writes = [];
    store.write('s1', '{"v":1}');
    store.write('s1', '{"v":2}');
    store.write('s2', '{"v":1}');
    assert.equal(store.read('s1'), '{"v":2}');
    await store.whenIdle();
    assert.equal(host.dir(PKG).get('s1'), '{"v":2}');
    assert.deepEqual(JSON.parse(host.dir(PKG).get(HOST_INDEX_ID)!), ['s1', 's2']);
    assert.equal(host.writes.filter(w => w === 's1').length, 1, 'coalesced');
    store.delete('s1');
    await store.whenIdle();
    assert.equal(host.dir(PKG).has('s1'), false);
    assert.deepEqual(JSON.parse(host.dir(PKG).get(HOST_INDEX_ID)!), ['s2']);
  });
});

describe('openPackageSaveStore: where saves go (UI plan §4.3)', () => {
  it('no host ⇒ browser; no storage either ⇒ unsaved browser', async () => {
    const a = await openPackageSaveStore(PKG, scope(), () => new MemoryStorage());
    assert.deepEqual(a.store.status, { persistent: true, where: 'browser' });
    const b = await openPackageSaveStore(PKG, scope(), () => null);
    assert.deepEqual(b.store.status, { persistent: false, reason: 'unavailable', where: 'browser' });
  });

  it('host ok ⇒ host-file; unknown hostApiVersion ⇒ host-fallback(host-version); list throws ⇒ host-fallback(host-unavailable)', async () => {
    const host = new FakeHost();
    assert.deepEqual((await openPackageSaveStore(PKG, scope(host), () => new MemoryStorage())).store.status, { persistent: true, where: 'host-file' });
    const v99 = Object.assign(new FakeHost(), { hostApiVersion: 99 });
    assert.deepEqual((await openPackageSaveStore(PKG, scope(v99), () => new MemoryStorage())).store.status,
      { persistent: true, where: 'host-fallback', fallbackReason: 'host-version' });
    // Player v1 running a payload whose footer says another host API (player checks at runtime, injects both).
    const mismatch = Object.assign(new FakeHost(), { payloadHostApiVersion: 2 });
    assert.deepEqual((await openPackageSaveStore(PKG, scope(mismatch), () => new MemoryStorage())).store.status,
      { persistent: true, where: 'host-fallback', fallbackReason: 'host-version' });
    const broken = Object.assign(new FakeHost(), { listFails: true });
    assert.deepEqual((await openPackageSaveStore(PKG, scope(broken), () => new MemoryStorage())).store.status,
      { persistent: true, where: 'host-fallback', fallbackReason: 'host-unavailable' });
    // Fallback AND no storage: unsaved, but still the exe context (copy never says 浏览器).
    assert.deepEqual((await openPackageSaveStore(PKG, scope(v99), () => null)).store.status,
      { persistent: false, reason: 'unavailable', where: 'host-fallback', fallbackReason: 'host-version' });
  });

  it('read-only saves folder at boot ⇒ host-fallback(write-failed); existing folder saves stay readable', async () => {
    const host = new FakeHost();
    host.dir(PKG).set('old', '{"state":{"turn":3}}');
    host.readOnly = true;
    const { store } = await openPackageSaveStore(PKG, scope(host), () => new MemoryStorage());
    assert.deepEqual(store.status, { persistent: true, where: 'host-fallback', fallbackReason: 'host-write-failed' });
    assert.equal(store.read('old'), '{"state":{"turn":3}}');
    store.write('new', '{"state":{"turn":0}}');
    assert.equal(store.isFallback('new'), true);
    assert.equal(store.isFallback('old'), false);
  });

  it('async flush failure mid-game ⇒ banner state + record re-homed to temporary storage; nothing lost', async () => {
    const host = new FakeHost();
    const storage = new MemoryStorage();
    const { store, host: file } = await openPackageSaveStore(PKG, scope(host), () => storage);
    const seen: string[] = [];
    store.onStatus(s => seen.push(`${s.where}:${s.fallbackReason ?? ''}`));
    store.write('s1', '{"state":{"turn":1,"updatedAt":"a"}}');
    await file!.whenIdle();
    host.readOnly = true;
    store.write('s1', '{"state":{"turn":2,"updatedAt":"b"}}');
    await file!.whenIdle();
    assert.deepEqual(seen, ['host-fallback:host-write-failed']);
    assert.equal(store.read('s1'), '{"state":{"turn":2,"updatedAt":"b"}}');
    assert.equal(store.isFallback('s1'), true);
    assert.equal(storage.getItem(`btg:pkg:${PKG}:save:s1`), '{"state":{"turn":2,"updatedAt":"b"}}');
    // Next write goes straight to the fallback (degrade only goes down in-process).
    store.write('s2', '{"state":{"turn":0}}');
    assert.equal(store.isFallback('s2'), true);
  });

  it('next launch: fallback saves still listed + tagged; continuing writes to the folder and the tag goes (newest wins)', async () => {
    const host = new FakeHost();
    const storage = new MemoryStorage();
    storage.setItem(`btg:pkg:${PKG}:index`, JSON.stringify(['s1']));
    storage.setItem(`btg:pkg:${PKG}:save:s1`, '{"state":{"turn":2,"updatedAt":"b"}}');
    host.dir(PKG).set('s1', '{"state":{"turn":1,"updatedAt":"a"}}');
    const { store, host: file } = await openPackageSaveStore(PKG, scope(host), () => storage);
    assert.deepEqual(store.list(), ['s1'], 'same id in both places is listed once');
    assert.equal(store.read('s1'), '{"state":{"turn":2,"updatedAt":"b"}}', 'newer copy wins');
    assert.equal(store.isFallback('s1'), true);
    store.write('s1', '{"state":{"turn":3,"updatedAt":"c"}}');
    await file!.whenIdle();
    assert.equal(store.isFallback('s1'), false);
    assert.equal(host.dir(PKG).get('s1'), '{"state":{"turn":3,"updatedAt":"c"}}');
  });
});

describe('replay + numbering over the exe store', () => {
  it('same requestId replayed (even across a failed flush) never advances twice', async () => {
    const host = new FakeHost();
    const { store, host: file } = await openPackageSaveStore(PKG, scope(host), () => new MemoryStorage());
    const { local } = packageStoryPort(manifest, { revision: rev } as never, store);
    const s = local.start('r1');
    const first = local.act(s.id, { choiceId: 'stay', expectedTurn: 0, requestId: '11111111-1111-4111-8111-000000000001' } as never);
    host.readOnly = true; // the disk write of that turn fails after the fact
    await file!.whenIdle();
    const again = local.act(s.id, { choiceId: 'stay', expectedTurn: 0, requestId: '11111111-1111-4111-8111-000000000001' } as never);
    assert.deepEqual(again, first);
    assert.equal(local.get(s.id).turn, 1);
    assert.equal(store.status.where, 'host-fallback');
    assert.equal(store.isFallback(s.id), true, 'the turn that failed on disk now lives in temporary storage');
  });

  it('「存档 n」 follows creation order; a corrupt save keeps its number and the others do not shift (X14)', async () => {
    const host = new FakeHost();
    const { store, host: file } = await openPackageSaveStore(PKG, scope(host), () => new MemoryStorage());
    const { local, port } = packageStoryPort(manifest, { revision: rev } as never, store);
    const ids = [local.start('r1').id, local.start('r1').id, local.start('r1').id];
    store.write(ids[0]!, '{garbage');
    await file!.whenIdle();
    const rows = port.rows!(((s: string, v?: Record<string, unknown>) => s.replace('{turn}', String(v?.turn ?? ''))) as never);
    const byId = new Map(rows.map(r => [r.id, r]));
    assert.equal(byId.get(ids[0]!)!.ordinal, 1);
    assert.ok(byId.get(ids[0]!)!.blockedReason);
    assert.equal(byId.get(ids[1]!)!.ordinal, 2);
    assert.equal(byId.get(ids[2]!)!.ordinal, 3);
    assert.equal(rows.at(-1)!.id, ids[0], 'corrupt row still listed after the continuable ones');
    assert.deepEqual([...ordinals(['x', 'y'])], [['x', 1], ['y', 2]]);
  });
});

describe('exe copy + boot', () => {
  it('exe sentences never say 浏览器 or the forbidden words; every one has English', () => {
    for (const line of [...EXE_PACKAGE_COPY, packageErrorMessage({ code: 'SESSION_NOT_FOUND' }, 'host-file'), packageErrorMessage({ code: 'SESSION_NOT_FOUND' }, 'host-fallback')]) {
      assert.ok(!line.includes('浏览器'), line);
      for (const word of FORBIDDEN_PACKAGE_WORDS) assert.ok(!line.includes(word), line);
      assert.ok(englishTranslations[line], `missing en-US: ${line}`);
    }
    assert.equal(packageErrorMessage({ code: 'SESSION_NOT_FOUND' }), '没有找到这个存档，可能已在这个浏览器里被清除。');
    assert.equal(SAVE_LOCATION_COPY.browser.footHint, '存档只保存在这台设备的这个浏览器里。');
    assert.equal(saveFolderPath(PKG), '%APPDATA%\\BookToGame\\Player\\saves\\btg-game-d\\');
  });

  it('host says payload sha mismatched ⇒ the same 「已损坏」 page (no native dialog)', () => {
    const doc = { getElementById: () => null } as unknown as Document;
    assert.equal(bootPackage(doc, {}).ok, false);
    const r = bootPackage(doc, { __BTG_HOST__: { payloadIntact: false } });
    assert.ok(!r.ok && r.kind === 'corrupt');
  });
});

describe('author exe export helpers (X5/X7)', () => {
  it('EXPORT_TARGET_UNAVAILABLE is its own state (muted, not a failure) and carries playerPath', () => {
    assert.deepEqual(classifyExportError('EXPORT_TARGET_UNAVAILABLE', { playerPath: 'dist/player/btg-player-windows-x64.exe' }),
      { kind: 'target-unavailable', playerPath: 'dist/player/btg-player-windows-x64.exe' });
    assert.deepEqual(classifyExportError('EXPORT_TARGET_UNAVAILABLE', {}), { kind: 'target-unavailable' });
  });
  it('exe bytes come from fileBase64 through the same report; html from text', () => {
    const exe = reportFileBytes({ html: '', fileBase64: Buffer.from([0x4d, 0x5a, 0, 255]).toString('base64') });
    assert.deepEqual([...exe], [0x4d, 0x5a, 0, 255]);
    assert.deepEqual([...reportFileBytes({ html: 'é' })], [0xc3, 0xa9]);
    assert.equal(reportMime({ target: 'windows-exe' }), 'application/vnd.microsoft.portable-executable');
    assert.equal(reportMime({}), 'text/html;charset=utf-8');
  });
  it('one hint joined with 「 · 」; capability query → ready/missing/unknown', () => {
    assert.equal(exportHint(['导出的是已发布 v3', false, 'Windows 播放器未就绪，网页版可正常导出']), '导出的是已发布 v3 · Windows 播放器未就绪，网页版可正常导出');
    assert.equal(exportHint([false, '']), '');
    assert.equal(availabilityOf({ html: { available: true }, 'windows-exe': { available: true } }), 'ready');
    assert.equal(availabilityOf({ html: { available: true }, 'windows-exe': { available: false } }), 'missing');
    assert.equal(availabilityOf(null), 'unknown');
  });
  it('every author exe string has English', () => {
    for (const key of ['导出 Windows 版', '生成一个 .exe 文件，对方在 Windows 10/11 上双击即可离线游玩', 'Windows 播放器未就绪，网页版可正常导出',
      ' · Windows 版', '播放器 {version}', '宿主接口 v{hostApiVersion}', 'Windows 播放器未就绪，未生成文件。网页版可正常导出。', '需要文件：{path}',
      '正在打包：校验版本 → 冻结目录 → 内联图片 → 生成网页 → 装入 Windows 播放器',
      '未签名：对方第一次打开时，Windows 可能提示「Windows 已保护你的电脑」，点「更多信息」→「仍要运行」即可。需要 Windows 10 或 11（64 位）。']) {
      assert.ok(englishTranslations[key], `missing en-US: ${key}`);
    }
  });
});
