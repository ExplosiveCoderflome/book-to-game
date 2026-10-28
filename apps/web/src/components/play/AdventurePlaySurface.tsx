import { useEffect, useMemo, useRef, useState } from 'react';
import type { AdventureView, NarrateResult, WorldRevision } from '@novel-game/contracts';
import { useI18n } from '../../lib/i18n';
import { worldPlayOverlayFromAdventure } from '../../lib/world-play-overlay';
import { resourceLabelFnFromWorld, type OptionChangeSummary, type VariableDelta } from '../../lib/variable-delta';
import { Empty } from '../Notice';
import { NarrateBox } from '../NarrateBox';
import { TiandaoToggle } from '../TiandaoToggle';
import { WorldGraphCanvas } from '../WorldGraphCanvas';
import { PlayMapPanel } from './PlayMapPanel';
import { PlayStatsBar, PlayStatsCompact } from '../PlayStatsBar';
import { useCompactViewport } from '../../lib/use-compact-viewport';
import { PlayEndingPanel, endingSummaryFromResources } from '../PlayEndingPanel';
import { AdventureActionRow } from './AdventureActionRow';
import { FillInteractionSheet } from './FillInteractionSheet';
import { useFillActionList } from './useFillActionList';
import { PlayClockStrip } from './PlayClockStrip';
import { StoryletHand } from './StoryletHand';
import { RollOutcomeLine } from './RollChanceNote';
import { formatDuration, s1DeltaChips } from '../../lib/s1-play';

export type AdventurePlaySurfaceProps = {
  session: AdventureView | null;
  revision: WorldRevision | null | undefined;
  busy: boolean;
  uncertain?: boolean;
  resDeltas?: VariableDelta[] | null;
  optionChanges?: OptionChangeSummary | null;
  showAiAux?: boolean;
  pathDefaultOpen?: boolean;
  onAct: (actionId: string) => void;
  onReplay: () => void;
  onReload?: () => void;
  onRetryPending?: () => void;
  onNarrate?: (force: boolean) => Promise<NarrateResult>;
  onSecondary?: () => void;
  secondaryLabel?: string;
  emptyHint?: string;
  /** When true, wrap reading + optional map in with-map layout fragment. */
  includeMapColumn?: boolean;
  /** Export package: 「本局不会保存。」 when storage is unavailable. */
  autosaveHint?: string;
  replayLabel?: string;
  /** Author play only (S1-U12): seed line under the history. */
  showSeed?: boolean;
  /** Author playtest only: list every known fact with 当前成立/不成立. Players see established facts only (no spoilers). */
  showAllFacts?: boolean;
  /** Player shell / package: the page heading already carries the version (M14). */
  hideMetaVersion?: boolean;
};

