import type { GenerationJob, SourceDocument } from '@novel-game/contracts';

export type AgentAction = 'retried' | 'escalated' | 'review_summary' | 'qa_report';

export interface AgentDecision {
  id: string;
  jobId: string;
  action: AgentAction;
  /** 决策针对的任务版本；同一版本只决策一次，保证轮询幂等。 */
  jobUpdatedAt: string;
  summary: string;
  detail?: unknown;
  createdAt: string;
}

export interface AgentDecisionRepository {
  record(decision: Omit<AgentDecision, 'id' | 'createdAt'>): AgentDecision;
  list(limit: number): AgentDecision[];
  exists(jobId: string, action: AgentAction, jobUpdatedAt: string): boolean;
  count(jobId: string, action: AgentAction): number;
  total(): number;
  beat(): void;
  lastBeat(): string | null;
}

/** Agent 只读任务与来源；绝不直接碰仓储实现。 */
export interface AgentJobReader {
  list(): GenerationJob[];
}
export interface AgentJobActor {
  retry(id: string): GenerationJob;
}
export interface AgentSourceReader {
  get(id: string): SourceDocument;
}
