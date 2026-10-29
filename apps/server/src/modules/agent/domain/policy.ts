import type { GenerationJob } from '@novel-game/contracts';

/** 同一任务 agent 累计自动重试上限；超过则一律升级交人工。 */
export const MAX_AGENT_RETRIES = 2;

/**
 * 内容/结构类失败：runner 的语义修复已耗尽，盲目重试无益，交人工。
 * 其余失败（连接、超时、未知）视为瞬时问题，agent 可重试。
 */
const NON_RETRYABLE_CODES = new Set([
  'INVALID_PRODUCTION',
  'INVALID_GENERATED_WORLD',
  'INVALID_GENERATED_GAME',
  'INVALID_EVIDENCE',
  'WORLD_SCOPE_MISMATCH',
  'SCHEMA_VALIDATION_FAILED',
]);

export interface Triage {
  action: 'retry' | 'escalate';
  reason: string;
}

/** 纯函数：只根据任务状态与 agent 已重试次数决策，不做 I/O。 */
export function triageFailure(job: GenerationJob, priorAgentRetries: number, maxAgentRetries: number = MAX_AGENT_RETRIES): Triage | null {
  if (job.status !== 'failed') return null;
  const code = job.failure?.code ?? 'UNKNOWN';
  if (priorAgentRetries >= maxAgentRetries) {
    return {action: 'escalate', reason: `agent 已累计重试 ${priorAgentRetries} 次仍失败，交人工处理`};
  }
  if (NON_RETRYABLE_CODES.has(code)) {
    return {action: 'escalate', reason: `失败码 ${code} 属于内容/结构问题，盲目重试无益，交人工处理`};
  }
  return {action: 'retry', reason: `失败码 ${code} 疑似瞬时问题，agent 自动重试`};
}
