import { useEffect, useMemo, useRef, useState } from 'react';
import { gameContentSchema, type CanvasLayout, type Draft, type GameContent, type GameRevision, type GenerationJob, type SessionView, type SourceSummary, type ValidationResult } from '@novel-game/contracts';
import { errorMessage, request, RequestError } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { relevantStoryJob } from '../lib/job-on-canvas';
import { playOverlayFromSession } from '../lib/play-overlay';
import { Empty, Notice } from './Notice';
import { BranchGraphCanvas } from './BranchGraphCanvas';
import { SceneEditor } from './SceneEditor';
import { StoryVariablesEditor } from './StoryVariablesEditor';

const blankContent = (): GameContent => ({ title: '', mode: 'story', premise: '', adaptationNotes: '', startSceneId: '', scenes: [] });
interface Props {
  token: string; drafts: Draft[]; sources: SourceSummary[];
  revisions: GameRevision[]; sessions: SessionView[];
  jobs: GenerationJob[];
  selectedId: string; select: (id: string) => void; refresh: () => Promise<void>;
  onPublished: (revision: GameRevision) => void;
  onOpenPlay?: (revisionId: string) => void;
  onOpenGeneration?: () => void;
}

export function DraftPanel({ token, drafts, sources, revisions, sessions, jobs, selectedId, select, refresh, onPublished, onOpenPlay, onOpenGeneration }: Props) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [content, setContent] = useState<GameContent>(blankContent);
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? '');
  const [sceneIndex, setSceneIndex] = useState(0);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<'scene' | 'meta' | 'variables'>('scene');
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
  useEffect(() => {
    let active = true;
    setDraft(null); setDirty(false); setConflict(false); setValidation(null); setError(null); setMessage(null); setJsonMode(false); setSceneIndex(0); setInspectorOpen(false); setInspectorTab('scene'); setCanvasMode('edit'); setPlaySession(null);
    if (!selectedId) { setContent(blankContent()); return; }
    setBusy(true);
    request<Draft>(token, `/drafts/${selectedId}`).then(value => {
      if (active) { setDraft(value); setContent(value.content); setSourceId(value.sourceId); }
    }).catch(e => { if (active) setError(errorMessage(e)); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [selectedId, token, reload]);
  function change(next: GameContent) { setContent(next); setDirty(true); setValidation(null); setMessage(null); }
  function selectScene(id: string) {
    const index = content.scenes.findIndex(s => s.id === id);
    if (index < 0) return;
    setSceneIndex(index);
    setInspectorTab('scene');
    setInspectorOpen(true);
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
    setInspectorTab('scene');
    setInspectorOpen(true);
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
    if (index >= 0) { setSceneIndex(index); setInspectorTab('scene'); setInspectorOpen(true); }
  }
  function disconnectEdge(fromId: string, choiceId: string) {
    const scenes = content.scenes.map(scene => {
      if (scene.id !== fromId) return scene;
      return { ...scene, choices: scene.choices.filter(choice => choice.id !== choiceId) };
    });
    change({ ...content, scenes });
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

  const scene = content.scenes[sceneIndex];
  return <section className="work-section draft-workspace">
    <div className="section-heading"><div><p className="eyebrow">{t('05 / 分支草稿')}</p><h2>{t('无限画布工作台')}</h2><p>{t('分支图是主操作面：编辑与试玩可在同一画布切换；侧栏写场景，试玩时高亮路径。')}</p></div><span className="edition">CANVAS FIRST</span></div>
    <div className="draft-toolbar panel"><label>{t('打开草稿')}<select value={selectedId} disabled={dirty || busy || jsonMode} onChange={e => select(e.target.value)}><option value="">{t('新建手动草稿')}</option>{drafts.map(d => <option key={d.id} value={d.id}>{d.content.title} · v{d.version}</option>)}</select></label><span className="hint">{draft ? t('当前 v{version}', { version: draft.version }) : t('手动创作')}{dirty || jsonMode ? t(' · 有未保存编辑') : ''}</span>{(dirty || conflict || jsonMode) && <button onClick={() => setReload(v => v + 1)} disabled={busy}>{t('放弃编辑并重新载入')}</button>}</div>
    <Notice text={error} /><Notice kind="success" text={message} />
    {conflict && <Notice text={t('草稿版本发生冲突，当前内容没有覆盖服务端。请先复制需要保留的内容，再点击“放弃编辑并重新载入”，基于最新版本重新编辑。')} />}
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
          <button type="button" className="small" disabled={busy || canvasMode === 'play'} onClick={() => { setInspectorTab('variables'); setInspectorOpen(true); }}>{t('变量')}</button>
          <button type="button" className="small" disabled={busy || canvasMode === 'play'} onClick={() => { if (jsonMode) applyJson(); else { setJsonText(JSON.stringify(content, null, 2)); setJsonMode(true); } }}>{t(jsonMode ? '应用 JSON 到编辑器' : '高级 JSON')}</button>
        </div>
      </div>
      {jsonMode ? <><label>GameContent JSON<textarea className="json-editor" rows={28} value={jsonText} onChange={e => setJsonText(e.target.value)} spellCheck={false} /></label><p className="hint">{t('应用后仍需保存草稿。JSON 必须符合 GameContent，模式只能为 story。')}</p></> : <>
        {metaOpen && <div className="draft-meta-strip">
          <div className="field-row"><label>{t('游戏标题')}<input value={content.title} maxLength={200} onChange={e => change({ ...content, title: e.target.value })} /></label><label>{t('起始场景')}<select value={content.startSceneId} onChange={e => change({ ...content, startSceneId: e.target.value })}><option value="">{t('选择故事入口')}</option>{content.scenes.map((s, i) => <option key={i} value={s.id}>{s.title || s.id}</option>)}</select></label></div>
          <label>{t('故事前提')}<textarea rows={2} maxLength={4000} value={content.premise} onChange={e => change({ ...content, premise: e.target.value })} /></label>
          <label>{t('改编说明')}<textarea rows={2} maxLength={4000} value={content.adaptationNotes} onChange={e => change({ ...content, adaptationNotes: e.target.value })} /></label>
        </div>}
        <div className={`draft-canvas-stage${(inspectorOpen || canvasMode === 'play') ? ' with-inspector' : ''}${canvasMode === 'play' ? ' play-mode' : ''}`}>
          <BranchGraphCanvas
            primary
            content={canvasMode === 'play' && latestRevision ? latestRevision.content : content}
            selectedSceneId={canvasMode === 'play' ? (playSession?.scene.id) : (inspectorOpen ? scene?.id : undefined)}
            onSelectScene={canvasMode === 'play' ? (() => {}) : selectScene}
            onAddScene={canvasMode === 'play' ? undefined : addScene}
            onLayoutChange={canvasMode === 'play' ? undefined : updateLayout}
            onConnectScenes={canvasMode === 'play' ? undefined : connectScenes}
            onDisconnectEdge={canvasMode === 'play' ? undefined : disconnectEdge}
            playabilityMode="publish"
            playOverlay={canvasMode === 'play' ? playOverlay : null}
            readOnly={canvasMode === 'play'}
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
                    <div className="reader-text">{playSession.scene.text.split(/\n+/).map((text, i) => <p key={i}>{text}</p>)}</div>
                    {Object.keys(playSession.variables ?? {}).length > 0 && <details open><summary>{t('当前故事变量')}</summary><dl>{Object.entries(playSession.variables ?? {}).map(([name, value]) => <div className="field-row" key={name}><dt>{name}</dt><dd>{typeof value === 'boolean' ? t(value ? '真' : '假') : String(value)}</dd></div>)}</dl></details>}
                    {playSession.ended && <div className="ending"><p className="eyebrow">{t('故事抵达了一个结局')}</p><p>{playSession.scene.ending ?? t('旅程告一段落。')}</p></div>}
                    {!playSession.ended && <div className="reader-choices"><p className="eyebrow">{t('你将如何选择？')}</p>{playSession.scene.choices.map((choice, i) => <button key={choice.id} type="button" disabled={playBusy} onClick={() => void actOnCanvas(choice.id)}><span aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>{choice.label}<span aria-hidden="true">→</span></button>)}</div>}
                    {onOpenPlay && latestRevision && <button type="button" className="quiet small" onClick={() => onOpenPlay(latestRevision.id)}>{t('在读者席打开 →')}</button>}
                  </>}
              </div>
            </aside>
          ) : inspectorOpen && <aside className="draft-inspector" aria-label={t('场景检视器')}>
            <div className="draft-inspector-header">
              <div className="draft-inspector-tabs">
                <button type="button" className={inspectorTab === 'scene' ? 'active' : ''} onClick={() => setInspectorTab('scene')}>{t('场景')}</button>
                <button type="button" className={inspectorTab === 'variables' ? 'active' : ''} onClick={() => setInspectorTab('variables')}>{t('变量')}</button>
                <button type="button" className={inspectorTab === 'meta' ? 'active' : ''} onClick={() => setInspectorTab('meta')}>{t('信息')}</button>
              </div>
              <button type="button" className="quiet small" onClick={() => setInspectorOpen(false)} aria-label={t('关闭侧栏')}>{t('关闭')}</button>
            </div>
            <div className="draft-inspector-body">
              {inspectorTab === 'scene' && (scene
                ? <SceneEditor key={scene.id} scene={scene} scenes={content.scenes} variables={content.variables} update={value => change({ ...content, scenes: content.scenes.map((s, i) => i === sceneIndex ? value : s) })} remove={() => { change({ ...content, scenes: content.scenes.filter((_, i) => i !== sceneIndex) }); setSceneIndex(Math.max(0, sceneIndex - 1)); setInspectorOpen(false); }} />
                : <Empty>{t('在画布上点击一个节点，或添加场景。')}</Empty>)}
              {inspectorTab === 'variables' && <StoryVariablesEditor key={draft?.id ?? 'new'} content={content} update={change} />}
              {inspectorTab === 'meta' && <div className="stack draft-inspector-meta">
                <label>{t('游戏标题')}<input value={content.title} maxLength={200} onChange={e => change({ ...content, title: e.target.value })} /></label>
                <label>{t('起始场景')}<select value={content.startSceneId} onChange={e => change({ ...content, startSceneId: e.target.value })}><option value="">{t('选择故事入口')}</option>{content.scenes.map((s, i) => <option key={i} value={s.id}>{s.title || s.id}</option>)}</select></label>
                <label>{t('故事前提')}<textarea rows={4} maxLength={4000} value={content.premise} onChange={e => change({ ...content, premise: e.target.value })} /></label>
                <label>{t('改编说明')}<textarea rows={3} maxLength={4000} value={content.adaptationNotes} onChange={e => change({ ...content, adaptationNotes: e.target.value })} /></label>
              </div>}
            </div>
          </aside>}
        </div>
      </>}
      <div className="editor-footer"><button type="submit" className="primary" disabled={busy || conflict || jsonMode || canvasMode === 'play' || (!dirty && !!draft)}>{t(busy ? '处理中…' : draft ? '保存草稿' : '创建草稿')}</button><button type="button" disabled={busy || dirty || conflict || jsonMode || canvasMode === 'play' || !draft} onClick={validate}>{t('校验故事')}</button><button type="button" disabled={busy || dirty || conflict || jsonMode || canvasMode === 'play' || !draft || !validation?.valid} onClick={publish}>{t('发布并试玩 →')}</button><span className="hint">{t('先保存，再校验，最后发布。')}</span></div>
      {validation && <div className="validation"><Notice kind={validation.valid ? 'success' : 'error'} text={t(validation.valid ? '校验通过，可以发布。发布版本内容固定，后续修改请重新发布。' : '校验未通过，请修正以下问题。')} />{validation.errors.length > 0 && <ul>{validation.errors.map((text, i) => <li key={i}>{text}</li>)}</ul>}{validation.warnings.length > 0 && <><h4>{t('提醒')}</h4><ul>{validation.warnings.map((text, i) => <li key={i}>{text}</li>)}</ul></>}</div>}
    </fieldset></form>}
  </section>;
}
