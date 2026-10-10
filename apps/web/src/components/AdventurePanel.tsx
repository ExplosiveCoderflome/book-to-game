import { useEffect, useRef, useState } from 'react';
import type { AdventureView, WorldRevision } from '@novel-game/contracts';
import { errorMessage, request, RequestError } from '../lib/api';
import { adventurePendingKey, PendingAdventure, restoreAdventure } from '../lib/pending-adventure';
import { Empty, Notice, dateLabel } from './Notice';

interface Props {token: string; revisions: WorldRevision[]; adventures: AdventureView[]; revisionId: string; selectRevision: (id: string) => void; refresh: () => Promise<void>}
export function AdventurePanel({token, revisions, adventures, revisionId, selectRevision, refresh}: Props) {
  const pending = useRef(new PendingAdventure(restoreAdventure(sessionStorage)));
  const [sessionId, setSessionId] = useState(pending.current.value?.sessionId ?? '');
  const [session, setSession] = useState<AdventureView | null>(null);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(!!pending.current.value);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true; setSession(null); setError(null);
    if (!sessionId) return;
    setBusy(true); request<AdventureView>(token, `/adventures/${sessionId}`).then(value => {if (active) setSession(value);}).catch(e => {if (active) setError(errorMessage(e));}).finally(() => {if (active) setBusy(false);});
    return () => {active = false;};
  }, [token, sessionId, reload]);
  async function start() {
    setBusy(true); setError(null);
    try {const value = await request<AdventureView>(token, '/adventures', 'POST', {worldRevisionId: revisionId}); setSession(value); setSessionId(value.id); await refresh();}
    catch (e) {setError(errorMessage(e));} finally {setBusy(false);}
  }
  async function act(actionId: string) {
    if (!session || busy) return;
    setBusy(true); setError(null);
    try {
      const input = pending.current.begin(session.id, actionId, session.turn);
      sessionStorage.setItem(adventurePendingKey, JSON.stringify(pending.current.value));
      const value = await request<AdventureView>(token, `/adventures/${pending.current.value!.sessionId}/actions`, 'POST', input);
      pending.current.confirm(); sessionStorage.removeItem(adventurePendingKey); setUncertain(false); setSession(value); await refresh();
    } catch (e) {
      setError(errorMessage(e));
      if (e instanceof RequestError && !e.uncertain) {pending.current.confirm(); sessionStorage.removeItem(adventurePendingKey); setUncertain(false); setReload(n => n + 1);}
      else setUncertain(!!pending.current.value);
    } finally {setBusy(false);}
  }
  const revision = revisions.find(r => r.id === session?.worldRevisionId);
  return <section className="work-section"><div className="section-heading"><div><p className="eyebrow">开放冒险</p><h2>去哪里，做什么，由你决定</h2><p>观察、交谈与行动会留下后果。每份存档固定一个世界版本。</p></div><span className="edition">EXPLORE & ACT</span></div>
    <Notice text={error} /><Notice kind="info" text={uncertain ? '上一行动结果尚未确认。请重试原请求；重试使用相同存档与请求标识，不会重复耗时。' : null} />
    <div className="play-layout"><aside className="panel stack"><h3>发布世界</h3><label>选择世界版本<select disabled={busy || uncertain} value={revisionId} onChange={e => selectRevision(e.target.value)}><option value="">选择已发布世界</option>{revisions.map(r => <option key={r.id} value={r.id}>{r.content.title} · v{r.version}</option>)}</select></label><p className="hint">{revisions.find(r => r.id === revisionId)?.content.premise}</p><button className="primary" disabled={busy || uncertain || !revisionId} onClick={start}>开始新冒险</button><div className="divider" /><h3>冒险存档 <small>{adventures.length}</small></h3>
      {adventures.length ? <ul className="item-list">{adventures.map(s => <li key={s.id}><button className={`list-button ${s.id === sessionId ? 'selected' : ''}`} disabled={busy || uncertain} onClick={() => setSessionId(s.id)}><strong>{revisions.find(r => r.id === s.worldRevisionId)?.content.title ?? '开放冒险'}</strong><span>{s.location.title} · {s.ended ? '已结束' : `耗时 ${s.elapsed}/${s.timeLimit}`}</span><small>{dateLabel(s.updatedAt)}</small></button></li>)}</ul> : <Empty>发布世界后即可创建存档。</Empty>}
    </aside><article className="panel reading-page">
      {!session ? <><Empty>{busy ? '正在读取存档…' : '开始新冒险或打开已有存档。'}</Empty>{sessionId && <button disabled={busy} onClick={() => setReload(n => n + 1)}>重新读取存档</button>}</> : <>
        <div className="reader-meta"><span>{revision?.content.title ?? '开放冒险'} · v{revision?.version ?? '—'}</span><span>行动 {session.turn}</span></div>
        <div className="adventure-goal"><strong>{session.playerRole}</strong><p>目标：{session.goal}</p><label>时间 · 已用 {session.elapsed} / {session.timeLimit} · 剩余 {Math.max(0, session.timeLimit - session.elapsed)}<progress max={session.timeLimit} value={session.elapsed} /></label></div>
        <h3>{session.location.title}</h3><div className="reader-text">{session.location.text.split(/\n+/).map((text, i) => <p key={i}>{text}</p>)}</div>
        {session.turn > 0 && <section className="adventure-result" aria-live="polite"><p className="eyebrow">刚刚发生</p>{session.history.at(-1)?.text.split(/\n+/).map((text, i) => <p key={i}>{text}</p>)}</section>}
        <div className="world-grid"><section><h4>已知信息</h4>{session.facts.length ? session.facts.map(f => <div className="known-fact" key={f.id}><strong>{f.label}</strong><span className="hint"> · {f.value ? '当前成立' : '当前不成立'}</span><p>{f.description}</p></div>) : <p className="hint">尚未发现线索。</p>}</section><section><h4>在场人物</h4>{session.npcs.length ? session.npcs.map(n => <div key={n.id}><strong>{n.name}</strong><p>{n.description}</p></div>) : <p className="hint">这里暂时没有其他人。</p>}</section></div>
        {session.ending && <div className="ending"><p className="eyebrow">冒险结局</p><h4>{session.ending.title}</h4><p>{session.ending.text}</p></div>}
        {uncertain && pending.current.value && <button className="primary" disabled={busy} onClick={() => act(pending.current.value!.input.actionId)}>重试并确认上一行动</button>}
        {!session.ended && <div className="adventure-actions"><p className="eyebrow">可以采取的行动</p>{session.actions.map(a => <div className="adventure-action" key={a.id}><button disabled={busy || uncertain || !a.enabled} onClick={() => act(a.id)}><strong>{a.label}</strong><span>耗时 {a.timeCost} →</span></button><p>{a.description}</p>{a.risk && <p className="hint">风险：{a.risk}</p>}{!a.enabled && <p className="blocked-reason">{a.blockedReason ?? '当前条件不满足'}</p>}</div>)}{!session.actions.length && <p className="hint">当前没有可见行动。</p>}</div>}
        <div className="reader-footer"><p className="hint">行动成功后自动保存。</p><button className="quiet small" disabled={busy} onClick={() => setReload(n => n + 1)}>重新读取存档</button></div>
        <details className="history" open><summary>回看行程 · {session.history.length} 条记录</summary>{session.history.map((h, i) => <div key={i}><p className="eyebrow">行动 {h.turn} · 耗时 {h.elapsed}{h.actionLabel ? ` · ${h.actionLabel}` : ''}</p><p>{h.text}</p></div>)}</details>
      </>}
    </article></div>
  </section>;
}
