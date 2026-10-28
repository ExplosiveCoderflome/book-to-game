/** S1 play-surface formatting. Pure: every number comes from the projection (AdventureView C1–C11). */
import type { AdventureLastResultView, AdventureResourceMeta } from '@novel-game/contracts';
import type { DeltaTone } from './variable-delta';

type T = (key: string, vars?: Record<string, string | number>) => string;

/** C11 / U15: < 12 → 「n 个月」; multiple of 12 → 「n 年」; else 「n 年 m 个月」. */
export function formatDuration(months: number, t: T): string {
  const n = Math.max(0, Math.round(months));
  if (n < 12) return t('{n} 个月', { n });
  const y = Math.floor(n / 12); const m = n % 12;
  return m === 0 ? t('{y} 年', { y }) : t('{y} 年 {m} 个月', { y, m });
}

/** U2: pressure resources (warn high / ending at max) read rust when they rise. */
export function toneForResource(meta: Pick<AdventureResourceMeta, 'warn'> | undefined, pressure: boolean, delta: number): DeltaTone {
  if (delta === 0) return 'neutral';
  if (pressure || meta?.warn === 'high') return delta > 0 ? 'pressure' : 'gain';
  return delta > 0 ? 'gain' : 'loss';
}

export type S1DeltaChip = { key: string; line: string; tone: DeltaTone };

/** C2: projected deltas → chip lines, incl. 「（已封顶）」and max changes. */
export function s1DeltaChips(result: AdventureLastResultView | undefined, pressureIds: ReadonlySet<string>, meta: AdventureResourceMeta[] | undefined, t: T): S1DeltaChip[] {
  if (!result) return [];
  const metaById = new Map((meta ?? []).map(m => [m.id, m]));
  return result.deltas.map((d, i) => {
    if ('kind' in d) return { key: `max-${d.id}-${i}`, line: t('{label}上限 {from} → {to}', { label: d.label, from: d.from, to: d.to }), tone: 'neutral' as const };
    const sign = d.delta > 0 ? `+${d.delta}` : d.delta < 0 ? `−${Math.abs(d.delta)}` : '±0';
    const base = `${d.label} ${sign}`;
    if (d.delta === 0 && d.clamped) return { key: `${d.id}-${i}`, line: d.clamped === 'max' ? t('{base}（已封顶）', { base: d.label }) : t('{base}（已触底）', { base: d.label }), tone: 'neutral' as const };
    const line = d.clamped === 'max' ? t('{base}（已封顶）', { base }) : d.clamped === 'min' ? t('{base}（已触底）', { base }) : base;
    return { key: `${d.id}-${i}`, line, tone: toneForResource(metaById.get(d.id), pressureIds.has(d.id), d.delta) };
  });
}

/** Rounded percent for「成功率 约 N%」. */
export const chancePercent = (chance: number) => Math.round(chance * 100);
