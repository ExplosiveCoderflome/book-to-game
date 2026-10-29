import { useI18n, I18nProvider } from './lib/i18n';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import type { AdventureView, WorldDraft, WorldRevision, Draft, GameRevision, GenerationJob, RuntimeInfo, SessionView, SourceSummary } from '@novel-game/contracts';
import { errorMessage, request } from './lib/api';
import { Notice } from './components/Notice';
import { DemoPreview } from './components/DemoPreview';
import { PlayRouteGate, useIsPlayerShell } from './components/player/PlayRouteGate';
import { isPlayerRoute, navigateHash, parsePlayRoute, playStoryHash, playWorldHash } from './lib/play-route';
import { WorkbenchShell } from './components/studio/WorkbenchShell';
import { ConnectionScreen } from './components/studio/ConnectionScreen';
import { workbenchTabFromHash, workspacePages, type WorkspaceTab as Tab } from './lib/workbench-navigation';
import { draftSwitchIssue, type AgentHandoff, type WorkspaceSearchEntry } from './lib/workspace-search';
/** Workbench tabs are code-split so the shell stays under the main-chunk budget. */
const SourcePanel = lazy(() => import('./components/SourcePanel').then(m => ({default: m.SourcePanel})));
const GenerationPanel = lazy(() => import('./components/GenerationPanel').then(m => ({default: m.GenerationPanel})));
const ModelSettingsPanel = lazy(() => import('./components/ModelSettingsPanel').then(m => ({default: m.ModelSettingsPanel})));
const DraftPanel = lazy(() => import('./components/DraftPanel').then(m => ({ default: m.DraftPanel })));
const PlayPanel = lazy(() => import('./components/PlayPanel').then(m => ({ default: m.PlayPanel })));
const WorldsPanel = lazy(() => import('./components/WorldsPanel').then(m => ({ default: m.WorldsPanel })));
const AdventurePanel = lazy(() => import('./components/AdventurePanel').then(m => ({ default: m.AdventurePanel })));
const BuildingLibraryPage = lazy(() => import('./components/building-library/BuildingLibraryPage').then(m => ({ default: m.BuildingLibraryPage })));
const ItemCatalogPage = lazy(() => import('./components/item-catalog/ItemCatalogPage').then(m => ({ default: m.ItemCatalogPage })));
const AgentChatPanel = lazy(() => import('./components/agent/AgentChatPanel').then(m => ({default: m.AgentChatPanel})));

interface Data { runtime: RuntimeInfo; sources: SourceSummary[]; jobs: GenerationJob[]; drafts: Draft[]; revisions: GameRevision[]; sessions: SessionView[]; worlds: WorldDraft[]; worldRevisions: WorldRevision[]; adventures: AdventureView[] }

function WorkspaceLoading() {
  const {t} = useI18n();
  return <div className="workspace-route-loading" role="status"><span className="studio-status-dot" />{t('正在读取工作空间…')}</div>;
}

