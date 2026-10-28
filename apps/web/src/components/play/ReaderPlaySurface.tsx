import { useMemo, useState } from 'react';
import type { GameRevision, NarrateResult, ProposeActResult, SessionView } from '@novel-game/contracts';
import { useI18n } from '../../lib/i18n';
import { playOverlayFromSession } from '../../lib/play-overlay';
import { costHintForChoice, type OptionChangeSummary, type VariableDelta } from '../../lib/variable-delta';
import { BranchGraphCanvas } from '../BranchGraphCanvas';
import { Empty, Notice } from '../Notice';
import { NarrateBox } from '../NarrateBox';
import { PlayStatsBar } from '../PlayStatsBar';
import { PlayEndingPanel, endingSummaryFromVariables } from '../PlayEndingPanel';
import { ProposeActBox } from '../ProposeActBox';
import { TiandaoToggle } from '../TiandaoToggle';
import { ReaderChoiceRow } from './ReaderChoiceRow';

export type ReaderPlaySurfaceProps = {
  session: SessionView | null;
  revision: GameRevision | null | undefined;
  busy: boolean;
  uncertain?: boolean;
  varDeltas?: VariableDelta[] | null;
  optionChanges?: OptionChangeSummary | null;
  proposeNote?: string | null;
  /** Author tab shows AI aux; player shell defaults false (A4 / M4). */
  showAiAux?: boolean;
  /** Path canvas default collapsed in player shell (A4). */
  pathDefaultOpen?: boolean;
  pendingRetryLabel?: string | null;
  onAct: (choiceId: string) => void;
  onReplay: () => void;
  onReload?: () => void;
  onRetryPending?: () => void;
  onNarrate?: (force: boolean) => Promise<NarrateResult>;
  onPropose?: (text: string) => Promise<ProposeActResult>;
  /** Quiet ending CTA — player: 返回书目; author may pass 回编辑… */
  onSecondary?: () => void;
  secondaryLabel?: string;
  emptyHint?: string;
  /** Replaces the footer save-id line (export package never shows ids). */
  autosaveHint?: string;
  replayLabel?: string;
};

/** Story reader seat — shared by author PlayPanel and player shell. No left catalog. */
export function ReaderPlaySurface({
  session, revision, busy, uncertain, varDeltas, optionChanges, proposeNote,
  showAiAux = true, pathDefaultOpen = true,
  onAct, onReplay, onReload, onRetryPending, onNarrate, onPropose,
  onSecondary, secondaryLabel, emptyHint, autosaveHint, replayLabel,
}: ReaderPlaySurfaceProps) {
  const { t } = useI18n();
  const [showPath, setShowPath] = useState(pathDefaultOpen);
  const playOverlay = useMemo(() => {
    if (!session || !revision) return null;
    return playOverlayFromSession(revision.content, session);
  }, [session, revision]);

  if (busy && !session) return <p role="status">{t('正在读取存档…')}</p>;
  if (!session) return <Empty>{emptyHint ?? t('选择一本已发布的故事，或者打开左侧存档。')}</Empty>;

  return (
    <>
      <div className="reader-meta">
        <span>{revision?.content.title ?? t('文字冒险')} · v{revision?.version ?? '—'}</span>
        <span>{t('第 {turn} 幕', { turn: session.turn + 1 })}</span>
      </div>
      <h3>{session.scene.title}</h3>
      <div className="reader-text">{session.scene.text.split(/\n+/).map((text, i) => <p key={i}>{text}</p>)}</div>
      <PlayStatsBar
        variables={session.variables ?? {}}
        deltas={varDeltas}
        optionChanges={optionChanges}
        showEmpty
        statTemplateId={revision?.content.statTemplateId}
        statTemplateVersion={revision?.content.statTemplateVersion}
      />
      {session.ended && (
        <PlayEndingPanel
          mode="story"
          title={session.scene.title}
          body={session.scene.ending ?? t('旅程告一段落。')}
          summary={endingSummaryFromVariables(session.variables, {
            statTemplateId: revision?.content.statTemplateId,
            statTemplateVersion: revision?.content.statTemplateVersion,
          })}
          onReplay={onReplay}
          replayBusy={busy}
          onBackEdit={onSecondary}
          backLabel={secondaryLabel}
          replayLabel={replayLabel}
        />
      )}
      {proposeNote && <Notice kind="success" text={proposeNote} />}
      {uncertain && onRetryPending && (
        <button type="button" className="primary" disabled={busy} onClick={onRetryPending}>
          {t(busy ? '正在确认…' : '重试并确认上一选择')}
        </button>
      )}
      {!session.ended && !uncertain && (
        <div className="reader-choices">
          <p className="eyebrow">{t('你将如何选择？')}</p>
          {session.scene.choices.map((choice, i) => {
            const cost = costHintForChoice(revision?.content, session.scene.id, choice.id);
            return (
              <ReaderChoiceRow
                key={choice.id}
                index={i + 1}
                label={choice.label}
                costHint={cost || undefined}
                disabled={busy}
                onClick={() => void onAct(choice.id)}
              />
            );
          })}
          {!session.scene.choices.length && <p className="hint">{t('当前没有可见选项。')}</p>}
        </div>
      )}
      {showAiAux && onNarrate && onPropose && (
        <div className="reader-aux stack">
          <TiandaoToggle disabled={busy || !!uncertain} />
          <NarrateBox visitKey={`${session.id}:${session.scene.id}:${session.turn}`} disabled={busy || !!uncertain} onNarrate={onNarrate} />
          {!session.ended && !uncertain && (
            <ProposeActBox disabled={busy} busy={busy} onPropose={onPropose} onPickCandidate={id => void onAct(id)} />
          )}
        </div>
      )}
      <div className="reader-footer">
        <p className="hint" data-testid="autosave-hint">{autosaveHint ?? t('选择成功后自动保存。存档 ID：{id}', { id: session.id })}</p>
        {onReload && (
          <button type="button" className="quiet small" disabled={busy} onClick={onReload}>{t('重新读取存档')}</button>
        )}
      </div>
      <details className="history">
        <summary>{t('回看行程 · {count} 条记录', { count: session.history.length })}</summary>
        {session.history.map((entry, i) => (
          <div key={i}>
            <p className="eyebrow">{t('第 {turn} 幕', { turn: entry.turn + 1 })}{entry.choiceLabel ? ` · ${entry.choiceLabel}` : ''}</p>
            <p>{entry.text}</p>
          </div>
        ))}
      </details>
      {revision && (
        <div className="play-path-panel" data-testid="play-path-panel">
          <div className="panel-heading">
            <h3>{t('分支路径')}</h3>
            <button type="button" className="small" onClick={() => setShowPath(v => !v)}>
              {t(showPath ? '收起路径画布' : '展开路径画布')}
            </button>
          </div>
          {showPath && playOverlay && (
            <BranchGraphCanvas
              content={revision.content}
              selectedSceneId={session.scene.id}
              onSelectScene={() => { /* play view follows session */ }}
              playOverlay={playOverlay}
              readOnly
              playabilityMode="publish"
            />
          )}
        </div>
      )}
    </>
  );
}
