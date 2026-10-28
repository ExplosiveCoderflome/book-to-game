import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AdventureView, NarrateResult, ProposeActResult, ProposeAdventureActResult, WorldRevision } from '@novel-game/contracts';
import { errorMessage, request } from '../lib/api';
import { readTiandaoCorrect } from '../lib/tiandao';
import { worldPlayOverlayFromAdventure } from '../lib/world-play-overlay';
import {
  diffOptionSets,
  diffAdventureFacts,
  diffResources,
  resourceLabelFnFromWorld,
  type OptionChangeSummary,
  type VariableDelta,
} from '../lib/variable-delta';

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
  const [playResDeltas, setPlayResDeltas] = useState<VariableDelta[] | null>(null);
  const [playOptionChanges, setPlayOptionChanges] = useState<OptionChangeSummary | null>(null);

  useEffect(() => {
    if (!playResDeltas?.length && !playOptionChanges?.newlyAvailable.length && !playOptionChanges?.newlyUnavailable.length) return;
    const timer = window.setTimeout(() => {
      setPlayResDeltas(null);
      setPlayOptionChanges(null);
    }, 4500);
    return () => window.clearTimeout(timer);
  }, [playResDeltas, playOptionChanges]);

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
    setPlayResDeltas(null);
    setPlayOptionChanges(null);
  }, []);

  function applyFeedback(before: AdventureView, after: AdventureView) {
    const labelFor = resourceLabelFnFromWorld(latestRevision?.content);
    const resD = diffResources(before.resources ?? {}, after.resources ?? {}, labelFor)
      .filter(d => !(d.name.startsWith('fs_') || d.name.startsWith('fu_')));
    const factD = diffAdventureFacts(before.facts ?? [], after.facts ?? []);
    const deltas = [...resD, ...factD];
    setPlayResDeltas(deltas.length ? deltas : null);
    const changes = diffOptionSets(
      before.actions.map(a => ({ id: a.id, label: a.label })),
      after.actions.map(a => ({ id: a.id, label: a.label })),
    );
    setPlayOptionChanges(
      changes.newlyAvailable.length || changes.newlyUnavailable.length ? changes : null,
    );
  }

  async function actOnCanvas(actionId: string) {
    if (!playSession) return;
    setPlayBusy(true); onError(null); setPlayResDeltas(null); setPlayOptionChanges(null);
    try {
      const before = playSession;
      const input = { actionId, expectedTurn: playSession.turn, requestId: crypto.randomUUID() };
      const result = await request<AdventureView>(token, `/adventures/${playSession.id}/actions`, 'POST', input);
      applyFeedback(before, result);
      setPlaySession(result);
      await refresh();
    } catch (e) { onError(errorMessage(e)); } finally { setPlayBusy(false); }
  }

  async function proposeOnCanvas(text: string): Promise<ProposeActResult> {
    if (!playSession) throw new Error('no session');
    setPlayBusy(true); onError(null);
    try {
      const before = playSession;
      const result = await request<ProposeAdventureActResult>(token, `/adventures/${playSession.id}/propose-act`, 'POST', {
        text, expectedTurn: playSession.turn, requestId: crypto.randomUUID(), autoAct: true, tiandaoCorrect: readTiandaoCorrect(),
      });
      if (result.status === 'acted' && result.adventure) {
        setProposeNote(result.label ? `已映射并执行：${result.label}` : '已映射并执行');
        const next = result.adventure as AdventureView;
        applyFeedback(before, next);
        setPlaySession(next);
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

  async function restartOnCanvas() {
    if (!latestRevision) return;
    setPlayBusy(true); onError(null); setPlayResDeltas(null); setPlayOptionChanges(null);
    try {
      const started = await request<AdventureView>(token, '/adventures', 'POST', { worldRevisionId: latestRevision.id });
      setPlaySession(started);
      setProposeNote(null);
      await refresh();
    } catch (e) { onError(errorMessage(e)); } finally { setPlayBusy(false); }
  }

  return {
    playSession,
    playBusy,
    proposeNote,
    playResDeltas,
    playOptionChanges,
    playOverlay,
    canPlayOnCanvas,
    actOnCanvas,
    narrateOnCanvas,
    proposeOnCanvas,
    restartOnCanvas,
    resetPlay,
  };
}
