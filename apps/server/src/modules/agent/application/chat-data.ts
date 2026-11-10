import { randomUUID } from 'node:crypto';
import type { AgentChatMessage } from '@novel-game/contracts';
import { z } from 'zod';

// Only the registered, server-owned schema result may bypass the ordinary preview.
// Identity registration cannot be forged by JSON tool arguments or schema-looking data.
const completeWorldSchemas = new WeakSet<object>();
export function completeWorldSchemaResult<T extends object>(schema: T): T {
  completeWorldSchemas.add(schema);
  return schema;
}

export function chatMessage(role: AgentChatMessage['role'], content: string, extra: Partial<AgentChatMessage> = {}): AgentChatMessage {
  return {id: randomUUID(), role, content, createdAt: new Date().toISOString(), ...extra};
}
export function chatResult(value: unknown): string {
  const text = JSON.stringify(value ?? null);
  if (value && typeof value === 'object' && completeWorldSchemas.has(value)) return text;
  return text.length <= 16000 ? text : JSON.stringify({truncated: true, notice: '结果过大，以下仅为预览。必须缩小读取范围，不能把截断预览作为完整草稿写回。', preview: text.slice(0, 16000)});
}
export function chatError(error: unknown): string {
  const code = (error as {code?: unknown} | null)?.code;
  return JSON.stringify({error: typeof code === 'string' ? code : 'CHAT_OPERATION_FAILED', message: code === 'CHAT_RUN_TOKEN_BUDGET'
    ? '本次运行已达到 token 成本预算，后续模型请求和工具执行已停止。完整历史与已完成回执已保存；请缩小步骤后明确继续，不会自动重试。'
    : '请求未完成，请检查参数、模型配置或重新读取当前状态。'});
}

const issueText = (issue: z.ZodIssue) => {
  const path = issue.path.length ? issue.path.map(String).join('.') : '参数';
  let expected = '格式不正确';
  if (issue.code === 'invalid_type') expected = `期望${issue.expected === 'string' ? '字符串' : issue.expected === 'number' ? '数字' : issue.expected === 'boolean' ? '布尔值' : issue.expected}`;
  else if (issue.code === 'invalid_value') expected = `允许值：${issue.values.map(String).join('、')}`;
  else if (issue.code === 'too_small') expected = `至少 ${issue.minimum}`;
  else if (issue.code === 'too_big') expected = `最多 ${issue.maximum}`;
  return `${path}：${expected}`;
};

export function chatValidationError(error: z.ZodError): string {
  return JSON.stringify({error: 'CHAT_INVALID_ARGS', message: '工具参数不符合要求，请按字段提示修正。', fields: error.issues.slice(0, 12).map(issueText)});
}
