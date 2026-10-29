import { useState } from 'react';
import { productionPlanSchema, type GenerationJob } from '@novel-game/contracts';
import { useI18n } from '../../lib/i18n';
import { request, errorMessage } from '../../lib/api';
import { Notice } from '../Notice';

const statusText: Record<GenerationJob['status'], string> = {
  queued: '等待处理', running: '正在生成', awaiting_review: '待审阅规划', succeeded: '已完成', failed: '失败', cancelled: '已取消',
};

export function ProductionJobCard({job, token, refresh, openDraft, selected}: {
  job: GenerationJob; token: string; refresh: () => Promise<void>; openDraft: (id: string, mode: 'story' | 'open') => void;
  selected?: boolean;
}) {
  const {t} = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editedPlan, setEditedPlan] = useState<string | null>(null);
  const [unitKey, setUnitKey] = useState('');
  const [direction, setDirection] = useState('');
  const state = job.productionState;
  const targets = state ? [
    ...(state.plan.world.storylets ?? []).map(item => ({key: `storylet:${item.id}`, label: `${t('剧情卡')} · ${item.title}`})),
    ...state.plan.world.locations.map(item => ({key: `location:${item.id}`, label: `${t('地点')} · ${item.title}`})),
    ...state.plan.world.endings.map(item => ({key: `ending:${item.id}`, label: `${t('结局')} · ${item.title}`})),
    ...state.plan.world.actions.map(item => ({key: `action:${item.id}`, label: `${t('行动')} · ${item.label}`})),
    ...state.plan.world.events.map(item => ({key: `event:${item.id}`, label: `${t('事件')} · ${item.label}`})),
    {key: 'timeout:timeout', label: t('期限结局')},
  ] : [];
  async function operate(action: 'approve-plan' | 'retry' | 'cancel' | 'rewrite-unit') {
    setBusy(true); setError(null);
    try {
      const body = action === 'approve-plan' ? {plan: productionPlanSchema.parse(editedPlan === null ? state!.plan : JSON.parse(editedPlan))}
        : action === 'rewrite-unit' ? {unitKey: unitKey || targets[0]?.key, direction: direction.trim()} : {};
      await request(token, `/jobs/${job.id}/${action}`, 'POST', body);
      await refresh();
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  return <li className="production-job" data-testid="production-job" id={`job-${job.id}`} data-selected={selected || undefined}>
    <div className="job-heading"><strong>{job.productionBrief!.title}</strong><span className={`status ${job.status}`}>{t(statusText[job.status])}</span></div>
    <p>{job.playerRole}</p>
    <p className="hint">{t(job.stage)} · {Math.round(job.progress * 100)}%</p>
    <progress max={1} value={job.progress} aria-label={t('生成进度')} />
    <Notice text={error ?? job.error} />
    {state && <>
      <p className="hint">{t('已保存 {count} 段正文', {count: Object.keys(state.texts).length})}</p>
      <details open={job.status === 'awaiting_review'} className="production-plan">
        <summary>{t('审阅人物与玩法')}</summary>
        <p>{state.plan.bible.premise}</p>
        <h4>{t('角色边界')}</h4>
        <ul>{state.plan.bible.identityBoundaries.map((line, i) => <li key={i}>{line}</li>)}</ul>
        <h4>{t('人物关系')}</h4>
        <dl className="production-cast">{state.plan.bible.cast.map((person, i) => <div key={i}><dt>{person.name} · {person.role}</dt><dd>{person.relationshipToPlayer}</dd></div>)}</dl>
        <h4>{t('策略与结局')}</h4>
        <ul>{state.plan.routes.map(route => <li key={route.id}><strong>{route.name}</strong><p>{route.strategy}</p><small>{route.endingIds.map(id => state.plan.world.endings.find(ending => ending.id === id)?.title ?? id).join(' / ')}</small></li>)}</ul>
        <p className="hint">{t('{places} 个地点 · {cards} 张剧情卡 · {endings} 个结局', {places: state.plan.world.locations.length, cards: state.plan.world.storylets?.length ?? 0, endings: state.plan.world.endings.length})}</p>
        {job.status === 'awaiting_review' && <details onToggle={e => { if (e.currentTarget.open && editedPlan === null) setEditedPlan(JSON.stringify(state.plan, null, 2)); }}>
          <summary>{t('高级修改规划')}</summary>
          <label>{t('玩法规划 JSON')}<textarea className="mono" rows={16} value={editedPlan ?? ''} onChange={e => setEditedPlan(e.target.value)} disabled={busy} spellCheck={false} /></label>
        </details>}
      </details>
      {state.lint && <div className="production-lint">
        <Notice kind={state.lint.errors ? 'error' : 'success'} text={t('内容体检：{errors} 项错误，{warnings} 项提示', {errors: state.lint.errors, warnings: state.lint.warnings})} />
        {state.lint.errors > 0 && <p>{t('正文已保存在草稿。请修复体检错误，再发布和导出。')}</p>}
      </div>}
      {state.playtest && <p className="hint">{t('快速试玩：{runs} 局 · {deadEnds} 个死路 · {unseen} 个结局尚未覆盖', {
        runs: state.playtest.strategies.reduce((sum, strategy) => sum + strategy.runs, 0), deadEnds: state.playtest.deadEnds,
        unseen: state.playtest.endings.filter(ending => !Object.values(state.playtest!.endingRates).some(rates => (rates[ending.id] ?? 0) > 0)).length,
      })}</p>}
      {state.approved && ['succeeded', 'failed'].includes(job.status) && <details className="production-plan">
        <summary>{t('修订一段正文')}</summary>
        <p className="hint">{t('按意见重写所选内容，复用其他已保存正文和已确认玩法；未完成内容会继续写作。完成后创建新草稿，保留原草稿。')}</p>
        <label htmlFor={`rewrite-target-${job.id}`}>{t('修订目标')}</label>
        <select id={`rewrite-target-${job.id}`} value={unitKey || targets[0]?.key} onChange={e => setUnitKey(e.target.value)} disabled={busy}>
          {targets.map(target => <option key={target.key} value={target.key}>{target.label}</option>)}
        </select>
        <label>{t('修订意见')}<textarea rows={3} value={direction} onChange={e => setDirection(e.target.value)} minLength={5} maxLength={2000} disabled={busy} /></label>
        <button disabled={busy || direction.trim().length < 5} onClick={() => void operate('rewrite-unit')}>{t('生成修订草稿')}</button>
      </details>}
    </>}
    <div className="actions">
      {job.status === 'awaiting_review' && <button className="primary" disabled={busy} onClick={() => void operate('approve-plan')}>{t(busy ? '正在确认…' : '确认规划并生成正文')}</button>}
      {(job.status === 'failed' || job.status === 'cancelled') && <button disabled={busy} onClick={() => void operate('retry')}>{t('从已保存内容继续')}</button>}
      {['queued', 'running', 'awaiting_review'].includes(job.status) && <button className="quiet" disabled={busy} onClick={() => void operate('cancel')}>{t('取消任务')}</button>}
      {job.draftId && <button className="primary" onClick={() => openDraft(job.draftId!, 'open')}>{t('打开草稿并检查试玩')}</button>}
    </div>
  </li>;
}
