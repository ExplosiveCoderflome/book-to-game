import type { GuidanceEdit, LintCategory, PassCheck, PlaytestReport, RouteGuidanceHint } from '@novel-game/contracts';
import { useI18n } from '../../lib/i18n';
import { percent1 } from '../../lib/preflight-api';

export const CATEGORY_LABEL: Record<LintCategory, string> = { structure: '结构', resource: '资源平衡', pool: '卡池', text: '文本', volume: '体量' };

/** G1–G10: line / measured come verbatim from the report; G9/G10 are stated facts, not numbers. */
export function PassLineTable({ checks }: { checks: PassCheck[] }) {
  const { t } = useI18n();
  const ids = new Set(checks.map(c => c.id));
  return (
    <table className="preflight-table" data-testid="preflight-pass-lines">
      <thead><tr><th>{t('及格线')}</th><th>{t('线')}</th><th>{t('实测')}</th><th>{t('结论')}</th></tr></thead>
      <tbody>
        {checks.map(c => (
          <tr key={c.id} className={c.pass ? 'is-pass' : 'is-fail'}>
            <td><strong>{c.id}</strong> {c.label}</td><td>{c.line}</td><td>{c.measured}</td><td>{c.pass ? t('达标') : t('未达标')}</td>
          </tr>
        ))}
        {!ids.has('G9') && <tr className="is-na"><td><strong>G9</strong> {t('诚实')}</td><td>{t('不由模拟判定 · 截图与投影单测验收')}</td><td>—</td><td>—</td></tr>}
        {!ids.has('G10') && <tr className="is-na"><td><strong>G10</strong> {t('交付')}</td><td>{t('不由模拟判定 · 导出回归验收（slice §9）')}</td><td>—</td><td>—</td></tr>}
      </tbody>
    </table>
  );
}

export function EndingRateTable({ report }: { report: PlaytestReport }) {
  const { t } = useI18n();
  const keys = [...report.endings.map(e => e.id), ...(Object.values(report.endingRates).some(r => (r['(none)'] ?? 0) > 0) ? ['(none)'] : [])];
  const title = (id: string) => {
    if (id === '(none)') return t('（步数用尽）');
    const e = report.endings.find(x => x.id === id);
    return e ? (e.kind === 'failure' ? t('{title}（失败）', { title: e.title }) : e.title) : id;
  };
  return (
    <table className="preflight-table" data-testid="preflight-ending-rates">
      <thead><tr><th>{t('结局')}</th>{report.strategies.map(s => <th key={s.id}>{s.label}</th>)}</tr></thead>
      <tbody>
        {keys.map(k => (
          <tr key={k}>
            <td>{title(k)}</td>
            {report.strategies.map(s => {
              const v = report.endingRates[s.id]?.[k] ?? 0;
              return <td key={s.id} className="num">{percent1(v)}%{s.id === 'random' && v > 0.6 ? ` ${t('偏高')}` : ''}</td>;
            })}
          </tr>
        ))}
        <tr className="is-sub">
          <td>{t(report.timeUnit === 'turn' ? '中位决策 / 字数 / 行动耗时' : '中位决策 / 字数 / 月')}</td>
          {report.strategies.map(s => { const m = report.medians[s.id]; return <td key={s.id} className="num">{m ? `${m.decisions} / ${m.uniqueChars} / ${m.months}` : '—'}</td>; })}
        </tr>
      </tbody>
    </table>
  );
}

