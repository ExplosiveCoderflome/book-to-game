import type { AgentChatConversation, AgentChatSummary } from '@novel-game/contracts';
import { request } from './api';

export const listAgentChats = (token: string) => request<{conversations: AgentChatSummary[]}>(token, '/agent/chats');
export const createAgentChat = (token: string) => request<AgentChatConversation>(token, '/agent/chats', 'POST', {});
export const getAgentChat = (token: string, id: string) => request<AgentChatConversation>(token, `/agent/chats/${id}`);
export const sendAgentMessage = (token: string, id: string, requestId: string, text: string) =>
  request<AgentChatConversation>(token, `/agent/chats/${id}/messages`, 'POST', {requestId, text}, {signal: AbortSignal.timeout(330_000)});
export const decideAgentAction = (token: string, id: string, actionId: string, decision: 'confirm' | 'reject') =>
  request<AgentChatConversation>(token, `/agent/chats/${id}/actions/${actionId}`, 'POST', {decision}, {signal: AbortSignal.timeout(330_000)});
