import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentChatConversation, AgentChatSummary } from '@novel-game/contracts';
import { createAgentChat, decideAgentAction, getAgentChat, listAgentChats, sendAgentMessage } from '../../lib/agent-chat-api';
import { errorMessage } from '../../lib/api';

const selectionKey = 'novel-game.agent-chat-id';
function savedSelection() {try {return localStorage.getItem(selectionKey) ?? '';} catch {return '';}}

export function useAgentConversation(token: string, active: boolean, onChanged: () => Promise<void>) {
  const [summaries, setSummaries] = useState<AgentChatSummary[]>([]);
  const [id, setId] = useState(savedSelection);
  const [conversation, setConversation] = useState<AgentChatConversation | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selected = useRef(id); selected.current = id;
  const pending = useRef<{id: string; requestId: string; text: string; displayText: string} | null>(null);
  const accept = useCallback((next: AgentChatConversation) => {
    if (selected.current !== next.id) return;
    setConversation(previous => previous?.id === next.id && previous.version > next.version ? previous : next);
  }, []);
  const loadList = useCallback(async () => {
    const result = await listAgentChats(token); setSummaries(result.conversations);
    setId(current => result.conversations.some(c => c.id === current) ? current : result.conversations[0]?.id ?? '');
  }, [token]);
  const refresh = useCallback(async () => {
    try {await loadList(); if (selected.current) accept(await getAgentChat(token, selected.current)); setError(null);}
    catch (e) {setError(errorMessage(e));}
  }, [token, loadList, accept]);
  useEffect(() => {if (active) void refresh();}, [active, refresh]);
  useEffect(() => {
    try {if (id) localStorage.setItem(selectionKey, id);} catch { /* Only the selected ID; messages remain server-side. */ }
    if (!active || !id) return;
    let cancelled = false; setLoading(true); setError(null);
    getAgentChat(token, id).then(next => {if (!cancelled) accept(next);})
      .catch(e => {if (!cancelled) setError(errorMessage(e));}).finally(() => {if (!cancelled) setLoading(false);});
    return () => {cancelled = true;};
  }, [active, token, id, accept]);
  useEffect(() => {
    if (!active || !id || conversation?.id !== id || conversation.status !== 'running') return;
    let cancelled = false, polling = false;
    const timer = setInterval(() => {
      if (polling) return; polling = true;
      getAgentChat(token, id).then(next => {if (!cancelled) accept(next);})
        .catch(e => {if (!cancelled) setError(errorMessage(e));}).finally(() => {polling = false;});
    }, 1500);
    return () => {cancelled = true; clearInterval(timer);};
  }, [active, token, id, conversation?.id, conversation?.status, accept]);
  const current = conversation?.id === id ? conversation : null;
  const running = busy || current?.status === 'running';
  const select = (next: string) => {selected.current = next; setId(next); setText(''); pending.current = null;};
  const start = async () => {
    setBusy(true); setError(null);
    try {const next = await createAgentChat(token); select(next.id); setConversation(next); await loadList();}
    catch (e) {setError(errorMessage(e));} finally {setBusy(false);}
  };
  const send = async (context: string) => {
    if (!text.trim() || running || loading) return;
    const displayText = text.trim(); setBusy(true); setError(null); setText('');
    try {
      let target = id;
      if (!target) {const next = await createAgentChat(token); target = next.id; selected.current = target; setId(target); setConversation(next);}
      const retry = pending.current;
      const same = retry?.id === target && retry.displayText === displayText;
      const body = same ? retry.text : context ? `${displayText}\n\n${context}` : displayText;
      const requestId = same ? retry.requestId : crypto.randomUUID();
      pending.current = {id: target, requestId, text: body, displayText};
      const response = sendAgentMessage(token, target, requestId, body);
      const timer = setTimeout(() => {getAgentChat(token, target).then(accept).catch(() => undefined);}, 300);
      try {accept(await response);} finally {clearTimeout(timer);}
      pending.current = null; await loadList(); await onChanged();
    } catch (e) {setError(errorMessage(e)); setText(displayText);}
    finally {setBusy(false);}
  };
  const decide = async (actionId: string, decision: 'confirm' | 'reject') => {
    setBusy(true); setError(null);
    try {accept(await decideAgentAction(token, id, actionId, decision)); await loadList(); await onChanged();}
    catch (e) {setError(errorMessage(e)); getAgentChat(token, id).then(accept).catch(() => undefined);}
    finally {setBusy(false);}
  };
  return {id, summaries, current, text, setText, busy, loading, running, error, select, start, send, decide, refresh};
}
