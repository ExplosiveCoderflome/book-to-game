import { WorkspaceHeader } from './studio/WorkspaceHeader';
import { useI18n } from '../lib/i18n';
import { useEffect, useRef, useState } from 'react';
import { generationInputSchema, type GenerationInput, type GenerationJob, type RuntimeInfo, type ScanDepth, type SourceSummary, type SourceDocument, type StatTemplateId } from '@novel-game/contracts';
import { StatTemplateSelect, type StatTemplateSelectValue } from './StatTemplateSelect';
import { selectedChapters } from '../lib/generation-scope';
import { errorMessage, request, RequestError } from '../lib/api';
import { Empty, Notice, dateLabel } from './Notice';
import { ProductionPanel } from './production/ProductionPanel';
import { JobFilters } from './production/JobFilters';
import { matchesJobFilter, type JobFilter } from '../lib/workspace-search';

const statuses: Record<GenerationJob['status'], string> = { queued: '等待处理', running: '正在生成', awaiting_review: '待审阅规划', succeeded: '已完成', failed: '失败', cancelled: '已取消' };
const pendingKey = 'novel-game.pending-generation';
function restoreGeneration(): GenerationInput | null {
  try {
    const result = generationInputSchema.safeParse(JSON.parse(sessionStorage.getItem(pendingKey) ?? 'null'));
    return result.success ? result.data : null;
  } catch { return null; }
}
interface Props { token: string; runtime: RuntimeInfo; sources: SourceSummary[]; selectedId: string; select: (id: string) => void; jobs: GenerationJob[]; refresh: () => Promise<void>; openDraft: (id: string, mode: 'story' | 'open') => void; onConfigure: () => void; jobFocus?: {id: string; request: number} | null; active?: boolean }

