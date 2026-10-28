import { useEffect, useRef, useState } from 'react';
import type { LintReport, PlaytestReport, WorldDraft } from '@novel-game/contracts';
import { useI18n } from '../../lib/i18n';
import { errorMessage } from '../../lib/api';
import { getWorldPreflight, lintTone, lintWorldDraft, percent1, playtestTone, playtestWorldDraft, preflightTime, type WorldPreflight } from '../../lib/preflight-api';
import { CATEGORY_LABEL, EndingRateTable, PassLineTable, ResourceBandTable } from './PreflightTables';

type Phase = 'idle' | 'running' | 'failed';

/** U14 / §3.6: two in-place strips below `.validation`. Author-only: never imported by src/package/*. */
export function PreflightPanel({ token, draft, dirty }: { token: string; draft: WorldDraft | null; dirty: boolean }) {
  const { t } = useI18n();
  const [data, setData] = useState<WorldPreflight | null>(null);
  const [lintPhase, setLintPhase] = useState<Phase>('idle');
  const [simPhase, setSimPhase] = useState<Phase>('idle');
  const [failure, setFailure] = useState<{ lint?: string; sim?: string }>({});
  const scope = useRef<string | null>(null);
  const draftId = draft?.id ?? null;
  const s1 = !!draft && !!(draft.content.resourceDefs || draft.content.clock || draft.content.storylets);

  useEffect(() => {
    scope.current = draftId; setData(null); setFailure({}); setLintPhase('idle'); setSimPhase('idle');
    if (!draftId) return;
    getWorldPreflight(token, draftId).then(d => { if (scope.current === draftId) setData(d); }).catch(() => undefined);
  }, [token, draftId, draft?.version]);

  if (!draft) return null;
  const lint = data?.lint; const sim = data?.playtest;
  const lintStale = !!lint && lint.draftVersion !== draft.version;
  const simStale = !!sim && sim.draftVersion !== draft.version;
  const disabledTitle = dirty ? t('先保存草稿') : undefined;

  const runLint = async () => {
    const id = draft.id; setLintPhase('running'); setFailure(f => ({ ...f, lint: undefined }));
    try { const r = await lintWorldDraft(token, id); if (scope.current === id) { setData(d => ({ ...(d ?? { draftVersion: draft.version, stale: { lint: false, playtest: false } }), lint: r })); setLintPhase('idle'); } }
    catch (e) { if (scope.current === id) { setLintPhase('failed'); setFailure(f => ({ ...f, lint: errorMessage(e) })); } }
  };
  const runSim = async () => {
    const id = draft.id; setSimPhase('running'); setFailure(f => ({ ...f, sim: undefined }));
    try { const r = await playtestWorldDraft(token, id); if (scope.current === id) { setData(d => ({ ...(d ?? { draftVersion: draft.version, stale: { lint: false, playtest: false } }), playtest: r })); setSimPhase('idle'); } }
    catch (e) { if (scope.current === id) { setSimPhase('failed'); setFailure(f => ({ ...f, sim: errorMessage(e) })); } }
  };

  return (
    <section className="preflight" data-testid="preflight-panel" aria-label={t('发布前体检')}>
      <h4>{t('发布前体检')}</h4>
      <LintStrip report={lint} stale={lintStale} phase={lintPhase} failure={failure.lint} dirty={dirty} disabledTitle={disabledTitle} onRun={() => void runLint()} blocking={s1} />
      {s1
        ? <SimStrip report={sim} stale={simStale} phase={simPhase} failure={failure.sim} dirty={dirty} disabledTitle={disabledTitle} onRun={() => void runSim()} />
        : <div className="preflight-strip tone-muted" data-testid="preflight-sim-strip"><p>{t('模拟试玩只对声明了资源定义、时钟或剧情卡的世界开放。')}</p></div>}
    </section>
  );
}

function StripHead({ text, button, busy, disabled, title, onRun }: { text: string; button: string; busy: boolean; disabled: boolean; title?: string; onRun: () => void }) {
  const { t } = useI18n();
  return (
    <div className="preflight-strip-head">
      <p>{text}</p>
      <button type="button" className="small" disabled={busy || disabled} title={title} onClick={onRun}>{busy ? t('正在跑…') : button}</button>
    </div>
  );
}

