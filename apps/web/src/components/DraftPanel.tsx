import { useEffect, useMemo, useRef, useState } from 'react';
import { gameContentSchema, type CanvasLayout, type Draft, type GameContent, type GameRevision, type GenerationJob, type RuntimeInfo, type ScanDepth, type ProposeActResult, type SessionView, type SourceDocument, type SourceSummary, type ValidationResult } from '@novel-game/contracts';
import { errorMessage, request, RequestError } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { relevantStoryJob } from '../lib/job-on-canvas';
import { shouldShowSkeletonPlaceholder, skeletonToCanvasContent } from '../lib/skeleton-placeholder';
import { playOverlayFromSession } from '../lib/play-overlay';
import { selectedChapters } from '../lib/generation-scope';
import { findLeafSceneIds } from '../lib/leaf-scenes';
import { dismissExtendGuide, isExtendGuideDismissed } from '../lib/extend-guide';
import { nextSceneSelection } from '../lib/multi-select';
import { Empty, Notice } from './Notice';
import { BranchGraphCanvas } from './BranchGraphCanvas';
import { SceneEditor } from './SceneEditor';
import { StoryVariablesEditor } from './StoryVariablesEditor';
import { WorldbookEditor } from './WorldbookEditor';
import { ProposeActBox } from './ProposeActBox';

const blankContent = (): GameContent => ({ title: '', mode: 'story', premise: '', adaptationNotes: '', startSceneId: '', scenes: [] });
interface Props {
  token: string; drafts: Draft[]; sources: SourceSummary[];
  revisions: GameRevision[]; sessions: SessionView[];
  jobs: GenerationJob[];
  runtime: RuntimeInfo;
  selectedId: string; select: (id: string) => void; refresh: () => Promise<void>;
  onPublished: (revision: GameRevision) => void;
  onOpenPlay?: (revisionId: string) => void;
  onOpenGeneration?: () => void;
  onConfigure?: () => void;
}

