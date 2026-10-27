import { useCallback, useEffect, useMemo, useState } from 'react';
import type { GameContent, GameRevision, NarrateResult, ProposeActResult, SessionView } from '@novel-game/contracts';
import { errorMessage, request } from '../lib/api';
import { playOverlayFromSession } from '../lib/play-overlay';
import { readTiandaoCorrect } from '../lib/tiandao';
import { diffVariables, labelFnFromContent, type VariableDelta } from '../lib/variable-delta';

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

  useEffect(() => {
    if (!playVarDeltas?.length) return;
    const timer = window.setTimeout(() => setPlayVarDeltas(null), 4500);
    return () => window.clearTimeout(timer);
  }, [playVarDeltas]);

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
  }, []);

  async function actOnCanvas(choiceId: string) {
    if (!playSession) return;
    setPlayBusy(true); onError(null); setPlayVarDeltas(null);
    try {
      const before = { ...(playSession.variables ?? {}) };
      const input = { choiceId, expectedTurn: playSession.turn, requestId: crypto.randomUUID() };
      const result = await request<SessionView>(token, `/sessions/${playSession.id}/actions`, 'POST', input);
      const deltas = diffVariables(before, result.variables ?? {}, labelFnFromContent(latestRevision?.content));
      setPlayVarDeltas(deltas.length ? deltas : null);
      setPlaySession(result);
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
        const deltas = diffVariables(playSession.variables ?? {}, next.variables ?? {}, labelFnFromContent(latestRevision?.content));
        setPlayVarDeltas(deltas.length ? deltas : null);
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
    playOverlay,
    canPlayOnCanvas,
    actOnCanvas,
    narrateOnCanvas,
    proposeOnCanvas,
    resetPlay,
    publishedContent: (latestRevision?.content ?? null) as GameContent | null,
  };
}
