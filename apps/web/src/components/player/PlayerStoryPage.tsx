import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { actSchema, type GameRevision, type SessionView } from '@novel-game/contracts';
import { useI18n } from '../../lib/i18n';
import { PendingAction, type PendingActionValue } from '../../lib/pending-action';
import type { StoryPagePort } from '../../lib/play-port';
import { navigateHash, playLandingHash, playStoryHash } from '../../lib/play-route';
import { diffOptionSets, diffVariables, labelFnFromContent, type OptionChangeSummary, type VariableDelta } from '../../lib/variable-delta';
import { Notice } from '../Notice';
import { ReaderPlaySurface } from '../play/ReaderPlaySurface';
import { CopyPlayLinkButton } from './CopyPlayLinkButton';
import type { PackageChrome } from './package-chrome';
import { SaveSlotList, type SaveSlot } from './SaveSlotList';

function restorePending(port: StoryPagePort): PendingActionValue | null {
  try {
    const value = JSON.parse(port.pendingStorage()?.getItem(port.pendingKey('story')) ?? 'null');
    if (value && typeof value.sessionId === 'string') {
      const parsed = actSchema.safeParse(value.input);
      if (parsed.success) return { sessionId: value.sessionId, input: parsed.data };
    }
  } catch { /* ignore */ }
  return null;
}

type Props = {
  port: StoryPagePort;
  revisionId: string;
  initialSessionId?: string;
  /** Export package chrome; omitted on M1 `/play`. */
  pkg?: PackageChrome;
};

