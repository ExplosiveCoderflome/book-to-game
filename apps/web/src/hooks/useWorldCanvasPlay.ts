import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AdventureView, NarrateResult, ProposeActResult, ProposeAdventureActResult, WorldRevision } from '@novel-game/contracts';
import { errorMessage, request } from '../lib/api';
import { readTiandaoCorrect } from '../lib/tiandao';
import { worldPlayOverlayFromAdventure } from '../lib/world-play-overlay';

export type WorldCanvasPlayArgs = {
  token: string;
  canvasMode: 'edit' | 'play';
  latestRevision: WorldRevision | null;
  linkedAdventures: AdventureView[];
  dirty: boolean;
  jsonMode: boolean;
  refresh: () => Promise<void>;
  onError: (message: string | null) => void;
};

/** Play-on-canvas controller for open worlds: adventure bootstrap, act, propose, narrate. */
export function useWorldCanvasPlay({
  token, canvasMode, latestRevision, linkedAdventures, dirty, jsonMode, refresh, onError,
}: WorldCanvasPlayArgs) {
  const [playSession, setPlaySession] = useState<AdventureView | null>(null);
  const [playBusy, setPlayBusy] = useState(false);
  const [proposeNote, setProposeNote] = useState<string | null>(null);

  const playOverlay = useMemo(() => {
    if (!playSession || !latestRevision) return null;
    return worldPlayOverlayFromAdventure(latestRevision.content, playSession);
  }, [playSession, latestRevision]);

  const canPlayOnCanvas = !!latestRevision && !dirty && !jsonMode;

  useEffect(() => {
    if (canvasMode !== 'play' || !latestRevision) return;
    const preferred = linkedAdventures[0];
    if (preferred && playSession?.id === preferred.id) return;
    if (preferred) { setPlaySession(preferred); return; }
    let active = true;
    setPlayBusy(true);
    request<AdventureView>(token, '/adventures', 'POST', { worldRevisionId: latestRevision.id })
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
  }, []);

  async function actOnCanvas(actionId: string) {
    if (!playSession) return;
    setPlayBusy(true); onError(null);
    try {
      const input = { actionId, expectedTurn: playSession.turn, requestId: crypto.randomUUID() };
      const result = await request<AdventureView>(token, `/adventures/${playSession.id}/actions`, 'POST', input);
      setPlaySession(result);
      await refresh();
    } catch (e) { onError(errorMessage(e)); } finally { setPlayBusy(false); }
  }

  async function proposeOnCanvas(text: string): Promise<ProposeActResult> {
    if (!playSession) throw new Error('no session');
    setPlayBusy(true); onError(null);
    try {
      const result = await request<ProposeAdventureActResult>(token, `/adventures/${playSession.id}/propose-act`, 'POST', {
        text, expectedTurn: playSession.turn, requestId: crypto.randomUUID(), autoAct: true, tiandaoCorrect: readTiandaoCorrect(),
      });
      if (result.status === 'acted' && result.adventure) {
        setProposeNote(result.label ? `已映射并执行：${result.label}` : '已映射并执行');
        setPlaySession(result.adventure as AdventureView);
        await refresh();
      } else if (result.status === 'none' || result.status === 'rejected') {
        setProposeNote(result.reason);
      }
      return {
        status: result.status,
        choiceId: result.actionId,
        label: result.label,
        reason: result.reason,
        candidates: result.candidates,
        session: result.adventure,
      };
    } finally { setPlayBusy(false); }
  }

  const narrateOnCanvas = useCallback(async (force: boolean): Promise<NarrateResult> => {
    if (!playSession) throw new Error('no session');
    return request<NarrateResult>(token, `/adventures/${playSession.id}/narrate`, 'POST', {
      expectedTurn: playSession.turn, force, tiandaoCorrect: readTiandaoCorrect(),
    });
  }, [playSession, token]);

  return {
    playSession,
    playBusy,
    proposeNote,
    playOverlay,
    canPlayOnCanvas,
    actOnCanvas,
    narrateOnCanvas,
    proposeOnCanvas,
    resetPlay,
  };
}
