import { useI18n, I18nProvider } from './lib/i18n';
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
import { DemoPreview } from './components/DemoPreview';

type Tab = 'sources' | 'generation' | 'worlds' | 'adventures' | 'drafts' | 'play' | 'settings';
const tabs: { id: Tab; label: string; number: string }[] = [{ id: 'sources', label: '原作书架', number: '01' }, { id: 'generation', label: '改编生成', number: '02' }, {id: 'worlds', label: '世界草稿', number: '03'}, {id: 'adventures', label: '开放冒险', number: '04'}, { id: 'drafts', label: '分支草稿', number: '05' }, { id: 'play', label: '分支试玩', number: '06' }, {id: 'settings', label: '模型设置', number: '07'}];
interface Data { runtime: RuntimeInfo; sources: SourceSummary[]; jobs: GenerationJob[]; drafts: Draft[]; revisions: GameRevision[]; sessions: SessionView[]; worlds: WorldDraft[]; worldRevisions: WorldRevision[]; adventures: AdventureView[] }

function Workbench() {
  const { t, locale, setLocale } = useI18n();
  const token = '';
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
  const [showDemo, setShowDemo] = useState(false);
  useEffect(() => { window.scrollTo({top: 0}); }, [tab]);
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
    if (mode === 'open') {
      setTab('worlds');
      if (worldDirty && id !== worldDraftId) {setError('世界草稿还有未保存的修改，请先保存或放弃编辑，再打开另一份草稿。'); return;}
      setWorldDraftId(id);
    } else {setDraftId(id); setTab('drafts');}
  }
  return <div className="app-shell">
    <header className="site-header"><a className="brand" href="#" onClick={e => { e.preventDefault(); setTab('sources'); }}><span className="brand-seal" aria-hidden="true">{t("叙")}</span><div><strong>{t("故事工坊")}</strong><small>{t("把小说里的可能，变成读者的选择")}</small></div></a><div className="header-controls"><label className="language-switch"><span>{t('界面语言')}</span><select aria-label={t('界面语言')} value={locale} onChange={e => setLocale(e.target.value as 'zh-CN' | 'en-US')}><option value="zh-CN">中文</option><option value="en-US">English</option></select></label><div className="header-status"><span className={`status-dot ${data ? 'online' : ''}`} />{data ? t("本地工作台已连接") : connecting ? t("正在连接本地工作台") : t("本地服务未连接")}{data && <span className="version">v{data.runtime.version}</span>}</div></div></header>
    <main>
      {!data ? showDemo ? <DemoPreview onBack={() => setShowDemo(false)} /> : <div className="connect-page"><div className="connect-intro"><p className="eyebrow">NOVEL → TEXT ADVENTURE</p><h1>{t("故事不止一种")}<br />{t("走法。")}</h1><p>{t("从原文出发，整理世界与人物，")}<br />{t("写下分岔的路，让读者亲自做出选择。")}</p><div className="ink-line" /></div><div className="panel stack connect-form"><p className="eyebrow">{t("本地作者工作台")}</p><h2>{connecting ? t("正在连接本地服务") : t("本地服务未连接")}</h2><p className="hint">{connecting ? t("正在读取本地工作台数据，请稍候。") : t("请确认 API 服务已启动，然后重新连接。Web 端不需要输入工作台访问码；访问码只用于 MCP。")}</p><button className="primary" onClick={retryConnection} disabled={connecting}>{connecting ? t("正在连接…") : t("重新连接 →")}</button><button type="button" className="demo-link" onClick={() => setShowDemo(true)}>{t("先体验一个可玩示例 →")}</button><Notice text={!connecting ? error : null} /><div className="connect-footnote">{t("本机 Web 通过来源校验访问；MCP 仍需要工作台访问码")}</div></div></div> : <>
        <div className="workspace-bar"><nav aria-label={t("工作台流程")}>{tabs.map(item => <button className={tab === item.id ? 'active' : ''} key={item.id} aria-current={tab === item.id ? 'page' : undefined} onClick={() => setTab(item.id)}><span>{item.number}</span>{t(item.label)}</button>)}</nav><div className="workspace-tools"><span className={`provider-state ${data.runtime.providerConfigured ? 'configured' : ''}`}>{data.runtime.providerConfigured ? t("模型服务已配置") : t("模型服务未配置")}</span><button className="quiet small" onClick={() => refresh().catch(e => setError(errorMessage(e)))}>{t("刷新")}</button></div></div>
        <Notice text={error} />
        <div hidden={tab !== 'sources'}><SourcePanel token={token} sources={data.sources} revisions={data.revisions} selectedId={sourceId} select={setSourceId} refresh={refresh} onGenerate={() => setTab('generation')} onDemoReady={revision => { setRevisionId(revision.id); setTab('play'); }} /></div>
        <div hidden={tab !== 'generation'}><GenerationPanel token={token} runtime={data.runtime} sources={data.sources} selectedId={sourceId} select={setSourceId} jobs={data.jobs} refresh={refresh} openDraft={openGeneratedDraft} onConfigure={() => setTab('settings')} /></div>
        <div hidden={tab !== 'drafts'}><DraftPanel token={token} drafts={data.drafts} sources={data.sources} selectedId={draftId} select={setDraftId} refresh={refresh} onPublished={revision => { setRevisionId(revision.id); setTab('play'); }} /></div>
        <div hidden={tab !== 'play'}><PlayPanel token={token} revisions={data.revisions} sessions={data.sessions} revisionId={revisionId} selectRevision={setRevisionId} refresh={refresh} /></div>
        <div hidden={tab !== 'worlds'}><WorldsPanel onDirtyChange={setWorldDirty} token={token} drafts={data.worlds} sources={data.sources} selectedId={worldDraftId} select={setWorldDraftId} refresh={refresh} onPublished={revision => {setWorldRevisionId(revision.id); setTab('adventures');}} /></div>
        <div hidden={tab !== 'adventures'}><AdventurePanel token={token} revisions={data.worldRevisions} adventures={data.adventures} revisionId={worldRevisionId} selectRevision={setWorldRevisionId} refresh={refresh} /></div>
        {tab === 'settings' && <ModelSettingsPanel token={token} onSaved={refresh} />}
      </>}
    </main>
    <footer className="site-footer"><span>{t("故事工坊 / 小说转文字游戏")}</span><span>{t("原文有据 · 改编有界 · 选择有果")}</span></footer>
  </div>;
}

export function App() { return <I18nProvider><Workbench /></I18nProvider>; }
