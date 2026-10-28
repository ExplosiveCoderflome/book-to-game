import { useCallback, useEffect, useMemo, useState } from 'react';
import type { GameContent, GameRevision, NarrateResult, ProposeActResult, SessionView } from '@novel-game/contracts';
import { errorMessage, request } from '../lib/api';
import { playOverlayFromSession } from '../lib/play-overlay';
import { readTiandaoCorrect } from '../lib/tiandao';
import { diffOptionSets, diffVariables, labelFnFromContent, type OptionChangeSummary, type VariableDelta } from '../lib/variable-delta';

export type StoryCanvasPlayArgs = {
  token: string;
  canvasMode: 'edit' | 'play';
  latestRevision: GameRevision | null;
  linkedSessions: SessionView[];
  dirty: boolean;
  jsonMode: boolean;
  refresh: () => Promise<void>;
  onError: (message: string | null) => void;
};

/** Play-on-canvas controller for story drafts: session bootstrap, act, propose, narrate. */
export function useStoryCanvasPlay({
  token, canvasMode, latestRevision, linkedSessions, dirty, jsonMode, refresh, onError,
}: StoryCanvasPlayArgs) {
  const [playSession, setPlaySession] = useState<SessionView | null>(null);
  const [playBusy, setPlayBusy] = useState(false);
  const [proposeNote, setProposeNote] = useState<string | null>(null);
  const [playVarDeltas, setPlayVarDeltas] = useState<VariableDelta[] | null>(null);
  const [playOptionChanges, setPlayOptionChanges] = useState<OptionChangeSummary | null>(null);

  useEffect(() => {
    if (!playVarDeltas?.length && !playOptionChanges?.newlyAvailable.length && !playOptionChanges?.newlyUnavailable.length) return;
    const timer = window.setTimeout(() => {
      setPlayVarDeltas(null);
      setPlayOptionChanges(null);
    }, 4500);
    return () => window.clearTimeout(timer);
  }, [playVarDeltas, playOptionChanges]);

  const playOverlay = useMemo(() => {
    if (!playSession || !latestRevision) return null;
    return playOverlayFromSession(latestRevision.content, playSession);
  }, [playSession, latestRevision]);

  const canPlayOnCanvas = !!latestRevision && !dirty && !jsonMode;

  useEffect(() => {
    if (canvasMode !== 'play' || !latestRevision) return;
    const preferred = linkedSessions[0];
    if (preferred && playSession?.id === preferred.id) return;
    if (preferred) { setPlaySession(preferred); return; }
    let active = true;
    setPlayBusy(true);
    request<SessionView>(token, '/sessions', 'POST', { gameRevisionId: latestRevision.id })
      .then(async started => {
        if (!active) return;
        setPlaySession(started);
        await refresh();
      })
      .catch(e => { if (active) onError(errorMessage(e)); })
      .finally(() => { if (active) setPlayBusy(false); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasMode, latestRevision?.id]);

  const resetPlay = useCallback(() => {
    setPlaySession(null);
    setProposeNote(null);
    setPlayVarDeltas(null);
    setPlayOptionChanges(null);
  }, []);

  function applyChoiceFeedback(before: SessionView, after: SessionView) {
    const deltas = diffVariables(before.variables ?? {}, after.variables ?? {}, labelFnFromContent(latestRevision?.content));
    setPlayVarDeltas(deltas.length ? deltas : null);
    const changes = diffOptionSets(
      before.scene.choices.map(c => ({ id: c.id, label: c.label })),
      after.scene.choices.map(c => ({ id: c.id, label: c.label })),
    );
    setPlayOptionChanges(
      changes.newlyAvailable.length || changes.newlyUnavailable.length ? changes : null,
    );
  }

  async function actOnCanvas(choiceId: string) {
    if (!playSession) return;
    setPlayBusy(true); onError(null); setPlayVarDeltas(null); setPlayOptionChanges(null);
    try {
      const before = playSession;
      const input = { choiceId, expectedTurn: playSession.turn, requestId: crypto.randomUUID() };
      const result = await request<SessionView>(token, `/sessions/${playSession.id}/actions`, 'POST', input);
      applyChoiceFeedback(before, result);
      setPlaySession(result);
      await refresh();
    } catch (e) { onError(errorMessage(e)); } finally { setPlayBusy(false); }
  }

  async function restartOnCanvas() {
    if (!latestRevision) return;
    setPlayBusy(true); onError(null); setPlayVarDeltas(null); setPlayOptionChanges(null);
    try {
      const started = await request<SessionView>(token, '/sessions', 'POST', { gameRevisionId: latestRevision.id });
      setPlaySession(started);
      setProposeNote(null);
      await refresh();
    } catch (e) { onError(errorMessage(e)); } finally { setPlayBusy(false); }
  }

  const narrateOnCanvas = useCallback(async (force: boolean): Promise<NarrateResult> => {
    if (!playSession) throw new Error('no session');
    return request<NarrateResult>(token, `/sessions/${playSession.id}/narrate`, 'POST', {
      expectedTurn: playSession.turn, force, tiandaoCorrect: readTiandaoCorrect(),
    });
  }, [playSession, token]);

  async function proposeOnCanvas(text: string): Promise<ProposeActResult> {
    if (!playSession) throw new Error('no session');
    setPlayBusy(true); onError(null);
    try {
      const result = await request<ProposeActResult>(token, `/sessions/${playSession.id}/propose-act`, 'POST', {
        text, expectedTurn: playSession.turn, requestId: crypto.randomUUID(), autoAct: true, tiandaoCorrect: readTiandaoCorrect(),
      });
      if (result.status === 'acted' && result.session) {
        setProposeNote(result.label ? `已映射并执行：${result.label}` : '已映射并执行');
        const next = result.session as SessionView;
        applyChoiceFeedback(playSession, next);
        setPlaySession(next);
        await refresh();
      } else if (result.status === 'none' || result.status === 'rejected') {
        setProposeNote(result.reason);
      }
      return result;
    } catch (e) {
      onError(errorMessage(e));
      throw e;
    } finally { setPlayBusy(false); }
  }

  return {
    playSession,
    playBusy,
    proposeNote,
    playVarDeltas,
    playOptionChanges,
    playOverlay,
    canPlayOnCanvas,
    actOnCanvas,
    narrateOnCanvas,
    proposeOnCanvas,
    restartOnCanvas,
    resetPlay,
    publishedContent: (latestRevision?.content ?? null) as GameContent | null,
  };
}
