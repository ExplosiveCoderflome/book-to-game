import { useMemo } from 'react';
import type { AdventureView, NarrateResult, ProposeActResult, WorldRevision } from '@novel-game/contracts';
import { useI18n } from '../../lib/i18n';
import { resourceLabelFnFromWorld, type OptionChangeSummary, type VariableDelta } from '../../lib/variable-delta';
import { Empty, Notice } from '../Notice';
import { NarrateBox } from '../NarrateBox';
import { TiandaoToggle } from '../TiandaoToggle';
import { ProposeActBox } from '../ProposeActBox';
import { PlayStatsBar } from '../PlayStatsBar';
import { PlayEndingPanel, endingSummaryFromResources } from '../PlayEndingPanel';
import { AdventureActionRow } from './AdventureActionRow';
import { FillInteractionSheet } from './FillInteractionSheet';
import { useFillActionList } from './useFillActionList';

type Props = {
  latestRevision: WorldRevision | null;
  playSession: AdventureView | null;
  playBusy: boolean;
  proposeNote: string | null;
  playResDeltas?: VariableDelta[] | null;
  playOptionChanges?: OptionChangeSummary | null;
  onBackEdit: () => void;
  onAct: (actionId: string) => void;
  onRestart?: () => void;
  onNarrate: (force: boolean) => Promise<NarrateResult>;
  onPropose: (text: string) => Promise<ProposeActResult>;
  onOpenAdventure?: (revisionId: string) => void;
};

/** Play-mode side panel for open-world canvas (presentation only). */
export function WorldPlayInspector({
  latestRevision, playSession, playBusy, proposeNote, playResDeltas, playOptionChanges,
  onBackEdit, onAct, onRestart, onNarrate, onPropose, onOpenAdventure,
}: Props) {
  const { t } = useI18n();
  const fillList = useFillActionList(playSession?.actions ?? [], playSession?.fillGroups, playSession?.location.id);
  const resourceLabels = useMemo(() => {
    if (!latestRevision) return {} as Record<string, string>;
    const fn = resourceLabelFnFromWorld(latestRevision.content);
    const ids = Object.keys(playSession?.resources ?? latestRevision.content.resources ?? {});
    return Object.fromEntries(ids.map(id => [id, fn(id)]));
  }, [latestRevision, playSession?.resources]);

  return (
    <aside className="draft-inspector play-inspector" aria-label={t('试玩面板')} data-testid="world-play-inspector">
      <div className="draft-inspector-header">
        <strong>{t('试玩')}</strong>
        <button type="button" className="quiet small" onClick={onBackEdit}>{t('返回编辑')}</button>
      </div>
      <div className="draft-inspector-body stack">
        {!latestRevision ? <Empty>{t('请先发布一个世界版本，再在画布上试玩。')}</Empty>
          : playBusy && !playSession ? <p role="status">{t('正在准备试玩…')}</p>
          : !playSession ? <Empty>{t('尚未打开存档。')}</Empty>
          : <>
            <p className="hint">{t('发布版本 v{version} · 行动 {turn}', { version: latestRevision.version, turn: playSession.turn })}</p>
            <div className="adventure-goal">
              <strong>{playSession.playerRole}</strong>
              <p>{t('目标：')}{playSession.goal}</p>
              <label>{t('时间 · 已用 {elapsed} / {limit}', { elapsed: playSession.elapsed, limit: playSession.timeLimit })}
                <progress max={playSession.timeLimit} value={playSession.elapsed} />
              </label>
            </div>
            <h4>{playSession.location.title}</h4>
            {proposeNote && <Notice kind="success" text={proposeNote} />}
            <div className="reader-text">{playSession.location.text.split(/\n+/).map((text, i) => <p key={i}>{text}</p>)}</div>
            <PlayStatsBar
              resources={playSession.resources ?? {}}
              resourceLabels={resourceLabels}
              deltas={playResDeltas}
              optionChanges={playOptionChanges}
              showEmpty
            />
            <div className="reader-aux stack">
              <TiandaoToggle disabled={playBusy} />
              <NarrateBox visitKey={`${playSession.id}:${playSession.location.id}:${playSession.turn}`} disabled={playBusy} onNarrate={onNarrate} />
            </div>
            {playSession.ended && playSession.ending && (
              <PlayEndingPanel
                mode="open"
                title={playSession.ending.title}
                body={playSession.ending.text}
                passages={playSession.ending.passages}
                recap={playSession.ending.recap}
                summary={endingSummaryFromResources(
                  playSession.resources,
                  resourceLabels,
                  [{ label: t('时间'), value: `${playSession.elapsed}/${playSession.timeLimit}` }],
                )}
                onReplay={() => onRestart?.()}
                onBackEdit={onBackEdit}
                replayBusy={playBusy}
              />
            )}
            {!playSession.ended && <div className="adventure-actions">
              <p className="eyebrow">{t('可以采取的行动')}</p>
              {fillList.mainItems.map(item => item.type === 'action'
                ? <AdventureActionRow key={item.action.id} action={item.action} compact disabled={playBusy} onClick={() => void onAct(item.action.id)} />
                : <div key={`entry-${item.group.id}`} className="adventure-action" data-testid="fill-entry-row">
                    <button type="button" disabled={playBusy} onClick={() => fillList.openSheet(item.group.id)}>
                      <span className="adventure-action-body">
                        <span className={`adventure-action-kind${item.group.kindHint === 'boss' ? ' is-boss' : ''}`}>{t(item.group.kindHint === 'shop' ? '商店' : item.group.kindHint === 'supply' ? '补给' : item.group.kindHint === 'quest' ? '任务' : item.group.kindHint === 'encounter' ? '遭遇' : item.group.kindHint === 'boss' ? 'Boss' : item.group.kindHint)}</span>
                        <strong className="adventure-action-label">{t((item.group.kindHint === 'encounter' || item.group.kindHint === 'boss') ? '面对·{name}' : '走进{name}', { name: item.group.label })}</strong>
                        <span className="adventure-action-meta">{t('耗时 {time}', { time: 0 })}</span>
                      </span>
                      <span className="adventure-action-arrow" aria-hidden="true">→</span>
                    </button>
                  </div>)}
              {!fillList.mainItems.length && <p className="hint">{t('当前没有可见行动。')}</p>}
              {fillList.openGroup && (
                <FillInteractionSheet
                  group={fillList.openGroup}
                  lines={fillList.openLines}
                  busy={playBusy}
                  compact
                  onAct={id => void onAct(id)}
                  onClose={fillList.closeSheet}
                />
              )}
            </div>}
            {!playSession.ended && <ProposeActBox disabled={playBusy} busy={playBusy} onPropose={onPropose} onPickCandidate={id => void onAct(id)} />}
            {onOpenAdventure && latestRevision && <button type="button" className="quiet small" onClick={() => onOpenAdventure(latestRevision.id)}>{t('在开放冒险打开 →')}</button>}
          </>}
      </div>
    </aside>
  );
}
