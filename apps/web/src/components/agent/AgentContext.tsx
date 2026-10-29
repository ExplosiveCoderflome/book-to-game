import type { AgentChatConversation, GenerationJob, SourceSummary, WorldDraft, WorldRevision } from '@novel-game/contracts';
import { useI18n } from '../../lib/i18n';
import { StudioIcon } from '../studio/StudioIcon';
import { actionStatusLabels, toolLabel, toolReceipt } from './agent-presenter';

export function AgentContext({mode, setMode, worlds, draft, jobs, sources, revisions, conversation, busy, onSelect, onOpenDraft, onOpenJobs, onOpenSources, onPrompt}: {
  mode: 'project' | 'activity'; setMode: (mode: 'project' | 'activity') => void; worlds: WorldDraft[]; draft?: WorldDraft;
  jobs: GenerationJob[]; sources: SourceSummary[]; revisions: WorldRevision[]; conversation: AgentChatConversation | null; busy: boolean;
  onSelect: (id: string) => void; onOpenDraft: (id: string) => void; onOpenJobs: () => void; onOpenSources: () => void; onPrompt: (prompt: string) => void;
}) {
  const {t} = useI18n();
  const source = sources.find(s => s.id === draft?.sourceId);
  const job = jobs.find(j => j.sourceId === draft?.sourceId && j.productionBrief);
  const written = Object.keys(job?.productionState?.texts ?? {}).length;
  const published = revisions.some(r => r.draftId === draft?.id && r.version === draft?.version);
  const receipts = conversation?.messages.filter(m => m.role === 'tool') ?? [];
  return <>
    <div className="agent-context-tabs" role="group" aria-label={t('工作区侧栏')}>
      <button className={mode === 'project' ? 'is-active' : ''} aria-pressed={mode === 'project'} onClick={() => setMode('project')}>{t('创作上下文')}</button>
      <button className={mode === 'activity' ? 'is-active' : ''} aria-pressed={mode === 'activity'} onClick={() => setMode('activity')}>{t('执行记录')}{receipts.length > 0 && <span>{receipts.length}</span>}</button>
    </div>
    <div className="agent-context-scroll">{mode === 'project' ? <>
      <div className="agent-context-section"><div className="agent-context-label"><StudioIcon name="world" /><h2>{t('当前作品')}</h2></div>
        <label className="agent-project-select"><span className="sr-only">{t('选择草稿上下文')}</span><select aria-label={t('选择草稿上下文')} value={draft?.id ?? ''} disabled={busy} onChange={e => onSelect(e.target.value)}><option value="">{t('不关联草稿')}</option>{worlds.map(w => <option key={w.id} value={w.id}>{w.content.title} · v{w.version}</option>)}</select></label>
        {draft ? <><div className="agent-project-cover"><div className="agent-project-monogram"><StudioIcon name="book" /></div><span>{t('角色扮演 · 世界草稿')}</span><h3>{draft.content.title}</h3><p>{draft.content.goal}</p><div className="agent-project-tags"><span>v{draft.version}</span><span>{t(published ? '当前版本已发布' : '待审阅草稿')}</span></div></div>
          <dl className="agent-project-metrics"><div><dt>{t('地点')}</dt><dd>{draft.content.locations.length}</dd></div><div><dt>{t('剧情卡')}</dt><dd>{draft.content.storylets?.length ?? 0}</dd></div><div><dt>{t('结局')}</dt><dd>{draft.content.endings.length}</dd></div></dl>
          <button className="agent-open-artifact" onClick={() => onOpenDraft(draft.id)}><StudioIcon name="file" /><span>{t('打开世界草稿')}</span><StudioIcon name="arrow" /></button>
          <div className="agent-context-role"><span>{t('玩家角色')}</span><p>{draft.content.playerRole}</p></div>
        </> : <div className="agent-context-empty"><p>{t('选择一份世界草稿，把相关角色、规划与进度带入对话。')}</p><button className="quiet" onClick={onOpenSources}>{t('从原作书架开始')}<StudioIcon name="arrow" /></button></div>}
      </div>
      {job && <div className="agent-context-section"><div className="agent-context-label"><StudioIcon name="tasks" /><h2>{t('关联制作任务')}</h2><button className="studio-icon-button" aria-label={t('打开制作任务')} onClick={onOpenJobs}><StudioIcon name="arrow" /></button></div>
        <ol className="agent-production-progress"><li className={job.productionState?.plan ? 'is-complete' : ''}><span>{job.productionState?.plan ? <StudioIcon name="check" /> : '1'}</span><div><strong>{t('玩法规划')}</strong><small>{t(job.productionState?.approved ? '已确认人物与玩法' : job.status === 'awaiting_review' ? '等待你审阅确认' : '等待生成')}</small></div></li>
          <li className={job.status === 'succeeded' ? 'is-complete' : ''}><span>{job.status === 'succeeded' ? <StudioIcon name="check" /> : '2'}</span><div><strong>{t('正文写作')}</strong><small>{written ? t('已保存 {count} 个正文单元', {count: written}) : t('确认规划后开始')}</small></div></li>
          <li className={published ? 'is-complete' : ''}><span>{published ? <StudioIcon name="check" /> : '3'}</span><div><strong>{t('审改与发布')}</strong><small>{t(published ? '当前草稿有固定发布版本' : '体检、试玩，再由你决定发布')}</small></div></li></ol>
      </div>}
      <div className="agent-context-section"><div className="agent-context-label"><StudioIcon name="book" /><h2>{t('参考资料')}</h2></div><button className="agent-reference-link" onClick={onOpenSources}><StudioIcon name="file" /><span>{source?.title ?? t('原作书架')}<small>{t('原作与证据')}</small></span><StudioIcon name="chevron" /></button></div>
      <div className="agent-context-section agent-next-actions"><h2>{t('接下来可以做')}</h2>{['检查这份游戏是否可玩', '审阅人物与玩法规划', '提出一轮修复建议'].map(prompt => <button disabled={busy} key={prompt} onClick={() => onPrompt(t(prompt))}><span>{t(prompt)}</span><StudioIcon name="arrow" /></button>)}</div>
    </> : <>
      <div className="agent-context-section"><h2>{t('本次对话的操作')}</h2><p className="agent-context-help">{t('工具调用和执行结果保存在这里。修改需要你在对话中确认。')}</p></div>
      {receipts.length ? <ol className="agent-activity-list">{receipts.map(message => {
        const action = conversation?.actions.find(a => a.callId === message.toolCallId), receipt = toolReceipt(message, t);
        const state = action?.status ?? receipt.status;
        return <li key={message.id}><span className={`agent-activity-icon is-${state}`}><StudioIcon name={state === 'pending' ? 'shield' : ['failed', 'uncertain', 'skipped', 'rejected'].includes(state) ? 'close' : 'check'} /></span><div><strong>{t(toolLabel(message.toolName ?? ''))}</strong><p>{t(action ? actionStatusLabels[action.status] : receipt.summary)}</p><details><summary>{t('查看详情')}</summary><pre>{action?.result ?? message.content}</pre></details></div></li>;
      })}</ol> : <div className="agent-activity-empty"><StudioIcon name="history" /><h3>{t('还没有执行记录')}</h3><p>{t('开始对话后，这里会显示 Agent 实际读取的资料和执行的操作。')}</p></div>}
    </>}</div>
  </>;
}
