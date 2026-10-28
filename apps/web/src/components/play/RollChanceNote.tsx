import type { AdventureRollView } from '@novel-game/contracts';
import { useI18n } from '../../lib/i18n';
import { chancePercent } from '../../lib/s1-play';

/** U3 / S1-U9: keyboard-reachable breakdown under an action row (never a hover-only tooltip). */
export function RollChanceNote({ roll }: { roll: AdventureRollView }) {
  const { t } = useI18n();
  if (roll.chance === undefined || !roll.parts?.length) return null;
  const pct = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(chancePercent(n))}%`;
  const [base, ...mods] = roll.parts;
  return (
    <details className="roll-breakdown" data-testid="roll-breakdown">
      <summary>{t('看构成')}</summary>
      <p>
        {t('基础 {b}%', { b: chancePercent(base!.add) })}
        {mods.map((p, i) => <span key={i}> · {p.label} {pct(p.add)}</span>)}
        {' · '}{t('合计 {p}%（限 {min}%–{max}%）', { p: chancePercent(roll.chance), min: chancePercent(roll.min), max: chancePercent(roll.max) })}
      </p>
    </details>
  );
}

/** Result line:「掷骰 · 成功率 约 N% · 成功/失败」. */
export function RollOutcomeLine({ roll }: { roll: { chance?: number; success: boolean } }) {
  const { t } = useI18n();
  return (
    <p className={`roll-outcome${roll.success ? '' : ' is-failure'}`} data-testid="roll-outcome">
      {roll.chance !== undefined ? t('掷骰 · 成功率 约 {p}%', { p: chancePercent(roll.chance) }) : t('掷骰')}
      {' · '}<strong>{roll.success ? t('成功') : t('失败')}</strong>
    </p>
  );
}
