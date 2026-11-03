import { useState, type ReactNode } from 'react';
import { useI18n } from '../../lib/i18n';
import type { LensStat, LensDeltaChip } from '../../lib/scene-lens';

/**
 * Compact top HUD for the scene-lens play shell.
 * 2–4 key readouts, each with an optional meter and last-beat Δ. The full status chart stays in the
 * drawer; this strip is the "what matters right now" line.
 */
export function SceneLensHud({ stats, testId = 'scene-lens-hud' }: { stats: LensStat[]; testId?: string }) {
  const { t } = useI18n();
  if (!stats.length) return null;
  return (
    <div className="scene-lens-hud" data-testid={testId} role="status" aria-live="polite" aria-label={t('状态')}>
      {stats.map(stat => (
        <div
          key={`${stat.kind}:${stat.key}`}
          className={`scene-lens-stat${stat.warn ? ' is-warn' : ''}${stat.delta ? ' is-changed' : ''}${stat.delta?.tone ? ` tone-${stat.delta.tone}` : ''}`}
          data-role={stat.role ?? 'unknown'}
          data-resource={stat.kind === 'resource' ? stat.key : undefined}
        >
          <span className="scene-lens-stat-label">{stat.label}</span>
          <span className="scene-lens-stat-value">
            {stat.value}
            {stat.delta ? (
              <span className={`scene-lens-stat-delta tone-${stat.delta.tone}`} title={stat.delta.line}>
                {stat.delta.direction === 'up' ? '↑' : stat.delta.direction === 'down' ? '↓' : ''}{stat.delta.short}
              </span>
            ) : null}
          </span>
          {stat.fillPercent !== undefined ? (
            <span className="scene-lens-stat-meter" aria-hidden="true">
              <span className="scene-lens-stat-meter-fill" style={{ width: `${stat.fillPercent}%` }} />
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/** One-line beat feedback under the scene text (deltas + newly opened / closed options). */
export function SceneLensFeedback({
  deltas,
  chips,
  optionChanges,
}: {
  deltas?: { name: string; line: string }[] | null;
  chips?: LensDeltaChip[] | null;
  optionChanges?: { newlyAvailable: string[]; newlyUnavailable: string[] } | null;
}) {
  const { t } = useI18n();
  const seen = new Set<string>();
  const lines = [
    ...(deltas ?? []).map(d => ({ key: `d:${d.name}`, line: d.line })),
    ...(chips ?? []).map(c => ({ key: `c:${c.key}`, line: c.line })),
  ].filter(line => {
    // Story resources can arrive both as a diff and as a projected chip; show each change once.
    if (seen.has(line.line)) return false;
    seen.add(line.line);
    return true;
  });
  const gained = optionChanges?.newlyAvailable ?? [];
  const lost = optionChanges?.newlyUnavailable ?? [];
  if (!lines.length && !gained.length && !lost.length) return null;
  return (
    <div className="scene-lens-feedback" data-testid="scene-lens-feedback">
      {lines.length ? (
        <p className="scene-lens-feedback-line">
          <span className="scene-lens-feedback-label">{t('刚刚变化')}</span>
          {lines.map(line => <span key={line.key} className="scene-lens-feedback-chip">{line.line}</span>)}
        </p>
      ) : null}
      {gained.length ? <p className="scene-lens-feedback-note is-new">{t('新可选：{labels}', { labels: gained.join(' · ') })}</p> : null}
      {lost.length ? <p className="scene-lens-feedback-note is-gone">{t('已不可用：{labels}', { labels: lost.join(' · ') })}</p> : null}
    </div>
  );
}

/**
 * Bottom action dock: one short primary row of choices plus a disclosure for the rest.
 * The player should always see what to click without scanning a long parallel list.
 */
export function SceneLensActions({
  eyebrow, primary, extra, overflow, overflowCount, overflowLabel, testId = 'scene-lens-actions',
}: {
  eyebrow?: string;
  primary: ReactNode;
  /** Always-visible sibling block (e.g. storylet hand) that is not a plain choice row. */
  extra?: ReactNode;
  overflow?: ReactNode;
  /** How many rows are folded away; shown in the disclosure label when > 0. */
  overflowCount?: number;
  overflowLabel?: string;
  testId?: string;
}) {
  const { t } = useI18n();
  const moreLabel = overflowLabel
    ?? (overflowCount ? t('更多选择（{n}）', { n: overflowCount }) : t('更多选择'));
  return (
    <section className="scene-lens-actions" data-testid={testId}>
      {eyebrow ? <p className="scene-lens-focus">{eyebrow}</p> : null}
      <div className="scene-lens-primary">{primary}</div>
      {extra}
      {overflow ? (
        <details className="scene-lens-more" data-testid="scene-lens-more">
          <summary>{moreLabel}</summary>
          <div className="scene-lens-overflow">{overflow}</div>
        </details>
      ) : null}
    </section>
  );
}

/** Secondary panels (full status, history, path, known facts) folded below the action dock. */
export function SceneLensDrawer({ children, label, defaultOpen = false }: { children: ReactNode; label?: string; defaultOpen?: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details
      className="scene-lens-drawer"
      data-testid="scene-lens-drawer"
      open={open}
      onToggle={e => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary>{label ?? t('更多信息 · 状态与记录')}</summary>
      <div className="scene-lens-drawer-body">{children}</div>
    </details>
  );
}
