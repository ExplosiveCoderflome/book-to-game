import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { GenerationJob, SourceSummary, WorldDraft, WorldRevision } from '@novel-game/contracts';
import { request } from '../../lib/api';
import { useI18n } from '../../lib/i18n';
import { StudioIcon, type StudioIconName } from '../studio/StudioIcon';
import { AgentContext } from './AgentContext';
import { AgentHistory } from './AgentHistory';
import { AgentTimeline } from './AgentTimeline';
import { useAgentConversation } from './useAgentConversation';
import { conversationLabel } from './agent-presenter';
import './agent-workspace.css';

const starters: {icon: StudioIconName; title: string; detail: string; prompt: string}[] = [
  {icon: 'book', title: '改编一个故事', detail: '从角色与创作目标出发', prompt: '我想把一个故事改编成可玩的角色扮演游戏，请先帮我梳理创作目标和玩法规划。'},
  {icon: 'world', title: '继续打磨作品', detail: '梳理人物、规划与剧情', prompt: '请先读取当前作品的规划与进度，告诉我哪些地方最值得继续完善。'},
  {icon: 'play', title: '检查是否可玩', detail: '检查规则与结局覆盖', prompt: '请检查当前草稿的结构和内容，运行模拟试玩并说明路线覆盖、节奏与可玩性问题，先不要修改。'},
  {icon: 'tasks', title: '推进制作任务', detail: '查看进度与待办问题', prompt: '请查看我的制作任务，说明哪些任务需要我确认或处理，以及下一步可以做什么。'},
];

