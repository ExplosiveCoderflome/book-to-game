import { useState } from 'react';
import { useI18n } from '../../lib/i18n';
import { absolutePlayUrl } from '../../lib/play-route';

type Props = {
  /** Hash like #/play/story/:id */
  hash: string;
  className?: string;
  label?: string;
};

export function CopyPlayLinkButton({ hash, className = 'quiet small', label }: Props) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  async function copy() {
    const url = absolutePlayUrl(hash);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      /* Fallback: select via prompt for older contexts */
      window.prompt(t('复制玩家链接'), url);
    }
  }
  return (
    <button type="button" className={className} data-testid="copy-play-link" onClick={() => void copy()}>
      {copied ? t('已复制') : (label ?? t('复制玩家链接'))}
    </button>
  );
}
