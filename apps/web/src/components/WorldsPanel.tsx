import { useEffect, useMemo, useState } from 'react';
import { worldContentSchema, type AdventureView, type CanvasLayout, type SourceSummary, type WorldContent, type WorldDraft, type WorldRevision, type ValidationResult } from '@novel-game/contracts';
import { request, RequestError, errorMessage } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { openingActionDensity } from '../lib/world-graph';
import { useWorldCanvasPlay } from '../hooks/useWorldCanvasPlay';
import { Notice, Empty } from './Notice';
import { WorldGraphCanvas } from './WorldGraphCanvas';
import { WorldOverview } from './WorldOverview';
import { WorldbookEditor } from './WorldbookEditor';
import { WorldPlayInspector } from './play/WorldPlayInspector';

const blank = (): WorldContent => ({
  schemaVersion: 1, mode: 'open', title: '', premise: '', playerRole: '', goal: '', worldRules: [''],
  adaptationNotes: '', sourceChapterIds: [], initialLocationId: '', timeLimit: 12, timeoutEnding: '',
  locations: [], facts: [], npcs: [], actions: [], events: [], endings: [],
});

interface Props {
  token: string; drafts: WorldDraft[]; sources: SourceSummary[];
  revisions: WorldRevision[]; adventures: AdventureView[];
  selectedId: string;
  select: (id: string) => void; refresh: () => Promise<void>;
  onPublished: (r: WorldRevision) => void; onDirtyChange: (dirty: boolean) => void;
  onOpenAdventure?: (revisionId: string) => void;
}

