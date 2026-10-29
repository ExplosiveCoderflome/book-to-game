import { useI18n, I18nProvider } from './lib/i18n';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import type { AdventureView, WorldDraft, WorldRevision, Draft, GameRevision, GenerationJob, RuntimeInfo, SessionView, SourceSummary } from '@novel-game/contracts';
import { errorMessage, request } from './lib/api';
import { GenerationPanel } from './components/GenerationPanel';
import { Notice } from './components/Notice';
import { SourcePanel } from './components/SourcePanel';
import { ModelSettingsPanel } from './components/ModelSettingsPanel';
import { DemoPreview } from './components/DemoPreview';
import { PlayRouteGate, useIsPlayerShell } from './components/player/PlayRouteGate';
import { isPlayerRoute, navigateHash, parsePlayRoute, playStoryHash, playWorldHash } from './lib/play-route';
import { WorkbenchShell } from './components/studio/WorkbenchShell';
import { ConnectionScreen } from './components/studio/ConnectionScreen';
import { workbenchTabFromHash, type WorkspaceTab as Tab } from './lib/workbench-navigation';
/** Workbench tabs are code-split so the shell stays under the main-chunk budget. */
const DraftPanel = lazy(() => import('./components/DraftPanel').then(m => ({ default: m.DraftPanel })));
const PlayPanel = lazy(() => import('./components/PlayPanel').then(m => ({ default: m.PlayPanel })));
const WorldsPanel = lazy(() => import('./components/WorldsPanel').then(m => ({ default: m.WorldsPanel })));
const AdventurePanel = lazy(() => import('./components/AdventurePanel').then(m => ({ default: m.AdventurePanel })));
const BuildingLibraryPage = lazy(() => import('./components/building-library/BuildingLibraryPage').then(m => ({ default: m.BuildingLibraryPage })));
const ItemCatalogPage = lazy(() => import('./components/item-catalog/ItemCatalogPage').then(m => ({ default: m.ItemCatalogPage })));
const AgentChatPanel = lazy(() => import('./components/agent/AgentChatPanel').then(m => ({default: m.AgentChatPanel})));

interface Data { runtime: RuntimeInfo; sources: SourceSummary[]; jobs: GenerationJob[]; drafts: Draft[]; revisions: GameRevision[]; sessions: SessionView[]; worlds: WorldDraft[]; worldRevisions: WorldRevision[]; adventures: AdventureView[] }

