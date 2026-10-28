import { PACKAGE_FORMAT_VERSION, RUNTIME_VERSION } from '@novel-game/play-runtime';
import { useI18n } from '../lib/i18n';

type Props = {
  kind: 'corrupt' | 'format-newer';
  title?: string;
  formatVersion?: number;
  runtimeVersion?: string;
  contentHash?: string;
  reason?: string;
};

/** Replaces <main> when the file cannot be opened. Never enters play, never touches saves. */
export function PackageErrorPage({ kind, title, formatVersion, runtimeVersion, contentHash, reason }: Props) {
  const { t } = useI18n();
  return (
    <section className="work-section package-error" data-testid={`package-error-${kind}`}>
      <div className="section-heading">
        <div>
          <p className="eyebrow">{t('无法打开')}</p>
          <h2>
            {title ? `${title} · ` : ''}
            {kind === 'corrupt' ? t('这个游戏文件已损坏') : t('此文件需要更新版本的播放器')}
          </h2>
          <p className="hint">
            {kind === 'corrupt'
              ? t('请找作者重新导出一份。')
              : t('这个文件的格式（v{formatVersion}）比当前播放器新。请找作者用最新版故事工坊重新导出。', { formatVersion: formatVersion ?? '?' })}
          </p>
        </div>
      </div>
      <details className="package-tech">
        <summary>{t('技术信息')}</summary>
        <p className="mono">
          {kind === 'corrupt'
            ? `${reason === 'content-hash' ? t('内容校验不一致') : t('文件内容无法读取')} · formatVersion ${formatVersion ?? '—'} · runtime ${runtimeVersion ?? RUNTIME_VERSION}${contentHash ? ` · ${contentHash.slice(0, 8)}` : ''}`
            : t('文件格式 v{file} · 播放器支持 v{player}', { file: formatVersion ?? '?', player: PACKAGE_FORMAT_VERSION })}
        </p>
      </details>
      <button type="button" className="quiet" onClick={() => location.reload()}>{t('重新打开')}</button>
    </section>
  );
}
