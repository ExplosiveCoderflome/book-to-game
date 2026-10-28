import type { AdventureClockView } from '@novel-game/contracts';
import { useI18n } from '../../lib/i18n';

/** U5 / C3–C4: calendar (content template verbatim) · countdown resource · open windows only. */
export function PlayClockStrip({ clock }: { clock: AdventureClockView }) {
  const { t } = useI18n();
  const countdown = clock.countdown;
  return (
    <div className="play-clock" data-testid="play-clock">
      <p className="play-clock-date">
        <span>{clock.label}</span>
        {countdown ? <span> · {t('{label} 余 {value} {unit}', { label: countdown.label, value: countdown.value, unit: countdown.unit ?? '' }).trim()}</span> : null}
      </p>
      {clock.openWindows.length > 0 && (
        <p className="play-clock-windows" data-testid="play-clock-windows">
          {clock.openWindows.map((w, i) => (
            <span key={w.id}>{i > 0 ? ' · ' : ''}{w.monthsLeft === 0
              ? t('{name} 本月结束', { name: w.label })
              : t('{name} 还剩 {n} 个月关闭', { name: w.label, n: w.monthsLeft })}</span>
          ))}
        </p>
      )}
    </div>
  );
}