export function AgentChatPanel({token, configured, active, historyHost, worlds, jobs, sources, revisions, onConfigure, onChanged, onOpenDraft, onOpenJobs, onOpenSources}: {
  token: string; configured: boolean; active: boolean; historyHost: HTMLDivElement | null;
  worlds: WorldDraft[]; jobs: GenerationJob[]; sources: SourceSummary[]; revisions: WorldRevision[];
  onConfigure: () => void; onChanged: () => Promise<void>; onOpenDraft: (id: string) => void; onOpenJobs: () => void; onOpenSources: () => void;
}) {
  const {t} = useI18n();
  const chat = useAgentConversation(token, active, onChanged);
  const [contextId, setContextId] = useState<string | null>(null);
  const draft = contextId === null ? worlds[0] : worlds.find(w => w.id === contextId);
  const [mode, setMode] = useState<'project' | 'activity'>('project');
  const [showContext, setShowContext] = useState(true), [model, setModel] = useState('');
  const contextDialog = useRef<HTMLDialogElement>(null), historyDialog = useRef<HTMLDialogElement>(null);
  const log = useRef<HTMLDivElement>(null), composer = useRef<HTMLTextAreaElement>(null), follow = useRef(true);
  const context = draft ? `【当前世界草稿：${draft.content.title}｜ID：${draft.id}｜版本：${draft.version}】` : '';
  const messageLimit = 8000 - context.length - (context ? 2 : 0);
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    request<{model: string}>(token, '/settings/model').then(result => {if (!cancelled) setModel(result.model);}).catch(() => {if (!cancelled) setModel('');});
    return () => {cancelled = true;};
  }, [active, configured, token]);
  useEffect(() => {follow.current = true;}, [chat.id]);
  useEffect(() => {if (active && follow.current && log.current && chat.current?.messages.length) log.current.scrollTop = log.current.scrollHeight;}, [active, chat.current?.version]);
  const prompt = (value: string) => {chat.setText(value); contextDialog.current?.close(); composer.current?.focus();};
  const history = <AgentHistory summaries={chat.summaries} selectedId={chat.id} busy={chat.busy}
    onCreate={() => {historyDialog.current?.close(); void chat.start();}} onSelect={id => {chat.select(id); historyDialog.current?.close();}} />;
  const contextContent = <AgentContext mode={mode} setMode={setMode} worlds={worlds} draft={draft} jobs={jobs} sources={sources} revisions={revisions}
    conversation={chat.current} busy={!!chat.running} onSelect={setContextId}
    onOpenDraft={id => {contextDialog.current?.close(); onOpenDraft(id);}} onOpenJobs={() => {contextDialog.current?.close(); onOpenJobs();}}
    onOpenSources={() => {contextDialog.current?.close(); onOpenSources();}} onPrompt={prompt} />;
  const openContext = () => {
    if (window.matchMedia('(max-width: 1100px)').matches) contextDialog.current?.showModal(); else setShowContext(value => !value);
  };
  const empty = !chat.current?.messages.length;
  return <section className="agent-workbench" aria-label={t('Agent 工作区')}>
    {active && historyHost && createPortal(history, historyHost)}
    <header className="agent-workbench-header"><div><button className="studio-icon-button agent-mobile-history" aria-label={t('查看对话列表')} onClick={() => historyDialog.current?.showModal()}><StudioIcon name="history" /></button>
      <h1 title={conversationLabel(chat.current?.title ?? '')}>{empty ? t('新的创作') : conversationLabel(chat.current?.title ?? '')}</h1>{!empty && <span className="agent-saved-label"><StudioIcon name="check" />{t('已保存')}</span>}</div>
      <div><button className="agent-new-button" aria-label={t('新建对话')} disabled={chat.busy} onClick={() => void chat.start()}><StudioIcon name="plus" /><span>{t('新对话')}</span></button>
        <button className="studio-icon-button" aria-label={t('重新读取对话')} onClick={() => void chat.refresh()}><StudioIcon name="refresh" /></button>
        <button className="agent-context-trigger" aria-label={t('查看创作上下文')} onClick={openContext}><StudioIcon name="panel" /><span>{t('上下文')}</span></button></div>
    </header>
    <div className={`agent-stage ${showContext ? 'with-context' : ''}`}>
      <div className="agent-chat-area">
        <div className={`agent-message-log ${empty ? 'is-empty' : ''}`} role="log" aria-label={t('对话记录')} aria-live="polite" tabIndex={0} ref={log}
          onScroll={e => {const node = e.currentTarget; follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 120;}}>
          {chat.loading ? <div className="agent-loading" role="status"><span className="agent-working-dot" />{t('正在读取对话…')}</div> : empty ? <div className="agent-welcome">
            <p className="agent-welcome-kicker">{t('故事工坊 · 创作助手')}</p>
            <h2>{t('让故事，成为可游玩的世界。')}</h2><p className="agent-welcome-description">{t('从一个想法开始，或继续打磨你的作品。')}<br />{t('我来梳理人物与玩法，你来决定故事的走向。')}</p>
            <div className="agent-creation-path"><span>{t('原作线索')}</span><i /><span>{t('人物与规则')}</span><i /><span>{t('可玩世界')}</span></div>
            <div className="agent-starters">{starters.map(item => <button key={item.title} onClick={() => prompt(t(item.prompt))} disabled={!!chat.running}><StudioIcon name={item.icon} /><div><strong>{t(item.title)}</strong><small>{t(item.detail)}</small></div><StudioIcon name="arrow" /></button>)}</div>
          </div> : chat.current && <AgentTimeline conversation={chat.current} running={!!chat.running} onDecide={(id, decision) => void chat.decide(id, decision)} />}
          {chat.running && <div className="agent-processing" role="status"><span className="agent-working-dot" /><span>{t('正在处理，进展会自动保存…')}</span><button className="quiet small" onClick={() => {setMode('activity'); if (window.matchMedia('(max-width: 1100px)').matches) contextDialog.current?.showModal(); else setShowContext(true);}}>{t('查看执行记录')}</button></div>}
        </div>
        <div className="agent-compose-area">
          {chat.error && <div className="agent-inline-error" role="alert"><p>{chat.error}</p><button onClick={() => void chat.refresh()}>{t('重新读取对话')}</button></div>}
          {!configured && <div className="agent-setup-notice"><span>{t('连接模型，开始与创作助手协作。')}</span><button onClick={onConfigure}>{t('配置模型')}<StudioIcon name="arrow" /></button></div>}
          <form className="agent-composer" onSubmit={e => {e.preventDefault(); follow.current = true; void chat.send(context);}}>
            {draft && <div className="agent-composer-context"><StudioIcon name="file" /><span>{draft.content.title}</span><small>v{draft.version}</small><button type="button" disabled={!!chat.running} className="studio-icon-button" aria-label={t('移除草稿上下文')} onClick={() => setContextId('')}><StudioIcon name="close" /></button></div>}
            <label><span className="sr-only">{t('给Agent的消息')}</span><textarea ref={composer} rows={3} value={chat.text} maxLength={messageLimit} disabled={!configured || !!chat.running}
              placeholder={t(chat.running ? 'Agent 正在处理你的请求…' : draft ? '一起完善这份作品，你想先从哪里开始？' : '描述你想改编的故事，或交给我一个创作任务…')}
              onChange={e => chat.setText(e.target.value)} onKeyDown={e => {if (!e.nativeEvent.isComposing && (e.ctrlKey || e.metaKey) && e.key === 'Enter') {e.preventDefault(); e.currentTarget.form?.requestSubmit();}}} /></label>
            <div className="agent-composer-toolbar"><button type="button" className="agent-model-button" onClick={onConfigure}><span className={`studio-status-dot ${configured ? 'is-online' : ''}`} /><span>{configured ? model || t('已配置模型') : t('选择模型')}</span><StudioIcon name="down" /></button>
              <div><span className="agent-keyboard-hint">Ctrl ↵</span><button type="submit" className="agent-send-button" aria-label={t('发送消息')} disabled={!configured || !!chat.running || chat.loading || !chat.text.trim()}><StudioIcon name="up" /></button></div></div>
          </form>
          <p className="agent-composer-note"><StudioIcon name="shield" />{t('对话和按需读取的资料将发送给所选模型；修改与发布由你确认。')}</p>
        </div>
      </div>
      {showContext && <aside className="agent-context-desktop" aria-label={t('创作上下文与执行记录')}>{contextContent}</aside>}
    </div>
    <dialog className="agent-mobile-dialog" ref={contextDialog}><div><button className="studio-icon-button agent-dialog-close" aria-label={t('关闭上下文')} onClick={() => contextDialog.current?.close()}><StudioIcon name="close" /></button>{contextContent}</div></dialog>
    <dialog className="agent-mobile-dialog agent-history-dialog" ref={historyDialog}><div><button className="studio-icon-button agent-dialog-close" aria-label={t('关闭对话列表')} onClick={() => historyDialog.current?.close()}><StudioIcon name="close" /></button>{history}</div></dialog>
  </section>;
}
