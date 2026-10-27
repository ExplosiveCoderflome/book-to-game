import type { VariableValue } from '@novel-game/contracts';
import { displayLabelForVariable } from '@novel-game/contracts';
import { useI18n } from '../lib/i18n';
import { formatVariableValue, type VariableDelta } from '../lib/variable-delta';

interface Props {
  variables: Record<string, VariableValue>;
  deltas?: VariableDelta[] | null;
  /** Optional genre template id for zh display labels. */
  statTemplateId?: string | null;
  statTemplateVersion?: number | null;
}

/** Always-visible compact status strip for play-time story variables. */
export function PlayStatsBar({ variables, deltas, statTemplateId, statTemplateVersion }: Props) {
  const { t } = useI18n();
  const entries = Object.entries(variables);
  if (!entries.length && !(deltas?.length)) return null;
  const changed = new Set((deltas ?? []).map(d => d.name));
  return (
    <div className="play-stats" data-testid="play-stats-bar" role="status" aria-live="polite">
      <div className="play-stats-row">
        <span className="play-stats-label">{t('状态')}</span>
        <div className="play-stats-chips">
          {entries.length === 0
            ? <span className="play-stats-empty">{t('暂无变量')}</span>
            : entries.map(([name, value]) => {
              const label = displayLabelForVariable(name, statTemplateId, statTemplateVersion);
              return (
                <span
                  key={name}
                  className={`play-stats-chip${changed.has(name) ? ' is-changed' : ''}`}
                  title={label === name ? name : `${label} (${name})`}
                >
                  <span className="play-stats-name">{label}</span>
                  <span className="play-stats-value">{typeof value === 'boolean' ? t(value ? '真' : '假') : formatVariableValue(value)}</span>
                </span>
              );
            })}
        </div>
      </div>
      {!!deltas?.length && (
        <div className="play-stats-delta" data-testid="play-stats-delta">
          <span className="play-stats-delta-label">{t('状态变化')}</span>
          {deltas.map(d => (
            <span key={d.name} className="play-stats-delta-chip">{d.line}</span>
          ))}
        </div>
      )}
    </div>
  );
}