function LintStrip({ report, stale, phase, failure, dirty, disabledTitle, onRun, blocking }: { report?: LintReport; stale: boolean; phase: Phase; failure?: string; dirty: boolean; disabledTitle?: string; onRun: () => void; blocking: boolean }) {
  const { t } = useI18n();
  const tone = phase === 'running' ? 'muted' : phase === 'failed' ? 'error' : report ? lintTone(report) : 'muted';
  const head = phase === 'running' ? t('内容体检 · 正在检查…')
    : report ? [
      report.errors || report.warnings ? t('内容体检 · {e} 个错误 · {w} 个提醒', { e: report.errors, w: report.warnings }) : t('内容体检 · 全部通过'),
      t('基于草稿 v{v}', { v: report.draftVersion }), preflightTime(report.createdAt),
      ...(stale ? [t('草稿已改动，报告可能过时')] : []),
    ].filter(Boolean).join(' · ')
    : t('内容体检 · 还没有体检');
  const errors = report?.issues.filter(i => i.severity === 'error') ?? [];
  const warnings = report?.issues.filter(i => i.severity === 'warning') ?? [];
  const issueRow = (i: LintReport['issues'][number], k: number) => (
    <li key={k} className={`preflight-issue is-${i.severity}`}>
      <span className="preflight-sev">{i.severity === 'error' ? t('错误') : t('提醒')}</span>
      <span className="preflight-cat">{t(CATEGORY_LABEL[i.category])}</span>
      <span>{i.message}{i.target?.label ? ` · ${i.target.label}` : ''}</span>
      <code className="preflight-tech">{i.ruleId}{i.target ? ` · ${i.target.kind}:${i.target.id}` : ''}</code>
    </li>
  );
  return (
    <div className={`preflight-strip tone-${tone}${stale ? ' is-stale' : ''}`} data-testid="preflight-lint-strip">
      <StripHead text={head} button={report ? t('重新体检') : t('体检')} busy={phase === 'running'} disabled={dirty} title={disabledTitle} onRun={onRun} />
      {phase === 'failed' && <p className="preflight-failure">{t('体检没有完成：{m}', { m: failure ?? '' })}</p>}
      {report && !blocking && report.errors > 0 && <p className="hint">{t('这个世界没有使用 S1 系统，体检结果仅供参考，不拦发布。')}</p>}
      {report && blocking && report.errors > 0 && <p className="hint">{t('有错误时不能发布；提醒不拦发布。')}</p>}
      {errors.length > 0 && <details open><summary>{t('错误 {n}', { n: errors.length })}</summary><ul>{errors.map(issueRow)}</ul></details>}
      {warnings.length > 0 && <details><summary>{t('提醒 {n}', { n: warnings.length })}</summary><ul>{warnings.map(issueRow)}</ul></details>}
      {report && report.checks.length > 0 && <details><summary>{t('静态及格线 · 档位 {tier}', { tier: report.tier })}</summary><PassLineTable checks={report.checks} /></details>}
    </div>
  );
}

function SimStrip({ report, stale, phase, failure, dirty, disabledTitle, onRun }: { report?: PlaytestReport; stale: boolean; phase: Phase; failure?: string; dirty: boolean; disabledTitle?: string; onRun: () => void }) {
  const { t } = useI18n();
  const tone = phase === 'running' ? 'muted' : phase === 'failed' ? 'error' : report ? playtestTone(report) : 'muted';
  const passed = report?.checks.filter(c => c.pass).length ?? 0;
  const head = phase === 'running' ? t('模拟试玩 · 正在跑…')
    : report ? [
      t('模拟试玩 · 及格线 {p} / {n} 达标', { p: passed, n: report.checks.length }),
      t('{s} 种策略 × {n} 局', { s: report.strategies.length, n: report.seeds }),
      t('基于草稿 v{v}', { v: report.draftVersion }), preflightTime(report.createdAt),
      ...(stale ? [t('草稿已改动，报告可能过时')] : []),
    ].filter(Boolean).join(' · ')
    : t('模拟试玩 · 还没有跑过');
  return (
    <div className={`preflight-strip tone-${tone}${stale ? ' is-stale' : ''}`} data-testid="preflight-sim-strip">
      <StripHead text={head} button={report ? t('重新跑') : t('跑模拟')} busy={phase === 'running'} disabled={dirty} title={disabledTitle} onRun={onRun} />
      {phase === 'failed' && <p className="preflight-failure">{t('模拟没有跑完，没有生成报告。上一份报告（如有）仍保留在下面。可以再跑一次。')}{failure ? ` (${failure})` : ''}</p>}
      {report && <>
        <details open><summary>{t('及格线')}</summary><PassLineTable checks={report.checks} /></details>
        <details><summary>{t('结局到达率（结局 × 策略，%）')}</summary><EndingRateTable report={report} /></details>
        <details><summary>{t('资源分布（P10 / P50 / P90，按随机策略进度）')}</summary><ResourceBandTable report={report} /></details>
        <details>
          <summary>{t('卡池与死路（从未抽到 {n} 张 · 连续重复率 {r}% · 死路 {d} · 锁定选项比例 {l}%）', {
            n: report.cards.neverDrawn.length, r: percent1(report.cards.consecutiveRepeatRate), d: report.deadEnds, l: percent1(report.lockedRatio) })}</summary>
          {report.cards.neverDrawn.length > 0 && <p>{t('从未抽到：')}<code>{report.cards.neverDrawn.join(' · ')}</code></p>}
          {report.gatesNeverMet.length > 0 && <p>{t('门控从未满足：')}<code>{report.gatesNeverMet.join(' · ')}</code></p>}
          {Object.entries(report.pinnedRatio).filter(([, v]) => v > 0.5).map(([id, v]) => <p key={id}>{t('{id} 有 {p}% 的步数卡在上下限', { id, p: percent1(v) })}</p>)}
        </details>
      </>}
    </div>
  );
}
