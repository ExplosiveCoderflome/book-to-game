import type { Ref } from 'react';
import type { VariableValue } from '@novel-game/contracts';
import { displayLabelForVariable } from '@novel-game/contracts';
import { useI18n } from '../lib/i18n';
import { formatVariableValue } from '../lib/variable-delta';

export type EndingSummaryItem = { label: string; value: string };

type Props = {
  /** story | open eyebrow */
  mode: 'story' | 'open';
  title?: string | null;
  body: string;
  /** 2–4 final-state chips; caller picks from variables/resources/time. */
  summary?: EndingSummaryItem[];
  tag?: string | null;
  onReplay: () => void;
  onBackEdit?: () => void;
  /** Override quiet back label (player shell: 返回书目). */
  backLabel?: string;
  replayBusy?: boolean;
  /** Override primary replay label (export package: 再来一局). */
  replayLabel?: string;
  /** S1 C8: ending kind (default ending). */
  kind?: 'ending' | 'failure' | 'timeout';
  /** S1 C8: one-shot storylet titles in order of experience. */
  path?: string[];
  /** K15: ending passages that held when the ending fired (appended after the body, in order). */
  passages?: { id: string; text: string }[];
  /** K15: 「这一生」 recap lines that held. `[]` = world has a recap but nothing held (block hidden); undefined = world without recap[]. */
  recap?: { id: string; text: string }[];
  /** Arrival scroll / focus target (AdventurePlaySurface). */
  panelRef?: Ref<HTMLDivElement>;
};

/**
 * Shared ending shell for story + open play (G6). Ending page = one reading page, not a card (ui-plan-s1-ending-page §3):
 * eyebrow (type only) → title → body (engine-picked variant) → K15 passages → 「这一生」 (or 「走过的路」 for worlds without recap[])
 * → one-line 本局收束 → hint → actions. Passages / recap arrive filtered + ordered by play-runtime; the UI never evaluates.
 */
export function PlayEndingPanel({
  mode, title, body, summary = [], tag, onReplay, onBackEdit, backLabel, replayBusy, replayLabel, kind = 'ending', path, passages = [], recap, panelRef,
}: Props) {
  const { t } = useI18n();
  const eyebrow = kind === 'failure' ? t('失败结局')
    : kind === 'timeout' ? t('时限已到')
    : mode === 'story' ? t('故事抵达了一个结局') : t('冒险结局');
  // E1: worlds with recap[] show 「这一生」 only (an empty list hides the block, no fallback); worlds without keep 「走过的路」.
  const shownPath = recap === undefined ? (path ?? []).slice(0, 6) : [];
  return (
    <div ref={panelRef} className={`play-ending${kind === 'failure' ? ' is-failure' : kind === 'timeout' ? ' is-timeout' : ''}`} data-testid="play-ending-panel" data-kind={kind}>
      <p className="play-ending-eyebrow">{eyebrow}</p>
      {tag ? <p className="play-ending-tag">{tag}</p> : null}
      {title ? <h4 className="play-ending-title" tabIndex={-1}>{title}</h4> : null}
      <div className="play-ending-body reader-text">
        {body.split(/\n+/).map((line, i) => <p key={i}>{line}</p>)}
      </div>
      {passages.length > 0 && (
        <div className="play-ending-passages reader-text">
          {passages.flatMap(p => p.text.split(/\n+/).map((line, i) => <p key={`${p.id}-${i}`} data-testid="play-ending-passage" data-passage={p.id}>{line}</p>))}
        </div>
      )}
      {recap && recap.length > 0 && (
        <section className="play-ending-recap" data-testid="play-ending-recap">
          <h5>{t('这一生')}</h5>
          <ul>{recap.map(r => <li key={r.id} data-recap={r.id}>{r.text}</li>)}</ul>
        </section>
      )}
      {shownPath.length > 0 && (
        <p className="play-ending-path" data-testid="play-ending-path">
          <span className="play-ending-summary-label">{t('走过的路')}</span>
          {shownPath.map((step, i) => <span key={i} className="play-ending-step">{i > 0 ? '→ ' : ''}{step}{i < shownPath.length - 1 ? ' ' : ''}</span>)}
          {(path?.length ?? 0) > shownPath.length ? <span className="play-ending-step"> {t('等 {n} 件', { n: path!.length - shownPath.length })}</span> : null}
        </p>
      )}
      {summary.length > 0 && (
        <p className="play-ending-summary" data-testid="play-ending-summary">
          <span className="play-ending-summary-label">{t('本局收束')}</span>
          {summary.map((s, i) => (
            <span key={`${s.label}-${i}`} className="play-ending-stat">{i > 0 ? ' · ' : ''}{s.label} {s.value}</span>
          ))}
        </p>
      )}
      <p className="play-ending-hint">{t('换一条路，结局会不一样。')}</p>
      <div className="play-ending-actions">
        <button type="button" className="primary" disabled={replayBusy} onClick={onReplay}>{replayLabel ?? t('再开一局')}</button>
        {onBackEdit ? <button type="button" className="quiet" disabled={replayBusy} onClick={onBackEdit}>{backLabel ?? t('回编辑改结局文案')}</button> : null}
      </div>
    </div>
  );
}

/** Build 2–4 summary chips from final variables (prefer stamped display labels). */
export function endingSummaryFromVariables(
  variables: Record<string, VariableValue> | undefined,
  opts?: { statTemplateId?: string | null; statTemplateVersion?: number | null; limit?: number },
): EndingSummaryItem[] {
  const limit = opts?.limit ?? 4;
  const entries = Object.entries(variables ?? {});
  return entries.slice(0, limit).map(([name, value]) => ({
    label: displayLabelForVariable(name, opts?.statTemplateId, opts?.statTemplateVersion),
    value: typeof value === 'boolean' ? (value ? '开' : '关') : formatVariableValue(value),
  }));
}

/** Build summary from open resources + optional time line. */
export function endingSummaryFromResources(
  resources: Record<string, number> | undefined,
  labels?: Record<string, string> | null,
  extra?: EndingSummaryItem[],
  limit = 4,
): EndingSummaryItem[] {
  const chips: EndingSummaryItem[] = Object.entries(resources ?? {})
    .filter(([id]) => !(id.startsWith('fs_') || id.startsWith('fu_')))
    .map(([id, n]) => ({
      label: labels?.[id] ?? id.replace(/_/g, ' '),
      value: String(n),
    }));
  const merged = [...(extra ?? []), ...chips];
  return merged.slice(0, limit);
}