function Workbench() {
  const { t } = useI18n();
  const token = '';
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [tab, setActiveTab] = useState<Tab>(() => workbenchTabFromHash(window.location.hash));
  const [historyHost, setHistoryHost] = useState<HTMLDivElement | null>(null);
  function setTab(next: Tab) {
    if (window.location.hash !== `#${next}`) window.history.pushState(null, '', `#${next}`);
    setActiveTab(next);
  }
  const [sourceId, setSourceId] = useState('');
  const [draftId, setDraftId] = useState('');
  const [revisionId, setRevisionId] = useState('');
  const [worldDraftId, setWorldDraftId] = useState('');
  const [worldRevisionId, setWorldRevisionId] = useState('');
  const [worldDirty, setWorldDirty] = useState(false);
  const [showDemo, setShowDemo] = useState(false);
  useEffect(() => { window.scrollTo({top: 0}); document.getElementById('studio-main')?.focus({preventScroll: true}); }, [tab]);
  useEffect(() => {
    const sync = () => setActiveTab(workbenchTabFromHash(window.location.hash));
    window.addEventListener('hashchange', sync); window.addEventListener('popstate', sync);
    return () => {window.removeEventListener('hashchange', sync); window.removeEventListener('popstate', sync);};
  }, []);
  const refresh = useCallback(async () => {
    const [runtime, sources, jobs, drafts, revisions, sessions, worlds, worldRevisions, adventures] = await Promise.all([
      request<RuntimeInfo>(token, '/runtime'), request<SourceSummary[]>(token, '/sources'), request<GenerationJob[]>(token, '/jobs'),
      request<Draft[]>(token, '/drafts'), request<GameRevision[]>(token, '/games'), request<SessionView[]>(token, '/sessions'),
      request<WorldDraft[]>(token, '/worlds/drafts'), request<WorldRevision[]>(token, '/worlds/revisions'), request<AdventureView[]>(token, '/adventures'),
    ]);
    setData({ runtime, sources, jobs, drafts, revisions, sessions, worlds, worldRevisions, adventures }); setError(null);
    setSourceId(current => current || sources[0]?.id || '');
    setRevisionId(current => current || revisions[0]?.id || '');
    setWorldRevisionId(current => current || worldRevisions[0]?.id || '');
  }, []);
  useEffect(() => {
    let active = true; setConnecting(true);
    refresh().catch(e => { if (active) setError(errorMessage(e)); }).finally(() => { if (active) setConnecting(false); });
    return () => { active = false; };
  }, [refresh]);
  const hasActiveJobs = data?.jobs.some(job => job.status === 'queued' || job.status === 'running') ?? false;
  useEffect(() => {
    if (!hasActiveJobs) return;
    let pending = false;
    const timer = window.setInterval(() => {
      if (pending) return;
      pending = true;
      refresh().catch(e => setError(errorMessage(e))).finally(() => {pending = false;});
    }, 4000);
    return () => window.clearInterval(timer);
  }, [hasActiveJobs, refresh]);
  function retryConnection() {
    setError(null); setConnecting(true);
    refresh().catch(e => setError(errorMessage(e))).finally(() => setConnecting(false));
  }
  const seenJobStatus = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    if (!data) return;
    for (const job of data.jobs) {
      const prev = seenJobStatus.current.get(job.id);
      seenJobStatus.current.set(job.id, job.status);
      if (prev && prev !== 'succeeded' && job.status === 'succeeded' && job.draftId && (job.mode ?? 'story') !== 'open') {
        setDraftId(job.draftId);
        setSourceId(job.sourceId);
        setTab('drafts');
      }
    }
  }, [data]);

  function openGeneratedDraft(id: string, mode: 'story' | 'open') {
    if (mode === 'open') {
      setTab('worlds');
      if (worldDirty && id !== worldDraftId) {setError('世界草稿还有未保存的修改，请先保存或放弃编辑，再打开另一份草稿。'); return;}
      setWorldDraftId(id);
    } else {setDraftId(id); setTab('drafts');}
  }
  return <WorkbenchShell tab={tab} onNavigate={setTab} connected={!!data} connecting={connecting} configured={!!data?.runtime.providerConfigured}
    historyHost={setHistoryHost} onRefresh={() => refresh().catch(e => setError(errorMessage(e)))}>
      {!data ? showDemo ? <DemoPreview onBack={() => setShowDemo(false)} /> : <ConnectionScreen connecting={connecting} error={error} onRetry={retryConnection} onDemo={() => setShowDemo(true)} /> : <>
        <Notice text={error} />
        <div hidden={tab !== 'sources'}><SourcePanel token={token} sources={data.sources} revisions={data.revisions} selectedId={sourceId} select={setSourceId} refresh={refresh} onGenerate={() => setTab('generation')} onDemoReady={revision => { setRevisionId(revision.id); setTab('play'); }} /></div>
        <div hidden={tab !== 'generation'}><GenerationPanel token={token} runtime={data.runtime} sources={data.sources} selectedId={sourceId} select={setSourceId} jobs={data.jobs} refresh={refresh} openDraft={openGeneratedDraft} onConfigure={() => setTab('settings')} /></div>
        <div hidden={tab !== 'agent'}><Suspense fallback={<p className="studio-loading" role="status">{t('正在读取工作空间…')}</p>}><AgentChatPanel token={token} configured={data.runtime.providerConfigured} active={tab === 'agent'} historyHost={historyHost}
          worlds={data.worlds} jobs={data.jobs} sources={data.sources} revisions={data.worldRevisions}
          onOpenDraft={id => openGeneratedDraft(id, 'open')} onOpenJobs={() => setTab('generation')} onOpenSources={() => setTab('sources')}
          onConfigure={() => setTab('settings')} onChanged={refresh} /></Suspense></div>
        <div hidden={tab !== 'drafts'}><Suspense fallback={null}><DraftPanel token={token} drafts={data.drafts} sources={data.sources} revisions={data.revisions} sessions={data.sessions} jobs={data.jobs} runtime={data.runtime} selectedId={draftId} select={setDraftId} refresh={refresh} onPublished={revision => { setRevisionId(revision.id); navigateHash(playStoryHash(revision.id)); }} onOpenPlay={id => { setRevisionId(id); setTab('play'); }} onOpenPlayerShell={id => navigateHash(playStoryHash(id))} onOpenGeneration={() => setTab('generation')} onConfigure={() => setTab('settings')} /></Suspense></div>
        <div hidden={tab !== 'play'}><Suspense fallback={null}><PlayPanel token={token} revisions={data.revisions} sessions={data.sessions} revisionId={revisionId} selectRevision={setRevisionId} refresh={refresh} /></Suspense></div>
        <div hidden={tab !== 'worlds'}><Suspense fallback={null}><WorldsPanel onDirtyChange={setWorldDirty} token={token} drafts={data.worlds} sources={data.sources} revisions={data.worldRevisions} adventures={data.adventures} selectedId={worldDraftId} select={setWorldDraftId} refresh={refresh} onPublished={revision => { setWorldRevisionId(revision.id); navigateHash(playWorldHash(revision.id)); }} onOpenAdventure={id => { setWorldRevisionId(id); setTab('adventures'); }} onOpenPlayerShell={id => navigateHash(playWorldHash(id))} onOpenBuildingLibrary={() => setTab('buildings')} /></Suspense></div>
        <div hidden={tab !== 'buildings'}><Suspense fallback={null}><BuildingLibraryPage token={token} /></Suspense></div>
        <div hidden={tab !== 'items'}><Suspense fallback={null}><ItemCatalogPage token={token} /></Suspense></div>
        <div hidden={tab !== 'adventures'}><Suspense fallback={null}><AdventurePanel token={token} revisions={data.worldRevisions} adventures={data.adventures} revisionId={worldRevisionId} selectRevision={setWorldRevisionId} refresh={refresh} /></Suspense></div>
        {tab === 'settings' && <ModelSettingsPanel token={token} onSaved={refresh} />}
      </>}
  </WorkbenchShell>;
}

function Root() {
  const player = useIsPlayerShell();
  // Keep hash parse in sync on first paint for deep links.
  useEffect(() => {
    if (!window.location.hash && isPlayerRoute(parsePlayRoute())) return;
  }, []);
  if (player) return <PlayRouteGate token="" />;
  return <Workbench />;
}

export function App() { return <I18nProvider><Root /></I18nProvider>; }