export function ResourceBandTable({ report }: { report: PlaytestReport }) {
  const { t } = useI18n();
  const rows = Object.entries(report.resourceBands);
  const cols = rows[0]?.[1].points.map(p => p.at) ?? [];
  if (!rows.length) return <p className="hint">{t('没有资源分布数据。')}</p>;
  return (
    <table className="preflight-table" data-testid="preflight-resource-bands">
      <thead><tr><th>{t('资源')}</th>{cols.map(at => <th key={at}>{t('进度 {p}%', { p: Math.round(at * 100) })}</th>)}</tr></thead>
      <tbody>
        {rows.map(([id, band]) => (
          <tr key={id}>
            <td>{band.label} <code>{id}</code></td>
            {band.points.map(p => <td key={p.at} className="num">{p.p10}–{p.p50}–{p.p90}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const COVERAGE_LABEL = { covered: '通用策略可达', 'goal-only': '仅定向打法可达', unreached: '自动策略未到达', 'no-trigger': '无触发来源' } as const;

/** Route coverage: per ending (generic best vs goal-directed) and per planned route (hit rate, median pacing). */
export function RouteCoverageTable({ report }: { report: PlaytestReport }) {
  const { t } = useI18n();
  const rc = report.routeCoverage;
  if (!rc) return <p className="hint">{t('这份报告没有路线覆盖数据（旧报告或已关闭）。重新跑一次即可生成。')}</p>;
  const plan = rc.routes.filter(r => r.source === 'plan');
  const title = (id: string) => report.endings.find(e => e.id === id)?.title ?? id;
  const notes = rc.issues.filter(i => i.ruleId !== 'route.guidance'); // guidance is listed with its edits below
  return (
    <>
      <table className="preflight-table preflight-route-table" data-testid="preflight-route-endings">
        <thead><tr><th>{t('结局')}</th><th className="num">{t('通用策略最高')}</th><th className="num">{t('定向打法（{n} 局）', { n: rc.seeds })}</th><th>{t('结论')}</th></tr></thead>
        <tbody>
          {rc.endings.map(e => (
            <tr key={e.id} className={e.status === 'covered' ? 'is-pass' : 'is-fail'}>
              <td>{e.kind === 'failure' ? t('{title}（失败）', { title: e.title }) : e.title}</td>
              <td className="num">{percent1(e.bestGeneric)}%</td>
              <td className="num">{e.goalRate === undefined ? '—' : `${percent1(e.goalRate)}%`}</td>
              <td>{t(COVERAGE_LABEL[e.status])}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {plan.length > 0 && (
        <table className="preflight-table preflight-route-table" data-testid="preflight-route-plan">
          <thead><tr><th>{t('规划路线')}</th><th>{t('目标结局')}</th><th className="num">{t('到达率')}</th><th className="num">{t('中位决策 / 字数（线 {d} / {c}）', { d: rc.pacing.decisions, c: rc.pacing.uniqueChars })}</th></tr></thead>
          <tbody>
            {plan.map(r => (
              <tr key={r.id} className={r.hitRate >= 0.2 && !r.belowPacing ? 'is-pass' : 'is-fail'}>
                <td>{r.name}</td><td>{r.endingIds.map(title).join(' · ')}</td><td className="num">{percent1(r.hitRate)}%</td>
                <td className="num">{r.hitRate > 0 ? `${r.medians.decisions} / ${r.medians.uniqueChars}` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {notes.length > 0 && <ul className="preflight-route-notes">{notes.map((i, n) => <li key={n} className={`sev-${i.severity}`}>{i.message}</li>)}</ul>}
      {(rc.guidance?.length ?? 0) > 0 && <RouteGuidanceList hints={rc.guidance!} />}
    </>
  );
}

/** S2: suggested edits per goal-only ending, each verified on the same random seeds. Read-only: nothing is applied here. */
function RouteGuidanceList({ hints }: { hints: RouteGuidanceHint[] }) {
  const { t } = useI18n();
  const describe = (e: GuidanceEdit) => e.kind === 'gate-trap'
    ? t('「{label}」加前置：须先满足 {conds}（否则会堵死「{blocks}」）', { label: e.label, conds: e.addLabels.map(l => `「${l}」`).join('、'), blocks: e.blocks })
    : e.kind === 'nudge-card' ? t('新增路线提示卡「{label}」（条件满足时在各地出现，正文为占位，需改写）', { label: e.label })
    : t('剧情卡「{label}」权重 {from} → {to}', { label: e.label, from: e.from, to: e.to });
  return (
    <div className="preflight-route-guidance" data-testid="preflight-route-guidance">
      <h4>{t('路线引导建议')}<span className="hint">{t('只是建议：不会自动写回草稿，作者确认后自行修改')}</span></h4>
      {hints.map(h => (
        <section key={h.endingId}>
          <p><strong>{h.title}</strong> <span className="preflight-guidance-rate">{t('随机到达 {a}% → {b}%（同 {n} 局）', { a: percent1(h.randomBefore), b: percent1(h.randomAfter), n: h.seeds })}</span></p>
          {h.edits.length > 0 ? <ol>{h.edits.map((e, n) => <li key={n}>{describe(e)}</li>)}</ol> : <p className="hint">{t('自动建议没有改善随机到达率')}</p>}
          <p className="hint">{t('关键步骤：{steps}', { steps: h.keySteps.join(' → ') })}</p>
        </section>
      ))}
    </div>
  );
}

/** S3: why the 「随机」 run is short + static minimum steps per ending next to the simulated minimum. */
export function PacingDiagnosis({ report }: { report: PlaytestReport }) {
  const { t } = useI18n();
  const pc = report.pacing;
  if (!pc) return null;
  return (
    <>
      {pc.causes.length > 0
        ? <ul className="preflight-pacing-causes">{pc.causes.map((c, n) => <li key={n}><span>{c.message}</span><span className="preflight-pacing-fix">{t('建议：{s}', { s: c.suggestion })}</span></li>)}</ul>
        : <p className="hint">{pc.belowLine ? t('低于节奏线，但没有找到单一原因') : t('「随机」中位数已达到节奏线')}</p>}
      <table className="preflight-table preflight-route-table" data-testid="preflight-pacing-estimate">
        <thead><tr><th>{t('结局')}</th><th className="num">{t('静态最少步数')}</th><th className="num">{t('模拟最少')}</th><th className="num">{t('随机占比')}</th><th className="num">{t('随机中位')}</th></tr></thead>
        <tbody>
          {pc.estimate.rows.map(r => (
            <tr key={r.endingId}>
              <td>{r.kind === 'failure' ? t('{title}（失败）', { title: r.title }) : r.title}</td>
              <td className="num">{r.estimateMin < 0 ? '—' : r.estimateMin}</td>
              <td className="num">{r.simulatedMin ?? '—'}</td>
              <td className="num">{percent1(r.randomShare)}%</td>
              <td className="num">{r.randomMedian ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
