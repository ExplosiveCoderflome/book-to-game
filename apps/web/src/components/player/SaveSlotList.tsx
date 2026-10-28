import type { ReactNode } from 'react';
import { useI18n } from '../../lib/i18n';
import { dateLabel, Empty } from '../Notice';

export type SaveSlot = {
  id: string;
  title: string;
  summary: string;
  ended?: boolean;
  updatedAt: string;
  /** Export package: 「存档 {n}」 by creation order — the row label instead of the game title. */
  ordinal?: number;
  createdAt?: string;
  /** Greyed, kept, never migrated: old revision/runtime, or unreadable. */
  blockedReason?: 'old-version' | 'corrupt';
  /** Only in memory this time (storage refused); lost on close. */
  unsaved?: boolean;
  /** exe: this save's current copy is in the player's temporary storage, not the saves folder. */
  fallback?: boolean;
};

type Props = {
  slots: SaveSlot[];
  selectedId?: string;
  busy?: boolean;
  /** null = say nothing here (the reading page already explains the empty state — M7: one empty state per screen). */
  emptyHint?: string | null;
  heading?: string;
  /** Hint under the list (export package: where saves live). */
  footHint?: string;
  /** Under the hint (export package: 「存档位置」 details). */
  footer?: ReactNode;
  onSelect: (id: string) => void;
};

export function SaveSlotList({ slots, selectedId, busy, emptyHint, heading, footHint, footer, onSelect }: Props) {
  const { t, locale } = useI18n();
  // Continuable rows first; blocked rows after, keeping their relative order.
  const ordered = [...slots.filter(s => !s.blockedReason), ...slots.filter(s => s.blockedReason)];
  return (
    <div className="save-slot-list" data-testid="save-slot-list">
      <h3>{heading ?? t('我的存档')} <small>{slots.length}</small></h3>
      {slots.length === 0 ? (
        emptyHint === null ? null : <Empty>{emptyHint ?? t('开始新存档后会出现在这里。')}</Empty>
      ) : (
        <ul className="item-list">
          {ordered.map(s => (
            <li key={s.id}>
              <button
                type="button"
                className={`list-button ${s.id === selectedId ? 'selected' : ''}${s.blockedReason ? ' blocked' : ''}`}
                disabled={busy || !!s.blockedReason}
                aria-current={s.id === selectedId ? 'true' : undefined}
                data-testid={s.blockedReason ? 'save-slot-blocked' : 'save-slot'}
                onClick={() => onSelect(s.id)}
              >
                <strong>{s.ordinal ? t('存档 {n}', { n: s.ordinal }) : s.title}</strong>
                <span>{s.ended ? `${t('已到结局')} · ${s.summary}` : s.summary}</span>
                {s.ordinal && s.createdAt
                  ? <small>{t('开始于 {createdAt} · 更新 {updatedAt}', { createdAt: dateLabel(s.createdAt, locale), updatedAt: dateLabel(s.updatedAt, locale) })}</small>
                  : s.updatedAt ? <small>{dateLabel(s.updatedAt, locale)}</small> : null}
                {s.blockedReason && (
                  <small className="save-slot-reason">{t(s.blockedReason === 'old-version' ? '来自旧版本，无法继续' : '存档已损坏，无法继续')}</small>
                )}
                {s.unsaved && <small className="save-slot-unsaved">{t('未保存')}</small>}
                {!s.unsaved && s.fallback && <small className="save-slot-unsaved save-slot-fallback" data-testid="save-slot-fallback">{t('临时位置')}</small>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {footHint && <p className="hint">{footHint}</p>}
      {footer}
    </div>
  );
}
