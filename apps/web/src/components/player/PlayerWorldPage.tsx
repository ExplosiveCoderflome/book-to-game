import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type AdventureView, type WorldRevision } from '@novel-game/contracts';
import { useI18n } from '../../lib/i18n';
import { PendingAdventure, restoreAdventure } from '../../lib/pending-adventure';
import type { WorldPagePort } from '../../lib/play-port';
import { navigateHash, playLandingHash, playWorldHash } from '../../lib/play-route';
import { diffAdventureFacts, diffOptionSets, diffResources, resourceLabelFnFromWorld, type OptionChangeSummary, type VariableDelta } from '../../lib/variable-delta';
import { Notice } from '../Notice';
import { AdventurePlaySurface } from '../play/AdventurePlaySurface';
import { CopyPlayLinkButton } from './CopyPlayLinkButton';
import type { PackageChrome } from './package-chrome';
import { SaveSlotList, type SaveSlot } from './SaveSlotList';

type Props = {
  port: WorldPagePort;
  revisionId: string;
  initialAdventureId?: string;
  /** Export package chrome; omitted on M1 `/play`. */
  pkg?: PackageChrome;
};

function readPending(port: WorldPagePort) {
  const storage = port.pendingStorage();
  if (!storage) return null;
  const key = port.pendingKey('world');
  return restoreAdventure({ getItem: () => { try { return storage.getItem(key); } catch { return null; } } });
}

