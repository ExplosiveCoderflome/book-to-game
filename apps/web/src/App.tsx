import { useCallback, useEffect, useState } from 'react';
import type { AdventureView, WorldDraft, WorldRevision, Draft, GameRevision, GenerationJob, RuntimeInfo, SessionView, SourceSummary } from '@novel-game/contracts';
import { errorMessage, request } from './lib/api';
import { DraftPanel } from './components/DraftPanel';
import { GenerationPanel } from './components/GenerationPanel';
import { Notice } from './components/Notice';
import { PlayPanel } from './components/PlayPanel';
import { SourcePanel } from './components/SourcePanel';
import { ModelSettingsPanel } from './components/ModelSettingsPanel';
import { WorldsPanel } from './components/WorldsPanel';
import { AdventurePanel } from './components/AdventurePanel';

type Tab = 'sources' | 'generation' | 'worlds' | 'adventures' | 'drafts' | 'play' | 'settings';
const tabs: { id: Tab; label: string; number: string }[] = [{ id: 'sources', label: '原作书架', number: '01' }, { id: 'generation', label: '改编生成', number: '02' }, {id: 'worlds', label: '世界草稿', number: '03'}, {id: 'adventures', label: '开放冒险', number: '04'}, { id: 'drafts', label: '分支草稿', number: '05' }, { id: 'play', label: '分支试玩', number: '06' }, {id: 'settings', label: '模型设置', number: '07'}];
interface Data { runtime: RuntimeInfo; sources: SourceSummary[]; jobs: GenerationJob[]; drafts: Draft[]; revisions: GameRevision[]; sessions: SessionView[]; worlds: WorldDraft[]; worldRevisions: WorldRevision[]; adventures: AdventureView[] }

