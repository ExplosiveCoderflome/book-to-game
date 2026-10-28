import { useCallback, useEffect, useRef, useState } from 'react';
import { type AdventureView, type NarrateResult, type WorldRevision } from '@novel-game/contracts';
import { errorMessage, request, RequestError } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { readTiandaoCorrect } from '../lib/tiandao';
import { adventurePendingKey, PendingAdventure, restoreAdventure } from '../lib/pending-adventure';
import { Notice } from './Notice';
import { AdventurePlaySurface } from './play/AdventurePlaySurface';
import { playWorldHash } from '../lib/play-route';
import { CopyPlayLinkButton } from './player/CopyPlayLinkButton';
import { OpenPlayerShellButton } from './player/OpenPlayerShellButton';
import { SaveSlotList } from './player/SaveSlotList';
import { diffAdventureFacts, diffOptionSets, diffResources, resourceLabelFnFromWorld, type OptionChangeSummary, type VariableDelta } from '../lib/variable-delta';

interface Props {
  token: string; revisions: WorldRevision[]; adventures: AdventureView[];
  revisionId: string; selectRevision: (id: string) => void; refresh: () => Promise<void>;
}

export function AdventurePanel({ token, revisions, adventures, revisionId, selectRevision, refresh }: Props) {
  const { t } = useI18n();
  const pending = useRef(new PendingAdventure(restoreAdventure(sessionStorage)));
  const [sessionId, setSessionId] = useState(pending.current.value?.sessionId ?? '');
  const [session, setSession] = useState<AdventureView | null>(null);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(!!pending.current.value);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [resDeltas, setResDeltas] = useState<VariableDelta[] | null>(null);
  const [optionChanges, setOptionChanges] = useState<OptionChangeSummary | null>(null);

  useEffect(() => {
    if (!resDeltas?.length && !optionChanges?.newlyAvailable.length && !optionChanges?.newlyUnavailable.length) return;
    const timer = window.setTimeout(() => { setResDeltas(null); setOptionChanges(null); }, 4500);
    return () => window.clearTimeout(timer);
  }, [resDeltas, optionChanges]);

  useEffect(() => {
    let active = true; setSession(null); setError(null);
    if (!sessionId) return;
    setBusy(true);
    request<AdventureView>(token, `/adventures/${sessionId}`).then(value => {
      if (active) setSession(value);
    }).catch(e => { if (active) setError(errorMessage(e)); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [token, sessionId, reload]);

  async function start() {
    setBusy(true); setError(null);
    try {
      const value = await request<AdventureView>(token, '/adventures', 'POST', { worldRevisionId: revisionId });
      setSession(value); setSessionId(value.id); await refresh();
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  async function act(actionId: string) {
    if (!session || busy) return;
    setBusy(true); setError(null); setResDeltas(null); setOptionChanges(null);
    try {
      const before = session;
      const input = pending.current.begin(session.id, actionId, session.turn);
      sessionStorage.setItem(adventurePendingKey, JSON.stringify(pending.current.value));
      const value = await request<AdventureView>(token, `/adventures/${pending.current.value!.sessionId}/actions`, 'POST', input);
      pending.current.confirm(); sessionStorage.removeItem(adventurePendingKey); setUncertain(false);
      const rev = revisions.find(r => r.id === value.worldRevisionId);
      const labelFor = resourceLabelFnFromWorld(rev?.content);
      const resD = diffResources(before.resources ?? {}, value.resources ?? {}, labelFor)
        .filter(d => !(d.name.startsWith('fs_') || d.name.startsWith('fu_')));
      const factD = diffAdventureFacts(before.facts ?? [], value.facts ?? []);
      const deltas = [...resD, ...factD];
      setResDeltas(deltas.length ? deltas : null);
      const changes = diffOptionSets(before.actions.map(a => ({ id: a.id, label: a.label })), value.actions.map(a => ({ id: a.id, label: a.label })));
      setOptionChanges(changes.newlyAvailable.length || changes.newlyUnavailable.length ? changes : null);
      setSession(value); await refresh();
    } catch (e) {
      setError(errorMessage(e));
      if (e instanceof RequestError && !e.uncertain) {
        pending.current.confirm(); sessionStorage.removeItem(adventurePendingKey); setUncertain(false); setReload(n => n + 1);
      } else setUncertain(!!pending.current.value);
    } finally { setBusy(false); }
  }

  const narrate = useCallback(async (force: boolean): Promise<NarrateResult> => {
    if (!session) throw new Error('no session');
    return request<NarrateResult>(token, `/adventures/${session.id}/narrate`, 'POST', {
      expectedTurn: session.turn, force, tiandaoCorrect: readTiandaoCorrect(),
    });
  }, [session, token]);

  const revision = revisions.find(r => r.id === session?.worldRevisionId);

  return <section className="work-section">
    <div className="section-heading">
      <div>
        <p className="eyebrow">{t('开放冒险')}</p>
        <h2>{t('去哪里，做什么，由你决定')}</h2>
        <p>{t('观察、交谈与行动会留下后果。每份存档固定一个世界版本。画布上可见当前位置与移动足迹。')}</p>
      </div>
      <div className="stack" style={{alignItems:'flex-end',gap:8}}>
        <span className="edition">EXPLORE & ACT</span>
        {revisionId ? <div className="player-open-actions"><OpenPlayerShellButton mode="world" revisionId={revisionId} className="quiet small" /><CopyPlayLinkButton hash={playWorldHash(revisionId)} /></div> : null}
      </div>
    </div>
    <Notice text={error} />
    <Notice kind="info" text={uncertain ? t('上一行动结果尚未确认。请重试原请求；重试使用相同存档与请求标识，不会重复耗时。') : null} />
    <div className={`play-layout${session?.map && revision ? ' with-map' : ''}`}>
      <aside className="panel stack">
        <h3>{t('发布世界')}</h3>
        <label>{t('选择世界版本')}
          <select disabled={busy || uncertain} value={revisionId} onChange={e => selectRevision(e.target.value)}>
            <option value="">{t('选择已发布世界')}</option>
            {revisions.map(r => <option key={r.id} value={r.id}>{r.content.title} · v{r.version}</option>)}
          </select>
        </label>
        <p className="hint">{revisions.find(r => r.id === revisionId)?.content.premise}</p>
        <button className="primary" disabled={busy || uncertain || !revisionId} onClick={start}>{t('开始新冒险')}</button>
        <div className="divider" />
        <SaveSlotList
          heading={t('冒险存档')}
          slots={adventures.map(s => ({
            id: s.id, title: revisions.find(r => r.id === s.worldRevisionId)?.content.title ?? t('开放冒险'),
            summary: `${s.location.title} · ${t('耗时 {elapsed}/{limit}', { elapsed: s.elapsed, limit: s.timeLimit })}`,
            ended: s.ended, updatedAt: s.updatedAt,
          }))}
          selectedId={sessionId}
          busy={busy || uncertain}
          emptyHint={t('发布世界后即可创建存档。')}
          onSelect={setSessionId}
        />
      </aside>
      <AdventurePlaySurface
        session={session}
        revision={revision}
        busy={busy}
        uncertain={uncertain}
        resDeltas={resDeltas}
        optionChanges={optionChanges}
        showAiAux
        pathDefaultOpen
        onAct={id => void act(id)}
        onReplay={() => void start()}
        onReload={() => setReload(n => n + 1)}
        onRetryPending={pending.current.value ? () => void act(pending.current.value!.input.actionId) : undefined}
        onNarrate={narrate}
        includeMapColumn
        showSeed
        showAllFacts
      />
    </div>
  </section>;
}
