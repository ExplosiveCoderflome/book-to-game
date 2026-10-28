import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { chancePercent, formatDuration, s1DeltaChips, toneForResource } from '../src/lib/s1-play';
import { lintTone, percent1, playtestTone } from '../src/lib/preflight-api';
import { englishTranslations, translate } from '../src/lib/locale';

const zh = (key: string, vars?: Record<string, string | number>) => translate('zh-CN', key, vars);

describe('S1 play formatting', () => {
  it('formats months per C11 / U15', () => {
    assert.equal(formatDuration(0, zh), '0 个月');
    assert.equal(formatDuration(11, zh), '11 个月');
    assert.equal(formatDuration(12, zh), '1 年');
    assert.equal(formatDuration(27, zh), '2 年 3 个月');
  });
  it('tones pressure resources rust when they rise (U2)', () => {
    assert.equal(toneForResource(undefined, true, 5), 'pressure');
    assert.equal(toneForResource(undefined, true, -5), 'gain');
    assert.equal(toneForResource({ warn: 'low' }, false, -3), 'loss');
    assert.equal(toneForResource(undefined, false, 0), 'neutral');
  });
  it('renders clamp and max-change chips from projected deltas only', () => {
    const chips = s1DeltaChips({ actionLabel: '闭关', months: 12, deltas: [
      { id: 'xiuwei', label: '修为', delta: 8, clamped: 'max' },
      { id: 'xinmo', label: '心魔', delta: 4 },
      { kind: 'max', id: 'shouyuan', label: '寿元', from: 40, to: 120 },
      { id: 'lingshi', label: '灵石', delta: -3, clamped: 'min' },
    ] }, new Set(['xinmo']), undefined, zh);
    assert.deepEqual(chips.map(c => c.line), ['修为 +8（已封顶）', '心魔 +4', '寿元上限 40 → 120', '灵石 −3（已触底）']);
    assert.deepEqual(chips.map(c => c.tone), ['gain', 'pressure', 'neutral', 'loss']);
    assert.equal(s1DeltaChips({ actionLabel: 'x', months: 0, deltas: [{ id: 'gx', label: '功勋', delta: 0, clamped: 'min' }] }, new Set(), undefined, zh)[0]!.line, '功勋（已触底）');
    assert.deepEqual(s1DeltaChips(undefined, new Set(), undefined, zh), []);
  });
  it('rounds chance and preflight percents', () => {
    assert.equal(chancePercent(0.555), 56);
    assert.equal(percent1(0.8401), '84');
    assert.equal(percent1(0.135), '13.5');
  });
  it('picks strip tones from report numbers', () => {
    assert.equal(lintTone({ errors: 1, warnings: 0 }), 'error');
    assert.equal(lintTone({ errors: 0, warnings: 3 }), 'warn');
    assert.equal(lintTone({ errors: 0, warnings: 0 }), 'ok');
    assert.equal(playtestTone({ checks: [{ id: 'G1', label: '', line: '', measured: '', pass: false }] }), 'warn');
  });
  it('has English for the player-facing S1 copy', () => {
    for (const key of ['{n} 个月', '{y} 年 {m} 个月', '成功率 约 {p}%', '看构成', '剧情 · {n} 张', '急事', '限时', '新到', '失败结局 · {title}', '时限已到', '走过的路', '此地可做', '{base}（已封顶）'])
      assert.ok(englishTranslations[key], `missing en-US: ${key}`);
  });
});

describe('S1 author code stays out of the offline package', () => {
  it('src/package/* never imports preflight / lint / sim', () => {
    const walk = (dir: string): string[] => readdirSync(dir).flatMap(f => statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]);
    for (const file of walk(join(import.meta.dirname, '../src/package'))) {
      const src = readFileSync(file, 'utf8');
      assert.doesNotMatch(src, /preflight|\/sim['"]|WorldSystemInspector|rules\/preflight/, file);
    }
  });
});
