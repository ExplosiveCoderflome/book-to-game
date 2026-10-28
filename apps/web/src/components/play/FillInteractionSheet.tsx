import type { AdventureView } from '@novel-game/contracts';
import { useEffect, useId } from 'react';
import { useI18n } from '../../lib/i18n';
import { AdventureActionRow } from './AdventureActionRow';

type FillGroup = NonNullable<AdventureView['fillGroups']>[number];
type Action = AdventureView['actions'][number];

type Props = {
  group: FillGroup;
  lines: Action[];
  busy?: boolean;
  uncertain?: boolean;
  onAct: (actionId: string) => void;
  onClose: () => void;
  /** Narrow inspector: drawer-like sheet. */
  compact?: boolean;
};

const KIND_LABEL: Record<FillGroup['kindHint'], string> = {
  shop: '商店',
  supply: '补给',
  quest: '任务',
  encounter: '遭遇',
  boss: 'Boss',
};

/** Instrument sub-panel for multi-line fill (hybrid B). No card grid / rainbow chips. */
export function FillInteractionSheet({ group, lines, busy, uncertain, onAct, onClose, compact }: Props) {
  const { t } = useI18n();
  const titleId = useId();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className={`fill-sheet${compact ? ' is-compact' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-testid="fill-interaction-sheet"
    >
      <div className="fill-sheet-header">
        <div className="fill-sheet-titles">
          <p className={`fill-sheet-eyebrow${group.kindHint === 'boss' ? ' is-boss' : ''}`}>
            {t(KIND_LABEL[group.kindHint])}
            {group.sheetEyebrow ? ` · ${t(group.sheetEyebrow)}` : ''}
          </p>
          <h3 id={titleId}>{group.label}</h3>
        </div>
        <button type="button" className="quiet small" onClick={onClose} aria-label={t('关闭')}>✕</button>
      </div>
      <div className="fill-sheet-body">
        {lines.length === 0 ? (
          <p className="fill-sheet-empty" data-testid="fill-sheet-empty">
            {group.emptyMessage
              ? t(group.emptyMessage)
              : (group.kindHint === 'encounter' || group.kindHint === 'boss')
                ? t('此处暂无解决行动')
                : t('尚未开张。这里还没有上架货物。')}
          </p>
        ) : (
          lines.map(a => (
            <AdventureActionRow
              key={a.id}
              action={a}
              compact={compact}
              disabled={busy || uncertain}
              onClick={() => onAct(a.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}
