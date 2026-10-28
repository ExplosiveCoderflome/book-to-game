import type { LintCategory, PassCheck, PlaytestReport } from '@novel-game/contracts';
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
          <td>{t('中位决策 / 字数 / 月')}</td>
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
