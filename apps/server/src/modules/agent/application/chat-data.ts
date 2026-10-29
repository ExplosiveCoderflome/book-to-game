import { randomUUID } from 'node:crypto';
import type { AgentChatMessage } from '@novel-game/contracts';

export function chatMessage(role: AgentChatMessage['role'], content: string, extra: Partial<AgentChatMessage> = {}): AgentChatMessage {
  return {id: randomUUID(), role, content, createdAt: new Date().toISOString(), ...extra};
}
export function chatResult(value: unknown): string {
  const text = JSON.stringify(value ?? null);
  return text.length <= 16000 ? text : JSON.stringify({truncated: true, notice: '结果过大，以下仅为预览。必须缩小读取范围，不能把截断预览作为完整草稿写回。', preview: text.slice(0, 16000)});
}
export function chatError(error: unknown): string {
  const code = (error as {code?: unknown} | null)?.code;
  return JSON.stringify({error: typeof code === 'string' ? code : 'CHAT_OPERATION_FAILED', message: '请求未完成，请检查参数、模型配置或重新读取当前状态。'});
}
