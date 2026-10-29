import { useState } from 'react';
import type { AgentChatSummary } from '@novel-game/contracts';
import { useI18n } from '../../lib/i18n';
import { StudioIcon } from '../studio/StudioIcon';
import { conversationLabel } from './agent-presenter';

export function AgentHistory({summaries, selectedId, busy, onSelect, onCreate}: {
  summaries: AgentChatSummary[]; selectedId: string; busy: boolean; onSelect: (id: string) => void; onCreate: () => void;
}) {
  const {t, locale} = useI18n();
  const [search, setSearch] = useState('');
  const filtered = summaries.filter(s => conversationLabel(s.title).toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  return <div className="agent-history">
    <div className="agent-history-heading"><span>{t('最近对话')}</span><button className="studio-icon-button" disabled={busy} aria-label={t('新建对话')} onClick={onCreate}><StudioIcon name="plus" /></button></div>
    {summaries.length > 5 && <label className="agent-history-search"><StudioIcon name="search" /><span className="sr-only">{t('搜索对话')}</span><input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('搜索对话')} /></label>}
    {filtered.length ? <ul>{filtered.map(item => <li key={item.id}><button disabled={busy} className={item.id === selectedId ? 'is-selected' : ''} onClick={() => onSelect(item.id)} aria-current={item.id === selectedId ? 'true' : undefined}>
      <StudioIcon name={item.status === 'running' ? 'history' : 'chat'} /><span>{t(conversationLabel(item.title))}</span>
      {item.status === 'running' ? <small>{t('处理中')}</small> : <time dateTime={item.updatedAt}>{new Date(item.updatedAt).toLocaleDateString(locale, {month: 'numeric', day: 'numeric'})}</time>}
    </button></li>)}</ul> : <p className="agent-history-empty">{t(search ? '没有匹配的对话' : '从一段对话开始创作，进展会保存在这里。')}</p>}
  </div>;
}
