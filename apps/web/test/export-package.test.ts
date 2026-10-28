import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyExportError, exportScopeKey, formatSize, groupDegraded, secretLocationLabel, stateForScope } from '../src/lib/export-report';
import { LocalStorageSaveStore, indexKey, saveKey } from '../src/package/local-storage-save-store';
import { parsePackageRoute, saveHash, startHash } from '../src/package/package-route';
import { FORBIDDEN_PACKAGE_WORDS, PACKAGE_COPY, packageErrorMessage } from '../src/package/package-copy';
import { englishTranslations } from '../src/lib/locale';

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  quotaAfter = Infinity;
  get length() { return this.map.size; }
  clear() { this.map.clear(); }
  getItem(k: string) { return this.map.get(k) ?? null; }
  key(i: number) { return [...this.map.keys()][i] ?? null; }
  removeItem(k: string) { this.map.delete(k); }
  setItem(k: string, v: string) {
    if (!k.startsWith('btg:probe:') && this.map.size >= this.quotaAfter) throw new DOMException('full', 'QuotaExceededError');
    this.map.set(k, v);
  }
}

describe('export report helpers (author UI)', () => {
  it('formats sizes: <1MB rounded KB, ≥1MB one-decimal MB', () => {
    assert.equal(formatSize(300), '1 KB');
    assert.equal(formatSize(2_841 * 1024 + 300), '2.8 MB');
    assert.equal(formatSize(512 * 1024), '512 KB');
    assert.equal(formatSize(20 * 1024 * 1024), '20.0 MB');
  });

  it('maps every export error code to a failure class; unknown → other', () => {
    assert.equal(classifyExportError('EXPORT_REVISION_NOT_PUBLISHED', undefined).kind, 'not-published');
    assert.deepEqual(classifyExportError('EXPORT_CONTENT_INVALID', { issues: ['场景缺少选项', 3] }), { kind: 'invalid', issues: ['场景缺少选项'] });
    assert.deepEqual(classifyExportError('EXPORT_TOO_LARGE', { size: 25, limit: 20 }), { kind: 'too-large', size: 25, limit: 20 });
    assert.deepEqual(classifyExportError('EXPORT_UNSUPPORTED_CONTENT', { items: [{ kind: 'building-asset', label: '钟楼', ref: 'b1' }] }),
      { kind: 'unsupported', items: [{ kind: 'building-asset', label: '钟楼' }] });
    assert.equal(classifyExportError('EXPORT_PLAYER_UNAVAILABLE', {}).kind, 'other');
    assert.equal(classifyExportError('NETWORK_UNCERTAIN', {}).kind, 'other');
  });

  it('secret failures show readable locations only (never a value)', () => {
    const f = classifyExportError('EXPORT_SECRET_DETECTED', { locations: ['content.revision.content.scenes[0].text', 'player'], rules: ['openai-key'] });
    assert.deepEqual(f, { kind: 'secret', locations: ['内容 · scenes[0].text', '播放器模板'] });
    assert.equal(secretLocationLabel('manifest'), '包信息');
  });

  it('groups degraded items by kind', () => {
    assert.deepEqual(groupDegraded([{ kind: 'image', detail: 'a' }, { kind: 'image', detail: 'b' }, { kind: 'other', detail: 'c' }]),
      [{ kind: 'image', items: ['a', 'b'] }, { kind: 'other', items: ['c'] }]);
  });
});

describe('package save store (localStorage partition)', () => {
  it('partitions by packageId and keeps an index', () => {
    const storage = new MemoryStorage();
    const a = LocalStorageSaveStore.open('btg-game-A', () => storage)!;
    const b = LocalStorageSaveStore.open('btg-game-B', () => storage)!;
    a.write('s1', '{"x":1}'); a.write('s1', '{"x":2}'); a.write('s2', '{}');
    b.write('s9', '{}');
    assert.deepEqual(a.list(), ['s1', 's2']);
    assert.deepEqual(b.list(), ['s9']);
    assert.equal(a.read('s1'), '{"x":2}');
    assert.equal(b.read('s1'), null);
    assert.ok(storage.getItem(indexKey('btg-game-A')));
    assert.ok(storage.getItem(saveKey('btg-game-B', 's9')));
  });

  it('returns null when storage is disabled, and throws on quota so the guard can raise the banner', () => {
    assert.equal(LocalStorageSaveStore.open('x', () => { throw new DOMException('denied', 'SecurityError'); }), null);
    assert.equal(LocalStorageSaveStore.open('x', () => null), null);
    const storage = new MemoryStorage();
    storage.quotaAfter = 0;
    const s = LocalStorageSaveStore.open('x', () => storage)!;
    assert.throws(() => s.write('a', '{}'));
  });
});