export function PlayerStoryPage({ port, revisionId, initialSessionId, pkg }: Props) {
  const { t } = useI18n();
  const pending = useRef(new PendingAction(restorePending(port)));
  const [revision, setRevision] = useState<GameRevision | null>(null);
  const [sessions, setSessions] = useState<SessionView[]>([]);
  const [rows, setRows] = useState<SaveSlot[] | null>(null);
  const [session, setSession] = useState<SessionView | null>(null);
  const [sessionId, setSessionId] = useState(initialSessionId ?? pending.current.value?.sessionId ?? '');
  const [busy, setBusy] = useState(false);
  const [loadingRev, setLoadingRev] = useState(true);
  const [badLink, setBadLink] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(!!pending.current.value);
  const [reload, setReload] = useState(0);
  const [varDeltas, setVarDeltas] = useState<VariableDelta[] | null>(null);
  const [optionChanges, setOptionChanges] = useState<OptionChangeSummary | null>(null);
  const hashFor = useCallback((id?: string) => pkg ? pkg.hash(id) : playStoryHash(revisionId, id), [pkg, revisionId]);
  const storage = port.pendingStorage;
  const pendingKey = port.pendingKey('story');
  const savePending = () => { try { storage()?.setItem(pendingKey, JSON.stringify(pending.current.value)); } catch { /* memory only */ } };
  const clearPending = () => { try { storage()?.removeItem(pendingKey); } catch { /* memory only */ } };

  useEffect(() => {
    if (!varDeltas?.length && !optionChanges?.newlyAvailable.length && !optionChanges?.newlyUnavailable.length) return;
    const timer = window.setTimeout(() => { setVarDeltas(null); setOptionChanges(null); }, 4500);
    return () => window.clearTimeout(timer);
  }, [varDeltas, optionChanges]);

  const refreshLists = useCallback(async () => {
    setSessions(await port.list(revisionId));
    if (port.rows) setRows(port.rows(t));
  }, [port, revisionId, t]);

  useEffect(() => {
    let active = true;
    setLoadingRev(true); setBadLink(false); setError(null); setRevision(null);
    port.revision(revisionId)
      .then(hit => {
        if (!active) return;
        if (!hit) { setBadLink(true); return; }
        setRevision(hit);
      })
      .catch(e => { if (active) { setError(port.message(e)); setBadLink(true); } })
      .finally(() => { if (active) setLoadingRev(false); });
    refreshLists().catch(e => { if (active) setError(port.message(e)); });
    return () => { active = false; };
  }, [port, revisionId, refreshLists]);

  useEffect(() => {
    if (pkg?.storageEpoch && port.rows) setRows(port.rows(t));
  }, [pkg?.storageEpoch, port, t]);

  useEffect(() => {
    if (initialSessionId) setSessionId(initialSessionId);
    else if (pkg) setSessionId('');
  }, [initialSessionId, pkg]);

  useEffect(() => {
    let active = true;
    setSession(null);
    if (!sessionId || badLink) return;
    setBusy(true); setError(null); setInfo(null);
    port.get(sessionId)
      .then(value => {
        if (!active) return;
        if (value.gameRevisionId !== revisionId) {
          setError(t('版本不存在或未发布。'));
          setSession(null);
          return;
        }
        setSession(value);
        navigateHash(hashFor(value.id));
      })
      .catch(e => {
        if (!active) return;
        if (pkg) {
          // save-missing / save-blocked: stay on the start page with the reason (UI plan §4.3).
          const code = (e as { code?: string } | null)?.code;
          if (code === 'SESSION_NOT_FOUND') setInfo(port.message(e)); else setError(port.message(e));
          setSessionId('');
          navigateHash(hashFor());
        } else setError(port.message(e));
      })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [sessionId, port, reload, revisionId, badLink, t, pkg, hashFor]);

  async function start() {
    setBusy(true); setError(null); setInfo(null);
    try {
      const started = await port.start(revisionId);
      setSession(started); setSessionId(started.id);
      navigateHash(hashFor(started.id));
      await refreshLists();
    } catch (e) { setError(port.message(e)); } finally { setBusy(false); }
  }

  async function act(choiceId: string) {
    if (!session) return;
    setBusy(true); setError(null); setInfo(null); setVarDeltas(null); setOptionChanges(null);
    try {
      const before = session;
      const input = pending.current.begin(session.id, choiceId, session.turn);
      savePending();
      const result = await port.act(session.id, input);
      pending.current.confirm(); clearPending(); setUncertain(false);
      const deltas = diffVariables(before.variables ?? {}, result.variables ?? {}, labelFnFromContent(revision?.content));
      setVarDeltas(deltas.length ? deltas : null);
      const changes = diffOptionSets(
        before.scene.choices.map(c => ({ id: c.id, label: c.label })),
        result.scene.choices.map(c => ({ id: c.id, label: c.label })),
      );
      setOptionChanges(changes.newlyAvailable.length || changes.newlyUnavailable.length ? changes : null);
      setSession(result);
      await refreshLists();
    } catch (e) {
      setError(port.message(e));
      if (!port.uncertain(e)) {
        pending.current.confirm(); clearPending(); setUncertain(false);
      } else setUncertain(!!pending.current.value);
    } finally { setBusy(false); }
  }

  function backToStart() {
    setSessionId(''); setSession(null); setError(null); setInfo(null);
    navigateHash(hashFor());
  }

  const slots = useMemo((): SaveSlot[] => rows ?? sessions.map(s => ({
    id: s.id,
    title: revision?.content.title ?? t('文字冒险'),
    summary: t('第 {turn} 幕 · {scene}', { turn: s.turn + 1, scene: s.ended ? t('已到结局') : s.scene.title }),
    ended: s.ended,
    updatedAt: s.updatedAt,
  })), [rows, sessions, revision, t]);
  const continueId = pkg && !sessionId ? slots.find(s => !s.blockedReason && !s.ended)?.id : undefined;

  if (loadingRev) {
    return <section className="work-section"><p role="status">{t('正在读取…')}</p></section>;
  }
  if (badLink || !revision) {
    return (
      <section className="work-section" data-testid="play-bad-link">
        <Notice text={pkg ? (error ?? t('行动未成功。进度未推进。')) : t('版本不存在或未发布。')} />
        {!pkg && <button type="button" className="quiet" onClick={() => navigateHash(playLandingHash())}>{t('返回书目')}</button>}
      </section>
    );
  }

  return (
    <section className={`work-section player-story-page${pkg ? ' package-page' : ''}`} data-testid="player-story-page">
      <div className="section-heading">
        <div>
          <p className="eyebrow">{pkg ? t('{mode} · v{version}', { mode: t('分支故事'), version: revision.version }) : t('分支故事')}</p>
          <h2>{pkg ? revision.content.title : `${revision.content.title} · v${revision.version}`}</h2>
          <p className="hint clamp-2">{revision.content.premise}</p>
        </div>
        <span className="edition">STORY</span>
      </div>
      <Notice text={error} />
      <Notice kind="info" text={info} />
      <Notice kind="info" text={uncertain ? (pkg ? t('上一步的结果尚未确认。请重试原选择，不会重复推进。') : t('上一选择的请求结果尚未确认。请重试原选择，服务会返回同一结果，不会重复推进故事。')) : null} />
      <div className="play-layout player-play-layout">
        <aside className="panel stack">
          <div className="player-open-actions">
            <button type="button" className="primary" disabled={busy || uncertain} onClick={() => void start()}>{t('开始新存档')}</button>
            {continueId && <button type="button" disabled={busy} data-testid="package-continue" onClick={() => setSessionId(continueId)}>{t('继续')}</button>}
            {!pkg && <CopyPlayLinkButton hash={playStoryHash(revisionId)} />}
          </div>
          <div className="divider" />
          <SaveSlotList
            slots={slots}
            selectedId={sessionId}
            busy={busy || uncertain}
            emptyHint={pkg ? null : undefined}
            footHint={pkg?.footHint}
            footer={pkg?.locationDetails}
            onSelect={id => setSessionId(id)}
          />
          {!pkg && <button type="button" className="quiet small" onClick={() => navigateHash(playLandingHash())}>{t('返回书目')}</button>}
        </aside>
        <article className="panel reading-page">
          <ReaderPlaySurface
            session={session}
            revision={revision}
            busy={busy}
            uncertain={uncertain}
            varDeltas={varDeltas}
            optionChanges={optionChanges}
            showAiAux={false}
            pathDefaultOpen={false}
            onAct={id => void act(id)}
            onReplay={() => void start()}
            onReload={() => setReload(v => v + 1)}
            onRetryPending={pending.current.value ? () => void act(pending.current.value!.input.choiceId) : undefined}
            onSecondary={pkg ? backToStart : () => navigateHash(playLandingHash())}
            secondaryLabel={pkg ? t('回到开始页') : t('返回书目')}
            replayLabel={pkg ? t('再来一局') : undefined}
            autosaveHint={pkg?.autosaveHint}
            emptyHint={pkg
              ? (slots.length ? t('选择左侧存档继续，或开始新存档。') : pkg.emptyNoSaves)
              : t('选择左侧存档，或开始新存档。')}
          />
        </article>
      </div>
    </section>
  );
}
