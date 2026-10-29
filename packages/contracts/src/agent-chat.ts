export interface AgentChatToolCall {id: string; name: string; arguments: Record<string, unknown>}
export interface AgentChatMessage {
  id: string; role: 'user' | 'assistant' | 'tool'; content: string; createdAt: string;
  requestId?: string; requestHash?: string; toolCalls?: AgentChatToolCall[]; toolCallId?: string; toolName?: string;
}
export interface AgentChatAction {
  id: string; callId: string; toolName: string; arguments: Record<string, unknown>; summary: string; guard?: string;
  status: 'pending' | 'executing' | 'succeeded' | 'failed' | 'rejected' | 'uncertain';
  result?: string; createdAt: string; updatedAt: string;
}
export interface AgentChatConversation {
  id: string; title: string; version: number; status: 'idle' | 'running'; leaseUntil: number;
  messages: AgentChatMessage[]; actions: AgentChatAction[]; createdAt: string; updatedAt: string;
}
export type AgentChatSummary = Pick<AgentChatConversation, 'id' | 'title' | 'status' | 'updatedAt'>;
