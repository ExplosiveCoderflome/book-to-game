import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { AgentChatConversation, AgentChatSummary } from '@novel-game/contracts';
import { createAgentChat, decideAgentAction, getAgentChat, listAgentChats, sendAgentMessage } from '../../lib/agent-chat-api';
import { errorMessage } from '../../lib/api';
import { useI18n } from '../../lib/i18n';

const selectionKey = 'novel-game.agent-chat-id';
function savedSelection() {try {return localStorage.getItem(selectionKey) ?? '';} catch {return '';}}

export function AgentChatPanel({token, configured, active, onConfigure, onChanged}: {
  token: string; configured: boolean; active: boolean; onConfigure: () => void; onChanged: () => Promise<void>;
}) {
  const {t} = useI18n();
  const [summaries, setSummaries] = useState<AgentChatSummary[]>([]);
  const [id, setId] = useState(savedSelection);
  const [conversation, setConversation] = useState<AgentChatConversation | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selected = useRef(id); selected.current = id;
  const pending = useRef<{id: string; requestId: string; text: string} | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const accept = useCallback((next: AgentChatConversation) => {
    if (selected.current !== next.id) return;
    setConversation(previous => previous?.id === next.id && previous.version > next.version ? previous : next);
  }, []);
  const loadList = useCallback(async () => {
    const result = await listAgentChats(token); setSummaries(result.conversations);
    setId(current => result.conversations.some(c => c.id === current) ? current : result.conversations[0]?.id ?? '');
  }, [token]);
  useEffect(() => {
    if (!active) return;
    loadList().catch(e => setError(errorMessage(e)));
  }, [active, loadList]);
  useEffect(() => {
    try {if (id) localStorage.setItem(selectionKey, id);} catch { /* selection only; messages stay on the server */ }
    if (!active || !id) return;
    let cancelled = false; setLoading(true); setError(null);
    getAgentChat(token, id).then(next => {if (!cancelled) accept(next);})
      .catch(e => {if (!cancelled) setError(errorMessage(e));}).finally(() => {if (!cancelled) setLoading(false);});
    return () => {cancelled = true;};
  }, [active, token, id, accept]);
  useEffect(() => {
    if (!active || !id || conversation?.id !== id || conversation.status !== 'running') return;
    let cancelled = false, polling = false;
    const timer = setInterval(() => {
      if (polling) return; polling = true;
      getAgentChat(token, id).then(next => {if (!cancelled) accept(next);})
        .catch(e => {if (!cancelled) setError(errorMessage(e));}).finally(() => {polling = false;});
    }, 1500);
    return () => {cancelled = true; clearInterval(timer);};
  }, [active, token, id, conversation?.id, conversation?.status, accept]);
  useEffect(() => {if (active) bottom.current?.scrollIntoView({block: 'nearest'});}, [active, conversation?.version]);

  const current = conversation?.id === id ? conversation : null;
  const running = busy || current?.status === 'running';
  const start = async () => {
    setBusy(true); setError(null);
    try {const next = await createAgentChat(token); selected.current = next.id; setId(next.id); setConversation(next); setText(''); pending.current = null; await loadList();}
    catch (e) {setError(errorMessage(e));} finally {setBusy(false);}
  };
  const send = async (event: FormEvent) => {
    event.preventDefault(); if (!text.trim() || running || loading) return;
    const body = text.trim(); setBusy(true); setError(null);
    try {
      let target = id;
      if (!target) {const next = await createAgentChat(token); target = next.id; selected.current = target; setId(target); setConversation(next);}
      const retry = pending.current;
      const requestId = retry?.id === target && retry.text === body ? retry.requestId : crypto.randomUUID();
      pending.current = {id: target, requestId, text: body};
      // Read once while the long request is running so the saved user message and tools can be polled.
      const response = sendAgentMessage(token, target, requestId, body);
      const timer = setTimeout(() => {getAgentChat(token, target).then(accept).catch(() => undefined);}, 300);
      let next: AgentChatConversation;
      try {next = await response;} finally {clearTimeout(timer);}
      accept(next); setText(''); pending.current = null;
      await loadList(); await onChanged();
    } catch (e) {setError(errorMessage(e));}
    finally {setBusy(false);}
  };
  const decide = async (actionId: string, decision: 'confirm' | 'reject') => {
    setBusy(true); setError(null);
    try {
      const next = await decideAgentAction(token, id, actionId, decision); accept(next);
      await loadList(); await onChanged();
    } catch (e) {setError(errorMessage(e)); getAgentChat(token, id).then(accept).catch(() => undefined);}
    finally {setBusy(false);}
  };
  const statuses: Record<string, string> = {pending: '待你确认', executing: '正在执行', succeeded: '已执行', failed: '执行失败', rejected: '已拒绝', uncertain: '结果未确认'};
  return <section className="agent-chat" aria-label={t('Agent 对话')}>
    <div className="section-heading"><div><p className="eyebrow">{t('作者助手')}</p><h2>{t('Agent 对话')}</h2></div>
      <button type="button" disabled={busy} onClick={() => {void loadList().catch(e => setError(errorMessage(e))); if (id) getAgentChat(token, id).then(accept).catch(e => setError(errorMessage(e)));}}>{t('重新读取对话')}</button>
    </div>
    <p className="hint">{t('对话与按需读取的资料会发送给模型设置中的服务。查询和体检可直接执行，修改、生成、重试和发布会先等待你确认。')}</p>
    {!configured && <div className="notice"><p>{t('先配置模型，才能与Agent对话。')}</p><button onClick={onConfigure}>{t('前往模型设置')}</button></div>}
    {error && <p role="alert" className="notice error">{error}</p>}
    <div className="agent-chat-layout">
      <aside className="agent-chat-sidebar" aria-label={t('对话列表')}>
        <button type="button" className="quiet" disabled={busy} onClick={() => void start()}>{t('新建对话')}</button>
        {summaries.length ? <ul>{summaries.map(item => <li key={item.id}><button type="button" disabled={busy} aria-current={item.id === id ? 'true' : undefined}
          onClick={() => {selected.current = item.id; setId(item.id); setText(''); pending.current = null;}}>{item.title}<small>{item.status === 'running' ? t('正在处理') : new Date(item.updatedAt).toLocaleString()}</small></button></li>)}</ul>
          : <p className="hint">{t('还没有对话，直接输入消息开始。')}</p>}
      </aside>
      <div className="agent-chat-main">
        <div className="agent-chat-log" role="log" aria-label={t('对话记录')} aria-live="polite">
          {loading && <p role="status">{t('正在读取对话…')}</p>}
          {!current?.messages.length && !loading && <div className="agent-chat-empty"><h3>{t('告诉我你想完成什么')}</h3>
            <p>{t('可以查询原作和草稿、检查失败任务、运行体检、生成修复候选，或提出需要你确认的修改。')}</p>
            <div className="toolbar">{['列出我的世界草稿', '看看哪些生成任务失败了', '你能帮我完成哪些操作？'].map(prompt => <button type="button" className="quiet small" key={prompt} onClick={() => setText(t(prompt))}>{t(prompt)}</button>)}</div>
          </div>}
          {current?.messages.map(message => message.role === 'tool'
            ? <details className="agent-chat-tool" key={message.id}><summary>{t('工具回执')} · {message.toolName}</summary><pre>{message.content}</pre></details>
            : <article key={message.id} className={`agent-chat-message is-${message.role}`}><strong>{message.role === 'user' ? t('你') : 'Agent'}</strong>
              {message.content && <p>{message.content}</p>}{message.toolCalls?.length ? <small>{t('调用工具')}：{message.toolCalls.map(c => c.name).join('、')}</small> : null}</article>)}
          {current?.actions.map(action => <article className={`agent-chat-action is-${action.status}`} key={action.id}>
            <strong>{t(statuses[action.status] ?? action.status)}</strong><p>{action.summary}</p>
            <details><summary>{t('查看具体操作参数')}</summary><pre>{JSON.stringify(action.arguments, null, 2)}</pre></details>
            {action.result && <details><summary>{t('执行结果')}</summary><pre>{action.result}</pre></details>}
            {action.status === 'uncertain' && <p>{t('请先查询实际业务状态，此操作不会自动重复执行。')}</p>}
            {action.status === 'pending' && <div className="toolbar"><button type="button" disabled={running} onClick={() => void decide(action.id, 'confirm')}>{t('确认执行')}</button>
              <button type="button" className="quiet" disabled={running} onClick={() => void decide(action.id, 'reject')}>{t('拒绝')}</button></div>}
          </article>)}
          {running && <p role="status">{t('Agent正在处理，工具回执会保存；刷新后可以继续查看。')}</p>}
          <div ref={bottom} />
        </div>
        <form className="agent-chat-composer" onSubmit={event => void send(event)}>
          <label>{t('给Agent的消息')}<textarea rows={3} maxLength={8000} disabled={!configured || running} value={text}
            placeholder={t('例如：列出我的世界草稿，并检查哪份需要修复。')} onChange={event => setText(event.target.value)}
            onKeyDown={event => {if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {event.preventDefault(); event.currentTarget.form?.requestSubmit();}}} /></label>
          <div className="toolbar"><span className="hint">{t('Ctrl+Enter发送；每轮最多4次模型调用。')}</span><button type="submit" className="primary" disabled={!configured || running || loading || !text.trim()}>{t(running ? '正在处理' : '发送消息')}</button></div>
        </form>
      </div>
    </div>
  </section>;
}
