import { useEffect, useMemo, useRef, useState } from 'react';
import { actSchema, type GameRevision, type ProposeActResult, type SessionView } from '@novel-game/contracts';
import { errorMessage, request, RequestError } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { PendingAction, type PendingActionValue } from '../lib/pending-action';
import { playOverlayFromSession } from '../lib/play-overlay';
import { BranchGraphCanvas } from './BranchGraphCanvas';
import { Empty, Notice, dateLabel } from './Notice';
import { ProposeActBox } from './ProposeActBox';

const pendingKey = 'novel-game.pending-action';
function restorePending(): PendingActionValue | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(pendingKey) ?? 'null');
    if (value && typeof value.sessionId === 'string') {
      const parsed = actSchema.safeParse(value.input);
      if (parsed.success) return { sessionId: value.sessionId, input: parsed.data };
    }
  } catch { /* An invalid browser record is not an action. */ }
  return null;
}
interface Props { token: string; revisions: GameRevision[]; sessions: SessionView[]; revisionId: string; selectRevision: (id: string) => void; refresh: () => Promise<void> }

export function PlayPanel({ token, revisions, sessions, revisionId, selectRevision, refresh }: Props) {
  const { locale, t } = useI18n();
  const pending = useRef(new PendingAction(restorePending()));
  const [session, setSession] = useState<SessionView | null>(null);
  const [sessionId, setSessionId] = useState(pending.current.value?.sessionId ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(!!pending.current.value);
  const [reload, setReload] = useState(0);
  const [showPath, setShowPath] = useState(true);
  const [proposeNote, setProposeNote] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setSession(null);
    if (!sessionId) return;
    setBusy(true); setError(null);
    request<SessionView>(token, `/sessions/${sessionId}`).then(value => { if (active) setSession(value); }).catch(e => { if (active) setError(errorMessage(e)); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [sessionId, token, reload]);
  async function start() {
    setBusy(true); setError(null);
    try {
      const started = await request<SessionView>(token, '/sessions', 'POST', { gameRevisionId: revisionId });
      setSession(started); setSessionId(started.id); setShowPath(true); await refresh();
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  async function act(choiceId: string) {
    if (!session) return;
    setBusy(true); setError(null);
    try {
      const input = pending.current.begin(session.id, choiceId, session.turn);
      sessionStorage.setItem(pendingKey, JSON.stringify(pending.current.value));
      const result = await request<SessionView>(token, `/sessions/${session.id}/actions`, 'POST', input);
      pending.current.confirm(); sessionStorage.removeItem(pendingKey); setUncertain(false); setSession(result); await refresh();
    } catch (e) {
      setError(errorMessage(e));
      if (e instanceof RequestError && !e.uncertain) { pending.current.confirm(); sessionStorage.removeItem(pendingKey); setUncertain(false); }
      else setUncertain(!!pending.current.value);
    } finally { setBusy(false); }
  }
  async function propose(text: string): Promise<ProposeActResult> {
    if (!session) throw new Error('no session');
    setBusy(true); setError(null);
    try {
      const result = await request<ProposeActResult>(token, `/sessions/${session.id}/propose-act`, 'POST', {
        text, expectedTurn: session.turn, requestId: crypto.randomUUID(), autoAct: true,
      });
      if (result.status === 'acted' && result.session) {
        setProposeNote(result.label ? `已映射并执行：${result.label}` : '已映射并执行');
        setSession(result.session as SessionView);
        await refresh();
      } else if (result.status === 'none' || result.status === 'rejected') {
        setProposeNote(result.reason);
      }
      return result;
    } catch (e) {
      setError(errorMessage(e));
      throw e;
    } finally { setBusy(false); }
  }
  const activeRevision = revisions.find(r => r.id === session?.gameRevisionId) ?? revisions.find(r => r.id === revisionId);
  const playOverlay = useMemo(() => {
    if (!session || !activeRevision) return null;
    return playOverlayFromSession(activeRevision.content, session);
  }, [session, activeRevision]);
  return <section className="work-section">
    <div className="section-heading"><div><p className="eyebrow">{t('04 / 读者席')}</p><h2>{t('现在，由你走进故事')}</h2><p>{t('每份存档固定一个发布版本。回到这里，继续上一次的选择。')}</p></div><span className="edition">READ & PLAY</span></div>
    <Notice text={error} /><Notice kind="info" text={uncertain ? t('上一选择的请求结果尚未确认。请重试原选择，服务会返回同一结果，不会重复推进故事。') : null} />
    <div className="play-layout"><aside className="panel stack">
      <h3>{t('发布书目')}</h3><label>{t('选择发布版本')}<select value={revisionId} disabled={busy || uncertain} onChange={e => selectRevision(e.target.value)}><option value="">{t('请选择一个已发布游戏')}</option>{revisions.map(r => <option key={r.id} value={r.id}>{r.content.title} · v{r.version}</option>)}</select></label>
      {revisions.find(r => r.id === revisionId) && <p className="hint">{revisions.find(r => r.id === revisionId)?.content.premise}</p>}
      <button className="primary" disabled={!revisionId || busy || uncertain} onClick={start}>{t('开始新存档')}</button>
      <div className="divider" /><h3>{t('我的存档')} <small>{sessions.length}</small></h3>
      {sessions.length === 0 ? <Empty>{t('从一个发布版本开始，存档会自动保存。')}</Empty> : <ul className="item-list">{sessions.map(s => <li key={s.id}><button className={`list-button ${s.id === sessionId ? 'selected' : ''}`} disabled={busy || uncertain} onClick={() => setSessionId(s.id)}><strong>{revisions.find(r => r.id === s.gameRevisionId)?.content.title ?? t('文字冒险')}</strong><span>{t('第 {turn} 幕', { turn: s.turn + 1 })} · {s.ended ? t('已到结局') : s.scene.title}</span><small>{dateLabel(s.updatedAt, locale)}</small></button></li>)}</ul>}
    </aside><article className="panel reading-page">
      {busy && !session ? <p role="status">{t('正在读取存档…')}</p> : !session ? <Empty>{t('选择一本已发布的故事，或者打开左侧存档。')}</Empty> : <>
        <div className="reader-meta"><span>{activeRevision?.content.title ?? t('文字冒险')} · v{activeRevision?.version ?? '—'}</span><span>{t('第 {turn} 幕', { turn: session.turn + 1 })}</span></div>
        <h3>{session.scene.title}</h3><div className="reader-text">{session.scene.text.split(/\n+/).map((text, i) => <p key={i}>{text}</p>)}</div>
        {Object.keys(session.variables ?? {}).length > 0 && <details><summary>{t('当前故事变量')}</summary><dl>{Object.entries(session.variables ?? {}).map(([name, value]) => <div className="field-row" key={name}><dt>{name}</dt><dd>{typeof value === 'boolean' ? t(value ? '真' : '假') : String(value)}</dd></div>)}</dl></details>}
        {session.ended && <div className="ending"><p className="eyebrow">{t('故事抵达了一个结局')}</p><p>{session.scene.ending ?? t('旅程告一段落。')}</p></div>}
        {proposeNote && <Notice kind="success" text={proposeNote} />}
        {uncertain && pending.current.value && <button className="primary" disabled={busy} onClick={() => act(pending.current.value!.input.choiceId)}>{t(busy ? '正在确认…' : '重试并确认上一选择')}</button>}
        {!session.ended && <div className="reader-choices"><p className="eyebrow">{t('你将如何选择？')}</p>{session.scene.choices.map((choice, i) => <button key={choice.id} disabled={busy || uncertain} onClick={() => act(choice.id)}><span aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>{choice.label}<span aria-hidden="true">→</span></button>)}</div>}
        {!session.ended && !uncertain && <ProposeActBox disabled={busy} busy={busy} onPropose={propose} onPickCandidate={id => void act(id)} />}
        <div className="reader-footer"><p className="hint">{t('选择成功后自动保存。存档 ID：{id}', { id: session.id })}</p><button className="quiet small" disabled={busy} onClick={() => setReload(v => v + 1)}>{t('重新读取存档')}</button></div>
        <details className="history"><summary>{t('回看行程 · {count} 条记录', { count: session.history.length })}</summary>{session.history.map((entry, i) => <div key={i}><p className="eyebrow">{t('第 {turn} 幕', { turn: entry.turn + 1 })}{entry.choiceLabel ? ` · ${entry.choiceLabel}` : ''}</p><p>{entry.text}</p></div>)}</details>
        {activeRevision && <div className="play-path-panel" data-testid="play-path-panel">
          <div className="panel-heading">
            <h3>{t('分支路径')}</h3>
            <button type="button" className="small" onClick={() => setShowPath(v => !v)}>{t(showPath ? '收起路径画布' : '展开路径画布')}</button>
          </div>
          {showPath && playOverlay && (
            <BranchGraphCanvas
              content={activeRevision.content}
              selectedSceneId={session.scene.id}
              onSelectScene={() => { /* play view: selection follows session */ }}
              playOverlay={playOverlay}
              readOnly
              playabilityMode="publish"
            />
          )}
        </div>}
      </>}
    </article></div>
  </section>;
}
