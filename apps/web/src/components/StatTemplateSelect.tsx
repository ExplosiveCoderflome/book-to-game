import { STAT_TEMPLATES, type StatTemplateId } from '@novel-game/contracts';
import { useI18n } from '../lib/i18n';

export type StatTemplateSelectValue = StatTemplateId | '';

interface Props {
  value: StatTemplateSelectValue;
  onChange: (value: StatTemplateSelectValue) => void;
  disabled?: boolean;
  /** Extra test id for the select element. */
  testId?: string;
  /** Compact layout for empty-canvas strip. */
  compact?: boolean;
  /** When wrapped in a fieldset with its own legend. */
  hideLabel?: boolean;
}

/** Shared optional genre-stat-template picker (generation + empty-scan + variables apply). */
export function StatTemplateSelect({ value, onChange, disabled, testId = 'stat-template-select', compact, hideLabel }: Props) {
  const { t } = useI18n();
  const selected = STAT_TEMPLATES.find(item => item.id === value);
  return (
    <div className={compact ? 'stat-template-select compact' : 'stat-template-select'} data-testid="stat-template-picker">
      {hideLabel ? (
        <select
          value={value}
          disabled={disabled}
          data-testid={testId}
          aria-label={t('数值模板')}
          onChange={e => onChange(e.target.value as StatTemplateSelectValue)}
        >
          <option value="">{t('不使用模板')}</option>
          {STAT_TEMPLATES.map(template => (
            <option key={template.id} value={template.id}>
              {t(template.label)}
            </option>
          ))}
        </select>
      ) : (
        <label>
          {t('数值模板')}
          <select
            value={value}
            disabled={disabled}
            data-testid={testId}
            onChange={e => onChange(e.target.value as StatTemplateSelectValue)}
          >
            <option value="">{t('不使用模板')}</option>
            {STAT_TEMPLATES.map(template => (
              <option key={template.id} value={template.id}>
                {t(template.label)}
              </option>
            ))}
          </select>
        </label>
      )}
      {selected && <p className="hint">{t(selected.blurb)}</p>}
      {!selected && !compact && <p className="hint">{t('可选。按题材灌入初值变量骨架；不选则由模型自拟。')}</p>}
    </div>
  );
}
