import { useEffect, useRef, useState } from 'react';
import { HOST_SAVES_DIR_DISPLAY } from '@novel-game/play-runtime';
import { useI18n } from '../lib/i18n';

/** exe host-file only (UI plan §3.4, X10): collapsed 「存档位置」 with the env-var path. No 「打开文件夹」. */
export function saveFolderPath(packageId: string): string {
  return `${HOST_SAVES_DIR_DISPLAY}${packageId}\\`;
}

export function SaveLocationHint({ packageId }: { packageId: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const path = saveFolderPath(packageId);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(path);
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1500);
    } catch { /* the path stays selectable */ }
  };
  return (
    <details className="save-slot-location" data-testid="save-location">
      <summary>{t('存档位置')}</summary>
      <code className="save-slot-location-path">{path}</code>
      <button type="button" className="quiet small" onClick={() => void copy()}>
        <span aria-live="polite">{copied ? t('已复制') : t('复制路径')}</span>
      </button>
    </details>
  );
}