describe('package route + copy', () => {
  it('parses #/save/<id>, everything else is the start page', () => {
    assert.deepEqual(parsePackageRoute('#/save/abc-1_2'), { kind: 'save', saveId: 'abc-1_2' });
    assert.deepEqual(parsePackageRoute('#/play/story/x'), { kind: 'start' });
    assert.deepEqual(parsePackageRoute('#/save/../../x'), { kind: 'start' });
    assert.deepEqual(parsePackageRoute(''), { kind: 'start' });
    assert.equal(saveHash('s1'), '#/save/s1');
    assert.equal(startHash(), '#/');
  });

  it('package copy never mentions service/auth/MCP/model/access code; unknown errors are honest', () => {
    for (const line of [...PACKAGE_COPY, packageErrorMessage(new Error('x')), packageErrorMessage({ code: 'NETWORK_UNCERTAIN' })]) {
      for (const word of FORBIDDEN_PACKAGE_WORDS) assert.ok(!line.includes(word), `${line} contains ${word}`);
    }
    assert.equal(packageErrorMessage({ code: 'CHOICE_LOCKED' }), '当前变量条件未满足，此选项不可用。');
    assert.equal(packageErrorMessage({ code: 'toString' }), '行动未成功。进度未推进。');
  });

  it('every new export/package string has an English translation', () => {
    for (const key of ['导出可玩包（网页版）', '先发布再导出', '导出的是已发布 v{version}', '正在打包…', '已导出', '重新下载',
      '导出失败 · 检测到密钥，已中止，未生成文件', '导出未完成，未生成文件。', '存档 {n}', '我的存档', '继续', '再来一局', '回到开始页',
      '未保存', '来自旧版本，无法继续', '存档已损坏，无法继续', '无法保存，本局关闭后不会保留。', '这个游戏文件已损坏', '此文件需要更新版本的播放器',
      '存档只保存在这台设备的这个浏览器里。', '上一步的结果尚未确认。请重试原选择，不会重复推进。', ...PACKAGE_COPY]) {
      assert.ok(englishTranslations[key], `missing en-US: ${key}`);
    }
  });
});

describe('export report is scoped to the current draft/revision', () => {
  type S = { phase: 'failed'; failure: { kind: 'other' } } | { phase: 'done'; fileName: string };
  it('a report for draft A is never shown for draft B (or an unpublished draft)', () => {
    const a = exportScopeKey('game', 'draft-a', 'rev-a1');
    const b = exportScopeKey('game', 'draft-b', 'rev-b1');
    const bUnpublished = exportScopeKey('game', 'draft-b', null);
    const failedA = { scope: a, value: { phase: 'failed', failure: { kind: 'other' } } as S };
    assert.deepEqual(stateForScope(failedA, a), failedA.value);
    assert.equal(stateForScope(failedA, b), null);
    assert.equal(stateForScope(failedA, bUnpublished), null);
    assert.equal(stateForScope(null, a), null);
    // switching back to A shows A's strip again (state is kept, only hidden)
    assert.deepEqual(stateForScope(failedA, exportScopeKey('game', 'draft-a', 'rev-a1')), failedA.value);
  });
  it('keys differ by kind, draft and revision; a re-publish hides the old revision report', () => {
    const doneA1 = { scope: exportScopeKey('world', 'w-a', 'r1'), value: { phase: 'done', fileName: 'a.html' } as S };
    assert.equal(stateForScope(doneA1, exportScopeKey('world', 'w-a', 'r2')), null);
    assert.equal(stateForScope(doneA1, exportScopeKey('game', 'w-a', 'r1')), null);
    assert.equal(stateForScope(doneA1, exportScopeKey('world', 'w-b', 'r1')), null);
    assert.notEqual(exportScopeKey('game', null, null), exportScopeKey('game', 'd1', null));
  });
});