/** Open adventure seat — shared by author AdventurePanel and player shell. */
export function AdventurePlaySurface({
  session, revision, busy, uncertain, resDeltas, optionChanges,
  showAiAux = true, pathDefaultOpen = true,
  onAct, onReplay, onReload, onRetryPending, onNarrate,
  onSecondary, secondaryLabel, emptyHint, includeMapColumn = true, autosaveHint, replayLabel, showSeed, showAllFacts, hideMetaVersion,
}: AdventurePlaySurfaceProps) {
  const { t } = useI18n();
  const [showPath, setShowPath] = useState(pathDefaultOpen);
  const playOverlay = useMemo(() => {
    if (!session || !revision) return null;
    return worldPlayOverlayFromAdventure(revision.content, session);
  }, [session, revision]);
  const compact = useCompactViewport();
  const resultRef = useRef<HTMLElement | null>(null);
  const endingRef = useRef<HTMLDivElement | null>(null);
  const lastTurn = useRef<{id?: string; turn?: number; ended?: boolean}>({});
  // Phone: after a choice the new 「刚刚发生」 sits far below the tapped button — bring it into view (desktop untouched).
  // Arrival at an ending (E4): scroll to 「刚刚发生」 (the ending follows right after it); if that block is taller than 40vh,
  // scroll to the ending itself so its eyebrow + title are on the first screen. Opening an already-ended save never scrolls.
  useEffect(() => {
    const prev = lastTurn.current;
    lastTurn.current = {id: session?.id, turn: session?.turn, ended: session?.ended};
    if (!session || prev.id !== session.id || prev.turn === undefined || session.turn <= prev.turn) return;
    const arrived = session.ended && !prev.ended;
    if (arrived) {
      const title = endingRef.current?.querySelector<HTMLElement>('.play-ending-title');
      if (compact) {
        const result = resultRef.current;
        const tall = !result || result.getBoundingClientRect().height > window.innerHeight * 0.4;
        const target = tall ? endingRef.current : result;
        if (target && typeof target.scrollIntoView === 'function') target.scrollIntoView({block: 'start', behavior: 'auto'});
        title?.focus({preventScroll: true});
      }
      return;
    }
    if (!compact) return;
    const el = resultRef.current;
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({block: 'start', behavior: 'auto'});
  }, [compact, session]);
  const fillList = useFillActionList(session?.actions ?? [], session?.fillGroups, session?.location.id);
  const s1 = !!session?.resourceMeta || !!session?.clock || !!session?.hand;
  const monthUnit = session?.timeUnit;
  const pressureIds = useMemo(() => new Set(Object.entries(revision?.content.resourceDefs ?? {})
    .filter(([, def]) => def.warnAtLeast !== undefined || !!def.onMax?.ending).map(([id]) => id)), [revision]);
  const shownFacts = (session?.facts ?? []).filter(f => showAllFacts || f.value === true);
  const s1Chips = session?.lastResult ? s1DeltaChips(session.lastResult, pressureIds, session.resourceMeta, t) : null;
  const s1Summary = () => {
    if (!session) return [];
    const chips = [] as { label: string; value: string }[];
    if (session.clock) chips.push({ label: t('时间'), value: session.clock.label });
    const meta = session.resourceMeta ?? [];
    for (const m of meta.filter(m => m.valueLabel)) chips.push({ label: m.label, value: m.valueLabel! });
    for (const m of meta.filter(m => m.display === 'bar' && !m.valueLabel)) chips.push({ label: m.label, value: m.max !== undefined ? `${m.value}/${m.max}` : String(m.value) });
    return chips.slice(0, 4);
  };

  const factList = shownFacts.length
    ? shownFacts.map(f => (
      <div className="known-fact" key={f.id} data-fact-value={String(f.value)}>
        <strong>{f.label}</strong>
        {showAllFacts ? <span className="hint"> · {f.value ? t('当前成立') : t('当前不成立')}</span> : null}
        <p>{f.description}</p>
      </div>
    ))
    : <p className="hint">{t('尚未发现线索。')}</p>;

  const reading = !session ? (
    <>
      <Empty>{busy ? t('正在读取存档…') : (emptyHint ?? t('开始新冒险或打开已有存档。'))}</Empty>
      {onReload && <button type="button" disabled={busy} onClick={onReload}>{t('重新读取存档')}</button>}
    </>
  ) : (
    <>
      <div className="reader-meta">
        <span>{revision?.content.title ?? t('开放冒险')}{hideMetaVersion ? '' : ` · v${revision?.version ?? '—'}`}</span>
        <span>{t('行动')} {session.turn}</span>
      </div>
      <div className="adventure-goal">
        <strong>{session.playerRole}</strong>
        <p>{t('目标：')}{session.goal}</p>
        {session.clock ? <PlayClockStrip clock={session.clock} /> : (
          <label>{t('时间 · 已用 {elapsed} / {limit} · 剩余 {remaining}', {
            elapsed: session.elapsed, limit: session.timeLimit, remaining: Math.max(0, session.timeLimit - session.elapsed),
          })}
            <progress max={session.timeLimit} value={session.elapsed} />
          </label>
        )}
      </div>
      {compact && session.resourceMeta?.length ? <PlayStatsCompact meta={session.resourceMeta} countdownId={session.clock?.countdown?.resourceId} isStatic={session.ended} /> : null}
      <h3>{session.location.title}</h3>
      <div className="reader-text">{session.location.text.split(/\n+/).map((text, i) => <p key={i}>{text}</p>)}</div>
      <PlayStatsBar
        resources={session.resources ?? {}}
        resourceLabels={Object.fromEntries(Object.keys(session.resources ?? {}).map(id => [id, resourceLabelFnFromWorld(revision?.content)(id)]))}
        deltas={resDeltas}
        optionChanges={optionChanges}
        showEmpty
        resourceMeta={session.resourceMeta ?? null}
        s1Deltas={s1Chips}
      />
      {showAiAux && onNarrate && (
        <>
          <TiandaoToggle disabled={busy || !!uncertain} />
          <NarrateBox visitKey={`${session.id}:${session.location.id}:${session.turn}`} disabled={busy || !!uncertain} onNarrate={onNarrate} />
        </>
      )}
      {session.turn > 0 && (
        <section className="adventure-result" aria-live="polite" ref={resultRef} data-testid="adventure-result">
          <p className="eyebrow">{session.lastResult
            ? (session.lastResult.months > 0
              ? t('刚刚发生 · {title} · 用去 {duration}', { title: session.lastResult.actionLabel, duration: formatDuration(session.lastResult.months, t) })
              : t('刚刚发生 · {title}', { title: session.lastResult.actionLabel }))
            : t('刚刚发生')}</p>
          {session.lastResult?.roll ? <RollOutcomeLine roll={session.lastResult.roll} /> : null}
          {session.history.at(-1)?.text.split(/\n+/).map((text, i) => <p key={i}>{text}</p>)}
          {session.lastResult?.windows?.opened.map(name => <p key={`o-${name}`} className="window-line">{t('{name}开启了。', { name })}</p>)}
          {session.lastResult?.windows?.closed.map(name => <p key={`c-${name}`} className="window-line">{t('{name}已经结束。', { name })}</p>)}
        </section>
      )}
      {session.ended && session.ending && (
        <PlayEndingPanel
          panelRef={endingRef}
          mode="open"
          title={session.ending.title}
          body={session.ending.text}
          summary={s1 ? s1Summary() : endingSummaryFromResources(
            session.resources,
            Object.fromEntries(Object.keys(session.resources ?? {}).map(id => [id, resourceLabelFnFromWorld(revision?.content)(id)])),
            [{ label: t('时间'), value: `${session.elapsed}/${session.timeLimit}` }],
          )}
          kind={session.ending.kind ?? 'ending'}
          path={session.ending.path}
          passages={session.ending.passages}
          recap={session.ending.recap}
          onReplay={onReplay}
          replayBusy={busy}
          onBackEdit={onSecondary}
          backLabel={secondaryLabel}
          replayLabel={replayLabel}
        />
      )}
      <div className="world-grid">
        {compact ? (
          // Phone: 「已知信息」 folded by default so the choices stay close to the text.
          <details className="known-facts-fold" data-testid="known-facts">
            <summary>{t('已知信息 · {n} 条', { n: shownFacts.length })}</summary>
            {factList}
          </details>
        ) : (
          <section data-testid="known-facts">
            <h4>{t('已知信息')}</h4>
            {factList}
          </section>
        )}
        <section>
          <h4>{t('在场人物')}</h4>
          {session.npcs.length
            ? session.npcs.map(n => <div key={n.id}><strong>{n.name}</strong><p>{n.description}</p></div>)
            : <p className="hint">{t('这里暂时没有其他人。')}</p>}
        </section>
      </div>
      {uncertain && onRetryPending && (
        <button type="button" className="primary" disabled={busy} onClick={onRetryPending}>{t('重试并确认上一行动')}</button>
      )}
      {!session.ended && !uncertain && (
        <div className="adventure-actions">
          {session.hand ? null : <p className="eyebrow">{t('可以采取的行动')}</p>}
          {session.hand ? <p className="adventure-subhead"><span>{t('此地可做')}</span></p> : null}
          {fillList.mainItems.map(item => item.type === 'action'
            ? <AdventureActionRow key={item.action.id} action={item.action} disabled={busy} timeUnit={monthUnit} onClick={() => void onAct(item.action.id)} />
            : (
              <div key={`entry-${item.group.id}`} className="adventure-action" data-testid="fill-entry-row">
                <button type="button" disabled={busy} onClick={() => fillList.openSheet(item.group.id)}>
                  <span className="adventure-action-body">
                    <span className={`adventure-action-kind${item.group.kindHint === 'boss' ? ' is-boss' : ''}`}>
                      {t(item.group.kindHint === 'shop' ? '商店'
                        : item.group.kindHint === 'supply' ? '补给'
                        : item.group.kindHint === 'quest' ? '任务'
                        : item.group.kindHint === 'encounter' ? '遭遇'
                        : item.group.kindHint === 'boss' ? 'Boss'
                        : item.group.kindHint)}
                    </span>
                    <strong className="adventure-action-label">
                      {t((item.group.kindHint === 'encounter' || item.group.kindHint === 'boss') ? '面对·{name}' : '走进{name}', { name: item.group.label })}
                    </strong>
                    <span className="adventure-action-meta">{t('耗时 {time}', { time: 0 })}</span>
                  </span>
                  <span className="adventure-action-arrow" aria-hidden="true">→</span>
                </button>
              </div>
            ))}
          {!fillList.mainItems.length && <p className="hint">{t('当前没有可见行动。')}</p>}
          {session.hand ? <StoryletHand hand={session.hand} busy={busy} timeUnit={monthUnit} onAct={id => void onAct(id)} /> : null}
          {fillList.openGroup && (
            <FillInteractionSheet
              group={fillList.openGroup}
              lines={fillList.openLines}
              busy={busy}
              uncertain={!!uncertain}
              onAct={id => void onAct(id)}
              onClose={fillList.closeSheet}
            />
          )}
        </div>
      )}
      <div className="reader-footer">
        {session.ended ? null : <p className="hint" data-testid="autosave-hint">{autosaveHint ?? t('行动成功后自动保存。')}</p>}
        {onReload && <button type="button" className="quiet small" disabled={busy} onClick={onReload}>{t('重新读取存档')}</button>}
      </div>
      <details className="history" open>
        <summary>{t('回看行程 · {count} 条记录', { count: session.history.length })}</summary>
        {session.history.map((h, i) => (
          <div key={i}>
            <p className="eyebrow">{monthUnit
              ? (h.elapsed === 0 ? t('行动 {turn} · 开局', { turn: h.turn }) : t('行动 {turn} · 已过 {date}', { turn: h.turn, date: formatDuration(h.elapsed, t) }))
              : t('行动 {turn} · 耗时 {elapsed}', { turn: h.turn, elapsed: h.elapsed })}{h.actionLabel ? ` · ${h.actionLabel}` : ''}</p>
            <p>{h.text}</p>
          </div>
        ))}
        {showSeed && session.rng ? <p className="play-seed" data-testid="play-seed">{t('种子 {seed} · 第 {cursor} 次取数', { seed: session.rng.seed, cursor: session.rng.cursor })}</p> : null}
      </details>
      {revision && (
        <div className="play-path-panel" data-testid="world-play-path-panel">
          <div className="panel-heading">
            <h3>{t('世界路径')}</h3>
            <button type="button" className="small" onClick={() => setShowPath(v => !v)}>
              {t(showPath ? '收起路径画布' : '展开路径画布')}
            </button>
          </div>
          {showPath && playOverlay && (
            <WorldGraphCanvas
              content={revision.content}
              selectedLocationId={session.location.id}
              onSelectLocation={() => { /* play view follows session */ }}
              playOverlay={playOverlay}
              readOnly
            />
          )}
        </div>
      )}
    </>
  );

  if (!includeMapColumn) {
    return <article className="panel reading-page">{reading}</article>;
  }

  return (
    <>
      <article className="panel reading-page">{reading}</article>
      {session?.map && revision && (
        <aside className="play-map-column"><PlayMapPanel content={revision.content} session={session} /></aside>
      )}
    </>
  );
}