export function GenerationPanel({ token, runtime, sources, selectedId, select, jobs, refresh, openDraft, onConfigure, jobFocus, active }: Props) {
  const { t, locale } = useI18n();
  const [workflow, setWorkflow] = useState<'production' | 'adaptation'>('production');
  const adaptationJobs = jobs.filter(job => !job.productionBrief);
  const [query, setQuery] = useState(''), [filter, setFilter] = useState<JobFilter>('all');
  const visibleJobs = adaptationJobs.filter(job => matchesJobFilter({...job, productionBrief: {title: sources.find(source => source.id === job.sourceId)?.title ?? ''}}, filter, query));
  const focusedJobId = jobFocus?.id;
  const focusedIsProduction = !!jobs.find(job => job.id === focusedJobId)?.productionBrief;
  useEffect(() => {
    if (!focusedJobId || !active) return;
    setWorkflow(focusedIsProduction ? 'production' : 'adaptation'); setQuery(''); setFilter('all');
    const frame = requestAnimationFrame(() => window.document.getElementById(`job-${focusedJobId}`)?.scrollIntoView({block: 'center'}));
    return () => cancelAnimationFrame(frame);
  }, [focusedJobId, active, focusedIsProduction, jobFocus?.request]);
  const [direction, setDirection] = useState(() => t('尊重原作世界规则，设计一次有明确选择后果的短篇冒险'));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<GenerationInput | null>(restoreGeneration());
  const [uncertain, setUncertain] = useState(!!pending.current);
  const [mode, setMode] = useState<'story' | 'open'>('open');
  const [playerRole, setPlayerRole] = useState('');
  const [canonPolicy, setCanonPolicy] = useState<'faithful' | 'divergent'>('faithful');
  const [document, setDocument] = useState<SourceDocument | null>(null);
  const [chapterIds, setChapterIds] = useState<string[]>([]);
  const [scanDepth, setScanDepth] = useState<ScanDepth>('medium');
  const [statTemplateId, setStatTemplateId] = useState<StatTemplateSelectValue>('');
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
      input = pending.current ?? {sourceId: selectedId, direction, mode, chapterIds: selectedChapters(document!.chapters, chapterIds), ...(mode === 'open' ? {playerRole, canonPolicy} : {scanDepth}), ...(statTemplateId ? {statTemplateId} : {}), requestId: crypto.randomUUID()};
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
    <WorkspaceHeader title="制作任务" description="从创作简报到可玩草稿，跟踪规划、写作与审阅。" />
    <div className="workspace-task-summary" aria-label={t('制作概况')}>{([
      ['运行中', jobs.filter(job => ['running', 'queued'].includes(job.status)).length],
      ['待审阅规划', jobs.filter(job => job.status === 'awaiting_review').length],
      ['需要处理', jobs.filter(job => ['failed', 'cancelled'].includes(job.status)).length],
      ['已完成', jobs.filter(job => job.status === 'succeeded').length],
    ] as const).map(([label, count]) => <div key={label}><span>{t(label)}</span><strong>{count}</strong></div>)}</div>
    <div className="actions production-workflow" role="group" aria-label={t('生成方式')}>
      <button type="button" className={workflow === 'production' ? 'primary' : 'quiet'} aria-pressed={workflow === 'production'} onClick={() => setWorkflow('production')}>{t('制作角色扮演游戏')}</button>
      <button type="button" className={workflow === 'adaptation' ? 'primary' : 'quiet'} aria-pressed={workflow === 'adaptation'} onClick={() => setWorkflow('adaptation')}>{t('原作快速改编')}</button>
    </div>
    <div hidden={workflow !== 'production'}><ProductionPanel token={token} configured={runtime.providerConfigured} sources={sources} jobs={jobs} refresh={refresh} openDraft={openDraft} onConfigure={onConfigure} jobFocus={jobFocus} /></div><div hidden={workflow !== 'adaptation'}>
    <Notice text={error} /><Notice kind="info" text={!runtime.providerConfigured ? t("尚未配置模型服务。前往“模型设置”填写并保存后即可生成，无需重启。也可在草稿页手动提交内容。") : null} />
    {!runtime.providerConfigured && <p><button onClick={onConfigure}>{t("前往模型设置 →")}</button></p>}
    <div className="generation-layout"><form className="panel stack" onSubmit={generate}>
      <h3>{t("这次想让读者经历什么？")}</h3>
      <label>{t("选择原作")}<select value={uncertain ? pending.current?.sourceId : selectedId} disabled={uncertain || busy !== null} onChange={e => select(e.target.value)}><option value="">{t("请选择已导入原作")}</option>{sources.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}</select></label>
      <label>{t("改编方向")}<textarea rows={6} maxLength={2000} value={uncertain ? pending.current?.direction : direction} disabled={uncertain || busy !== null} onChange={e => setDirection(e.target.value)} placeholder={t("例如：让读者扮演配角，在旧城的一夜中决定是否交出秘密。")} /></label>
      <fieldset disabled={uncertain || busy !== null}><legend>{t("游戏形式与范围")}</legend>
        <label>{t("形式")}<select value={uncertain ? pending.current?.mode ?? 'story' : mode} onChange={e => setMode(e.target.value as 'story' | 'open')}><option value="open">{t("开放冒险 · 地点、行动与持续后果")}</option><option value="story">{t("分支故事 · 固定场景与选择")}</option></select></label>
        {(uncertain ? pending.current?.mode : mode) === 'open' && <><label>{t("玩家身份")}<input maxLength={500} value={uncertain ? pending.current?.playerRole ?? '' : playerRole} onChange={e => setPlayerRole(e.target.value)} placeholder={t("例如：渡口送信人，为救出同伴寻找过河方法")} /></label><label>{t("改编策略")}<select value={uncertain ? pending.current?.canonPolicy : canonPolicy} onChange={e => setCanonPolicy(e.target.value as 'faithful' | 'divergent')}><option value="faithful">{t("忠实原作世界与人物约束")}</option><option value="divergent">{t("允许明确标注的剧情分歧")}</option></select></label></>}
        <details className="chapter-scope"><summary>{t("选择章节 ·")} {uncertain ? pending.current?.chapterIds?.length ?? t("全部") : chapterIds.length} / {document?.chapters.length ?? '—'}</summary>
          <button type="button" className="small" onClick={() => setChapterIds(document?.chapters.map(c => c.id) ?? [])}>{t("选择全部")}</button>
          {document?.chapters.map(c => <label className="check-label" key={c.id}><input type="checkbox" checked={(uncertain ? pending.current?.chapterIds ?? document.chapters.map(c => c.id) : chapterIds).includes(c.id)} onChange={e => setChapterIds(ids => e.target.checked ? [...ids, c.id] : ids.filter(id => id !== c.id))} />{c.index + 1}. {c.title}</label>)}
        </details>
        <p className="hint">{uncertain ? t("重试保持原请求的章节范围、身份与策略。") : document ? t('本次范围：{chapters}。只分析和发送这些章节。', {chapters: document.chapters.filter(c => chapterIds.includes(c.id)).map(c => c.title).join(locale === 'zh-CN' ? '、' : ', ') || t('尚未选择')}) : t("正在载入章节…")}</p>
      </fieldset>
      {(uncertain ? pending.current?.mode : mode) !== 'open' && (
        <fieldset disabled={uncertain || busy !== null} data-testid="scan-depth-fieldset">
          <legend>{t('扫描粒度')}</legend>
          <div className="scan-depth-row" role="group" aria-label={t('扫描粒度')}>
            {([
              ['coarse', '粗 · 章弧'],
              ['medium', '中 · 默认'],
              ['fine', '细 · 拍点'],
            ] as const).map(([value, label]) => (
              <label key={value} className={`scan-depth-option${(uncertain ? pending.current?.scanDepth ?? 'medium' : scanDepth) === value ? ' active' : ''}`}>
                <input type="radio" name="scanDepth" value={value} checked={(uncertain ? pending.current?.scanDepth ?? 'medium' : scanDepth) === value} onChange={() => setScanDepth(value)} disabled={uncertain || busy !== null} />
                {t(label)}
              </label>
            ))}
          </div>
          <p className="hint">{t('空图首次扫描按粒度生成节点；之后可在画布对任一节点「延申节点」。')}</p>
        </fieldset>
      )}
      <fieldset disabled={uncertain || busy !== null} data-testid="stat-template-fieldset">
        <legend>{t('数值模板')}</legend>
        <StatTemplateSelect
          hideLabel
          value={uncertain ? ((pending.current?.statTemplateId as StatTemplateId | undefined) ?? '') : statTemplateId}
          onChange={setStatTemplateId}
          disabled={uncertain || busy !== null}
          testId="generation-stat-template"
        />
      </fieldset>
      <p className="hint">{t("开放冒险以建议行动推进，支持不同策略、时间压力与持续后果。")}</p>
      <p className="hint">{t("生成时会把分块正文发送至你配置的模型服务。")}</p>
      <button className="primary" disabled={!(uncertain ? pending.current?.sourceId : selectedId) || (!uncertain && (!document || !chapterIds.length)) || !runtime.providerConfigured || busy !== null}>{busy === 'new' ? t("正在提交…") : uncertain ? t("确认并重试同一生成请求") : t("开始分析与生成")}</button>
      {uncertain && <p className="hint">{t("请求结果未确认，重试会使用同一任务标识与方向。")}</p>}
    </form>
    <div className="panel"><div className="panel-heading"><h3>{t("生成记录")}</h3><span className="hint">{t("运行中自动刷新")}</span></div>
      <JobFilters query={query} setQuery={setQuery} filter={filter} setFilter={setFilter} count={visibleJobs.length} />
      {adaptationJobs.length === 0 ? <Empty>{t("生成任务会保存在这里。关闭网页后，可回来查看进度。")}</Empty> : !visibleJobs.length ? <Empty>{t('没有匹配的制作记录，试试其他状态或关键词。')}</Empty> : <ul className="job-list">{visibleJobs.map(job => <li key={job.id} id={`job-${job.id}`} data-selected={job.id === focusedJobId || undefined}>
        <div className="job-heading"><strong>{sources.find(s => s.id === job.sourceId)?.title ?? t("原作任务")}</strong><span className={`status ${job.status}`}>{t(statuses[job.status])}</span></div>
        <p>{job.mode === 'open' ? t("开放冒险") : t("分支故事")} · {job.stage.startsWith('分析小说 ') ? t('分析小说 {completed}/{total}', {completed: job.completedChunks, total: job.totalChunks}) : t(job.stage || '准备中')} <span className="hint">· {t('{completed} / {total} 块', {completed: job.completedChunks, total: job.totalChunks})}</span></p>
        <progress max={1} value={Math.min(1, Math.max(0, job.progress))} aria-label={t("生成进度")} /><div className="job-meta"><small>{dateLabel(job.updatedAt, locale)}</small><small>{Math.round(job.progress * 100)}%</small></div>
        {job.error && <Notice text={job.error} />}
        {job.analysis && <details><summary>{t("查看原作分析")}</summary><p>{job.analysis.summary}</p><p className="hint">{t('已分析 {completed} / {total} 章', {completed: job.analysis.coverage.chapterIds.length, total: job.analysis.coverage.totalChapters})}</p>{job.analysis.uncertainties.length > 0 && <ul>{job.analysis.uncertainties.map((text, i) => <li key={i}>{text}</li>)}</ul>}</details>}
        <div className="actions">{job.draftId && <button className="primary small" onClick={() => openDraft(job.draftId!, job.mode ?? 'story')}>{t("打开草稿 →")}</button>}{(job.status === 'failed' || job.status === 'cancelled') && <button disabled={busy !== null} onClick={() => operate(job.id, 'retry')}>{t("重试任务")}</button>}{(job.status === 'queued' || job.status === 'running') && <button className="quiet" disabled={busy !== null} onClick={() => operate(job.id, 'cancel')}>{t("取消任务")}</button>}</div>
      </li>)}</ul>}
    </div></div>
    </div>
  </section>;
}