function Workbench() {
  const { t } = useI18n();
  const token = '';
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [tab, setActiveTab] = useState<Tab>(() => workbenchTabFromHash(window.location.hash));
  const [historyHost, setHistoryHost] = useState<HTMLDivElement | null>(null);
  const [agentHandoff, setAgentHandoff] = useState<AgentHandoff | null>(null);
  const [jobFocus, setJobFocus] = useState<{id: string; request: number} | null>(null);
  const [visitedTabs, setVisitedTabs] = useState<Set<Tab>>(() => new Set([tab]));
  const scrollPositions = useRef<Partial<Record<Tab, number>>>({});
  const visited = (page: Tab) => tab === page || visitedTabs.has(page);
  function setTab(next: Tab) {
    setError(null);
    if (window.location.hash !== `#${next}`) window.history.pushState(null, '', `#${next}`);
    setActiveTab(next);
  }
  const [sourceId, setSourceId] = useState('');
  const [draftId, setDraftId] = useState('');
  const [revisionId, setRevisionId] = useState('');
  const [worldDraftId, setWorldDraftId] = useState('');
  const [worldRevisionId, setWorldRevisionId] = useState('');
  const [worldDirty, setWorldDirty] = useState(false), [worldBusy, setWorldBusy] = useState(false);
  const [draftDirty, setDraftDirty] = useState(false), [draftBusy, setDraftBusy] = useState(false);
  const [showDemo, setShowDemo] = useState(false);
  useEffect(() => {
    setVisitedTabs(previous => new Set([...previous, tab]));
    const main = document.getElementById('studio-main');
    main?.focus({preventScroll: true});
    if (main) main.scrollTop = scrollPositions.current[tab] ?? 0;
  }, [tab]);
  useEffect(() => {
    const sync = () => {setError(null); setActiveTab(workbenchTabFromHash(window.location.hash));};
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
  function openGeneratedDraft(id: string, mode: 'story' | 'open') {
    const world = mode === 'open';
    setTab(world ? 'worlds' : 'drafts');
    const issue = draftSwitchIssue(world ? worldDraftId : draftId, id, world ? worldDirty : draftDirty, world ? worldBusy : draftBusy);
    if (issue) {
      setError(t(issue === 'busy' ? '编辑器正在处理操作，请完成后再打开另一份草稿。' : '当前草稿有未保存的修改，请先保存或放弃编辑，再打开另一份草稿。'));
      return;
    }
    setError(null);
    if (world) setWorldDraftId(id); else setDraftId(id);
  }
  const searchEntries: WorkspaceSearchEntry[] = [
    ...workspacePages.map(page => ({key: `page:${page.id}`, title: t(page.label), detail: t('工作空间页面'), tab: page.id})),
    ...(data?.worlds ?? []).map(world => ({key: `world:${world.id}`, title: world.content.title, detail: `${t('世界草稿')} · v${world.version}`, tab: 'worlds' as const, entityId: world.id})),
    ...(data?.drafts ?? []).map(draft => ({key: `draft:${draft.id}`, title: draft.content.title, detail: `${t('分支草稿')} · v${draft.version}`, tab: 'drafts' as const, entityId: draft.id})),
    ...(data?.sources ?? []).map(source => ({key: `source:${source.id}`, title: source.title, detail: t('原作 · {count} 章', {count: source.chapterCount}), tab: 'sources' as const, entityId: source.id})),
    ...(data?.jobs ?? []).map(job => ({key: `job:${job.id}`, title: job.productionBrief?.title ?? data?.sources.find(source => source.id === job.sourceId)?.title ?? t('原作任务'), detail: `${t('制作任务')} · ${t(job.stage)}`, tab: 'generation' as const, entityId: job.id})),
  ];
  function openSearchEntry(entry: WorkspaceSearchEntry) {
    if (entry.entityId) {
      if (entry.tab === 'worlds') {openGeneratedDraft(entry.entityId, 'open'); return;}
      if (entry.tab === 'drafts') {openGeneratedDraft(entry.entityId, 'story'); return;}
      if (entry.tab === 'sources') setSourceId(entry.entityId);
      if (entry.tab === 'generation') setJobFocus(previous => ({id: entry.entityId!, request: (previous?.request ?? 0) + 1}));
    }
    setTab(entry.tab);
  }
  function askAgent(topic: string) {
    const world = data?.worlds.find(world => world.id === worldDraftId);
    const source = data?.sources.find(source => source.id === sourceId);
    const draft = data?.drafts.find(draft => draft.id === draftId);
    const context = tab === 'worlds' && world ? `世界草稿：${world.content.title}，ID：${world.id}，版本：${world.version}。${worldDirty ? '页面有未保存编辑，只分析已保存版本。' : ''}`
      : tab === 'sources' && source ? `原作：${source.title}，sourceId：${source.id}。`
      : tab === 'drafts' && draft ? `分支草稿：${draft.content.title}，ID：${draft.id}，版本：${draft.version}。只读取已保存版本。`
      : '';
    setAgentHandoff({label: t(topic), worldId: tab === 'worlds' ? world?.id : undefined,
      prompt: t('请帮我梳理“{topic}”的当前情况与下一步建议，先读取相关的已保存信息，不要修改或发布。', {topic: t(topic)}) + (context ? `\n\n${context}` : '')});
    setTab('agent');
  }
  return <WorkbenchShell tab={tab} onNavigate={setTab} connected={!!data} connecting={connecting} configured={!!data?.runtime.providerConfigured}
    searchEntries={searchEntries} onSearchSelect={openSearchEntry} onAskAgent={askAgent}
    onScrollPosition={(page, top) => {scrollPositions.current[page] = top;}}
    historyHost={setHistoryHost} onRefresh={() => refresh().catch(e => setError(errorMessage(e)))}>
      {!data ? showDemo ? <DemoPreview onBack={() => setShowDemo(false)} /> : <ConnectionScreen connecting={connecting} error={error} onRetry={retryConnection} onDemo={() => setShowDemo(true)} /> : <>
        <Notice text={error} />
        <div hidden={tab !== 'sources'}>{visited('sources') && <Suspense fallback={<WorkspaceLoading />}> <SourcePanel token={token} sources={data.sources} revisions={data.revisions} selectedId={sourceId} select={setSourceId} refresh={refresh} onGenerate={() => setTab('generation')} onDemoReady={revision => { setRevisionId(revision.id); setTab('play'); }} /></Suspense>}</div>
        <div hidden={tab !== 'generation'}>{visited('generation') && <Suspense fallback={<WorkspaceLoading />}> <GenerationPanel token={token} runtime={data.runtime} sources={data.sources} selectedId={sourceId} select={setSourceId} jobs={data.jobs} refresh={refresh} openDraft={openGeneratedDraft} onConfigure={() => setTab('settings')} jobFocus={jobFocus} active={tab === 'generation'} /></Suspense>}</div>
        <div hidden={tab !== 'agent'}>{visited('agent') && <Suspense fallback={<p className="studio-loading" role="status">{t('正在读取工作空间…')}</p>}><AgentChatPanel token={token} configured={data.runtime.providerConfigured} active={tab === 'agent'} historyHost={historyHost}
          worlds={data.worlds} jobs={data.jobs} sources={data.sources} revisions={data.worldRevisions}
          handoff={agentHandoff} onHandoffConsumed={() => setAgentHandoff(null)}
          onOpenDraft={id => openGeneratedDraft(id, 'open')} onOpenJobs={() => setTab('generation')} onOpenSources={() => setTab('sources')}
          onConfigure={() => setTab('settings')} onChanged={refresh} /></Suspense>}</div>
        <div hidden={tab !== 'drafts'}>{visited('drafts') && <Suspense fallback={<WorkspaceLoading />}><DraftPanel onDirtyChange={setDraftDirty} onBusyChange={setDraftBusy} token={token} drafts={data.drafts} sources={data.sources} revisions={data.revisions} sessions={data.sessions} jobs={data.jobs} runtime={data.runtime} selectedId={draftId} select={setDraftId} refresh={refresh} onPublished={revision => { setRevisionId(revision.id); navigateHash(playStoryHash(revision.id)); }} onOpenPlay={id => { setRevisionId(id); setTab('play'); }} onOpenPlayerShell={id => navigateHash(playStoryHash(id))} onOpenGeneration={() => setTab('generation')} onConfigure={() => setTab('settings')} /></Suspense>}</div>
        <div hidden={tab !== 'play'}>{visited('play') && <Suspense fallback={<WorkspaceLoading />}><PlayPanel token={token} revisions={data.revisions} sessions={data.sessions} revisionId={revisionId} selectRevision={setRevisionId} refresh={refresh} /></Suspense>}</div>
        <div hidden={tab !== 'worlds'}>{visited('worlds') && <Suspense fallback={<WorkspaceLoading />}><WorldsPanel onDirtyChange={setWorldDirty} onBusyChange={setWorldBusy} token={token} drafts={data.worlds} sources={data.sources} revisions={data.worldRevisions} adventures={data.adventures} selectedId={worldDraftId} select={setWorldDraftId} refresh={refresh} onPublished={revision => { setWorldRevisionId(revision.id); navigateHash(playWorldHash(revision.id)); }} onOpenAdventure={id => { setWorldRevisionId(id); setTab('adventures'); }} onOpenPlayerShell={id => navigateHash(playWorldHash(id))} onOpenBuildingLibrary={() => setTab('buildings')} /></Suspense>}</div>
        <div hidden={tab !== 'buildings'}>{visited('buildings') && <Suspense fallback={<WorkspaceLoading />}><BuildingLibraryPage token={token} /></Suspense>}</div>
        <div hidden={tab !== 'items'}>{visited('items') && <Suspense fallback={<WorkspaceLoading />}><ItemCatalogPage token={token} /></Suspense>}</div>
        <div hidden={tab !== 'adventures'}>{visited('adventures') && <Suspense fallback={<WorkspaceLoading />}><AdventurePanel token={token} revisions={data.worldRevisions} adventures={data.adventures} revisionId={worldRevisionId} selectRevision={setWorldRevisionId} refresh={refresh} /></Suspense>}</div>
        <div hidden={tab !== 'settings'}>{visited('settings') && <Suspense fallback={<WorkspaceLoading />}><ModelSettingsPanel token={token} onSaved={refresh} /></Suspense>}</div>
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
