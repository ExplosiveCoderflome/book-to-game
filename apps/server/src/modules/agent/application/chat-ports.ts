import type { AgentChatConversation, AgentChatMessage, AgentChatToolCall } from '@novel-game/contracts';

export interface ChatTool {
  name: string; description: string; parameters: Record<string, unknown>; requiresConfirmation: boolean;
  validate(input: unknown): Record<string, unknown>;
  prepare(input: Record<string, unknown>): {summary: string; guard?: string};
  execute(input: Record<string, unknown>): unknown;
}
export interface ChatModel {
  run(messages: AgentChatMessage[], tools: ChatTool[], signal: AbortSignal, hooks: ChatRunHooks): Promise<{limited: boolean}>;
}
export interface ChatRunHooks {
  maxRounds: number;
  /** Read-only durable evidence; never an authorization or an execution queue. */
  recovery?(): Pick<AgentChatConversation, 'id' | 'actions'>;
  startTurn(): void;
  assistant(reply: {text: string; calls: AgentChatToolCall[]}, final: boolean): void;
  execute(call: AgentChatToolCall): Promise<{content: string; proposed: boolean}>;
  toolResult(call: AgentChatToolCall, content: string): void;
}
export interface ChatRepository {
  insert(conversation: AgentChatConversation): void;
  get(id: string): AgentChatConversation | undefined;
  list(): AgentChatConversation[];
  save(conversation: AgentChatConversation, expectedVersion: number): AgentChatConversation;
}
export interface ChatDeps {repository: ChatRepository; model(): ChatModel; tools(): ChatTool[]; redact?(text: string): string}
