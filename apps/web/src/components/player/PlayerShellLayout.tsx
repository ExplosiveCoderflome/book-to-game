import type { ReactNode } from 'react';
import { useI18n } from '../../lib/i18n';
import { navigateHash, playLandingHash, workbenchHash } from '../../lib/play-route';

type Props = {
  children: ReactNode;
  /** Show quiet「返回工作台」(A3 default). */
  showBackWorkbench?: boolean;
  /** Brand click target (export package: its own start page `#/`). */
  brandHref?: string;
  onBrand?: () => void;
  /** Rendered above <main> on every state (export package storage banner). */
  banner?: ReactNode;
};

/** Pure player chrome: brand + 游玩 subtitle; no .workspace-bar. */
export function PlayerShellLayout({ children, showBackWorkbench = true, brandHref = '#/play', onBrand, banner }: Props) {
  const { t, locale, setLocale } = useI18n();
  return (
    <div className="app-shell player-shell" data-testid="player-shell">
      <header className="site-header">
        <a
          className="brand"
          href={brandHref}
          onClick={e => { e.preventDefault(); if (onBrand) onBrand(); else navigateHash(playLandingHash()); }}
        >
          <span className="brand-seal" aria-hidden="true">{t('叙')}</span>
          <div>
            <strong>{t('故事工坊')}</strong>
            <small>{t('故事工坊 · 游玩')}</small>
          </div>
        </a>
        <div className="header-controls">
          <label className="language-switch">
            <span>{t('界面语言')}</span>
            <select
              aria-label={t('界面语言')}
              value={locale}
              onChange={e => setLocale(e.target.value as 'zh-CN' | 'en-US')}
            >
              <option value="zh-CN">中文</option>
              <option value="en-US">English</option>
            </select>
          </label>
          {showBackWorkbench && (
            <button
              type="button"
              className="quiet small"
              data-testid="player-back-workbench"
              onClick={() => navigateHash(workbenchHash())}
            >
              {t('返回工作台')}
            </button>
          )}
        </div>
      </header>
      {banner}
      <main>{children}</main>
      <footer className="site-footer">
        <span>{t('故事工坊 / 小说转文字游戏')}</span>
        <span>{t('原文有据 · 改编有界 · 选择有果')}</span>
      </footer>
    </div>
  );
}
