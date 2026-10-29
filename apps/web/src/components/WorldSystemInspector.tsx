import type { WorldContent, WorldBaseEffect } from '@novel-game/contracts';
import { useI18n } from '../lib/i18n';

/** §3.7: read-only S1 system view (resources / clock & windows / storylet pool). No inputs (editing is S3). */
export function WorldSystemInspector({ content }: { content: WorldContent }) {
  const { t } = useI18n();
  const defs = Object.entries(content.resourceDefs ?? {});
  const clock = content.clock;
  const storylets = content.storylets ?? [];
  if (!defs.length && !clock && !storylets.length) return <p className="hint" data-testid="world-system-inspector">{t('这个世界没有声明资源定义、时钟或剧情卡。')}</p>;
  const endingTitle = (id?: string) => content.endings.find(e => e.id === id)?.title ?? id;
  const storyletTitle = (id?: string) => storylets.find(s => s.id === id)?.title ?? id;
  const resLabel = (id: string) => content.resourceDefs?.[id]?.label ?? id;
  const locTitle = (id: string) => content.locations.find(l => l.id === id)?.title ?? id;
  const trigger = (trig: { ending?: string; storylet?: string } | undefined, word: string) => !trig ? '' : trig.ending
    ? t('{w} → 结局「{title}」', { w: word, title: endingTitle(trig.ending) ?? '' })
    : trig.storylet ? t('{w} → 剧情卡「{title}」', { w: word, title: storyletTitle(trig.storylet) ?? '' }) : '';
  const display = { bar: t('条形'), number: t('数字'), pips: t('格子'), hidden: t('隐藏') } as const;
  const calendar = (m: number) => !clock ? String(m) : (clock.display ?? '第{year}年 {month}月')
    .replace('{year}', String(clock.startYear + Math.floor((clock.startMonth - 1 + m) / 12)))
    .replace('{month}', String(((clock.startMonth - 1 + m) % 12) + 1));
  const effectText = (e: WorldBaseEffect) => e.kind === 'resource' ? `${resLabel(e.resourceId)} ${e.delta >= 0 ? '+' : '−'}${Math.abs(e.delta)}` : e.kind;
  const oneTime = storylets.filter(s => !s.repeat).length;
  const urgent = storylets.filter(s => s.urgent).length;
  return (
    <div className="world-system-inspector" data-testid="world-system-inspector">
      {defs.length > 0 && <>
        <h5>{t('资源定义 {n}', { n: defs.length })}</h5>
        <table className="preflight-table"><tbody>
          {defs.map(([id, d]) => (
            <tr key={id}>
              <td>{d.label}<code>{id}</code></td>
              <td>{d.min}–{d.max ?? '∞'}{d.unit ? ` ${d.unit}` : ''}</td>
              <td>{t('起始 {n}', { n: d.initial ?? d.min })} · {display[d.display ?? 'number']}</td>
              <td>{d.warnAtMost !== undefined ? t('≤{n} 告急', { n: d.warnAtMost }) : d.warnAtLeast !== undefined ? t('≥{n} 告急', { n: d.warnAtLeast }) : '—'}</td>
              <td>{[trigger(d.onMin, t('触底')), trigger(d.onMax, t('封顶'))].filter(Boolean).join(' · ') || '—'}</td>
            </tr>
          ))}
        </tbody></table>
      </>}
      {clock && <>
        <h5>{t('时钟')}</h5>
        <p>{t('起始 {date} · 显示「{tpl}」· 时限 {n} 个月', { date: calendar(0), tpl: clock.display ?? '第{year}年 {month}月', n: clock.limitMonths })}</p>
        {(clock.rules ?? []).map((r, i) => <p key={i}>{t('每 {n} 个月：{effects}', { n: r.everyMonths, effects: r.effects.map(effectText).join('，') })}</p>)}
        {(clock.windows ?? []).length > 0 && <p>{t('窗口')}　{(clock.windows ?? []).map(w => t('{label} 第 {from}–{to} 月{card}', {
          label: w.label ?? w.id, from: w.fromMonth, to: w.toMonth, card: w.storyletId ? t(' → 卡「{title}」', { title: storyletTitle(w.storyletId) ?? '' }) : '' })).join(' · ')}</p>}
      </>}
      {storylets.length > 0 && <>
        <h5>{t('剧情卡池 {n} · 一次性 {o} · 可重复 {r} · 急事 {u}', { n: storylets.length, o: oneTime, r: storylets.length - oneTime, u: urgent })}</h5>
        <div className="world-system-scroll">
          <table className="preflight-table">
            <thead><tr><th>{t('卡')}</th><th>{t('地点')}</th><th>{t('类型')}</th><th>{t('变体')}</th><th>{t('选项')}</th></tr></thead>
            <tbody>
              {storylets.map(s => (
                <tr key={s.id}>
                  <td>{s.title} <code>{s.id}</code></td>
                  <td>{s.locationIds?.length ? s.locationIds.map(locTitle).join('、') : t('任意')}</td>
                  <td>{[s.repeat ? t('可重复 · 冷却 {c}', { c: s.repeat.cooldownTurns }) + (s.repeat.maxTimes ? t(' · 最多 {m}', { m: s.repeat.maxTimes }) : '') : t('一次性'), s.urgent ? t('急事') : ''].filter(Boolean).join(' · ')}</td>
                  <td className="num">{s.textVariants?.length ?? 1}{s.textCases?.length ? ` + ${t('{n} 条按状态', { n: s.textCases.length })}` : ''}</td>
                  <td className="num">{s.choices.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>}
      <p className="hint">{t('改这些字段请用「高级 JSON」；剧情卡编辑器在后续版本提供。')}</p>
    </div>
  );
}
