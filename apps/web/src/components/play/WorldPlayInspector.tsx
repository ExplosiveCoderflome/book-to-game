import { SYSTEM_WAIT_ACTION_ID, type AdventureView, type NarrateResult, type ProposeActResult, type WorldRevision } from '@novel-game/contracts';
import { useI18n } from '../../lib/i18n';
import { Empty, Notice } from '../Notice';
import { NarrateBox } from '../NarrateBox';
import { TiandaoToggle } from '../TiandaoToggle';
import { ProposeActBox } from '../ProposeActBox';

type Props = {
  latestRevision: WorldRevision | null;
  playSession: AdventureView | null;
  playBusy: boolean;
  proposeNote: string | null;
  onBackEdit: () => void;
  onAct: (actionId: string) => void;
  onNarrate: (force: boolean) => Promise<NarrateResult>;
  onPropose: (text: string) => Promise<ProposeActResult>;
  onOpenAdventure?: (revisionId: string) => void;
};

/** Play-mode side panel for open-world canvas (presentation only). */
export function WorldPlayInspector({
  latestRevision, playSession, playBusy, proposeNote,
  onBackEdit, onAct, onNarrate, onPropose, onOpenAdventure,
}: Props) {
  const { t } = useI18n();
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
            {playSession.resources && Object.keys(playSession.resources).length > 0 && (
              <p className="hint" data-testid="play-resources">{t('资源：')}{Object.entries(playSession.resources).map(([k, v]) => `${k}=${v}`).join(' · ')}</p>
            )}
            <div className="reader-text">{playSession.location.text.split(/\n+/).map((text, i) => <p key={i}>{text}</p>)}</div>
            <TiandaoToggle disabled={playBusy} />
            <NarrateBox visitKey={`${playSession.id}:${playSession.location.id}:${playSession.turn}`} disabled={playBusy} onNarrate={onNarrate} />
            {playSession.ending && <div className="ending"><p className="eyebrow">{t('冒险结局')}</p><h4>{playSession.ending.title}</h4><p>{playSession.ending.text}</p></div>}
            {!playSession.ended && <div className="adventure-actions">
              <p className="eyebrow">{t('可以采取的行动')}</p>
              {playSession.actions.map(a => (
                <div className="adventure-action" key={a.id}>
                  <button type="button" disabled={playBusy || !a.enabled} onClick={() => void onAct(a.id)}>
                    <strong>{a.id === SYSTEM_WAIT_ACTION_ID ? t(a.label) : a.label}</strong>
                    <span>{t('耗时 {time} →', { time: a.timeCost })}</span>
                  </button>
                  {!a.enabled && <p className="blocked-reason">{a.blockedReason ?? t('当前条件不满足')}</p>}
                </div>
              ))}
            </div>}
            {!playSession.ended && <ProposeActBox disabled={playBusy} busy={playBusy} onPropose={onPropose} onPickCandidate={id => void onAct(id)} />}
            {onOpenAdventure && latestRevision && <button type="button" className="quiet small" onClick={() => onOpenAdventure(latestRevision.id)}>{t('在开放冒险打开 →')}</button>}
          </>}
      </div>
    </aside>
  );
}