export function PlayerWorldPage({ port, revisionId, initialAdventureId, pkg }: Props) {
  const { t } = useI18n();
  const pending = useRef(new PendingAdventure(readPending(port)));
  const [revision, setRevision] = useState<WorldRevision | null>(null);
  const [adventures, setAdventures] = useState<AdventureView[]>([]);
  const [rows, setRows] = useState<SaveSlot[] | null>(null);
  const [session, setSession] = useState<AdventureView | null>(null);
  const [sessionId, setSessionId] = useState(initialAdventureId ?? pending.current.value?.sessionId ?? '');
  const [busy, setBusy] = useState(false);
  const [loadingRev, setLoadingRev] = useState(true);
  const [badLink, setBadLink] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(!!pending.current.value);
  const [reload, setReload] = useState(0);
  const [resDeltas, setResDeltas] = useState<VariableDelta[] | null>(null);
  const [optionChanges, setOptionChanges] = useState<OptionChangeSummary | null>(null);
  const hashFor = useCallback((id?: string) => pkg ? pkg.hash(id) : playWorldHash(revisionId, id), [pkg, revisionId]);
  const pendingKey = port.pendingKey('world');
  const savePending = () => { try { port.pendingStorage()?.setItem(pendingKey, JSON.stringify(pending.current.value)); } catch { /* memory only */ } };
  const clearPending = () => { try { port.pendingStorage()?.removeItem(pendingKey); } catch { /* memory only */ } };

  useEffect(() => {
    if (!resDeltas?.length && !optionChanges?.newlyAvailable.length && !optionChanges?.newlyUnavailable.length) return;
    const timer = window.setTimeout(() => { setResDeltas(null); setOptionChanges(null); }, 4500);
    return () => window.clearTimeout(timer);
  }, [resDeltas, optionChanges]);

  const refreshLists = useCallback(async () => {
    setAdventures(await port.list(revisionId));
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
    if (initialAdventureId) setSessionId(initialAdventureId);
    else if (pkg) setSessionId('');
  }, [initialAdventureId, pkg]);

  useEffect(() => {
    let active = true;
    setSession(null);
    if (!sessionId || badLink) return;
    setBusy(true); setError(null); setInfo(null);
    port.get(sessionId)
      .then(value => {
        if (!active) return;
        if (value.worldRevisionId !== revisionId) {
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
      const value = await port.start(revisionId);
      setSession(value); setSessionId(value.id);
      navigateHash(hashFor(value.id));
      await refreshLists();
    } catch (e) { setError(port.message(e)); } finally { setBusy(false); }
  }

  async function act(actionId: string) {
    if (!session || busy) return;
    setBusy(true); setError(null); setInfo(null); setResDeltas(null); setOptionChanges(null);
    try {
      const before = session;
      const input = pending.current.begin(session.id, actionId, session.turn);
      savePending();
      const value = await port.act(pending.current.value!.sessionId, input);
      pending.current.confirm(); clearPending(); setUncertain(false);
      const labelFor = resourceLabelFnFromWorld(revision?.content);
      const resD = diffResources(before.resources ?? {}, value.resources ?? {}, labelFor)
        .filter(d => !(d.name.startsWith('fs_') || d.name.startsWith('fu_')));
      const factD = diffAdventureFacts(before.facts ?? [], value.facts ?? []);
      const deltas = [...resD, ...factD];
      setResDeltas(deltas.length ? deltas : null);
      const changes = diffOptionSets(
        before.actions.map(a => ({ id: a.id, label: a.label })),
        value.actions.map(a => ({ id: a.id, label: a.label })),
      );
      setOptionChanges(changes.newlyAvailable.length || changes.newlyUnavailable.length ? changes : null);
      setSession(value);
      await refreshLists();
    } catch (e) {
      setError(port.message(e));
      if (!port.uncertain(e)) {
        pending.current.confirm(); clearPending(); setUncertain(false); setReload(n => n + 1);
      } else setUncertain(!!pending.current.value);
    } finally { setBusy(false); }
  }

  function backToStart() {
    setSessionId(''); setSession(null); setError(null); setInfo(null);
    navigateHash(hashFor());
  }

  const slots = useMemo((): SaveSlot[] => rows ?? adventures.map(s => ({
    id: s.id,
    title: revision?.content.title ?? t('开放冒险'),
    summary: s.ended
      ? t('已结束')
      : t('{location} · 耗时 {elapsed}/{limit}', { location: s.location.title, elapsed: s.elapsed, limit: s.timeLimit }),
    ended: s.ended,
    updatedAt: s.updatedAt,
  })), [rows, adventures, revision, t]);
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
    <section className={`work-section player-world-page${pkg ? ' package-page' : ''}`} data-testid="player-world-page">
      <div className="section-heading">
        <div>
          <p className="eyebrow">{pkg ? t('{mode} · v{version}', { mode: t('开放世界'), version: revision.version }) : t('开放世界')}</p>
          <h2>{pkg ? revision.content.title : `${revision.content.title} · v${revision.version}`}</h2>
          <p className="hint clamp-2">{revision.content.premise}</p>
        </div>
        <span className="edition">WORLD</span>
      </div>
      <Notice text={error} />
      <Notice kind="info" text={info} />
      <Notice kind="info" text={uncertain ? (pkg ? t('上一步的结果尚未确认。请重试原选择，不会重复推进。') : t('上一行动结果尚未确认。请重试原请求；重试使用相同存档与请求标识，不会重复耗时。')) : null} />
      <div className={`play-layout player-play-layout${session?.map && revision ? ' with-map' : ''}${session ? ' has-session' : ''}`}>
        <aside className="panel stack">
          <div className="player-open-actions">
            <button type="button" className="primary" disabled={busy || uncertain} onClick={() => void start()}>{pkg ? t('开始新存档') : t('开始新冒险')}</button>
            {continueId && <button type="button" disabled={busy} data-testid="package-continue" onClick={() => setSessionId(continueId)}>{t('继续')}</button>}
            {!pkg && <CopyPlayLinkButton hash={playWorldHash(revisionId)} />}
          </div>
          <div className="divider" />
          <SaveSlotList
            heading={pkg ? t('我的存档') : t('冒险存档')}
            slots={slots}
            selectedId={sessionId}
            busy={busy || uncertain}
            emptyHint={pkg ? null : t('开始新存档后会出现在这里。')}
            footHint={pkg?.footHint}
            footer={pkg?.locationDetails}
            onSelect={id => setSessionId(id)}
          />
          {!pkg && <button type="button" className="quiet small" onClick={() => navigateHash(playLandingHash())}>{t('返回书目')}</button>}
        </aside>
        <AdventurePlaySurface
          session={session}
          revision={revision}
          busy={busy}
          uncertain={uncertain}
          resDeltas={resDeltas}
          optionChanges={optionChanges}
          showAiAux={false}
          pathDefaultOpen={false}
          onAct={id => void act(id)}
          onReplay={() => void start()}
          onReload={pkg && !sessionId ? undefined : () => setReload(n => n + 1)}
          onRetryPending={pending.current.value ? () => void act(pending.current.value!.input.actionId) : undefined}
          onSecondary={pkg ? backToStart : () => navigateHash(playLandingHash())}
          secondaryLabel={pkg ? t('回到开始页') : t('返回书目')}
          replayLabel={pkg ? t('再来一局') : undefined}
          autosaveHint={pkg?.autosaveHint}
          hideMetaVersion
          emptyHint={pkg
            ? (slots.length ? t('选择左侧存档继续，或开始新存档。') : pkg.emptyNoSaves)
            : t('选择左侧存档，或开始新冒险。')}
          includeMapColumn
        />
      </div>
    </section>
  );
}
