import { useRef, useState } from 'react';
import { productionInputSchema, type ProductionBrief, type ProductionInput, type GenerationJob, type SourceSummary } from '@novel-game/contracts';
import preset from '../../../../../examples/wulin-waizhuan.production.json';
import { useI18n } from '../../lib/i18n';
import { errorMessage, request, RequestError } from '../../lib/api';
import { Empty, Notice } from '../Notice';
import { ProductionJobCard } from './ProductionJobCard';
import { AgentFeed } from './AgentFeed';

export function ProductionPanel({token, configured, sources, jobs, refresh, openDraft, onConfigure}: {
  token: string; configured: boolean; sources: SourceSummary[]; jobs: GenerationJob[]; refresh: () => Promise<void>;
  openDraft: (id: string, mode: 'story' | 'open') => void; onConfigure: () => void;
}) {
  const {t} = useI18n();
  const [brief, setBrief] = useState<ProductionBrief>(preset as ProductionBrief);
  const [sourceId, setSourceId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<ProductionInput | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const set = (key: keyof ProductionBrief, value: string) => setBrief(current => ({...current, [key]: value}));
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      const input = pending.current ?? productionInputSchema.parse({brief, ...(sourceId ? {sourceId} : {}), requestId: crypto.randomUUID()});
      pending.current = input;
      await request(token, '/production/jobs', 'POST', input);
      pending.current = null; setUncertain(false);
      await refresh();
    } catch (e) {
      setError(errorMessage(e));
      const unknown = e instanceof RequestError && e.uncertain;
      setUncertain(unknown);
      if (!unknown) pending.current = null;
    } finally { setBusy(false); }
  }
  const productionJobs = jobs.filter(job => job.productionBrief);
  return <div data-testid="production-panel">
    <ol className="production-stages"><li>{t('设定与角色')}</li><li>{t('审阅玩法规划')}</li><li>{t('逐段写作与体检')}</li><li>{t('试玩、发布与导出')}</li></ol>
    <div className="generation-layout production-layout">
      <form className="panel stack" onSubmit={submit}>
        <div className="panel-heading"><h3>{t('角色扮演游戏简报')}</h3><button type="button" className="quiet small" disabled={busy || uncertain} onClick={() => { setBrief(preset as ProductionBrief); setSourceId(''); }}>{t('使用白展堂样本')}</button></div>
        <p className="hint">{t('先确定人物边界、行动与后果，再生成完整内容。规划需要你确认。')}</p>
        <Notice text={error} />
        {!configured && <Notice kind="info" text={t('请先配置模型，才能生成玩法规划。')} />}
        {!configured && <button type="button" onClick={onConfigure}>{t('前往模型设置 →')}</button>}
        <fieldset disabled={busy || uncertain}>
          <label>{t('游戏标题')}<input value={brief.title} maxLength={200} required onChange={e => set('title', e.target.value)} /></label>
          <label>{t('扮演角色')}<textarea value={brief.playerRole} maxLength={500} rows={3} required onChange={e => set('playerRole', e.target.value)} /></label>
          <label>{t('世界与人物设定')}<textarea value={brief.setting} maxLength={12000} rows={9} required onChange={e => set('setting', e.target.value)} /></label>
          <label>{t('本局目标与冲突')}<textarea value={brief.goal} maxLength={2000} rows={6} required onChange={e => set('goal', e.target.value)} /></label>
          <label>{t('基调与文风')}<textarea value={brief.tone} maxLength={1000} rows={3} required onChange={e => set('tone', e.target.value)} /></label>
          <label>{t('内容规模')}<select value={brief.tier} onChange={e => set('tier', e.target.value)}><option value="S">{t('S · 至少25张剧情卡')}</option><option value="M">{t('M · 至少40张剧情卡')}</option></select></label>
          <label>{t('附加原作资料')}<select value={sourceId} onChange={e => setSourceId(e.target.value)}><option value="">{t('仅使用以上设定')}</option>{sources.map(source => <option key={source.id} value={source.id}>{source.title}</option>)}</select></label>
        </fieldset>
        <p className="hint">{t('设定与所选原作会发送至你配置的模型。每段写完都会保存，可在失败后继续。')}</p>
        <button className="primary" disabled={!configured || busy}>{t(busy ? '正在提交…' : uncertain ? '确认并重试同一生成请求' : '生成玩法规划')}</button>
        {uncertain && <p className="hint">{t('请求结果未确认，重试会使用同一任务标识与方向。')}</p>}
      </form>
      <div className="panel production-records"><h3>{t('游戏制作记录')}</h3>
        {productionJobs.length ? <ul className="job-list">{productionJobs.map(job => <ProductionJobCard key={job.id} job={job} token={token} refresh={refresh} openDraft={openDraft} />)}</ul>
          : <Empty>{t('提交简报后，先审阅角色与策略，再确认生成正文。')}</Empty>}
        <AgentFeed token={token} />
      </div>
    </div>
  </div>;
}
