import React, { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../lib/i18n';
import { searchWorkspace, type WorkspaceSearchEntry } from '../../lib/workspace-search';
import { workspacePages } from '../../lib/workbench-navigation';
import { StudioIcon } from './StudioIcon';

export function WorkspaceSearch({entries, onSelect}: {entries: WorkspaceSearchEntry[]; onSelect: (entry: WorkspaceSearchEntry) => void}) {
  const {t} = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState('');
  const open = () => {setQuery(''); dialog.current?.showModal();};
  useEffect(() => {
    const shortcut = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && !e.defaultPrevented) {
        if (document.querySelector('dialog[open]')) return;
        e.preventDefault(); open();
      }
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, []);
  const results = searchWorkspace(entries, query);
  return <>
    <button className="workspace-search-trigger" aria-label={t('搜索工作空间')} onClick={open}><StudioIcon name="search" /><span>{t('搜索')}</span><kbd>Ctrl K</kbd></button>
    <dialog className="workspace-search-dialog" ref={dialog} aria-label={t('搜索工作空间')} onClick={e => {if (e.target === e.currentTarget) dialog.current?.close();}}>
      <div className="workspace-search-input"><StudioIcon name="search" /><label><span className="sr-only">{t('搜索页面、原作、草稿与任务')}</span><input autoFocus type="search" value={query} placeholder={t('搜索页面、原作、草稿与任务')} onChange={e => setQuery(e.target.value)} onKeyDown={e => {
        if (e.key === 'ArrowDown') {e.preventDefault(); dialog.current?.querySelector<HTMLButtonElement>('.workspace-search-result')?.focus();}
        if (e.key === 'Escape') {e.preventDefault(); dialog.current?.close();}
        if (e.key === 'Enter' && results[0]) {e.preventDefault(); dialog.current?.close(); onSelect(results[0]);}
      }} /></label><button className="studio-icon-button" aria-label={t('关闭搜索')} onClick={() => dialog.current?.close()}><StudioIcon name="close" /></button></div>
      <p className="workspace-search-caption" role="status">{t(query ? '找到 {count} 项（最多显示 30 项）' : '页面与最近作品', {count: results.length})}</p>
      <div className="workspace-search-results" onKeyDown={e => {
        if (!['ArrowDown', 'ArrowUp'].includes(e.key)) return;
        const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button'));
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        e.preventDefault(); buttons[(index + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
      }}>
        {results.map(entry => <button key={entry.key} className="workspace-search-result" onClick={() => {dialog.current?.close(); onSelect(entry);}}>
          <StudioIcon name={workspacePages.find(page => page.id === entry.tab)!.icon} /><span><strong>{entry.title}</strong><small>{entry.detail}</small></span><StudioIcon name="arrow" />
        </button>)}
        {!results.length && <div className="workspace-no-results"><StudioIcon name="search" /><strong>{t('没有找到匹配内容')}</strong><p>{t('试试作品名、原作名或页面名称。')}</p><button onClick={() => setQuery('')}>{t('清除搜索')}</button></div>}
      </div>
      <footer>{t('↑ ↓ 选择 · Enter 打开 · Esc 关闭')}</footer>
    </dialog>
  </>;
}
