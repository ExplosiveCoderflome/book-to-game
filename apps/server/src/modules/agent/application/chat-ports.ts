import type { AgentChatConversation, AgentChatMessage, AgentChatToolCall } from '@novel-game/contracts';

export interface ChatTool {
  name: string; description: string; parameters: Record<string, unknown>; requiresConfirmation: boolean;
  validate(input: unknown): Record<string, unknown>;
  prepare(input: Record<string, unknown>): {summary: string; guard?: string};
  execute(input: Record<string, unknown>): unknown;
}
export interface ChatModel {
  respond(messages: AgentChatMessage[], tools: ChatTool[], signal: AbortSignal): Promise<{text: string; calls: AgentChatToolCall[]}>;
}
export interface ChatRepository {
  insert(conversation: AgentChatConversation): void;
  get(id: string): AgentChatConversation | undefined;
  list(): AgentChatConversation[];
  save(conversation: AgentChatConversation, expectedVersion: number): AgentChatConversation;
}
export interface ChatDeps {repository: ChatRepository; model(): ChatModel; tools(): ChatTool[]; redact?(text: string): string}
