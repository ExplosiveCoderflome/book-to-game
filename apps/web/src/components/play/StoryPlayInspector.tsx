import type { GameRevision, NarrateResult, ProposeActResult, SessionView } from '@novel-game/contracts';
import { costHintForChoice, type VariableDelta } from '../../lib/variable-delta';
import { useI18n } from '../../lib/i18n';
import { Empty, Notice } from '../Notice';
import { PlayStatsBar } from '../PlayStatsBar';
import { NarrateBox } from '../NarrateBox';
import { TiandaoToggle } from '../TiandaoToggle';
import { ProposeActBox } from '../ProposeActBox';

type Props = {
  latestRevision: GameRevision | null;
  playSession: SessionView | null;
  playBusy: boolean;
  proposeNote: string | null;
  playVarDeltas: VariableDelta[] | null;
  onBackEdit: () => void;
  onAct: (choiceId: string) => void;
  onNarrate: (force: boolean) => Promise<NarrateResult>;
  onPropose: (text: string) => Promise<ProposeActResult>;
  onOpenPlay?: (revisionId: string) => void;
};

/** Play-mode side panel for story canvas (presentation only). */
export function StoryPlayInspector({
  latestRevision, playSession, playBusy, proposeNote, playVarDeltas,
  onBackEdit, onAct, onNarrate, onPropose, onOpenPlay,
}: Props) {
  const { t } = useI18n();
  return (
    <aside className="draft-inspector play-inspector" aria-label={t('试玩面板')} data-testid="draft-play-inspector">
      <div className="draft-inspector-header">
        <strong>{t('试玩')}</strong>
        <button type="button" className="quiet small" onClick={onBackEdit}>{t('返回编辑')}</button>
      </div>
      <div className="draft-inspector-body stack">
        {!latestRevision ? <Empty>{t('请先发布一个版本，再在画布上试玩。')}</Empty>
          : playBusy && !playSession ? <p role="status">{t('正在准备试玩…')}</p>
          : !playSession ? <Empty>{t('尚未打开存档。')}</Empty>
          : <>
            <p className="hint">{t('发布版本 v{version} · 第 {turn} 幕', { version: latestRevision.version, turn: playSession.turn + 1 })}</p>
            <h4>{playSession.scene.title}</h4>
            {proposeNote && <Notice kind="success" text={proposeNote} />}
            <div className="reader-text">{playSession.scene.text.split(/\n+/).map((text, i) => <p key={i}>{text}</p>)}</div>
            <PlayStatsBar variables={playSession.variables ?? {}} deltas={playVarDeltas} statTemplateId={latestRevision?.content.statTemplateId} statTemplateVersion={latestRevision?.content.statTemplateVersion} />
            {playSession.ended && <div className="ending"><p className="eyebrow">{t('故事抵达了一个结局')}</p><p>{playSession.scene.ending ?? t('旅程告一段落。')}</p></div>}
            {!playSession.ended && <div className="reader-choices"><p className="eyebrow">{t('你将如何选择？')}</p>{playSession.scene.choices.map((choice, i) => {
              const cost = costHintForChoice(latestRevision?.content, playSession.scene.id, choice.id);
              return <button key={choice.id} type="button" className="reader-choice" disabled={playBusy} onClick={() => void onAct(choice.id)}>
                <span className="reader-choice-index" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
                <span className="reader-choice-body">
                  <span className="reader-choice-label">{choice.label}</span>
                  {cost ? <span className="reader-choice-cost">{t('代价')}：{cost}</span> : null}
                </span>
                <span className="reader-choice-arrow" aria-hidden="true">→</span>
              </button>;
            })}</div>}
            <div className="reader-aux stack">
              <TiandaoToggle disabled={playBusy} />
              <NarrateBox visitKey={`${playSession.id}:${playSession.scene.id}:${playSession.turn}`} disabled={playBusy} onNarrate={onNarrate} />
              {!playSession.ended && <ProposeActBox disabled={playBusy} busy={playBusy} onPropose={onPropose} onPickCandidate={id => void onAct(id)} />}
            </div>
            {onOpenPlay && latestRevision && <button type="button" className="quiet small" onClick={() => onOpenPlay(latestRevision.id)}>{t('在读者席打开 →')}</button>}
          </>}
      </div>
    </aside>
  );
}
