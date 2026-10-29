import React from 'react';
import { useI18n } from '../../lib/i18n';
import type { JobFilter } from '../../lib/workspace-search';
import { StudioIcon } from '../studio/StudioIcon';

export function JobFilters({query, setQuery, filter, setFilter, count}: {
  query: string; setQuery: (value: string) => void; filter: JobFilter; setFilter: (value: JobFilter) => void; count: number;
}) {
  const {t} = useI18n();
  return <div className="workspace-list-tools">
    <label className="workspace-search-field"><StudioIcon name="search" /><span className="sr-only">{t('搜索制作记录')}</span><input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder={t('搜索制作记录')} /></label>
    <label><span className="sr-only">{t('任务状态')}</span><select aria-label={t('任务状态')} value={filter} onChange={e => setFilter(e.target.value as JobFilter)}>
      {([['all', '全部状态'], ['active', '运行中'], ['review', '待审阅规划'], ['failed', '需要处理'], ['done', '已完成']] as const).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
    </select></label><span className="hint" role="status">{t('{count} 条记录', {count})}</span>
  </div>;
}
