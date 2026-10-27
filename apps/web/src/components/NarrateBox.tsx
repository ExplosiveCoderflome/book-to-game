import { useCallback, useEffect, useRef, useState } from 'react';
import type { NarrateResult } from '@novel-game/contracts';
import { useI18n } from '../lib/i18n';

const storageKey = 'novel-game.l1-narrate';

function readEnabled(): boolean {
  try { return window.localStorage.getItem(storageKey) === '1'; } catch { return false; }
}
function writeEnabled(value: boolean): void {
  try { window.localStorage.setItem(storageKey, value ? '1' : '0'); } catch { /* ignore */ }
}

interface Props {
  /** Changes when the player arrives at a different scene visit. */
  visitKey: string;
  disabled?: boolean;
  onNarrate: (force: boolean) => Promise<NarrateResult>;
}

/**
 * L1 optional play-time narration. Default OFF so play stays deterministic unless opted in.
 * Never mutates choices/variables; parent onNarrate must be narrate-only.
 */
export function NarrateBox({ visitKey, disabled, onNarrate }: Props) {
  const { t } = useI18n();
  const [enabled, setEnabled] = useState(readEnabled);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'ok' | 'unavailable'>('idle');
  const requestSeq = useRef(0);
  const onNarrateRef = useRef(onNarrate);
  onNarrateRef.current = onNarrate;

  useEffect(() => {
    writeEnabled(enabled);
  }, [enabled]);

  const applyResult = useCallback((result: NarrateResult) => {
    if (result.status === 'ok' && result.text) {
      setText(result.text);
      setStatus('ok');
      setReason(null);
    } else {
      setText(null);
      setStatus('unavailable');
      setReason(result.reason ?? t('旁白暂不可用，仍可阅读正文。'));
    }
  }, [t]);

  useEffect(() => {
    if (!enabled || disabled) {
      setText(null);
      setReason(null);
      setStatus('idle');
      setBusy(false);
      return;
    }
    let cancelled = false;
    const seq = ++requestSeq.current;
    setBusy(true);
    setReason(null);
    void onNarrateRef.current(false)
      .then(result => {
        if (cancelled || seq !== requestSeq.current) return;
        applyResult(result);
      })
      .catch(() => {
        if (cancelled || seq !== requestSeq.current) return;
        setText(null);
        setStatus('unavailable');
        setReason(t('旁白请求失败，仍可阅读正文。'));
      })
      .finally(() => {
        if (!cancelled && seq === requestSeq.current) setBusy(false);
      });
    return () => { cancelled = true; };
  }, [enabled, visitKey, disabled, applyResult, t]);

  async function refresh() {
    if (!enabled || disabled || busy) return;
    const seq = ++requestSeq.current;
    setBusy(true);
    setReason(null);
    try {
      const result = await onNarrateRef.current(true);
      if (seq !== requestSeq.current) return;
      applyResult(result);
    } catch {
      if (seq !== requestSeq.current) return;
      setText(null);
      setStatus('unavailable');
      setReason(t('旁白请求失败，仍可阅读正文。'));
    } finally {
      if (seq === requestSeq.current) setBusy(false);
    }
  }

  return (
    <div className="narrate-box" data-testid="narrate-box" data-enabled={enabled ? '1' : '0'} data-status={status}>
      <div className="narrate-toolbar">
        <label className="narrate-toggle">
          <input
            data-testid="narrate-toggle"
            type="checkbox"
            checked={enabled}
            disabled={disabled}
            onChange={e => setEnabled(e.target.checked)}
          />
          <span>{t('L1 表演旁白')}</span>
        </label>
        <span className="hint">{t('可选；默认关闭。只生成风味文案，不改选项/行动与变量。')}</span>
        {enabled && (
          <button
            type="button"
            className="quiet small"
            data-testid="narrate-refresh"
            disabled={disabled || busy}
            onClick={() => void refresh()}
          >
            {t(busy ? '旁白生成中…' : '刷新旁白')}
          </button>
        )}
      </div>
      {enabled && busy && !text && <p className="hint" role="status">{t('旁白生成中…')}</p>}
      {enabled && text && (
        <div className="narrate-text" data-testid="narrate-text">
          <p className="eyebrow">{t('旁白')}</p>
          {text.split(/\n+/).map((line, i) => <p key={i}>{line}</p>)}
        </div>
      )}
      {enabled && !busy && status === 'unavailable' && reason && (
        <p className="hint narrate-unavailable" data-testid="narrate-unavailable">{reason}</p>
      )}
    </div>
  );
}
