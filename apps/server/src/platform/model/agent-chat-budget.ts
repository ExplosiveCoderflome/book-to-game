import type { AssistantMessage } from '@mariozechner/pi-ai';
import { AppError } from '../../shared/errors.js';

export const CHAT_CONTEXT_TARGET_BYTES = 96 * 1024;
export const CHAT_RECENT_TURNS = 4;
export const CHAT_RUN_TOKEN_BUDGET = 256_000;
export const CHAT_MAX_OUTPUT_TOKENS = 8192;

// Conservative heuristic for mixed Chinese/JSON, not a provider tokenizer or a dollar guarantee.
// Count every serialized byte (including schemas); never assume cache discounts.
export function estimateChatTokens(bytes: number): number {return Math.ceil(bytes / 2);}
export function chatLimit(value: number | undefined, fallback: number, min: number, max: number): number {
  const limit = value ?? fallback;
  if (!Number.isInteger(limit) || limit < min || limit > max) throw new AppError('CHAT_BUDGET_CONFIG', 'Agent 成本预算配置无效', 422);
  return limit;
}

/** One instance per run; never charge historic usage again or reset between tool rounds. */
export class ChatTokenBudget {
  spent = 0;
  estimatedInput = 0;
  constructor(readonly limit: number) {}
  check(requestBytes: number, maxOutputTokens: number) {
    this.estimatedInput = estimateChatTokens(requestBytes);
    if (this.spent + this.estimatedInput + maxOutputTokens > this.limit) throw this.error();
  }
  settle(message: AssistantMessage) {
    const usage = message.usage;
    const sum = usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
    const reported = Number.isFinite(usage.totalTokens) && usage.totalTokens > 0 ? usage.totalTokens : sum;
    const hasUsage = Number.isFinite(reported) && reported > 0;
    const tokens = hasUsage ? reported : this.estimatedInput + estimateChatTokens(Buffer.byteLength(JSON.stringify(message.content)));
    this.spent += tokens;
    return {tokens, source: hasUsage ? 'usage' : 'estimate', runTokens: this.spent, runTokenBudget: this.limit};
  }
  error() {
    console.info(JSON.stringify({event: 'agent.chat.budget_stop', runTokens: this.spent, estimatedInputTokens: this.estimatedInput, runTokenBudget: this.limit}));
    return new AppError('CHAT_RUN_TOKEN_BUDGET', '本次运行已达到 token 成本预算，已停止后续模型请求和工具执行；完整历史与已完成回执已保存，请缩小步骤后明确继续', 422);
  }
}