export function App() {
  const [token, setToken] = useState(() => sessionStorage.getItem('novel-game.token') ?? '');
  const [tokenInput, setTokenInput] = useState(token);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [tab, setTab] = useState<Tab>('sources');
  const [sourceId, setSourceId] = useState('');
  const [draftId, setDraftId] = useState('');
  const [revisionId, setRevisionId] = useState('');
  const [worldDraftId, setWorldDraftId] = useState('');
  const [worldRevisionId, setWorldRevisionId] = useState('');
  const [worldDirty, setWorldDirty] = useState(false);
  useEffect(() => { window.scrollTo({top: 0}); }, [tab]);
  const refresh = useCallback(async () => {
    if (!token) return;
    const [runtime, sources, jobs, drafts, revisions, sessions, worlds, worldRevisions, adventures] = await Promise.all([
      request<RuntimeInfo>(token, '/runtime'), request<SourceSummary[]>(token, '/sources'), request<GenerationJob[]>(token, '/jobs'),
      request<Draft[]>(token, '/drafts'), request<GameRevision[]>(token, '/games'), request<SessionView[]>(token, '/sessions'),
      request<WorldDraft[]>(token, '/worlds/drafts'), request<WorldRevision[]>(token, '/worlds/revisions'), request<AdventureView[]>(token, '/adventures'),
    ]);
    setData({ runtime, sources, jobs, drafts, revisions, sessions, worlds, worldRevisions, adventures }); setError(null);
    setSourceId(current => current || sources[0]?.id || '');
    setRevisionId(current => current || revisions[0]?.id || '');
    setWorldRevisionId(current => current || worldRevisions[0]?.id || '');
  }, [token]);
  useEffect(() => {
    if (!token) { setData(null); return; }
    let active = true; setConnecting(true);
    refresh().catch(e => { if (active) setError(errorMessage(e)); }).finally(() => { if (active) setConnecting(false); });
    return () => { active = false; };
  }, [token, refresh]);
  const hasActiveJobs = data?.jobs.some(job => job.status === 'queued' || job.status === 'running') ?? false;
  useEffect(() => {
    if (!hasActiveJobs || !token) return;
    let pending = false;
    const timer = window.setInterval(() => {
      if (pending) return;
      pending = true;
      refresh().catch(e => setError(errorMessage(e))).finally(() => {pending = false;});
    }, 4000);
    return () => window.clearInterval(timer);
  }, [hasActiveJobs, token, refresh]);
  function connect(event: React.FormEvent) {
    event.preventDefault(); const next = tokenInput.trim();
    sessionStorage.setItem('novel-game.token', next); setError(null);
    if (next === token) { setConnecting(true); refresh().catch(e => setError(errorMessage(e))).finally(() => setConnecting(false)); }
    else { setData(null); setToken(next); }
  }
  function openGeneratedDraft(id: string, mode: 'story' | 'open') {
    if (mode === 'open') {
      setTab('worlds');
      if (worldDirty && id !== worldDraftId) {setError('世界草稿还有未保存的修改，请先保存或放弃编辑，再打开另一份草稿。'); return;}
      setWorldDraftId(id);
    } else {setDraftId(id); setTab('drafts');}
  }
  function disconnect() {
    if (worldDirty) {setTab('worlds'); setError('世界草稿还有未保存的修改，请先保存或放弃编辑，再断开工作台。'); return;}
    sessionStorage.removeItem('novel-game.token'); setToken(''); setTokenInput('');
  }
  return <div className="app-shell">
    <header className="site-header"><a className="brand" href="#" onClick={e => { e.preventDefault(); setTab('sources'); }}><span className="brand-seal" aria-hidden="true">叙</span><div><strong>故事工坊</strong><small>把小说里的可能，变成读者的选择</small></div></a><div className="header-status"><span className={`status-dot ${data ? 'online' : ''}`} />{data ? '本地工作台已连接' : '等待连接本地服务'}{data && <span className="version">v{data.runtime.version}</span>}</div></header>
    <main>
      {!data ? <div className="connect-page"><div className="connect-intro"><p className="eyebrow">NOVEL → TEXT ADVENTURE</p><h1>故事不止一种<br />走法。</h1><p>从原文出发，整理世界与人物，<br />写下分岔的路，让读者亲自做出选择。</p><div className="ink-line" /></div><form className="panel stack connect-form" onSubmit={connect}><p className="eyebrow">本地作者工作台</p><h2>连接你的工坊</h2><p className="hint">从 <code>data/access-token.txt</code> 复制工作台访问码。它用于保护本地工作台和 MCP，<strong>不是模型 API Key</strong>；模型将在进入后通过“模型设置”配置。</p><label>工作台访问码<input type="password" autoComplete="off" value={tokenInput} onChange={e => setTokenInput(e.target.value)} placeholder="粘贴本项目生成的工作台访问码" required /></label><button className="primary" disabled={connecting || !tokenInput.trim()}>{connecting ? '正在连接…' : '进入故事工坊 →'}</button><Notice text={error} /><div className="connect-footnote">访问码仅保留在当前浏览器会话 · 单用户本地使用</div></form></div> : <>
        <div className="workspace-bar"><nav aria-label="工作台流程">{tabs.map(item => <button className={tab === item.id ? 'active' : ''} key={item.id} aria-current={tab === item.id ? 'page' : undefined} onClick={() => setTab(item.id)}><span>{item.number}</span>{item.label}</button>)}</nav><div className="workspace-tools"><span className={`provider-state ${data.runtime.providerConfigured ? 'configured' : ''}`}>{data.runtime.providerConfigured ? '模型服务已配置' : '模型服务未配置'}</span><button className="quiet small" onClick={() => refresh().catch(e => setError(errorMessage(e)))}>刷新</button><button className="quiet small" onClick={disconnect}>断开</button></div></div>
        <Notice text={error} />
        <div hidden={tab !== 'sources'}><SourcePanel token={token} sources={data.sources} selectedId={sourceId} select={setSourceId} refresh={refresh} onGenerate={() => setTab('generation')} /></div>
        <div hidden={tab !== 'generation'}><GenerationPanel token={token} runtime={data.runtime} sources={data.sources} selectedId={sourceId} select={setSourceId} jobs={data.jobs} refresh={refresh} openDraft={openGeneratedDraft} onConfigure={() => setTab('settings')} /></div>
        <div hidden={tab !== 'drafts'}><DraftPanel token={token} drafts={data.drafts} sources={data.sources} selectedId={draftId} select={setDraftId} refresh={refresh} onPublished={revision => { setRevisionId(revision.id); setTab('play'); }} /></div>
        <div hidden={tab !== 'play'}><PlayPanel token={token} revisions={data.revisions} sessions={data.sessions} revisionId={revisionId} selectRevision={setRevisionId} refresh={refresh} /></div>
        <div hidden={tab !== 'worlds'}><WorldsPanel onDirtyChange={setWorldDirty} token={token} drafts={data.worlds} sources={data.sources} selectedId={worldDraftId} select={setWorldDraftId} refresh={refresh} onPublished={revision => {setWorldRevisionId(revision.id); setTab('adventures');}} /></div>
        <div hidden={tab !== 'adventures'}><AdventurePanel token={token} revisions={data.worldRevisions} adventures={data.adventures} revisionId={worldRevisionId} selectRevision={setWorldRevisionId} refresh={refresh} /></div>
        {tab === 'settings' && <ModelSettingsPanel token={token} onSaved={refresh} />}
      </>}
    </main>
    <footer className="site-footer"><span>故事工坊 / 小说转文字游戏</span><span>原文有据 · 改编有界 · 选择有果</span></footer>
  </div>;
}
