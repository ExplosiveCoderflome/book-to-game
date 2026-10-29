import { useRef, useState, type ReactNode } from 'react';
import { useI18n } from '../../lib/i18n';
import { workspacePages, type WorkspaceTab } from '../../lib/workbench-navigation';
import { StudioIcon } from './StudioIcon';
import './studio.css';

export function WorkbenchShell({tab, onNavigate, connected, connecting, configured, onRefresh, historyHost, children}: {
  tab: WorkspaceTab; onNavigate: (tab: WorkspaceTab) => void; connected: boolean; connecting: boolean; configured: boolean;
  onRefresh: () => void; historyHost: (node: HTMLDivElement | null) => void; children: ReactNode;
}) {
  const {t, locale, setLocale} = useI18n();
  const [navigationOpen, setNavigationOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const navigate = (next: WorkspaceTab) => {onNavigate(next); dialog.current?.close(); setNavigationOpen(false);};
  const navItem = (page: typeof workspacePages[number]) => <button type="button" key={page.id} aria-current={tab === page.id ? 'page' : undefined}
    className={`studio-nav-item ${tab === page.id ? 'is-active' : ''}`} onClick={() => navigate(page.id)}>
    <StudioIcon name={page.icon} /><span>{t(page.label)}</span>{page.id === 'agent' && <span className="studio-nav-key">A</span>}
  </button>;
  // The native modal handles keyboard focus, Escape, and focus restoration on phones.
  const navigation = <>
    <button className="studio-brand" onClick={() => navigate('agent')} aria-label={t('故事工坊首页')}>
      <span className="studio-brand-mark"><StudioIcon name="branch" /></span><span><strong>{t('故事工坊')}</strong><small>STORY WORKSHOP</small></span>
    </button>
    <nav className="studio-nav" aria-label={t('工作空间导航')}>
      {workspacePages.filter(p => p.group === 'main').map(navItem)}
      <details className="studio-tool-nav" open={workspacePages.some(p => p.id === tab && p.group === 'tools') || undefined}>
        <summary><StudioIcon name="grid" /><span>{t('创作工具')}</span><StudioIcon name="down" /></summary>
        <div>{workspacePages.filter(p => p.group === 'tools').map(navItem)}</div>
      </details>
    </nav>
  </>;
  return <div className={`app-shell studio-shell ${tab === 'agent' ? 'is-agent' : ''}`}>
    <a className="studio-skip" href="#studio-main" onClick={e => {e.preventDefault(); document.getElementById('studio-main')?.focus();}}>{t('跳到主要内容')}</a>
    <aside className="studio-sidebar">
      {navigation}<div className="studio-history-host" ref={historyHost} />
      <div className="studio-sidebar-bottom">{workspacePages.filter(p => p.group === 'settings').map(navItem)}
        <div className="studio-local-state"><span className={`studio-status-dot ${connected ? 'is-online' : ''}`} /><span>{t(connected ? '本地工作空间' : connecting ? '正在连接…' : '本地服务未连接')}</span><small>v0.2</small></div>
      </div>
    </aside>
    <dialog ref={dialog} className="studio-mobile-nav" onClose={() => setNavigationOpen(false)} onClick={e => {if (e.target === e.currentTarget) dialog.current?.close();}}>
      <div><button className="studio-icon-button studio-nav-close" aria-label={t('关闭导航')} onClick={() => dialog.current?.close()}><StudioIcon name="close" /></button>{navigation}
        {workspacePages.filter(p => p.group === 'settings').map(navItem)}</div>
    </dialog>
    <div className="studio-workspace">
      <header className="studio-topbar">
        <div className="studio-breadcrumb"><button className="studio-icon-button studio-mobile-menu" aria-label={t('打开导航')} aria-expanded={navigationOpen} onClick={() => {dialog.current?.showModal(); setNavigationOpen(true);}}><StudioIcon name="menu" /></button>
          <span>{t('工作空间')}</span><StudioIcon name="chevron" /><strong>{t(workspacePages.find(p => p.id === tab)!.label)}</strong>
        </div>
        <div className="studio-topbar-tools"><span className="studio-model-state"><span className={`studio-status-dot ${configured ? 'is-online' : ''}`} />{t(configured ? '模型已配置' : '未配置模型')}</span>
          <button className="studio-icon-button" aria-label={t('刷新工作空间')} onClick={onRefresh}><StudioIcon name="refresh" /></button>
          <label className="studio-language"><span className="sr-only">{t('界面语言')}</span><select aria-label={t('界面语言')} value={locale} onChange={e => setLocale(e.target.value as 'zh-CN' | 'en-US')}><option value="zh-CN">中</option><option value="en-US">EN</option></select></label>
        </div>
      </header>
      <main id="studio-main" className="studio-content" tabIndex={-1}>{children}</main>
    </div>
  </div>;
}
