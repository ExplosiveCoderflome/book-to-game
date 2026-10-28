import type { AdventureResourceMeta, StatRole, VariableValue } from '@novel-game/contracts';
import type { S1DeltaChip } from '../lib/s1-play';
import { displayLabelForVariable, roleForVariable } from '@novel-game/contracts';
import { useI18n } from '../lib/i18n';
import {
  formatVariableValue,
  meterFillPercent,
  toneForDelta,
  type OptionChangeSummary,
  type VariableDelta,
} from '../lib/variable-delta';

interface Props {
  variables?: Record<string, VariableValue>;
  /** Open-world numeric pools; shown with resource role when present. */
  resources?: Record<string, number> | null;
  /** Soft display labels for resource ids (id stays in title tooltip). */
  resourceLabels?: Record<string, string> | null;
  deltas?: VariableDelta[] | null;
  /** G5: labels that appeared / vanished vs previous beat. */
  optionChanges?: OptionChangeSummary | null;
  /** Optional genre template id for zh display labels + role order. */
  statTemplateId?: string | null;
  statTemplateVersion?: number | null;
  /** Default open (ChoiceScript always-checkable); optional collapse OK. */
  defaultOpen?: boolean;
  /**
   * When session exists but no vars/resources: show empty hint instead of hiding HUD (G10).
   * Pass true whenever a play session is active.
   */
  showEmpty?: boolean;
  /** S1 C1: declared resource meta → scale mode (bars first, then one number line). Absent = legacy HUD unchanged. */
  resourceMeta?: AdventureResourceMeta[] | null;
  /** S1 C2: projected delta chips (incl. 已封顶 / 已触底 / max changes). */
  s1Deltas?: S1DeltaChip[] | null;
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

type Row = {
  name: string;
  value: VariableValue;
  label: string;
  role: StatRole | undefined;
  kind: 'variable' | 'resource';
};

/** Always-visible ChoiceScript-inspired status chart for play-time story / adventure state. */
export function PlayStatsBar({
  variables = {},
  resources,
  resourceLabels,
  deltas,
  optionChanges,
  statTemplateId,
  statTemplateVersion,
  defaultOpen = true,
  showEmpty = false,
  resourceMeta,
  s1Deltas,
}: Props) {
  const { t } = useI18n();
  if (resourceMeta) return <ScaledStats meta={resourceMeta} deltas={s1Deltas ?? []} optionChanges={optionChanges} defaultOpen={defaultOpen} />;
  const varEntries = Object.entries(variables);
  const resEntries = Object.entries(resources ?? {}).filter(
    ([id]) => !(id.startsWith('fs_') || id.startsWith('fu_')),
  );
  const hasRows = varEntries.length > 0 || resEntries.length > 0;
  const hasFeedback = !!(deltas?.length) || !!(optionChanges?.newlyAvailable.length || optionChanges?.newlyUnavailable.length);
  if (!hasRows && !hasFeedback && !showEmpty) return null;

  const changed = new Set((deltas ?? []).map(d => d.name));
  const rows: Row[] = [
    ...varEntries.map(([name, value]) => ({
      name,
      value,
      label: displayLabelForVariable(name, statTemplateId, statTemplateVersion),
      role: roleForVariable(name, statTemplateId, statTemplateVersion),
      kind: 'variable' as const,
    })),
    ...resEntries.map(([name, value]) => ({
      name,
      value: value as VariableValue,
      label: resourceLabels?.[name] ?? name.replace(/_/g, ' '),
      role: 'resource' as StatRole,
      kind: 'resource' as const,
    })),
  ].sort((a, b) => {
    const ra = roleRank(a.role);
    const rb = roleRank(b.role);
    if (ra !== rb) return ra - rb;
    return a.name.localeCompare(b.name);
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
        {!hasRows ? (
          <p className="play-stats-empty" data-testid="play-stats-empty">
            {t('本局尚未声明状态。作者可在数值编辑里添加变量，试玩时代价与反馈会更清楚。')}
          </p>
        ) : (
          <div className="play-stats-chart">
            {rows.map(row => {
              const isFlag = typeof row.value === 'boolean' || row.role === 'flag';
              // Tooltip shows the display label only — never the internal resource id.
              const title = row.label;
              return (
                <div
                  key={`${row.kind}:${row.name}`}
                  className={`play-stats-item${changed.has(row.name) ? ' is-changed' : ''}${isFlag ? ' is-flag' : ''}${row.role ? ` role-${row.role}` : ''}`}
                  title={title}
                  data-role={row.role ?? 'unknown'}
                  data-kind={row.kind}
                >
                  <div className="play-stats-item-head">
                    <span className="play-stats-name">{row.label}</span>
                    {row.role && <span className="play-stats-role">{t(ROLE_LABEL[row.role])}</span>}
                    {isFlag ? (
                      <span className={`play-stats-flag-pill${row.value ? ' is-on' : ''}`}>
                        {row.value ? t('开') : t('关')}
                      </span>
                    ) : (
                      <span className="play-stats-value">{formatVariableValue(row.value)}</span>
                    )}
                  </div>
                  {!isFlag && typeof row.value === 'number' ? (
                    <div className="play-stats-meter" aria-hidden="true">
                      <span className="play-stats-meter-fill" style={{ width: `${meterFillPercent(row.value)}%` }} />
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
            {deltas.map(d => {
              const role = roleForVariable(d.name, statTemplateId, statTemplateVersion)
                ?? (resources && Object.hasOwn(resources, d.name) ? 'resource' : undefined);
              const tone = toneForDelta(d, role);
              return (
                <span
                  key={d.name}
                  className={`play-stats-delta-chip tone-${tone}`}
                  data-tone={tone}
                >
                  {d.line}
                </span>
              );
            })}
          </div>
        )}
        {(optionChanges?.newlyAvailable.length || optionChanges?.newlyUnavailable.length) ? (
          <div className="play-stats-option-changes" data-testid="play-option-changes">
            {!!optionChanges?.newlyAvailable.length && (
              <p className="play-stats-option-line is-new">
                {t('新可选：{labels}', { labels: optionChanges.newlyAvailable.join(' · ') })}
              </p>
            )}
            {!!optionChanges?.newlyUnavailable.length && (
              <p className="play-stats-option-line is-gone">
                {t('已不可用：{labels}', { labels: optionChanges.newlyUnavailable.join(' · ') })}
              </p>
            )}
          </div>
        ) : null}
      </div>
    </details>
  );
}

/** U1 scale mode: `bar` rows (value / current max + unit, true-range fill), then one wrapped number/pips line. */
function ScaledStats({ meta, deltas, optionChanges, defaultOpen }: { meta: AdventureResourceMeta[]; deltas: S1DeltaChip[]; optionChanges?: OptionChangeSummary | null; defaultOpen: boolean }) {
  const { t } = useI18n();
  const changed = new Set(deltas.map(d => d.key.replace(/-\d+$/, '').replace(/^max-/, '')));
  const bars = meta.filter(m => m.display === 'bar' && m.max !== undefined);
  const numbers = meta.filter(m => !(m.display === 'bar' && m.max !== undefined));
  // Most counters start at their floor (0); 「已触底」 is only worth saying when the floor is a danger (low warning).
  const bound = (m: AdventureResourceMeta) => m.bound === 'max' ? t('已封顶') : m.bound === 'min' && m.warn === 'low' ? t('已触底') : '';
  const valueText = (m: AdventureResourceMeta) => m.valueLabel ?? (m.display === 'pips' && m.max !== undefined ? `${m.value} / ${m.max}` : String(m.value));
  return (
    <details className="play-stats is-scaled" data-testid="play-stats-bar" open={defaultOpen}>
      <summary className="play-stats-summary">
        <span className="play-stats-label">{t('状态')}</span>
        <span className="play-stats-summary-hint">{t('随时可查')}</span>
      </summary>
      <div className="play-stats-body" role="status" aria-live="polite">
        <div className="play-stats-chart">
          {bars.map(m => {
            const span = (m.max! - m.min) || 1;
            const fill = Math.max(0, Math.min(100, ((m.value - m.min) / span) * 100));
            return (
              <div key={m.id} className={`play-stats-item is-bar${m.warn ? ' is-warn' : ''}${changed.has(m.id) ? ' is-changed' : ''}`} data-resource={m.id}>
                <div className="play-stats-item-head">
                  <span className="play-stats-name">{m.label}</span>
                  {m.warn ? <span className="play-stats-warn">{t('告急')}</span> : null}
                  {bound(m) ? <span className="play-stats-bound">{bound(m)}</span> : null}
                  <span className="play-stats-value">{t('{value} / {max}{unit}', { value: m.value, max: m.max!, unit: m.unit ? ` ${m.unit}` : '' })}</span>
                </div>
                <div className="play-stats-meter" aria-hidden="true"><span className="play-stats-meter-fill" style={{ width: `${fill}%` }} /></div>
              </div>
            );
          })}
        </div>
        {numbers.length > 0 && (
          <p className="play-stats-numbers" data-testid="play-stats-numbers">
            {numbers.map((m, i) => (
              <span key={m.id} className={`play-stats-number${m.warn ? ' is-warn' : ''}${changed.has(m.id) ? ' is-changed' : ''}`} data-resource={m.id}>
                {i > 0 ? ' · ' : ''}{m.label} <strong>{valueText(m)}</strong>{m.unit && !m.valueLabel ? ` ${m.unit}` : ''}
                {m.warn ? <span className="play-stats-warn"> {t('告急')}</span> : null}
                {bound(m) ? <span className="play-stats-bound"> {bound(m)}</span> : null}
              </span>
            ))}
          </p>
        )}
        {deltas.length > 0 && (
          <div className="play-stats-delta" data-testid="play-stats-delta">
            <span className="play-stats-delta-label">{t('状态变化')}</span>
            {deltas.map(d => <span key={d.key} className={`play-stats-delta-chip tone-${d.tone}`} data-tone={d.tone}>{d.line}</span>)}
          </div>
        )}
        {(optionChanges?.newlyAvailable.length || optionChanges?.newlyUnavailable.length) ? (
          <div className="play-stats-option-changes" data-testid="play-option-changes">
            {!!optionChanges?.newlyAvailable.length && <p className="play-stats-option-line is-new">{t('新可选：{labels}', { labels: optionChanges.newlyAvailable.join(' · ') })}</p>}
            {!!optionChanges?.newlyUnavailable.length && <p className="play-stats-option-line is-gone">{t('已不可用：{labels}', { labels: optionChanges.newlyUnavailable.join(' · ') })}</p>}
          </div>
        ) : null}
      </div>
    </details>
  );
}

/**
 * Phone-only one-line HUD above the location text (sticky): countdown first, then bars, then numbers.
 * Display labels + values only; never ids, never 「已封顶」.
 */
export function PlayStatsCompact({ meta, countdownId, isStatic }: { meta: AdventureResourceMeta[]; countdownId?: string; /** E5: no longer sticky once the run has ended. */ isStatic?: boolean }) {
  const { t } = useI18n();
  const rank = (m: AdventureResourceMeta) => m.id === countdownId ? 0 : m.display === 'bar' ? 1 : 2;
  const items = [...meta].sort((a, b) => rank(a) - rank(b)).slice(0, 6);
  if (!items.length) return null;
  const text = (m: AdventureResourceMeta) => m.valueLabel ?? (m.max !== undefined && m.display !== 'number' ? `${m.value}/${m.max}` : String(m.value));
  return (
    <div className={`play-stats-compact${isStatic ? ' is-static' : ''}`} data-testid="play-stats-compact" aria-label={t('状态')}>
      {items.map(m => (
        <span key={m.id} className={`play-stats-compact-item${m.warn ? ' is-warn' : ''}`} data-resource={m.id}>
          <span className="play-stats-compact-name">{m.label}</span>
          <strong>{text(m)}</strong>
        </span>
      ))}
    </div>
  );
}
