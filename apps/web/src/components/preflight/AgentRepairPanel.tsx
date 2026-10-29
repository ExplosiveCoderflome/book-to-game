import { useEffect, useRef, useState } from 'react';
import type { AgentRepairCandidate, PlaytestReport, WorldDraft } from '@novel-game/contracts';
import { errorMessage, RequestError } from '../../lib/api';
import { applyAgentRepair, createAgentRepair, listAgentRepairs, rejectAgentRepair } from '../../lib/agent-repair-api';
import { percent1 } from '../../lib/preflight-api';
import { useI18n } from '../../lib/i18n';

interface Props {
  token: string; draft: WorldDraft; report?: PlaytestReport; dirty: boolean;
  onApplied: (draft: WorldDraft) => Promise<void>; onBusyChange: (busy: boolean) => void;
}

export function AgentRepairPanel({token, draft, report, dirty, onApplied, onBusyChange}: Props) {
  const {t} = useI18n();
  const [candidates, setCandidates] = useState<AgentRepairCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scope = useRef('');
  const key = `${draft.id}@${draft.version}`;
  scope.current = key;
  useEffect(() => {
    let active = true; scope.current = key; setLoading(true); setError(null); setCandidates([]);
    listAgentRepairs(token, draft.id).then(result => {if (active) setCandidates(result.candidates);})
      .catch(e => {if (active) setError(errorMessage(e));}).finally(() => {if (active) setLoading(false);});
    return () => {active = false; scope.current = '';};
  }, [token, draft.id, draft.version]);

  const run = async (operation: () => Promise<void>) => {
    setBusy(true); onBusyChange(true); setError(null);
    try {await operation();}
    catch (e) {
      if (scope.current === key) {
        const blockers = e instanceof RequestError ? (e.details as {blockers?: string[]} | undefined)?.blockers : undefined;
        setError([errorMessage(e), ...(blockers ?? [])].join('；'));
      }
    } finally {setBusy(false); onBusyChange(false);}
  };
  const refresh = async () => {
    const result = await listAgentRepairs(token, draft.id);
    if (scope.current === key) setCandidates(result.candidates);
  };
  const currentReport = report?.draftVersion === draft.version;
  const hints = currentReport ? report.routeCoverage?.guidance ?? [] : [];
  return <section className="preflight-strip" data-testid="agent-repair-panel" aria-label={t('Agent 修复候选')}>
    <div className="preflight-strip-head"><h4>{t('Agent 修复候选')}</h4>
      <button type="button" className="small" disabled={busy || loading} onClick={() => void run(refresh)}>{t('重新读取候选')}</button>
    </div>
    <p className="hint">{t('先预览规则差异，再确认应用。确认时会重新体检与模拟，通过后保存新草稿。')}</p>
    <p className="hint">{t('仅支持行动前置与卡片权重调整；需要补写正文的建议交作者处理。验证使用同 40 个种子，不代表完整平衡验收。')}</p>
    {dirty && <p className="hint">{t('先保存草稿')}</p>}
    {busy && <p role="status">{t('正在生成或复验候选，请稍候…')}</p>}
    {error && <p role="alert" className="preflight-failure">{error}</p>}
    {loading ? <p role="status">{t('正在读取修复候选…')}</p> : null}
    {!currentReport && <p className="hint">{t('先对当前版本运行模拟试玩，再生成修复候选。')}</p>}
    {currentReport && !hints.length && <p className="hint">{t('当前报告没有可生成候选的路线建议。')}</p>}
    {hints.map(hint => {
      const supported = hint.edits.some(edit => edit.kind === 'weight' || edit.kind === 'gate-trap');
      const exists = candidates.some(c => c.baseVersion === draft.version && c.endingId === hint.endingId);
      return <div key={hint.endingId} className="preflight-strip-head">
        <span>{hint.title}{!supported && ` · ${t('需要作者补写内容')}`}</span>
        {supported && <button type="button" className="small" disabled={dirty || busy || loading || exists} onClick={() => void run(async () => {
          await createAgentRepair(token, draft.id, draft.version, hint.endingId); await refresh();
        })}>{t(exists ? '已生成候选' : '生成规则修复候选')}</button>}
      </div>;
    })}
    {!loading && !candidates.length && <p className="hint">{t('暂无修复候选。生成候选不会修改草稿。')}</p>}
    {candidates.map(candidate => {
      const stale = candidate.baseVersion !== draft.version;
      const verification = candidate.verification ?? candidate.preview;
      return <article key={candidate.id} className="agent-repair-candidate">
        <strong>{candidate.endingTitle}</strong> · {t('基于草稿 v{v}', {v: candidate.baseVersion})} · {t(candidate.status === 'applied' ? '已应用' : candidate.status === 'rejected' ? '已驳回' : '待作者确认')}
        {candidate.status === 'pending' && stale && <p className="hint">{t('草稿已更新，旧候选不能应用。请重新体检并生成候选。')}</p>}
        <p>{t('随机到达 {a}% → {b}%（同 {n} 局）', {a: percent1(verification.beforeRate), b: percent1(verification.afterRate), n: verification.seeds})}</p>
        <p className="hint">{t('体检错误 {a} → {b}；模拟死路 {c} → {d}', {a: verification.beforeErrors, b: verification.afterErrors, c: verification.beforeDeadEnds, d: verification.afterDeadEnds})}</p>
        {verification.afterErrors > 0 && <p className="hint">{t('原有体检错误仍需处理，本次修改不代表可以发布。')}</p>}
        {verification.blockers.map((reason, i) => <p key={i} className="preflight-failure">{reason}</p>)}
        <details><summary>{t('查看修改差异')}</summary>{candidate.changes.map(change => <div key={change.target}>
          <p>{change.label}</p><code className="preflight-tech">{change.target}</code>
          <pre className="agent-repair-diff">{t('修改前')}：{change.before}{'\n'}{t('修改后')}：{change.after}</pre>
        </div>)}</details>
        {candidate.status === 'pending' && <div className="toolbar">
          <button type="button" disabled={dirty || busy || stale || !candidate.preview.allowed} onClick={() => void run(async () => {
            const result = await applyAgentRepair(token, candidate.id);
            if (scope.current === key) await onApplied(result.draft);
          })}>{t('确认应用并复验')}</button>
          <button type="button" className="quiet" disabled={busy || dirty} onClick={() => void run(async () => {await rejectAgentRepair(token, candidate.id); await refresh();})}>{t('驳回候选')}</button>
        </div>}
      </article>;
    })}
  </section>;
}
