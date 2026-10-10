import { useEffect, useRef, useState } from 'react';
import { generationInputSchema, type GenerationInput, type GenerationJob, type RuntimeInfo, type SourceSummary, type SourceDocument } from '@novel-game/contracts';
import { selectedChapters } from '../lib/generation-scope';
import { errorMessage, request, RequestError } from '../lib/api';
import { Empty, Notice, dateLabel } from './Notice';

const statuses: Record<GenerationJob['status'], string> = { queued: '等待处理', running: '正在生成', succeeded: '已完成', failed: '失败', cancelled: '已取消' };
const pendingKey = 'novel-game.pending-generation';
function restoreGeneration(): GenerationInput | null {
  try {
    const result = generationInputSchema.safeParse(JSON.parse(sessionStorage.getItem(pendingKey) ?? 'null'));
    return result.success ? result.data : null;
  } catch { return null; }
}
interface Props { token: string; runtime: RuntimeInfo; sources: SourceSummary[]; selectedId: string; select: (id: string) => void; jobs: GenerationJob[]; refresh: () => Promise<void>; openDraft: (id: string, mode: 'story' | 'open') => void; onConfigure: () => void }

export function GenerationPanel({ token, runtime, sources, selectedId, select, jobs, refresh, openDraft, onConfigure }: Props) {
  const [direction, setDirection] = useState('尊重原作世界规则，设计一次有明确选择后果的短篇冒险');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<GenerationInput | null>(restoreGeneration());
  const [uncertain, setUncertain] = useState(!!pending.current);
  const [mode, setMode] = useState<'story' | 'open'>('open');
  const [playerRole, setPlayerRole] = useState('');
  const [canonPolicy, setCanonPolicy] = useState<'faithful' | 'divergent'>('faithful');
  const [document, setDocument] = useState<SourceDocument | null>(null);
  const [chapterIds, setChapterIds] = useState<string[]>([]);
  useEffect(() => {
    let active = true; setDocument(null); setChapterIds([]);
    if (selectedId) request<SourceDocument>(token, `/sources/${selectedId}`).then(value => {
      if (active) {setDocument(value); setChapterIds(value.chapters.map(c => c.id));}
    }).catch(e => {if (active) setError(errorMessage(e));});
    return () => {active = false;};
  }, [token, selectedId]);
  async function generate(event: React.FormEvent) {
    event.preventDefault(); setError(null);
    let input: GenerationInput;
    try {
      if (!pending.current && !document) throw new Error('请等待原文章节载入。');
      input = pending.current ?? {sourceId: selectedId, direction, mode, chapterIds: selectedChapters(document!.chapters, chapterIds), ...(mode === 'open' ? {playerRole, canonPolicy} : {}), requestId: crypto.randomUUID()};
      if (input.mode === 'open' && !input.playerRole?.trim()) throw new Error('请填写玩家身份。');
    } catch (e) {setError(errorMessage(e)); return;}
    setBusy('new');
    pending.current = input;
    sessionStorage.setItem(pendingKey, JSON.stringify(input));
    try { await request<GenerationJob>(token, '/jobs', 'POST', input); pending.current = null; sessionStorage.removeItem(pendingKey); setUncertain(false); await refresh(); }
    catch (e) { setError(errorMessage(e)); if (e instanceof RequestError && e.uncertain && pending.current) setUncertain(true); else { pending.current = null; sessionStorage.removeItem(pendingKey); setUncertain(false); } }
    finally { setBusy(null); }
  }
  async function operate(id: string, action: 'retry' | 'cancel') {
    setBusy(id); setError(null);
    try { await request(token, `/jobs/${id}/${action}`, 'POST', {}); await refresh(); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(null); }
  }
  return <section className="work-section">
    <div className="section-heading"><div><p className="eyebrow">02 / 改编桌</p><h2>为原作打开另一条路</h2><p>选择章节与玩家身份，生成可审阅的世界或分支故事。</p></div><span className="edition">ADAPTATION DESK</span></div>
    <Notice text={error} /><Notice kind="info" text={!runtime.providerConfigured ? '尚未配置模型服务。前往“模型设置”填写并保存后即可生成，无需重启。也可在草稿页手动提交内容。' : null} />
    {!runtime.providerConfigured && <p><button onClick={onConfigure}>前往模型设置 →</button></p>}
    <div className="generation-layout"><form className="panel stack" onSubmit={generate}>
      <h3>这次想让读者经历什么？</h3>
      <label>选择原作<select value={uncertain ? pending.current?.sourceId : selectedId} disabled={uncertain || busy !== null} onChange={e => select(e.target.value)}><option value="">请选择已导入原作</option>{sources.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}</select></label>
      <label>改编方向<textarea rows={6} maxLength={2000} value={uncertain ? pending.current?.direction : direction} disabled={uncertain || busy !== null} onChange={e => setDirection(e.target.value)} placeholder="例如：让读者扮演配角，在旧城的一夜中决定是否交出秘密。" /></label>
      <fieldset disabled={uncertain || busy !== null}><legend>游戏形式与范围</legend>
        <label>形式<select value={uncertain ? pending.current?.mode ?? 'story' : mode} onChange={e => setMode(e.target.value as 'story' | 'open')}><option value="open">开放冒险 · 地点、行动与持续后果</option><option value="story">分支故事 · 固定场景与选择</option></select></label>
        {(uncertain ? pending.current?.mode : mode) === 'open' && <><label>玩家身份<input maxLength={500} value={uncertain ? pending.current?.playerRole ?? '' : playerRole} onChange={e => setPlayerRole(e.target.value)} placeholder="例如：渡口送信人，为救出同伴寻找过河方法" /></label><label>改编策略<select value={uncertain ? pending.current?.canonPolicy : canonPolicy} onChange={e => setCanonPolicy(e.target.value as 'faithful' | 'divergent')}><option value="faithful">忠实原作世界与人物约束</option><option value="divergent">允许明确标注的剧情分歧</option></select></label></>}
        <details className="chapter-scope"><summary>选择章节 · {uncertain ? pending.current?.chapterIds?.length ?? '全部' : chapterIds.length} / {document?.chapters.length ?? '—'}</summary>
          <button type="button" className="small" onClick={() => setChapterIds(document?.chapters.map(c => c.id) ?? [])}>选择全部</button>
          {document?.chapters.map(c => <label className="check-label" key={c.id}><input type="checkbox" checked={(uncertain ? pending.current?.chapterIds ?? document.chapters.map(c => c.id) : chapterIds).includes(c.id)} onChange={e => setChapterIds(ids => e.target.checked ? [...ids, c.id] : ids.filter(id => id !== c.id))} />{c.index + 1}. {c.title}</label>)}
        </details>
        <p className="hint">{uncertain ? '重试保持原请求的章节范围、身份与策略。' : document ? `本次范围：${document.chapters.filter(c => chapterIds.includes(c.id)).map(c => c.title).join('、') || '尚未选择'}。只分析和发送这些章节。` : '正在载入章节…'}</p>
      </fieldset>
      <p className="hint">开放冒险以建议行动推进，支持不同策略、时间压力与持续后果。</p>
      <p className="hint">生成时会把分块正文发送至你配置的模型服务。</p>
      <button className="primary" disabled={!(uncertain ? pending.current?.sourceId : selectedId) || (!uncertain && (!document || !chapterIds.length)) || !runtime.providerConfigured || busy !== null}>{busy === 'new' ? '正在提交…' : uncertain ? '确认并重试同一生成请求' : '开始分析与生成'}</button>
      {uncertain && <p className="hint">请求结果未确认，重试会使用同一任务标识与方向。</p>}
    </form>
    <div className="panel"><div className="panel-heading"><h3>生成记录</h3><span className="hint">运行中自动刷新</span></div>
      {jobs.length === 0 ? <Empty>生成任务会保存在这里。关闭网页后，可回来查看进度。</Empty> : <ul className="job-list">{jobs.map(job => <li key={job.id}>
        <div className="job-heading"><strong>{sources.find(s => s.id === job.sourceId)?.title ?? '原作任务'}</strong><span className={`status ${job.status}`}>{statuses[job.status]}</span></div>
        <p>{job.mode === 'open' ? '开放冒险' : '分支故事'} · {job.stage || '准备中'} <span className="hint">· {job.completedChunks} / {job.totalChunks} 块</span></p>
        <progress max={1} value={Math.min(1, Math.max(0, job.progress))} aria-label="生成进度" /><div className="job-meta"><small>{dateLabel(job.updatedAt)}</small><small>{Math.round(job.progress * 100)}%</small></div>
        {job.error && <Notice text={job.error} />}
        {job.analysis && <details><summary>查看原作分析</summary><p>{job.analysis.summary}</p><p className="hint">已分析 {job.analysis.coverage.chapterIds.length} / {job.analysis.coverage.totalChapters} 章</p>{job.analysis.uncertainties.length > 0 && <ul>{job.analysis.uncertainties.map((text, i) => <li key={i}>{text}</li>)}</ul>}</details>}
        <div className="actions">{job.draftId && <button className="primary small" onClick={() => openDraft(job.draftId!, job.mode ?? 'story')}>打开草稿 →</button>}{(job.status === 'failed' || job.status === 'cancelled') && <button disabled={busy !== null} onClick={() => operate(job.id, 'retry')}>重试任务</button>}{(job.status === 'queued' || job.status === 'running') && <button className="quiet" disabled={busy !== null} onClick={() => operate(job.id, 'cancel')}>取消任务</button>}</div>
      </li>)}</ul>}
    </div></div>
  </section>;
}
