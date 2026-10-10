import { useEffect, useState } from 'react';
import { gameContentSchema, type Draft, type GameContent, type GameRevision, type SourceSummary, type ValidationResult } from '@novel-game/contracts';
import { errorMessage, request, RequestError } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { Empty, Notice } from './Notice';
import { SceneEditor } from './SceneEditor';
import { StoryVariablesEditor } from './StoryVariablesEditor';

const blankContent = (): GameContent => ({ title: '', mode: 'story', premise: '', adaptationNotes: '', startSceneId: '', scenes: [] });
interface Props { token: string; drafts: Draft[]; sources: SourceSummary[]; selectedId: string; select: (id: string) => void; refresh: () => Promise<void>; onPublished: (revision: GameRevision) => void }

export function DraftPanel({ token, drafts, sources, selectedId, select, refresh, onPublished }: Props) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [content, setContent] = useState<GameContent>(blankContent);
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? '');
  const [sceneIndex, setSceneIndex] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [jsonMode, setJsonMode] = useState(false);
  const [jsonText, setJsonText] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    setDraft(null); setDirty(false); setConflict(false); setValidation(null); setError(null); setMessage(null); setJsonMode(false); setSceneIndex(0);
    if (!selectedId) { setContent(blankContent()); return; }
    setBusy(true);
    request<Draft>(token, `/drafts/${selectedId}`).then(value => {
      if (active) { setDraft(value); setContent(value.content); setSourceId(value.sourceId); }
    }).catch(e => { if (active) setError(errorMessage(e)); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [selectedId, token, reload]);
  function change(next: GameContent) { setContent(next); setDirty(true); setValidation(null); setMessage(null); }
  function applyJson() {
    try {
      const result = gameContentSchema.safeParse(JSON.parse(jsonText));
      if (!result.success) { setError(result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('\n')); return; }
      change(result.data); setJsonMode(false); setSceneIndex(0); setError(null);
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
  const scene = content.scenes[sceneIndex];
  return <section className="work-section">
    <div className="section-heading"><div><p className="eyebrow">{t('03 / 分支校样')}</p><h2>{t('每个选择，都有去处')}</h2><p>{t('编辑故事、核对证据与连线，发布一个可试玩的固定版本。')}</p></div><span className="edition">STORY PROOF</span></div>
    <div className="draft-toolbar panel"><label>{t('打开草稿')}<select value={selectedId} disabled={dirty || busy || jsonMode} onChange={e => select(e.target.value)}><option value="">{t('新建手动草稿')}</option>{drafts.map(d => <option key={d.id} value={d.id}>{d.content.title} · v{d.version}</option>)}</select></label><span className="hint">{draft ? t('当前 v{version}', { version: draft.version }) : t('手动创作')}{dirty || jsonMode ? t(' · 有未保存编辑') : ''}</span>{(dirty || conflict || jsonMode) && <button onClick={() => setReload(v => v + 1)} disabled={busy}>{t('放弃编辑并重新载入')}</button>}</div>
    <Notice text={error} /><Notice kind="success" text={message} />
    {conflict && <Notice text={t('草稿版本发生冲突，当前内容没有覆盖服务端。请先复制需要保留的内容，再点击“放弃编辑并重新载入”，基于最新版本重新编辑。')} />}
    {dirty && <p className="hint">{t('请先保存或放弃当前编辑，再切换草稿。')}</p>}
    {selectedId && !draft ? <div className="panel">{busy ? <p role="status">{t('正在打开草稿…')}</p> : <><Empty>{t('草稿未能打开。请重新载入后继续编辑。')}</Empty><button onClick={() => setReload(v => v + 1)}>{t('重新载入草稿')}</button></>}</div> : <form className="panel draft-editor" onChange={() => { setDirty(true); setValidation(null); setMessage(null); }} onSubmit={e => { e.preventDefault(); void save(); }}><fieldset className="editor-body" disabled={busy}>
      {!draft && <label>{t('所属原作')}<select value={sourceId} onChange={e => { setSourceId(e.target.value); setDirty(true); }}><option value="">{t('选择原作')}</option>{sources.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}</select></label>}
      <div className="panel-heading"><h3>{t(draft ? '编辑草稿' : '建立手动草稿')}</h3><button type="button" className="small" disabled={busy} onClick={() => { if (jsonMode) applyJson(); else { setJsonText(JSON.stringify(content, null, 2)); setJsonMode(true); } }}>{t(jsonMode ? '应用 JSON 到编辑器' : '高级 JSON 编辑')}</button></div>
      {jsonMode ? <><label>GameContent JSON<textarea className="json-editor" rows={28} value={jsonText} onChange={e => setJsonText(e.target.value)} spellCheck={false} /></label><p className="hint">{t('应用后仍需保存草稿。JSON 必须符合 GameContent，模式只能为 story。')}</p></> : <>
        <div className="field-row"><label>{t('游戏标题')}<input value={content.title} maxLength={200} onChange={e => change({ ...content, title: e.target.value })} /></label><label>{t('起始场景')}<select value={content.startSceneId} onChange={e => change({ ...content, startSceneId: e.target.value })}><option value="">{t('选择故事入口')}</option>{content.scenes.map((s, i) => <option key={i} value={s.id}>{s.title || s.id}</option>)}</select></label></div>
        <label>{t('故事前提')}<textarea rows={3} maxLength={4000} value={content.premise} onChange={e => change({ ...content, premise: e.target.value })} /></label>
        <label>{t('改编说明')}<textarea rows={2} maxLength={4000} value={content.adaptationNotes} onChange={e => change({ ...content, adaptationNotes: e.target.value })} /></label>
        <StoryVariablesEditor key={draft?.id ?? 'new'} content={content} update={change} />
        <div className="scene-layout"><aside className="scene-nav"><div className="panel-heading"><h4>{t('场景')} <small>{content.scenes.length}</small></h4><button type="button" className="small" disabled={content.scenes.length >= 100} onClick={() => { change({ ...content, scenes: [...content.scenes, { id: `scene-${crypto.randomUUID().slice(0, 8)}`, title: '', text: '', origin: 'adapted', evidence: [], choices: [] }] }); setSceneIndex(content.scenes.length); }}>{t('＋ 添加')}</button></div><ol>{content.scenes.map((s, i) => <li key={i}><button type="button" className={`list-button ${i === sceneIndex ? 'selected' : ''}`} onClick={() => setSceneIndex(i)}><strong>{s.title || t('未命名场景')}</strong><small>{s.id === content.startSceneId ? t('入口 · ') : ''}{s.ending ? t('结局') : t('{count} 个选择', { count: s.choices.length })}</small></button></li>)}</ol></aside><div>{scene ? <SceneEditor key={sceneIndex} scene={scene} scenes={content.scenes} variables={content.variables} update={value => change({ ...content, scenes: content.scenes.map((s, i) => i === sceneIndex ? value : s) })} remove={() => { change({ ...content, scenes: content.scenes.filter((_, i) => i !== sceneIndex) }); setSceneIndex(Math.max(0, sceneIndex - 1)); }} /> : <Empty>{t('添加场景开始写作。至少需要三个场景，并设置可到达的结局。')}</Empty>}</div></div>
      </>}
      <div className="editor-footer"><button type="submit" className="primary" disabled={busy || conflict || jsonMode || (!dirty && !!draft)}>{t(busy ? '处理中…' : draft ? '保存草稿' : '创建草稿')}</button><button type="button" disabled={busy || dirty || conflict || jsonMode || !draft} onClick={validate}>{t('校验故事')}</button><button type="button" disabled={busy || dirty || conflict || jsonMode || !draft || !validation?.valid} onClick={publish}>{t('发布并试玩 →')}</button><span className="hint">{t('先保存，再校验，最后发布。')}</span></div>
      {validation && <div className="validation"><Notice kind={validation.valid ? 'success' : 'error'} text={t(validation.valid ? '校验通过，可以发布。发布版本内容固定，后续修改请重新发布。' : '校验未通过，请修正以下问题。')} />{validation.errors.length > 0 && <ul>{validation.errors.map((text, i) => <li key={i}>{text}</li>)}</ul>}{validation.warnings.length > 0 && <><h4>{t('提醒')}</h4><ul>{validation.warnings.map((text, i) => <li key={i}>{text}</li>)}</ul></>}</div>}
    </fieldset></form>}
  </section>;
}