export function DraftPanel({ token, drafts, sources, revisions, sessions, jobs, runtime, selectedId, select, refresh, onPublished, onOpenPlay, onOpenGeneration, onConfigure }: Props) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [content, setContent] = useState<GameContent>(blankContent);
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? '');
  const [sceneIndex, setSceneIndex] = useState(0);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<'scene' | 'meta' | 'variables' | 'worldbook'>('scene');
  const [inspectorSecondary, setInspectorSecondary] = useState<'meta' | 'variables' | 'worldbook'>('worldbook');
  const [metaOpen, setMetaOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [jsonMode, setJsonMode] = useState(false);
  const [jsonText, setJsonText] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [canvasMode, setCanvasMode] = useState<'edit' | 'play'>('edit');
  const [playSession, setPlaySession] = useState<SessionView | null>(null);
  const [playBusy, setPlayBusy] = useState(false);
  const [proposeNote, setProposeNote] = useState<string | null>(null);
  const [extendBusy, setExtendBusy] = useState(false);
  const [scanDepth, setScanDepth] = useState<ScanDepth>('medium');
  const [scanDirection, setScanDirection] = useState(() => t('尊重原作世界规则，设计一次有明确选择后果的短篇冒险'));
  const [scanBusy, setScanBusy] = useState(false);
  const [extendFailedSceneId, setExtendFailedSceneId] = useState<string | null>(null);
  const [focusSceneIds, setFocusSceneIds] = useState<string[]>([]);
  const [focusNonce, setFocusNonce] = useState(0);
  const [extendNeighborCount, setExtendNeighborCount] = useState<1 | 2>(1);
  const [lastExtendSummary, setLastExtendSummary] = useState<{ addedCount: number; anchorTitle: string; neighborCount: 1 | 2; leafId: string | null } | null>(null);
  const [batchExtendProgress, setBatchExtendProgress] = useState<{ done: number; total: number } | null>(null);
  const [showExtendGuide, setShowExtendGuide] = useState(false);
  const [selectedSceneIds, setSelectedSceneIds] = useState<string[]>([]);
  const [extendConflict, setExtendConflict] = useState(false);
  const extendInFlight = useRef(false);
  const extendAbort = useRef<AbortController | null>(null);
  const [scanDocument, setScanDocument] = useState<SourceDocument | null>(null);
  const [chapterScope, setChapterScope] = useState<'all' | 'pick'>('all');
  const [scanChapterIds, setScanChapterIds] = useState<string[]>([]);
  useEffect(() => {
    let active = true;
    setDraft(null); setDirty(false); setConflict(false); setValidation(null); setError(null); setMessage(null); setJsonMode(false); setSceneIndex(0); setInspectorOpen(false); setInspectorTab('scene'); setCanvasMode('edit'); setPlaySession(null); setExtendFailedSceneId(null); setFocusSceneIds([]); setLastExtendSummary(null); setBatchExtendProgress(null); setShowExtendGuide(false); setSelectedSceneIds([]); setExtendConflict(false);
    if (!selectedId) { setContent(blankContent()); return; }
    setBusy(true);
    request<Draft>(token, `/drafts/${selectedId}`).then(value => {
      if (active) {
        setDraft(value); setContent(value.content); setSourceId(value.sourceId);
        setShowExtendGuide(value.content.scenes.length > 0 && !isExtendGuideDismissed(value.id));
      }
    }).catch(e => { if (active) setError(errorMessage(e)); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [selectedId, token, reload]);
  useEffect(() => {
    let active = true;
    setScanDocument(null);
    if (!sourceId) { setScanChapterIds([]); return; }
    request<SourceDocument>(token, `/sources/${sourceId}`).then(doc => {
      if (!active) return;
      setScanDocument(doc);
      setScanChapterIds(doc.chapters.map(c => c.id));
      if (chapterScope !== 'pick') setChapterScope('all');
    }).catch(e => { if (active) setError(errorMessage(e)); });
    return () => { active = false; };
  }, [token, sourceId, selectedId]);
  function change(next: GameContent) { setContent(next); setDirty(true); setValidation(null); setMessage(null); }
  function openInspector(tab: 'scene' | 'meta' | 'variables' | 'worldbook') {
    setInspectorTab(tab);
    if (tab !== 'scene') setInspectorSecondary(tab);
    setInspectorOpen(true);
  }
  function selectScene(id: string, opts?: { additive?: boolean }) {
    const index = content.scenes.findIndex(s => s.id === id);
    if (index < 0) return;
    setSelectedSceneIds(prev => nextSceneSelection(prev, id, !!opts?.additive));
    setSceneIndex(index);
    openInspector('scene');
  }

  function clearMultiSelection() {
    const keep = content.scenes[sceneIndex]?.id;
    setSelectedSceneIds(keep ? [keep] : []);
  }
  function addScene() {
    const id = `scene-${crypto.randomUUID().slice(0, 8)}`;
    const selected = content.scenes[sceneIndex];
    const anchor = selected ? content.canvasLayout?.[selected.id] : undefined;
    const x = (anchor?.x ?? (content.scenes.length * 40)) + 220;
    const y = (anchor?.y ?? (content.scenes.length * 40)) + (selected ? 0 : 80);
    const canvasLayout: CanvasLayout = { ...(content.canvasLayout ?? {}), [id]: { x, y } };
    change({
      ...content,
      scenes: [...content.scenes, { id, title: '', text: '', origin: 'adapted', evidence: [], choices: [] }],
      startSceneId: content.startSceneId || id,
      canvasLayout,
    });
    setSceneIndex(content.scenes.length);
    openInspector('scene');
  }
  function updateLayout(layout: CanvasLayout) {
    change({ ...content, canvasLayout: layout });
  }
  function connectScenes(fromId: string, toId: string) {
    const scenes = content.scenes.map(scene => {
      if (scene.id !== fromId) return scene;
      if (scene.ending) return scene;
      if (scene.choices.some(c => c.targetSceneId === toId)) return scene;
      if (scene.choices.length >= 8) return scene;
      const choiceId = `choice-${crypto.randomUUID().slice(0, 6)}`;
      return { ...scene, choices: [...scene.choices, { id: choiceId, label: '新连线', targetSceneId: toId }] };
    });
    change({ ...content, scenes });
    const index = scenes.findIndex(s => s.id === fromId);
    if (index >= 0) { setSceneIndex(index); openInspector('scene'); }
  }
  function disconnectEdge(fromId: string, choiceId: string) {
    const scenes = content.scenes.map(scene => {
      if (scene.id !== fromId) return scene;
      return { ...scene, choices: scene.choices.filter(choice => choice.id !== choiceId) };
    });
    change({ ...content, scenes });
  }

  async function extendOneScene(
    current: Draft,
    currentContent: GameContent,
    sceneId: string,
    neighborCount: 1 | 2,
    signal?: AbortSignal,
  ): Promise<{ draft: Draft; added: string[] }> {
    const beforeIds = new Set(currentContent.scenes.map(s => s.id));
    const updated = await request<Draft>(token, `/drafts/${current.id}/extend-scene`, 'POST', {
      version: current.version,
      sceneId,
      direction: currentContent.premise || scanDirection,
      neighborCount,
    }, { signal });
    const added = updated.content.scenes.map(s => s.id).filter(id => !beforeIds.has(id));
    return { draft: updated, added };
  }

  function beginExtendRun(): AbortSignal | undefined {
    extendAbort.current?.abort();
    const ac = new AbortController();
    extendAbort.current = ac;
    return ac.signal;
  }

  function cancelExtendRun() {
    extendAbort.current?.abort();
  }

  function handleExtendFailure(e: unknown, sceneId: string | null, context: 'single' | 'batch') {
    if (e instanceof RequestError && e.code === 'REQUEST_ABORTED') {
      setError(t('已取消延申。'));
      setExtendFailedSceneId(null);
      return;
    }
    const prefix = context === 'batch' ? t('批量延申中断：{detail}', { detail: errorMessage(e) }) : t('延申失败：{detail}', { detail: errorMessage(e) });
    setError(prefix);
    if (sceneId) setExtendFailedSceneId(sceneId);
    if (e instanceof RequestError && e.status === 409) {
      setConflict(true);
      setExtendConflict(true);
      setError(t('延申时草稿版本冲突，已停止。请重新加载草稿后再试。'));
    }
  }

  async function extendSelectedScene(sceneId: string) {
    if (!draft || dirty || jsonMode) {
      setError(t('请先保存当前编辑，再延申节点。'));
      return;
    }
    if (extendInFlight.current || extendBusy) return; // ignore double-clicks / spam
    extendInFlight.current = true;
    const signal = beginExtendRun();
    setExtendBusy(true); setError(null); setMessage(null); setExtendFailedSceneId(null); setBatchExtendProgress(null); setExtendConflict(false);
    const anchorTitle = content.scenes.find(s => s.id === sceneId)?.title || sceneId;
    const breadth = extendNeighborCount;
    try {
      const { draft: updated, added } = await extendOneScene(draft, content, sceneId, breadth, signal);
      setDraft(updated); setContent(updated.content); setDirty(false);
      const focus = added.length > 0 ? added : [sceneId];
      setFocusSceneIds(focus);
      setFocusNonce(n => n + 1);
      const leafId = added[added.length - 1] ?? null;
      setLastExtendSummary({ addedCount: added.length, anchorTitle, neighborCount: breadth, leafId });
      const prefer = leafId ?? sceneId;
      const index = updated.content.scenes.findIndex(s => s.id === prefer);
      if (index >= 0) { setSceneIndex(index); openInspector('scene'); setSelectedSceneIds([prefer]); }
      setMessage(t('已延申节点（草稿 v{version}）· 新增 {count} 个场景', { version: updated.version, count: added.length }));
      await refresh();
    } catch (e) {
      handleExtendFailure(e, sceneId, 'single');
    }
    finally { extendInFlight.current = false; setExtendBusy(false); extendAbort.current = null; }
  }

  function extendAgainFromLeaf() {
    const leaf = lastExtendSummary?.leafId;
    if (!leaf || extendInFlight.current) return;
    void extendSelectedScene(leaf);
  }

  async function runSequentialExtend(ids: string[], neighborCount: 1 | 2, anchorLabel: string) {
    if (!draft || dirty || jsonMode) {
      setError(t('请先保存当前编辑，再延申节点。'));
      return;
    }
    if (extendInFlight.current || extendBusy) return;
    if (!ids.length) {
      setError(t('请先选择要延申的节点。'));
      return;
    }
    extendInFlight.current = true;
    const signal = beginExtendRun();
    setExtendBusy(true); setError(null); setMessage(null); setExtendFailedSceneId(null); setExtendConflict(false);
    setBatchExtendProgress({ done: 0, total: ids.length });
    let current = draft;
    let currentContent = content;
    const allAdded: string[] = [];
    let failedAt: string | null = null;
    let aborted = false;
    try {
      for (let i = 0; i < ids.length; i++) {
        if (signal?.aborted) { aborted = true; break; }
        const sceneId = ids[i]!;
        if (!currentContent.scenes.some(s => s.id === sceneId)) {
          setBatchExtendProgress({ done: i + 1, total: ids.length });
          continue;
        }
        try {
          const { draft: updated, added } = await extendOneScene(current, currentContent, sceneId, neighborCount, signal);
          current = updated;
          currentContent = updated.content;
          allAdded.push(...added);
          setDraft(updated); setContent(updated.content); setDirty(false);
          setBatchExtendProgress({ done: i + 1, total: ids.length });
        } catch (e) {
          if (e instanceof RequestError && e.code === 'REQUEST_ABORTED') { aborted = true; break; }
          failedAt = sceneId;
          handleExtendFailure(e, sceneId, 'batch');
          break;
        }
      }
      if (aborted) {
        setError(t('已取消延申。'));
        if (allAdded.length > 0) {
          setFocusSceneIds(allAdded);
          setFocusNonce(n => n + 1);
        }
      } else if (allAdded.length > 0) {
        setFocusSceneIds(allAdded);
        setFocusNonce(n => n + 1);
        const leafId = allAdded[allAdded.length - 1] ?? null;
        setLastExtendSummary({
          addedCount: allAdded.length,
          anchorTitle: anchorLabel,
          neighborCount,
          leafId,
        });
        setMessage(t('已批量延申（草稿 v{version}）· 新增 {count} 个场景', {
          version: current.version,
          count: allAdded.length,
        }));
        await refresh();
      } else if (!failedAt) {
        setMessage(t('没有可延申的节点。'));
      }
    } finally {
      extendInFlight.current = false;
      setExtendBusy(false);
      setBatchExtendProgress(null);
      extendAbort.current = null;
    }
  }

  async function extendAllLeavesBatch() {
    await runSequentialExtend(findLeafSceneIds(content), 1, t('全部叶节点'));
  }

  async function extendSelectedScenesBatch() {
    const ids = selectedSceneIds.filter(id => content.scenes.some(s => s.id === id));
    await runSequentialExtend(ids, extendNeighborCount, t('选中节点'));
  }

  const leafCount = useMemo(() => findLeafSceneIds(content).length, [content]);

  function onDismissExtendGuide() {
    if (draft) dismissExtendGuide(draft.id);
    setShowExtendGuide(false);
  }

  async function startCanvasScan() {
    if (!sourceId) { setError(t('请先选择原作，再按粒度扫描生成。')); return; }
    if (!runtime.providerConfigured) { setError(t('尚未配置模型服务。请先前往模型设置。')); return; }
    if (jsonMode) { setError(t('请先退出 JSON 模式，再开始扫描。')); return; }
    if (dirty && content.scenes.length > 0) { setError(t('请先保存或放弃当前编辑，再开始扫描。')); return; }
    if (!scanDocument) { setError(t('请等待原文章节载入。')); return; }
    const direction = scanDirection.trim() || t('尊重原作世界规则，设计一次有明确选择后果的短篇冒险');
    let chapterIds: string[] | undefined;
    try {
      chapterIds = chapterScope === 'all'
        ? scanDocument.chapters.map(c => c.id)
        : selectedChapters(scanDocument.chapters, scanChapterIds);
    } catch (e) { setError(errorMessage(e)); return; }
    if (!chapterIds.length) { setError(t('请至少选择一个章节。')); return; }
    setScanBusy(true); setError(null); setMessage(null);
    try {
      await request<GenerationJob>(token, '/jobs', 'POST', {
        sourceId,
        direction,
        mode: 'story',
        scanDepth,
        chapterIds,
        requestId: crypto.randomUUID(),
      });
      setMessage(t('已提交扫描任务（{depth} · {chapters} 章）。骨架生成后会落到画布。', {
        depth: scanDepth === 'coarse' ? t('粗') : scanDepth === 'fine' ? t('细') : t('中'),
        chapters: chapterIds.length,
      }));
      await refresh();
    } catch (e) { setError(errorMessage(e)); }
    finally { setScanBusy(false); }
  }
  function applyJson() {
    try {
      const result = gameContentSchema.safeParse(JSON.parse(jsonText));
      if (!result.success) { setError(result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('\n')); return; }
      change(result.data); setJsonMode(false); setSceneIndex(0); setInspectorOpen(false); setError(null);
    } catch { setError(t('JSON 格式不正确，请检查括号、逗号和引号。')); }
  }
  async function save() {
    const parsed = gameContentSchema.safeParse(content);
    if (!parsed.success) { setError(parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('\n')); return; }
    if (!sourceId) { setError(t('请选择草稿对应的原作。')); return; }
    setBusy(true); setError(null); setMessage(null);
    try {
      const saved = draft ? await request<Draft>(token, `/drafts/${draft.id}`, 'PUT', { version: draft.version, content: parsed.data }) : await request<Draft>(token, '/drafts', 'POST', { sourceId, content: parsed.data });
      setDraft(saved); setContent(saved.content); setDirty(false); setMessage(t('已保存草稿 v{version}', { version: saved.version })); await refresh();
      if (!selectedId) select(saved.id);
    } catch (e) { setError(errorMessage(e)); if (e instanceof RequestError && e.status === 409) setConflict(true); } finally { setBusy(false); }
  }
  async function validate() {
    if (!draft) return; setBusy(true); setError(null);
    try { setValidation(await request<ValidationResult>(token, `/drafts/${draft.id}/validate`, 'POST', {})); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  async function publish() {
    if (!draft) return; setBusy(true); setError(null);
    try {
      const revision = await request<GameRevision>(token, `/drafts/${draft.id}/publish`, 'POST', { version: draft.version });
      await refresh(); onPublished(revision);
    } catch (e) { setError(errorMessage(e)); if (e instanceof RequestError && e.status === 409) setConflict(true); } finally { setBusy(false); }
  }
  const linkedRevisions = useMemo(
    () => (draft ? revisions.filter(r => r.draftId === draft.id).sort((a, b) => b.version - a.version) : []),
    [draft, revisions],
  );
  const latestRevision = linkedRevisions[0] ?? null;
  const linkedSessions = useMemo(() => {
    if (!latestRevision) return [] as SessionView[];
    return sessions.filter(s => s.gameRevisionId === latestRevision.id).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [sessions, latestRevision]);
  const playOverlay = useMemo(() => {
    if (!playSession || !latestRevision) return null;
    return playOverlayFromSession(latestRevision.content, playSession);
  }, [playSession, latestRevision]);
  const canPlayOnCanvas = !!latestRevision && !dirty && !jsonMode;
  const generationJob = useMemo(
    () => relevantStoryJob(jobs, { sourceId: draft?.sourceId ?? (sourceId || null), draftId: draft?.id ?? (selectedId || null) }),
    [jobs, draft?.sourceId, draft?.id, sourceId, selectedId],
  );
  const skeletonPlaceholder = shouldShowSkeletonPlaceholder(generationJob, { dirty, jsonMode, canvasMode });
  const canvasGraphContent = useMemo(() => {
    if (skeletonPlaceholder && generationJob?.skeleton) return skeletonToCanvasContent(generationJob.skeleton);
    if (canvasMode === 'play' && latestRevision) return latestRevision.content;
    return content;
  }, [skeletonPlaceholder, generationJob?.skeleton, canvasMode, latestRevision, content]);

  useEffect(() => {
    if (canvasMode !== 'play' || !latestRevision) return;
    const preferred = linkedSessions[0];
    if (preferred && playSession?.id === preferred.id) return;
    if (preferred) { setPlaySession(preferred); return; }
    let active = true;
    setPlayBusy(true);
    request<SessionView>(token, '/sessions', 'POST', { gameRevisionId: latestRevision.id })
      .then(async started => {
        if (!active) return;
        setPlaySession(started);
        await refresh();
      })
      .catch(e => { if (active) setError(errorMessage(e)); })
      .finally(() => { if (active) setPlayBusy(false); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasMode, latestRevision?.id]);

  const genWatchRef = useRef<string | null>(null);
  useEffect(() => {
    const stamp = generationJob ? `${generationJob.id}:${generationJob.status}:${generationJob.draftId ?? ''}` : null;
    const prev = genWatchRef.current;
    genWatchRef.current = stamp;
    if (!generationJob || generationJob.status !== 'succeeded' || !generationJob.draftId) return;
    if (dirty || jsonMode) return;
    // Only react when this job transitions into succeeded (not when reopening an old draft).
    const transitioned = !!prev && prev.startsWith(`${generationJob.id}:`) && !prev.includes(':succeeded:');
    if (!transitioned) return;
    if (generationJob.draftId === selectedId) {
      setReload(v => v + 1);
      setMessage(t('生成完成，已刷新画布上的草稿。'));
      return;
    }
    select(generationJob.draftId);
    setMessage(t('生成完成，已在画布打开新草稿。'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generationJob?.id, generationJob?.status, generationJob?.draftId]);

  async function actOnCanvas(choiceId: string) {
    if (!playSession) return;
    setPlayBusy(true); setError(null);
    try {
      const input = { choiceId, expectedTurn: playSession.turn, requestId: crypto.randomUUID() };
      const result = await request<SessionView>(token, `/sessions/${playSession.id}/actions`, 'POST', input);
      setPlaySession(result);
      await refresh();
    } catch (e) { setError(errorMessage(e)); } finally { setPlayBusy(false); }
  }

  async function proposeOnCanvas(text: string): Promise<ProposeActResult> {
    if (!playSession) throw new Error('no session');
    setPlayBusy(true); setError(null);
    try {
      const result = await request<ProposeActResult>(token, `/sessions/${playSession.id}/propose-act`, 'POST', {
        text, expectedTurn: playSession.turn, requestId: crypto.randomUUID(), autoAct: true,
      });
      if (result.status === 'acted' && result.session) {
        setProposeNote(result.label ? `已映射并执行：${result.label}` : '已映射并执行');
        setPlaySession(result.session as SessionView);
        await refresh();
      } else if (result.status === 'none' || result.status === 'rejected') {
        setProposeNote(result.reason);
      }
      return result;
    } catch (e) {
      setError(errorMessage(e));
      throw e;
    } finally { setPlayBusy(false); }
  }

  const scene = content.scenes[sceneIndex];
  return <section className="work-section draft-workspace">
    <div className="section-heading"><div><p className="eyebrow">{t('05 / 分支草稿')}</p><h2>{t('无限画布工作台')}</h2><p>{t('分支图是主操作面：编辑与试玩可在同一画布切换；侧栏写场景，试玩时高亮路径。')}</p></div><span className="edition">CANVAS FIRST</span></div>
    <div className="draft-toolbar panel"><label>{t('打开草稿')}<select value={selectedId} disabled={dirty || busy || jsonMode} onChange={e => select(e.target.value)}><option value="">{t('新建手动草稿')}</option>{drafts.map(d => <option key={d.id} value={d.id}>{d.content.title} · v{d.version}</option>)}</select></label><span className="hint">{draft ? t('当前 v{version}', { version: draft.version }) : t('手动创作')}{dirty || jsonMode ? t(' · 有未保存编辑') : ''}</span>{(dirty || conflict || jsonMode) && <button onClick={() => setReload(v => v + 1)} disabled={busy}>{t('放弃编辑并重新载入')}</button>}</div>
    <Notice text={error} /><Notice kind="success" text={message} />
    {extendConflict && (
      <div className="extend-conflict-bar" data-testid="extend-conflict-bar" role="alert">
        <span>{t('延申时草稿版本冲突，已停止。请重新加载草稿后再试。')}</span>
        <button type="button" className="small primary" data-testid="extend-reload-draft" disabled={busy || extendBusy} onClick={() => { setExtendConflict(false); setConflict(false); setExtendFailedSceneId(null); setError(null); setReload(v => v + 1); }}>{t('重新加载草稿')}</button>
        <button type="button" className="quiet small" disabled={extendBusy} onClick={() => { setExtendConflict(false); setError(null); }}>{t('关闭')}</button>
      </div>
    )}
    {extendFailedSceneId && !extendConflict && (
      <div className="extend-retry-bar" data-testid="extend-retry-bar">
        <button type="button" className="small primary" disabled={extendBusy || dirty || jsonMode || !draft} onClick={() => void extendSelectedScene(extendFailedSceneId)}>{t(extendBusy ? '正在重试延申…' : '重试延申节点')}</button>
        <button type="button" className="quiet small" disabled={extendBusy} onClick={() => { setExtendFailedSceneId(null); setError(null); }}>{t('关闭')}</button>
      </div>
    )}
    {conflict && !extendConflict && <Notice text={t('草稿版本发生冲突，当前内容没有覆盖服务端。请先复制需要保留的内容，再点击“放弃编辑并重新载入”，基于最新版本重新编辑。')} />}
    {dirty && <p className="hint">{t('请先保存或放弃当前编辑，再切换草稿。')}</p>}
    {selectedId && !draft ? <div className="panel">{busy ? <p role="status">{t('正在打开草稿…')}</p> : <><Empty>{t('草稿未能打开。请重新载入后继续编辑。')}</Empty><button onClick={() => setReload(v => v + 1)}>{t('重新载入草稿')}</button></>}</div> : <form className="panel draft-editor draft-editor-canvas" onChange={() => { setDirty(true); setValidation(null); setMessage(null); }} onSubmit={e => { e.preventDefault(); void save(); }}><fieldset className="editor-body" disabled={busy}>
      {!draft && <label>{t('所属原作')}<select value={sourceId} onChange={e => { setSourceId(e.target.value); setDirty(true); }}><option value="">{t('选择原作')}</option>{sources.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}</select></label>}
      <div className="panel-heading draft-canvas-actions">
        <h3>{t(draft ? (canvasMode === 'play' ? '画布试玩' : '画布编辑') : '建立手动草稿')}</h3>
        <div className="draft-action-cluster">
          {draft && (
            <div className="canvas-mode-toggle" role="group" aria-label={t('画布模式')}>
              <button type="button" className={`small${canvasMode === 'edit' ? ' active' : ''}`} disabled={busy || playBusy} onClick={() => setCanvasMode('edit')}>{t('编辑')}</button>
              <button type="button" className={`small${canvasMode === 'play' ? ' active' : ''}`} disabled={busy || playBusy || !canPlayOnCanvas} title={!canPlayOnCanvas ? t('需已发布版本，且无未保存编辑') : undefined} onClick={() => setCanvasMode('play')}>{t('试玩')}</button>
            </div>
          )}
          <button type="button" className="small" disabled={busy || canvasMode === 'play'} onClick={() => setMetaOpen(v => !v)}>{t(metaOpen ? '收起故事信息' : '故事信息')}</button>
          <button type="button" className="small" disabled={busy || canvasMode === 'play'} onClick={() => openInspector('variables')}>{t('变量')}</button>
          <button type="button" className="small" data-testid="open-worldbook" disabled={busy || canvasMode === 'play'} onClick={() => openInspector('worldbook')}>{t('世界书')}</button>
          <button type="button" className="small" disabled={busy || canvasMode === 'play'} onClick={() => { if (jsonMode) applyJson(); else { setJsonText(JSON.stringify(content, null, 2)); setJsonMode(true); } }}>{t(jsonMode ? '应用 JSON 到编辑器' : '高级 JSON')}</button>
        </div>
      </div>
      {jsonMode ? <><label>GameContent JSON<textarea className="json-editor" rows={28} value={jsonText} onChange={e => setJsonText(e.target.value)} spellCheck={false} /></label><p className="hint">{t('应用后仍需保存草稿。JSON 必须符合 GameContent，模式只能为 story。')}</p></> : <>
        {metaOpen && <div className="draft-meta-strip">
          <div className="field-row"><label>{t('游戏标题')}<input value={content.title} maxLength={200} onChange={e => change({ ...content, title: e.target.value })} /></label><label>{t('起始场景')}<select value={content.startSceneId} onChange={e => change({ ...content, startSceneId: e.target.value })}><option value="">{t('选择故事入口')}</option>{content.scenes.map((s, i) => <option key={i} value={s.id}>{s.title || s.id}</option>)}</select></label></div>
          <label>{t('故事前提')}<textarea rows={2} maxLength={4000} value={content.premise} onChange={e => change({ ...content, premise: e.target.value })} /></label>
          <label>{t('改编说明')}<textarea rows={2} maxLength={4000} value={content.adaptationNotes} onChange={e => change({ ...content, adaptationNotes: e.target.value })} /></label>
        </div>}
        <div className={`draft-canvas-stage${(inspectorOpen || canvasMode === 'play') ? ' with-inspector' : ''}${inspectorOpen && canvasMode !== 'play' ? ' with-dual-inspector' : ''}${canvasMode === 'play' ? ' play-mode' : ''}`}>
        {content.scenes.length === 0 && !skeletonPlaceholder && (
          <div className="branch-canvas-empty-scan" data-testid="empty-scan-depth" data-canvas-ui onChange={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
            <strong>{t('空图画布 · 一键扫描生成')}</strong>
            <label className="empty-scan-source">{t('原作')}
              <select value={sourceId} disabled={scanBusy || !!draft} onChange={e => setSourceId(e.target.value)} data-testid="empty-scan-source">
                <option value="">{t('选择原作')}</option>
                {sources.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
              </select>
            </label>
            <label className="empty-scan-direction">{t('改编方向')}
              <textarea rows={2} maxLength={2000} value={scanDirection} disabled={scanBusy} onChange={e => setScanDirection(e.target.value)} placeholder={t('例如：让读者在关夜中决定是否交出秘密。')} data-testid="empty-scan-direction" />
            </label>
            <div className="scan-depth-row" role="group" aria-label={t('扫描粒度')}>
              {([['coarse', '粗 · 章弧'], ['medium', '中 · 默认'], ['fine', '细 · 拍点']] as const).map(([value, label]) => (
                <button key={value} type="button" className={`small${scanDepth === value ? ' active' : ''}`} disabled={scanBusy} onClick={() => setScanDepth(value)}>{t(label)}</button>
              ))}
            </div>
            <div className="empty-scan-scope" data-testid="empty-scan-scope">
              <div className="scan-depth-row" role="group" aria-label={t('章节范围')}>
                <button type="button" className={`small${chapterScope === 'all' ? ' active' : ''}`} disabled={scanBusy || !scanDocument} onClick={() => { setChapterScope('all'); if (scanDocument) setScanChapterIds(scanDocument.chapters.map(c => c.id)); }}>{t('全书')}</button>
                <button type="button" className={`small${chapterScope === 'pick' ? ' active' : ''}`} disabled={scanBusy || !scanDocument} onClick={() => setChapterScope('pick')}>{t('选章')}</button>
              </div>
              <p className="hint">{scanDocument
                ? t('本次范围：{count} / {total} 章', { count: chapterScope === 'all' ? scanDocument.chapters.length : scanChapterIds.length, total: scanDocument.chapters.length })
                : t('正在载入章节…')}</p>
              {chapterScope === 'pick' && scanDocument && (
                <div className="empty-scan-chapters" data-testid="empty-scan-chapters">
                  <button type="button" className="quiet small" disabled={scanBusy} onClick={() => setScanChapterIds(scanDocument.chapters.map(c => c.id))}>{t('全选')}</button>
                  {scanDocument.chapters.map(c => (
                    <label className="check-label" key={c.id}>
                      <input type="checkbox" checked={scanChapterIds.includes(c.id)} disabled={scanBusy} onChange={e => setScanChapterIds(ids => e.target.checked ? [...ids, c.id] : ids.filter(id => id !== c.id))} />
                      {c.index + 1}. {c.title}
                    </label>
                  ))}
                </div>
              )}
            </div>
            <p className="hint">{t('留在画布即可按粒度扫描原作；骨架生成后落到此处。之后可对任一节点「延申节点」。当前：{depth}', { depth: scanDepth === 'coarse' ? t('粗') : scanDepth === 'fine' ? t('细') : t('中') })}</p>
            {!runtime.providerConfigured && (
              <p className="hint">{t('尚未配置模型服务。')}{onConfigure && <> <button type="button" className="quiet small" onClick={onConfigure}>{t('前往模型设置 →')}</button></>}</p>
            )}
            <div className="empty-scan-actions">
              <button type="button" className="small primary" data-testid="empty-scan-start" disabled={scanBusy || !sourceId || !scanDocument || !runtime.providerConfigured || !!generationJob && (generationJob.status === 'queued' || generationJob.status === 'running')} onClick={() => void startCanvasScan()}>
                {t(scanBusy ? '正在提交扫描…' : (generationJob && (generationJob.status === 'queued' || generationJob.status === 'running') ? '扫描进行中…' : '按此粒度扫描生成'))}
              </button>
              {onOpenGeneration && <button type="button" className="quiet small" disabled={scanBusy} onClick={onOpenGeneration}>{t('更多选项 →')}</button>}
            </div>
          </div>
        )}
<BranchGraphCanvas
            primary
            content={canvasGraphContent}
            selectedSceneId={skeletonPlaceholder ? undefined : (canvasMode === 'play' ? (playSession?.scene.id) : (inspectorOpen ? scene?.id : undefined))}
            selectedSceneIds={skeletonPlaceholder || canvasMode === 'play' ? undefined : selectedSceneIds}
            onSelectScene={skeletonPlaceholder || canvasMode === 'play' ? (() => {}) : selectScene}
            onClearSelection={skeletonPlaceholder || canvasMode === 'play' ? undefined : clearMultiSelection}
            onAddScene={skeletonPlaceholder || canvasMode === 'play' ? undefined : addScene}
            onLayoutChange={skeletonPlaceholder || canvasMode === 'play' ? undefined : updateLayout}
            onConnectScenes={skeletonPlaceholder || canvasMode === 'play' ? undefined : connectScenes}
            onDisconnectEdge={skeletonPlaceholder || canvasMode === 'play' ? undefined : disconnectEdge}
            playabilityMode={skeletonPlaceholder ? 'skeleton' : 'publish'}
            playOverlay={canvasMode === 'play' ? playOverlay : null}
            readOnly={skeletonPlaceholder || canvasMode === 'play'}
            skeletonPlaceholder={skeletonPlaceholder}
            onExtendScene={skeletonPlaceholder || canvasMode === 'play' || !draft || dirty ? undefined : extendSelectedScene}
            extendBusy={extendBusy}
            extendNeighborCount={extendNeighborCount}
            onExtendNeighborCountChange={setExtendNeighborCount}
            onExtendAgain={skeletonPlaceholder || canvasMode === 'play' || !draft || dirty || !lastExtendSummary?.leafId ? undefined : extendAgainFromLeaf}
            extendAgainTargetId={lastExtendSummary?.leafId ?? null}
            lastExtendSummary={lastExtendSummary}
            onBatchExtendLeaves={skeletonPlaceholder || canvasMode === 'play' || !draft || dirty ? undefined : () => void extendAllLeavesBatch()}
            onExtendSelectedScenes={skeletonPlaceholder || canvasMode === 'play' || !draft || dirty ? undefined : () => void extendSelectedScenesBatch()}
            onCancelExtend={extendBusy ? cancelExtendRun : undefined}
            batchExtendProgress={batchExtendProgress}
            leafCount={leafCount}
            showExtendGuide={showExtendGuide && !skeletonPlaceholder && canvasMode === 'edit' && !!draft && content.scenes.length > 0}
            onDismissExtendGuide={onDismissExtendGuide}
            focusSceneIds={focusSceneIds}
            focusNonce={focusNonce}
            generationJob={canvasMode === 'edit' ? generationJob : null}
            onOpenGenerationDraft={generationJob?.draftId ? (() => select(generationJob.draftId!)) : undefined}
            onWatchGeneration={onOpenGeneration}
          />
          {canvasMode === 'play' ? (
            <aside className="draft-inspector play-inspector" aria-label={t('试玩面板')} data-testid="draft-play-inspector">
              <div className="draft-inspector-header">
                <strong>{t('试玩')}</strong>
                <button type="button" className="quiet small" onClick={() => setCanvasMode('edit')}>{t('返回编辑')}</button>
              </div>
              <div className="draft-inspector-body stack">
                {!latestRevision ? <Empty>{t('请先发布一个版本，再在画布上试玩。')}</Empty>
                  : playBusy && !playSession ? <p role="status">{t('正在准备试玩…')}</p>
                  : !playSession ? <Empty>{t('尚未打开存档。')}</Empty>
                  : <>
                    <p className="hint">{t('发布版本 v{version} · 第 {turn} 幕', { version: latestRevision.version, turn: playSession.turn + 1 })}</p>
                    <h4>{playSession.scene.title}</h4>
                    {proposeNote && <Notice kind="success" text={proposeNote} />}
                    <div className="reader-text">{playSession.scene.text.split(/\n+/).map((text, i) => <p key={i}>{text}</p>)}</div>
                    {Object.keys(playSession.variables ?? {}).length > 0 && <details open><summary>{t('当前故事变量')}</summary><dl>{Object.entries(playSession.variables ?? {}).map(([name, value]) => <div className="field-row" key={name}><dt>{name}</dt><dd>{typeof value === 'boolean' ? t(value ? '真' : '假') : String(value)}</dd></div>)}</dl></details>}
                    {playSession.ended && <div className="ending"><p className="eyebrow">{t('故事抵达了一个结局')}</p><p>{playSession.scene.ending ?? t('旅程告一段落。')}</p></div>}
                    {!playSession.ended && <div className="reader-choices"><p className="eyebrow">{t('你将如何选择？')}</p>{playSession.scene.choices.map((choice, i) => <button key={choice.id} type="button" disabled={playBusy} onClick={() => void actOnCanvas(choice.id)}><span aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>{choice.label}<span aria-hidden="true">→</span></button>)}</div>}
                    {!playSession.ended && <ProposeActBox disabled={playBusy} busy={playBusy} onPropose={proposeOnCanvas} onPickCandidate={id => void actOnCanvas(id)} />}
                    {onOpenPlay && latestRevision && <button type="button" className="quiet small" onClick={() => onOpenPlay(latestRevision.id)}>{t('在读者席打开 →')}</button>}
                  </>}
              </div>
            </aside>
          ) : inspectorOpen && <aside className="draft-inspector dual-ready" aria-label={t('场景检视器')} data-testid="draft-inspector" data-secondary={inspectorSecondary}>
            <div className="draft-inspector-header">
              <div className="draft-inspector-tabs">
                <button type="button" className={inspectorTab === 'scene' ? 'active' : ''} onClick={() => openInspector('scene')}>{t('场景')}</button>
                <button type="button" className={inspectorTab === 'variables' ? 'active' : (inspectorSecondary === 'variables' ? 'paired' : '')} onClick={() => openInspector('variables')}>{t('变量')}</button>
                <button type="button" className={inspectorTab === 'worldbook' ? 'active' : (inspectorSecondary === 'worldbook' ? 'paired' : '')} data-testid="inspector-worldbook-tab" onClick={() => openInspector('worldbook')}>{t('世界书')}</button>
                <button type="button" className={inspectorTab === 'meta' ? 'active' : (inspectorSecondary === 'meta' ? 'paired' : '')} onClick={() => openInspector('meta')}>{t('信息')}</button>
              </div>
              <button type="button" className="quiet small" onClick={() => setInspectorOpen(false)} aria-label={t('关闭侧栏')}>{t('关闭')}</button>
            </div>
            <div className="draft-inspector-body" data-active-tab={inspectorTab}>
              <div className={`draft-inspector-pane pane-scene${inspectorTab === 'scene' ? ' is-active' : ''}`} data-pane="scene">
                <p className="draft-inspector-pane-label">{t('场景')}</p>
                {scene
                  ? <SceneEditor key={scene.id} scene={scene} scenes={content.scenes} variables={content.variables} update={value => change({ ...content, scenes: content.scenes.map((s, i) => i === sceneIndex ? value : s) })} remove={() => { change({ ...content, scenes: content.scenes.filter((_, i) => i !== sceneIndex) }); setSceneIndex(Math.max(0, sceneIndex - 1)); setInspectorOpen(false); }} />
                  : <Empty>{t('在画布上点击一个节点，或添加场景。')}</Empty>}
              </div>
              <div className={`draft-inspector-pane pane-secondary${inspectorTab !== 'scene' ? ' is-active' : ''}`} data-pane={inspectorSecondary}>
                <p className="draft-inspector-pane-label">{t(inspectorSecondary === 'variables' ? '变量' : inspectorSecondary === 'worldbook' ? '世界书' : '信息')}</p>
                {inspectorSecondary === 'variables' && <StoryVariablesEditor key={draft?.id ?? 'new'} content={content} update={change} />}
                {inspectorSecondary === 'worldbook' && <WorldbookEditor key={draft?.id ?? 'new-wb'}
                  worldbook={content.worldbook}
                  onChange={wb => change({ ...content, worldbook: wb })}
                  numericNames={Object.keys(content.variables ?? {}).filter(name => typeof content.variables![name] === 'number')}
                  places={content.scenes.map(s => ({ id: s.id, title: s.title || s.id }))}
                  placeScopeType="scenes"
                />}
                {inspectorSecondary === 'meta' && <div className="stack draft-inspector-meta">
                  <label>{t('游戏标题')}<input value={content.title} maxLength={200} onChange={e => change({ ...content, title: e.target.value })} /></label>
                  <label>{t('起始场景')}<select value={content.startSceneId} onChange={e => change({ ...content, startSceneId: e.target.value })}><option value="">{t('选择故事入口')}</option>{content.scenes.map((s, i) => <option key={i} value={s.id}>{s.title || s.id}</option>)}</select></label>
                  <label>{t('故事前提')}<textarea rows={4} maxLength={4000} value={content.premise} onChange={e => change({ ...content, premise: e.target.value })} /></label>
                  <label>{t('改编说明')}<textarea rows={3} maxLength={4000} value={content.adaptationNotes} onChange={e => change({ ...content, adaptationNotes: e.target.value })} /></label>
                </div>}
              </div>
            </div>
          </aside>}
        </div>
      </>}
      <div className="editor-footer"><button type="submit" className="primary" disabled={busy || conflict || jsonMode || canvasMode === 'play' || (!dirty && !!draft)}>{t(busy ? '处理中…' : draft ? '保存草稿' : '创建草稿')}</button><button type="button" disabled={busy || dirty || conflict || jsonMode || canvasMode === 'play' || !draft} onClick={validate}>{t('校验故事')}</button><button type="button" disabled={busy || dirty || conflict || jsonMode || canvasMode === 'play' || !draft || !validation?.valid} onClick={publish}>{t('发布并试玩 →')}</button><span className="hint">{t('先保存，再校验，最后发布。')}</span></div>
      {validation && <div className="validation"><Notice kind={validation.valid ? 'success' : 'error'} text={t(validation.valid ? '校验通过，可以发布。发布版本内容固定，后续修改请重新发布。' : '校验未通过，请修正以下问题。')} />{validation.errors.length > 0 && <ul>{validation.errors.map((text, i) => <li key={i}>{text}</li>)}</ul>}{validation.warnings.length > 0 && <><h4>{t('提醒')}</h4><ul>{validation.warnings.map((text, i) => <li key={i}>{text}</li>)}</ul></>}</div>}
    </fieldset></form>}
  </section>;
}
