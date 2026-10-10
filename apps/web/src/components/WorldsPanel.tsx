import { useEffect, useState } from 'react';
import { worldContentSchema, type SourceSummary, type WorldContent, type WorldDraft, type WorldRevision, type ValidationResult } from '@novel-game/contracts';
import { request, RequestError, errorMessage } from '../lib/api';
import { Notice, Empty } from './Notice';
import { WorldOverview } from './WorldOverview';

const blank = (): WorldContent => ({schemaVersion: 1, mode: 'open', title: '', premise: '', playerRole: '', goal: '', worldRules: [''], adaptationNotes: '', sourceChapterIds: [], initialLocationId: '', timeLimit: 12, timeoutEnding: '', locations: [], facts: [], npcs: [], actions: [], events: [], endings: []});
interface Props {token: string; drafts: WorldDraft[]; sources: SourceSummary[]; selectedId: string; select: (id: string) => void; refresh: () => Promise<void>; onPublished: (r: WorldRevision) => void; onDirtyChange: (dirty: boolean) => void}
export function WorldsPanel({token, drafts, sources, selectedId, select, refresh, onPublished, onDirtyChange}: Props) {
  const [draft, setDraft] = useState<WorldDraft | null>(null);
  const [content, setContent] = useState<WorldContent>(blank);
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? '');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [json, setJson] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [conflict, setConflict] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {onDirtyChange(dirty || json !== null);}, [dirty, json, onDirtyChange]);
  useEffect(() => {
    let active = true; setDraft(null); setContent(blank()); setDirty(false); setJson(null); setValidation(null); setError(null); setMessage(null); setConflict(false);
    if (!selectedId) return;
    setBusy(true); request<WorldDraft>(token, `/worlds/drafts/${selectedId}`).then(d => {if (active) {setDraft(d); setContent(d.content); setSourceId(d.sourceId);}}).catch(e => {if (active) setError(errorMessage(e));}).finally(() => {if (active) setBusy(false);});
    return () => {active = false;};
  }, [selectedId, token, reload]);
  useEffect(() => {
    if (!dirty && json === null) return;
    const warn = (event: BeforeUnloadEvent) => {event.preventDefault(); event.returnValue = '';};
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, json]);
  function change(next: WorldContent) {setContent(next); setDirty(true); setValidation(null); setMessage(null);}
  function apply() {
    try {const parsed = worldContentSchema.parse(JSON.parse(json ?? '')); change(parsed); setJson(null); setError(null);} catch (e) {setError(errorMessage(e));}
  }
  async function operate(kind: 'save' | 'validate' | 'publish') {
    setBusy(true); setError(null); setMessage(null);
    try {
      if (kind === 'save') {
        if (!sourceId) throw new Error('请选择所属原作。');
        const parsed = worldContentSchema.parse(content);
        const saved = draft ? await request<WorldDraft>(token, `/worlds/drafts/${draft.id}`, 'PUT', {version: draft.version, content: parsed}) : await request<WorldDraft>(token, '/worlds/drafts', 'POST', {sourceId, content: parsed});
        setDraft(saved); setContent(saved.content); setDirty(false); setValidation(null); setMessage(`已保存世界草稿 v${saved.version}`); await refresh(); if (!selectedId) select(saved.id);
      } else if (draft && kind === 'validate') setValidation(await request<ValidationResult>(token, `/worlds/drafts/${draft.id}/validate`, 'POST', {}));
      else if (draft) {const revision = await request<WorldRevision>(token, `/worlds/drafts/${draft.id}/publish`, 'POST', {version: draft.version}); await refresh(); onPublished(revision);}
    } catch (e) {setError(errorMessage(e)); if (e instanceof RequestError && e.status === 409) setConflict(true);} finally {setBusy(false);}
  }
  return <section className="work-section"><div className="section-heading"><div><p className="eyebrow">世界校样</p><h2>把世界的规则写清楚</h2><p>审阅开局、知识与行动后果，再发布固定版本。</p></div><span className="edition">WORLD PROOF</span></div>
    <div className="panel draft-toolbar"><label>打开世界草稿<select disabled={busy || dirty || json !== null} value={selectedId} onChange={e => select(e.target.value)}><option value="">新建手动世界</option>{drafts.map(d => <option key={d.id} value={d.id}>{d.content.title} · v{d.version}</option>)}</select></label><span className="hint">{dirty || json !== null ? '有未保存编辑' : draft ? `当前 v${draft.version}` : '可通过高级 JSON 粘贴完整世界'}</span>{(dirty || json !== null || conflict) && <button disabled={busy} onClick={() => setReload(n => n + 1)}>放弃编辑并重新载入</button>}</div>
    <Notice text={error} /><Notice kind="success" text={message} /><Notice text={conflict ? '服务端版本已改变，未覆盖当前内容。请复制需要保留的 JSON 后重新载入。' : null} />
    {selectedId && !draft ? <div className="panel"><Empty>{busy ? '正在打开世界…' : '无法打开世界，请重新载入。'}</Empty><button disabled={busy} onClick={() => setReload(n => n + 1)}>重新载入</button></div> : <div className="panel draft-editor"><fieldset disabled={busy} className="editor-body">
      {!draft && <label>所属原作<select value={sourceId} onChange={e => {setSourceId(e.target.value); setDirty(true);}}><option value="">选择原作</option>{sources.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}</select></label>}
      <div className="panel-heading"><h3>开局与目标</h3><button onClick={() => json === null ? setJson(JSON.stringify(content, null, 2)) : apply()}>{json === null ? '高级 JSON 编辑' : '应用 JSON 到编辑器'}</button></div>
      <p className="hint">来源：{sources.find(s => s.id === sourceId)?.title ?? '尚未选择'} · 改编范围 {content.sourceChapterIds.length} 章。地点、行动、证据与条件可在高级 JSON 中完整编辑。</p>
      {json !== null ? <label>WorldContent JSON<textarea className="json-editor" rows={28} value={json} spellCheck={false} onChange={e => setJson(e.target.value)} /></label> : <>
        <div className="field-row"><label>标题<input maxLength={200} value={content.title} onChange={e => change({...content, title: e.target.value})} /></label><label>玩家身份<input maxLength={500} value={content.playerRole} onChange={e => change({...content, playerRole: e.target.value})} /></label></div>
        <label>前提<textarea rows={3} maxLength={4000} value={content.premise} onChange={e => change({...content, premise: e.target.value})} /></label><label>玩家目标<textarea rows={2} maxLength={1000} value={content.goal} onChange={e => change({...content, goal: e.target.value})} /></label>
        <div className="field-row"><label>开局地点<select value={content.initialLocationId} onChange={e => change({...content, initialLocationId: e.target.value})}><option value="">选择地点</option>{content.locations.map(l => <option key={l.id} value={l.id}>{l.title}</option>)}</select></label><label>时间上限<input type="number" min={3} max={100} value={content.timeLimit} onChange={e => change({...content, timeLimit: Number(e.target.value)})} /></label></div>
        <label>世界规则（每行一条）<textarea rows={3} value={content.worldRules.join('\n')} onChange={e => change({...content, worldRules: e.target.value.split('\n')})} /></label><label>改编说明<textarea rows={3} maxLength={4000} value={content.adaptationNotes} onChange={e => change({...content, adaptationNotes: e.target.value})} /></label><label>超时结局<textarea rows={2} maxLength={3000} value={content.timeoutEnding} onChange={e => change({...content, timeoutEnding: e.target.value})} /></label>
        <WorldOverview content={content} />
      </>}
      <div className="editor-footer"><button className="primary" disabled={busy || conflict || json !== null || (!!draft && !dirty)} onClick={() => operate('save')}>保存世界草稿</button><button disabled={busy || dirty || conflict || json !== null || !draft} onClick={() => operate('validate')}>校验世界</button><button disabled={busy || dirty || conflict || json !== null || !draft || !validation?.valid} onClick={() => operate('publish')}>发布并冒险 →</button></div>
      {validation && <div className="validation"><Notice kind={validation.valid ? 'success' : 'error'} text={validation.valid ? '校验通过，可以发布。请确认公开文本没有泄漏隐藏剧情。' : '校验未通过，请修正。'} />{validation.errors.map((e, i) => <p key={i}>{e}</p>)}{validation.warnings.map((e, i) => <p className="hint" key={i}>{e}</p>)}</div>}
    </fieldset></div>}
  </section>;
}
