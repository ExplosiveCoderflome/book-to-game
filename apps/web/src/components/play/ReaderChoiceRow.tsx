import { useI18n } from '../../lib/i18n';

type Props = {
  index: number;
  label: string;
  costHint?: string;
  disabled?: boolean;
  /** G4: only when contract provides visible-but-locked choices — do not invent. */
  locked?: boolean;
  lockedReason?: string;
  onClick: () => void;
};

/** Story choice row: index · label · cost subline · arrow; locked variant when contract allows. */
export function ReaderChoiceRow({
  index, label, costHint, disabled, locked, lockedReason, onClick,
}: Props) {
  const { t } = useI18n();
  const isLocked = !!locked;
  return (
    <button
      type="button"
      className={`reader-choice${isLocked ? ' is-locked' : ''}`}
      disabled={disabled || isLocked}
      onClick={onClick}
      data-testid={isLocked ? 'reader-choice-locked' : 'reader-choice'}
    >
      <span className="reader-choice-index" aria-hidden="true">{String(index).padStart(2, '0')}</span>
      <span className="reader-choice-body">
        <span className="reader-choice-label">{label}</span>
        {costHint ? <span className="reader-choice-cost">{t('代价')}：{costHint}</span> : null}
        {isLocked && (
          <span className="reader-choice-locked-reason">
            {t('未解锁：{reason}', { reason: lockedReason || t('现在还不能这样做') })}
          </span>
        )}
      </span>
      {!isLocked && <span className="reader-choice-arrow" aria-hidden="true">→</span>}
    </button>
  );
}
