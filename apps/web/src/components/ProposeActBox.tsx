import { useState } from 'react';
import type { ProposeActResult } from '@novel-game/contracts';
import { useI18n } from '../lib/i18n';

interface Props {
  disabled?: boolean;
  busy?: boolean;
  onPropose: (text: string) => Promise<ProposeActResult>;
  onPickCandidate?: (choiceId: string) => void;
}

export function ProposeActBox({ disabled, busy, onPropose, onPickCandidate }: Props) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const [localBusy, setLocalBusy] = useState(false);
  const [result, setResult] = useState<ProposeActResult | null>(null);

  async function submit() {
    const value = text.trim();
    if (!value || disabled || busy || localBusy) return;
    setLocalBusy(true);
    setResult(null);
    try {
      const next = await onPropose(value);
      setResult(next);
      if (next.status === 'acted') setText('');
    } finally {
      setLocalBusy(false);
    }
  }

  const waiting = busy || localBusy;
  return (
    <div className="propose-act-box" data-testid="propose-act-box">
      <p className="eyebrow">{t('自由输入（L2 映射）')}</p>
      <p className="hint">{t('模型只能点名当前可见选项；被世界书禁止的行动不会出现在候选中。')}</p>
      <div className="propose-act-row">
        <input
          data-testid="propose-act-input"
          type="text"
          maxLength={500}
          value={text}
          disabled={disabled || waiting}
          placeholder={t('例如：我想和船夫聊聊')}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void submit(); } }}
        />
        <button type="button" className="primary small" data-testid="propose-act-submit" disabled={disabled || waiting || !text.trim()} onClick={() => void submit()}>
          {t(waiting ? '映射中…' : '映射并行动')}
        </button>
      </div>
      {result && (
        <div className={`propose-act-result propose-${result.status}`} data-testid="propose-act-result" data-status={result.status}>
          {result.status === 'acted' && <p>{t('已映射并执行：{label}', { label: result.label ?? result.choiceId ?? '' })}</p>}
          {result.status === 'mapped' && <p>{t('映射到：{label}（未自动执行）', { label: result.label ?? result.choiceId ?? '' })}</p>}
          {(result.status === 'none' || result.status === 'rejected') && (
            <>
              <p>{result.reason ?? t('未能映射到可用选项。')}</p>
              {result.candidates.length > 0 && (
                <div className="propose-fallback">
                  <p className="eyebrow">{t('可选行动')}</p>
                  {result.candidates.map(c => (
                    <button key={c.id} type="button" className="small" disabled={disabled || waiting || !onPickCandidate} onClick={() => onPickCandidate?.(c.id)}>
                      {c.label}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
