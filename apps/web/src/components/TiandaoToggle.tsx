import { useEffect, useState } from 'react';
import { useI18n } from '../lib/i18n';
import { readTiandaoCorrect, writeTiandaoCorrect } from '../lib/tiandao';

interface Props {
  disabled?: boolean;
}

/**
 * Optional play-time「天道修正」. Default OFF.
 * When ON, play AI endpoints receive tiandaoCorrect and inject a soft system-prompt block.
 * No separate detector this phase — prompt-only.
 */
export function TiandaoToggle({ disabled }: Props) {
  const { t } = useI18n();
  const [enabled, setEnabled] = useState(readTiandaoCorrect);

  useEffect(() => {
    writeTiandaoCorrect(enabled);
  }, [enabled]);

  return (
    <div className="tiandao-box" data-testid="tiandao-box" data-enabled={enabled ? '1' : '0'}>
      <div className="tiandao-toolbar">
        <label className="tiandao-toggle">
          <input
            data-testid="tiandao-toggle"
            type="checkbox"
            checked={enabled}
            disabled={disabled}
            onChange={e => setEnabled(e.target.checked)}
          />
          <span>{t('天道修正')}</span>
        </label>
        <span className="hint">{t('可选；默认关闭。开启后玩时 AI 会注入天道约束提示词，越界或改规则时以修正口吻回应（本阶段无额外检测）。')}</span>
      </div>
    </div>
  );
}
