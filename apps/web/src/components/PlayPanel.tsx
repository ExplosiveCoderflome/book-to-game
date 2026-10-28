import { useCallback, useEffect, useRef, useState } from 'react';
import { actSchema, type GameRevision, type NarrateResult, type ProposeActResult, type SessionView } from '@novel-game/contracts';
import { errorMessage, request, RequestError } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { readTiandaoCorrect } from '../lib/tiandao';
import { PendingAction, type PendingActionValue } from '../lib/pending-action';
import { diffOptionSets, diffVariables, labelFnFromContent, type OptionChangeSummary, type VariableDelta } from '../lib/variable-delta';
import { Empty, Notice, dateLabel } from './Notice';
import { ReaderPlaySurface } from './play/ReaderPlaySurface';
import { playStoryHash } from '../lib/play-route';
import { CopyPlayLinkButton } from './player/CopyPlayLinkButton';
import { OpenPlayerShellButton } from './player/OpenPlayerShellButton';

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
  const [proposeNote, setProposeNote] = useState<string | null>(null);
  const [varDeltas, setVarDeltas] = useState<VariableDelta[] | null>(null);
  const [optionChanges, setOptionChanges] = useState<OptionChangeSummary | null>(null);
  useEffect(() => {
    if (!varDeltas?.length && !optionChanges?.newlyAvailable.length && !optionChanges?.newlyUnavailable.length) return;
    const timer = window.setTimeout(() => { setVarDeltas(null); setOptionChanges(null); }, 4500);
    return () => window.clearTimeout(timer);
  }, [varDeltas, optionChanges]);
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
      setSession(started); setSessionId(started.id); await refresh();
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  async function act(choiceId: string) {
    if (!session) return;
    setBusy(true); setError(null); setVarDeltas(null); setOptionChanges(null);
    try {
      const before = session;
      const input = pending.current.begin(session.id, choiceId, session.turn);
      sessionStorage.setItem(pendingKey, JSON.stringify(pending.current.value));
      const result = await request<SessionView>(token, `/sessions/${session.id}/actions`, 'POST', input);
      pending.current.confirm(); sessionStorage.removeItem(pendingKey); setUncertain(false);
      const rev = revisions.find(r => r.id === result.gameRevisionId) ?? revisions.find(r => r.id === revisionId);
      const deltas = diffVariables(before.variables ?? {}, result.variables ?? {}, labelFnFromContent(rev?.content));
      setVarDeltas(deltas.length ? deltas : null);
      const changes = diffOptionSets(before.scene.choices.map(c => ({ id: c.id, label: c.label })), result.scene.choices.map(c => ({ id: c.id, label: c.label })));
      setOptionChanges(changes.newlyAvailable.length || changes.newlyUnavailable.length ? changes : null);
      setSession(result); await refresh();
    } catch (e) {
      setError(errorMessage(e));
      if (e instanceof RequestError && !e.uncertain) { pending.current.confirm(); sessionStorage.removeItem(pendingKey); setUncertain(false); }
      else setUncertain(!!pending.current.value);
    } finally { setBusy(false); }
  }

  const narrate = useCallback(async (force: boolean): Promise<NarrateResult> => {
    if (!session) throw new Error('no session');
    return request<NarrateResult>(token, `/sessions/${session.id}/narrate`, 'POST', {
      expectedTurn: session.turn, force, tiandaoCorrect: readTiandaoCorrect(),
    });
  }, [session, token]);
  async function propose(text: string): Promise<ProposeActResult> {
    if (!session) throw new Error('no session');
    setBusy(true); setError(null);
    try {
      const result = await request<ProposeActResult>(token, `/sessions/${session.id}/propose-act`, 'POST', {
        text, expectedTurn: session.turn, requestId: crypto.randomUUID(), autoAct: true, tiandaoCorrect: readTiandaoCorrect(),
      });
      if (result.status === 'acted' && result.session) {
        setProposeNote(result.label ? `已映射并执行：${result.label}` : '已映射并执行');
        const next = result.session as SessionView;
        const rev = revisions.find(r => r.id === next.gameRevisionId) ?? revisions.find(r => r.id === revisionId);
        const deltas = diffVariables(session.variables ?? {}, next.variables ?? {}, labelFnFromContent(rev?.content));
        setVarDeltas(deltas.length ? deltas : null);
        const changes = diffOptionSets(session.scene.choices.map(c => ({ id: c.id, label: c.label })), next.scene.choices.map(c => ({ id: c.id, label: c.label })));
        setOptionChanges(changes.newlyAvailable.length || changes.newlyUnavailable.length ? changes : null);
        setSession(next);
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
  return <section className="work-section">
    <div className="section-heading"><div><p className="eyebrow">{t('04 / 读者席')}</p><h2>{t('现在，由你走进故事')}</h2><p>{t('每份存档固定一个发布版本。回到这里，继续上一次的选择。')}</p></div><div className="stack" style={{alignItems:'flex-end',gap:8}}><span className="edition">READ & PLAY</span>{revisionId ? <div className="player-open-actions"><OpenPlayerShellButton mode="story" revisionId={revisionId} className="quiet small" /><CopyPlayLinkButton hash={playStoryHash(revisionId)} /></div> : null}</div></div>
    <Notice text={error} /><Notice kind="info" text={uncertain ? t('上一选择的请求结果尚未确认。请重试原选择，服务会返回同一结果，不会重复推进故事。') : null} />
    <div className="play-layout"><aside className="panel stack">
      <h3>{t('发布书目')}</h3><label>{t('选择发布版本')}<select value={revisionId} disabled={busy || uncertain} onChange={e => selectRevision(e.target.value)}><option value="">{t('请选择一个已发布游戏')}</option>{revisions.map(r => <option key={r.id} value={r.id}>{r.content.title} · v{r.version}</option>)}</select></label>
      {revisions.find(r => r.id === revisionId) && <p className="hint">{revisions.find(r => r.id === revisionId)?.content.premise}</p>}
      <button className="primary" disabled={!revisionId || busy || uncertain} onClick={start}>{t('开始新存档')}</button>
      <div className="divider" /><h3>{t('我的存档')} <small>{sessions.length}</small></h3>
      {sessions.length === 0 ? <Empty>{t('从一个发布版本开始，存档会自动保存。')}</Empty> : <ul className="item-list">{sessions.map(s => <li key={s.id}><button className={`list-button ${s.id === sessionId ? 'selected' : ''}`} disabled={busy || uncertain} onClick={() => setSessionId(s.id)}><strong>{revisions.find(r => r.id === s.gameRevisionId)?.content.title ?? t('文字冒险')}</strong><span>{t('第 {turn} 幕', { turn: s.turn + 1 })} · {s.ended ? t('已到结局') : s.scene.title}</span><small>{dateLabel(s.updatedAt, locale)}</small></button></li>)}</ul>}
    </aside><article className="panel reading-page">
      <ReaderPlaySurface
        session={session}
        revision={activeRevision}
        busy={busy}
        uncertain={uncertain}
        varDeltas={varDeltas}
        optionChanges={optionChanges}
        proposeNote={proposeNote}
        showAiAux
        pathDefaultOpen
        onAct={id => void act(id)}
        onReplay={() => void start()}
        onReload={() => setReload(v => v + 1)}
        onRetryPending={pending.current.value ? () => void act(pending.current.value!.input.choiceId) : undefined}
        onNarrate={narrate}
        onPropose={propose}
      />
    </article></div>
  </section>;
}
