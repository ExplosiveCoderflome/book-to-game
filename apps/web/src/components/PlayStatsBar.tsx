import type { StatRole, VariableValue } from '@novel-game/contracts';
import { displayLabelForVariable, roleForVariable } from '@novel-game/contracts';
import { useI18n } from '../lib/i18n';
import { formatVariableValue, meterFillPercent, type VariableDelta } from '../lib/variable-delta';

interface Props {
  variables: Record<string, VariableValue>;
  deltas?: VariableDelta[] | null;
  /** Optional genre template id for zh display labels + role order. */
  statTemplateId?: string | null;
  statTemplateVersion?: number | null;
  /** Default open (ChoiceScript always-checkable); optional collapse OK. */
  defaultOpen?: boolean;
}

const ROLE_ORDER: StatRole[] = ['resource', 'relationship', 'pressure', 'progress', 'flag'];
const ROLE_LABEL: Record<StatRole, string> = {
  resource: '资源',
  relationship: '关系',
  pressure: '压力',
  progress: '进度',
  flag: '旗帜',
};

function roleRank(role: StatRole | undefined): number {
  if (!role) return ROLE_ORDER.length + 1;
  const i = ROLE_ORDER.indexOf(role);
  return i < 0 ? ROLE_ORDER.length : i;
}

/** Always-visible ChoiceScript-inspired status chart for play-time story variables. */
export function PlayStatsBar({
  variables,
  deltas,
  statTemplateId,
  statTemplateVersion,
  defaultOpen = true,
}: Props) {
  const { t } = useI18n();
  const entries = Object.entries(variables);
  if (!entries.length && !(deltas?.length)) return null;
  const changed = new Set((deltas ?? []).map(d => d.name));
  const sorted = [...entries].sort(([a], [b]) => {
    const ra = roleRank(roleForVariable(a, statTemplateId, statTemplateVersion));
    const rb = roleRank(roleForVariable(b, statTemplateId, statTemplateVersion));
    if (ra !== rb) return ra - rb;
    return a.localeCompare(b);
  });

  return (
    <details
      className="play-stats"
      data-testid="play-stats-bar"
      open={defaultOpen}
    >
      <summary className="play-stats-summary">
        <span className="play-stats-label">{t('状态')}</span>
        <span className="play-stats-summary-hint">{t('随时可查')}</span>
      </summary>
      <div className="play-stats-body" role="status" aria-live="polite">
        {entries.length === 0 ? (
          <span className="play-stats-empty">{t('暂无变量')}</span>
        ) : (
          <div className="play-stats-chart">
            {sorted.map(([name, value]) => {
              const label = displayLabelForVariable(name, statTemplateId, statTemplateVersion);
              const role = roleForVariable(name, statTemplateId, statTemplateVersion);
              const isFlag = typeof value === 'boolean' || role === 'flag';
              const title = label === name ? name : `${label} (${name})`;
              return (
                <div
                  key={name}
                  className={`play-stats-item${changed.has(name) ? ' is-changed' : ''}${isFlag ? ' is-flag' : ''}${role ? ` role-${role}` : ''}`}
                  title={title}
                  data-role={role ?? 'unknown'}
                >
                  <div className="play-stats-item-head">
                    <span className="play-stats-name">{label}</span>
                    {role && <span className="play-stats-role">{t(ROLE_LABEL[role])}</span>}
                    {isFlag ? (
                      <span className={`play-stats-flag-pill${value ? ' is-on' : ''}`}>
                        {value ? t('开') : t('关')}
                      </span>
                    ) : (
                      <span className="play-stats-value">{formatVariableValue(value)}</span>
                    )}
                  </div>
                  {!isFlag && typeof value === 'number' ? (
                    <div className="play-stats-meter" aria-hidden="true">
                      <span className="play-stats-meter-fill" style={{ width: `${meterFillPercent(value)}%` }} />
                    </div>
                  ) : !isFlag ? (
                    <div className="play-stats-meter is-plain" aria-hidden="true" />
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
        {!!deltas?.length && (
          <div className="play-stats-delta" data-testid="play-stats-delta">
            <span className="play-stats-delta-label">{t('状态变化')}</span>
            {deltas.map(d => (
              <span key={d.name} className="play-stats-delta-chip">{d.line}</span>
            ))}
          </div>
        )}
      </div>
    </details>
  );
}