export function WorldsPanel({
  token, drafts, sources, revisions, adventures, selectedId, select, refresh, onPublished, onDirtyChange, onOpenAdventure,
}: Props) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<WorldDraft | null>(null);
  const [content, setContent] = useState<WorldContent>(blank);
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? '');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [json, setJson] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<number | null>(null);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [conflict, setConflict] = useState(false);
  const [reload, setReload] = useState(0);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<'location' | 'meta' | 'all' | 'worldbook'>('location');
  const [selectedLocationId, setSelectedLocationId] = useState<string | undefined>();
  const [metaOpen, setMetaOpen] = useState(false);
  const [canvasMode, setCanvasMode] = useState<'edit' | 'play'>('edit');

  useEffect(() => { onDirtyChange(dirty || json !== null); }, [dirty, json, onDirtyChange]);
  useEffect(() => {
    let active = true;
    setDraft(null); setContent(blank()); setDirty(false); setJson(null); setValidation(null);
    setError(null); setMessage(null); setConflict(false); setInspectorOpen(false);
    setSelectedLocationId(undefined); setInspectorTab('location'); setMetaOpen(false);
    setCanvasMode('edit');
    if (!selectedId) return;
    setBusy(true);
    request<WorldDraft>(token, `/worlds/drafts/${selectedId}`).then(d => {
      if (active) {
        setDraft(d); setContent(d.content); setSourceId(d.sourceId);
        setSelectedLocationId(d.content.initialLocationId || d.content.locations[0]?.id);
      }
    }).catch(e => { if (active) setError(errorMessage(e)); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [selectedId, token, reload]);
  useEffect(() => {
    if (!dirty && json === null) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, json]);

  const density = useMemo(() => openingActionDensity(content), [content]);
  const canvasWarnings = useMemo(() => {
    const fromValidation = [
      ...(validation?.errors?.filter(w => /开局可执行|开局行动密度|availableWhen/.test(w)) ?? []),
      ...(validation?.warnings?.filter(w => /开局可执行|开局行动密度|availableWhen/.test(w)) ?? []),
    ];
    const note = density.error ?? density.warning;
    if (note && !fromValidation.includes(note)) return [note, ...fromValidation];
    return fromValidation;
  }, [validation, density]);

  const linkedRevisions = useMemo(
    () => (draft ? revisions.filter(r => r.draftId === draft.id).sort((a, b) => b.version - a.version) : []),
    [draft, revisions],
  );
  const latestRevision = linkedRevisions[0] ?? null;
  const linkedAdventures = useMemo(() => {
    if (!latestRevision) return [] as AdventureView[];
    return adventures.filter(a => a.worldRevisionId === latestRevision.id).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [adventures, latestRevision]);
  const {
    playSession, playBusy, proposeNote, playOverlay, canPlayOnCanvas,
    actOnCanvas, narrateOnCanvas, proposeOnCanvas, resetPlay,
  } = useWorldCanvasPlay({
    token,
    canvasMode,
    latestRevision,
    linkedAdventures,
    dirty,
    jsonMode: json !== null,
    refresh,
    onError: setError,
  });
  useEffect(() => { resetPlay(); }, [selectedId, resetPlay]);

  function change(next: WorldContent) { setContent(next); setDirty(true); setValidation(null); setMessage(null); }
  function selectLocation(id: string) {
    setSelectedLocationId(id);
    setInspectorTab('location');
    setInspectorOpen(true);
  }
  function updateLayout(layout: CanvasLayout) {
    change({ ...content, canvasLayout: layout });
  }
  function apply() {
    try {
      const parsed = worldContentSchema.parse(JSON.parse(json ?? ''));
      change(parsed); setJson(null); setError(null);
      setSelectedLocationId(parsed.initialLocationId || parsed.locations[0]?.id);
    } catch (e) { setError(errorMessage(e)); }
  }
  async function operate(kind: 'save' | 'validate' | 'publish') {
    setBusy(true); setError(null); setMessage(null);
    try {
      if (kind === 'save') {
        if (!sourceId) throw new Error('请选择所属原作。');
        const parsed = worldContentSchema.parse(content);
        const saved = draft
          ? await request<WorldDraft>(token, `/worlds/drafts/${draft.id}`, 'PUT', { version: draft.version, content: parsed })
          : await request<WorldDraft>(token, '/worlds/drafts', 'POST', { sourceId, content: parsed });
        setDraft(saved); setContent(saved.content); setDirty(false); setValidation(null); setMessage(saved.version);
        await refresh(); if (!selectedId) select(saved.id);
      } else if (draft && kind === 'validate') {
        setValidation(await request<ValidationResult>(token, `/worlds/drafts/${draft.id}/validate`, 'POST', {}));
      } else if (draft) {
        const revision = await request<WorldRevision>(token, `/worlds/drafts/${draft.id}/publish`, 'POST', { version: draft.version });
        await refresh(); onPublished(revision);
      }
    } catch (e) {
      setError(errorMessage(e));
      if (e instanceof RequestError && e.status === 409) setConflict(true);
    } finally { setBusy(false); }
  }

  return <section className="work-section draft-workspace world-workspace">
    <div className="section-heading">
      <div>
        <p className="eyebrow">{t('世界校样')}</p>
        <h2>{t('开放世界画布')}</h2>
        <p>{t('地点拓扑是主操作面：编辑与试玩可在同一画布切换；曲边是移动行动，试玩时高亮足迹。')}</p>
      </div>
      <span className="edition">WORLD CANVAS</span>
    </div>
    <div className="panel draft-toolbar">
      <label>{t('打开世界草稿')}
        <select disabled={busy || dirty || json !== null} value={selectedId} onChange={e => select(e.target.value)}>
          <option value="">{t('新建手动世界')}</option>
          {drafts.map(d => <option key={d.id} value={d.id}>{d.content.title} · v{d.version}</option>)}
        </select>
      </label>
      <span className="hint">{dirty || json !== null ? t('有未保存编辑') : draft ? t('当前 v{version}', { version: draft.version }) : t('可通过高级 JSON 粘贴完整世界')}</span>
      {(dirty || json !== null || conflict) && <button disabled={busy} onClick={() => setReload(n => n + 1)}>{t('放弃编辑并重新载入')}</button>}
    </div>
    <Notice text={error} />
    <Notice kind="success" text={message === null ? null : '已保存世界草稿 v{version}'} params={{ version: message ?? '' }} />
    <Notice text={conflict ? t('服务端版本已改变，未覆盖当前内容。请复制需要保留的 JSON 后重新载入。') : null} />
    {selectedId && !draft ? (
      <div className="panel">
        <Empty>{busy ? t('正在打开世界…') : t('无法打开世界，请重新载入。')}</Empty>
        <button disabled={busy} onClick={() => setReload(n => n + 1)}>{t('重新载入')}</button>
      </div>
    ) : (
      <div className="panel draft-editor draft-editor-canvas">
        <fieldset disabled={busy} className="editor-body">
          {!draft && (
            <label>{t('所属原作')}
              <select value={sourceId} onChange={e => { setSourceId(e.target.value); setDirty(true); }}>
                <option value="">{t('选择原作')}</option>
                {sources.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
              </select>
            </label>
          )}
          <div className="panel-heading draft-canvas-actions">
            <h3>{t(draft ? (canvasMode === 'play' ? '画布试玩' : '画布编辑') : '建立手动世界')}</h3>
            <div className="draft-action-cluster">
              {draft && (
                <div className="canvas-mode-toggle" role="group" aria-label={t('画布模式')}>
                  <button type="button" className={`small${canvasMode === 'edit' ? ' active' : ''}`} disabled={busy || playBusy} onClick={() => setCanvasMode('edit')}>{t('编辑')}</button>
                  <button type="button" className={`small${canvasMode === 'play' ? ' active' : ''}`} disabled={busy || playBusy || !canPlayOnCanvas} title={!canPlayOnCanvas ? t('需已发布版本，且无未保存编辑') : undefined} onClick={() => setCanvasMode('play')}>{t('试玩')}</button>
                </div>
              )}
              <button type="button" className="small" disabled={busy || json !== null || canvasMode === 'play'} onClick={() => setMetaOpen(v => !v)}>{t(metaOpen ? '收起世界信息' : '世界信息')}</button>
              <button type="button" className="small" disabled={busy || json !== null || canvasMode === 'play' || !content.locations.length} onClick={() => { setInspectorTab('all'); setInspectorOpen(true); }}>{t('全览')}</button>
              <button type="button" className="small" data-testid="open-worldbook" disabled={busy || json !== null || canvasMode === 'play'} onClick={() => { setInspectorTab('worldbook'); setInspectorOpen(true); }}>{t('世界书')}</button>
              <button type="button" className="small" disabled={busy || canvasMode === 'play'} onClick={() => json === null ? setJson(JSON.stringify(content, null, 2)) : apply()}>{json === null ? t('高级 JSON') : t('应用 JSON 到编辑器')}</button>
            </div>
          </div>
          {json !== null ? (
            <label>WorldContent JSON<textarea className="json-editor" rows={28} value={json} spellCheck={false} onChange={e => setJson(e.target.value)} /></label>
          ) : <>
            {metaOpen && (
              <div className="draft-meta-strip">
                <p className="hint">{t('来源：{source} · 改编范围 {chapters} 章。地点、行动、证据与条件可在高级 JSON 中完整编辑。', { source: sources.find(s => s.id === sourceId)?.title ?? t('尚未选择'), chapters: content.sourceChapterIds.length })}</p>
                <div className="field-row">
                  <label>{t('标题')}<input maxLength={200} value={content.title} onChange={e => change({ ...content, title: e.target.value })} /></label>
                  <label>{t('玩家身份')}<input maxLength={500} value={content.playerRole} onChange={e => change({ ...content, playerRole: e.target.value })} /></label>
                </div>
                <label>{t('前提')}<textarea rows={2} maxLength={4000} value={content.premise} onChange={e => change({ ...content, premise: e.target.value })} /></label>
                <label>{t('玩家目标')}<textarea rows={2} maxLength={1000} value={content.goal} onChange={e => change({ ...content, goal: e.target.value })} /></label>
                <div className="field-row">
                  <label>{t('开局地点')}
                    <select value={content.initialLocationId} onChange={e => change({ ...content, initialLocationId: e.target.value })}>
                      <option value="">{t('选择地点')}</option>
                      {content.locations.map(l => <option key={l.id} value={l.id}>{l.title}</option>)}
                    </select>
                  </label>
                  <label>{t('时间上限')}<input type="number" min={3} max={100} value={content.timeLimit} onChange={e => change({ ...content, timeLimit: Number(e.target.value) })} /></label>
                </div>
                <label>{t('世界规则（每行一条）')}<textarea rows={2} value={content.worldRules.join('\n')} onChange={e => change({ ...content, worldRules: e.target.value.split('\n') })} /></label>
                <label>{t('改编说明')}<textarea rows={2} maxLength={4000} value={content.adaptationNotes} onChange={e => change({ ...content, adaptationNotes: e.target.value })} /></label>
                <label>{t('超时结局')}<textarea rows={2} maxLength={3000} value={content.timeoutEnding} onChange={e => change({ ...content, timeoutEnding: e.target.value })} /></label>
              </div>
            )}
            <div className={`draft-canvas-stage${(inspectorOpen || canvasMode === 'play') ? ' with-inspector' : ''}${canvasMode === 'play' ? ' play-mode' : ''}`} data-testid="world-canvas-stage">
              <WorldGraphCanvas
                primary
                content={canvasMode === 'play' && latestRevision ? latestRevision.content : content}
                selectedLocationId={canvasMode === 'play' ? playSession?.location.id : (inspectorOpen ? selectedLocationId : undefined)}
                onSelectLocation={canvasMode === 'play' ? (() => {}) : selectLocation}
                onLayoutChange={canvasMode === 'play' ? undefined : updateLayout}
                warnings={canvasMode === 'play' ? [] : canvasWarnings}
                playOverlay={canvasMode === 'play' ? playOverlay : null}
                readOnly={canvasMode === 'play'}
              />
              {canvasMode === 'play' ? (
                <WorldPlayInspector
                  latestRevision={latestRevision}
                  playSession={playSession}
                  playBusy={playBusy}
                  proposeNote={proposeNote}
                  onBackEdit={() => setCanvasMode('edit')}
                  onAct={actOnCanvas}
                  onNarrate={narrateOnCanvas}
                  onPropose={proposeOnCanvas}
                  onOpenAdventure={onOpenAdventure}
                />
              ) : inspectorOpen && (
                <aside className="draft-inspector" aria-label={t('地点检视器')} data-testid="world-inspector">
                  <div className="draft-inspector-header">
                    <div className="draft-inspector-tabs">
                      <button type="button" className={inspectorTab === 'location' ? 'active' : ''} onClick={() => setInspectorTab('location')}>{t('地点')}</button>
                      <button type="button" className={inspectorTab === 'meta' ? 'active' : ''} onClick={() => setInspectorTab('meta')}>{t('信息')}</button>
                      <button type="button" className={inspectorTab === 'worldbook' ? 'active' : ''} data-testid="inspector-worldbook-tab" onClick={() => setInspectorTab('worldbook')}>{t('世界书')}</button>
                      <button type="button" className={inspectorTab === 'all' ? 'active' : ''} onClick={() => setInspectorTab('all')}>{t('全览')}</button>
                    </div>
                    <button type="button" className="quiet small" onClick={() => setInspectorOpen(false)} aria-label={t('关闭侧栏')}>{t('关闭')}</button>
                  </div>
                  <div className="draft-inspector-body">
                    {inspectorTab === 'location' && (
                      selectedLocationId
                        ? <WorldOverview content={content} focusLocationId={selectedLocationId} />
                        : <Empty>{t('在画布上点击一个地点节点。')}</Empty>
                    )}
                    {inspectorTab === 'meta' && (
                      <div className="stack draft-inspector-meta">
                        <label>{t('标题')}<input maxLength={200} value={content.title} onChange={e => change({ ...content, title: e.target.value })} /></label>
                        <label>{t('玩家身份')}<input maxLength={500} value={content.playerRole} onChange={e => change({ ...content, playerRole: e.target.value })} /></label>
                        <label>{t('前提')}<textarea rows={3} maxLength={4000} value={content.premise} onChange={e => change({ ...content, premise: e.target.value })} /></label>
                        <label>{t('玩家目标')}<textarea rows={2} maxLength={1000} value={content.goal} onChange={e => change({ ...content, goal: e.target.value })} /></label>
                        <label>{t('开局地点')}
                          <select value={content.initialLocationId} onChange={e => change({ ...content, initialLocationId: e.target.value })}>
                            <option value="">{t('选择地点')}</option>
                            {content.locations.map(l => <option key={l.id} value={l.id}>{l.title}</option>)}
                          </select>
                        </label>
                        <label>{t('时间上限')}<input type="number" min={3} max={100} value={content.timeLimit} onChange={e => change({ ...content, timeLimit: Number(e.target.value) })} /></label>
                      </div>
                    )}
                    {inspectorTab === 'all' && <WorldOverview content={content} />}
                  </div>
                </aside>
              )}
            </div>
          </>}
          <div className="editor-footer">
            <button className="primary" disabled={busy || conflict || json !== null || canvasMode === 'play' || (!!draft && !dirty)} onClick={() => operate('save')}>{t('保存世界草稿')}</button>
            <button disabled={busy || dirty || conflict || json !== null || canvasMode === 'play' || !draft} onClick={() => operate('validate')}>{t('校验世界')}</button>
            <button disabled={busy || dirty || conflict || json !== null || canvasMode === 'play' || !draft || !validation?.valid} onClick={() => operate('publish')}>{t('发布并冒险 →')}</button>
            <span className="hint">{t('先保存，再校验，最后发布。')}</span>
          </div>
          {validation && (
            <div className="validation">
              <Notice kind={validation.valid ? 'success' : 'error'} text={validation.valid ? t('校验通过，可以发布。请确认公开文本没有泄漏隐藏剧情。') : t('校验未通过，请修正。')} />
              {validation.errors.map((e, i) => <p key={i}>{e}</p>)}
              {validation.warnings.map((e, i) => <p className="hint" key={i}>{e}</p>)}
            </div>
          )}
        </fieldset>
      </div>
    )}
  </section>;
}
