import type { GenerationJob, ProductionNarrative, ProductionPlan, ProductionBrief, SourceDocument } from '@novel-game/contracts';
import { assertPlanMechanics, assertProductionNarrative, assertProductionPlan, productionUnits, selectChapters } from '../../generation/index.js';
import type { Logger } from '../../../shared/logger.js';
import { triageFailure } from '../domain/policy.js';
import type { AgentDecision, AgentDecisionRepository, AgentJobActor, AgentJobReader, AgentSourceReader } from '../domain/ports.js';

export interface SupervisorDeps {
  jobs: AgentJobReader & AgentJobActor;
  sources: AgentSourceReader;
  decisions: AgentDecisionRepository;
  logger?: Logger;
}

export interface SupervisorReport {
  checked: number;
  acted: number;
  decisions: AgentDecision[];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : undefined;
}

function errorIssues(error: unknown): unknown {
  const details = (error as { details?: unknown } | null)?.details;
  if (details && typeof details === 'object' && 'issues' in details) return (details as { issues: unknown }).issues;
  return undefined;
}

function checkPlan(plan: ProductionPlan, brief: ProductionBrief, source: SourceDocument): { passed: boolean; message: string; issues?: unknown } {
  try {
    assertProductionPlan(plan, brief, source);
    assertPlanMechanics(plan);
    return {passed: true, message: '规划机制检查通过（角色/剧情卡/NPC/资源/结局/路线均达标），可人工确认'};
  } catch (error) {
    return {passed: false, message: `规划机制检查未通过：${errorMessage(error)}，人工确认前请先处理`, issues: errorIssues(error)};
  }
}

function checkUnit(plan: ProductionPlan, unitKey: string, text: ProductionNarrative): { passed: boolean; message: string } {
  const unit = productionUnits(plan).find(item => item.key === unitKey);
  if (!unit) return {passed: false, message: `单元 ${unitKey} 不在规划内`};
  try {
    assertProductionNarrative(plan, unit, text);
    return {passed: true, message: '通过'};
  } catch (error) {
    return {passed: false, message: errorMessage(error)};
  }
}

/**
 * Tier A 监督 agent：只做监督、重试与质检，绝不批规划、绝不改写单元、绝不发布。
 * 每一轮只对任务的当前版本决策一次（按 jobUpdatedAt 去重），轮询幂等。
 * 本模块不调用模型：全部判断来自确定性校验与失败码规则。
 */
export class AgentSupervisor {
  constructor(private readonly deps: SupervisorDeps, private readonly maxAgentRetries: number = 2) {}

  runOnce(): SupervisorReport {
    const {jobs, sources, decisions, logger} = this.deps;
    const made: AgentDecision[] = [];
    let checked = 0;
    for (const job of jobs.list()) {
      const relevant = job.status === 'failed'
        || (job.status === 'awaiting_review' && !!job.productionBrief && !!job.productionState?.plan)
        || (job.status === 'succeeded' && !!job.productionState?.plan && Object.keys(job.productionState.texts).length > 0);
      if (!relevant) continue;
      checked++;
      try {
        const decision = this.supervise(job, sources, decisions);
        if (decision) made.push(decision);
      } catch (error) {
        // 监督本身失败也不中断整轮；按任务版本记一次升级，避免重复刷屏。
        if (!decisions.exists(job.id, 'escalated', job.updatedAt)) {
          made.push(decisions.record({jobId: job.id, action: 'escalated', jobUpdatedAt: job.updatedAt,
            summary: `agent 监督执行失败：${errorMessage(error)}，交人工处理`, detail: {code: errorCode(error)}}));
        }
        logger?.warn('agent.supervise.failed', {jobId: job.id, message: errorMessage(error)});
      }
    }
    decisions.beat();
    return {checked, acted: made.length, decisions: made};
  }

  private supervise(job: GenerationJob, sources: AgentSourceReader, decisions: AgentDecisionRepository): AgentDecision | null {
    // 1. 失败任务：按失败码分流，重试或升级。
    if (job.status === 'failed') {
      if (decisions.exists(job.id, 'retried', job.updatedAt) || decisions.exists(job.id, 'escalated', job.updatedAt)) return null;
      const triage = triageFailure(job, decisions.count(job.id, 'retried'), this.maxAgentRetries);
      if (!triage) return null;
      if (triage.action === 'retry') {
        try {
          this.deps.jobs.retry(job.id);
        } catch (error) {
          // 状态已变（人工/ worker 已接手）则静默跳过；其余错误升级交人。
          if (errorCode(error) === 'JOB_STATE_CONFLICT' || errorCode(error) === 'JOB_NOT_FOUND') return null;
          return decisions.record({jobId: job.id, action: 'escalated', jobUpdatedAt: job.updatedAt,
            summary: `agent 重试失败：${errorMessage(error)}，交人工处理`,
            detail: {code: job.failure?.code, step: job.failure?.step, retryError: errorCode(error)}});
        }
        return decisions.record({jobId: job.id, action: 'retried', jobUpdatedAt: job.updatedAt, summary: triage.reason,
          detail: {code: job.failure?.code, step: job.failure?.step}});
      }
      return decisions.record({jobId: job.id, action: 'escalated', jobUpdatedAt: job.updatedAt, summary: triage.reason,
        detail: {code: job.failure?.code, step: job.failure?.step, message: job.failure?.message}});
    }

    // 2. 待审阅规划：只跑机制检查并摘要，绝不替人工确认。
    if (job.status === 'awaiting_review' && job.productionBrief && job.productionState?.plan) {
      if (decisions.exists(job.id, 'review_summary', job.updatedAt)) return null;
      const source = selectChapters(sources.get(job.sourceId), job.chapterIds);
      const check = checkPlan(job.productionState.plan, job.productionBrief, source);
      return decisions.record({jobId: job.id, action: 'review_summary', jobUpdatedAt: job.updatedAt,
        summary: check.message, detail: {passed: check.passed, issues: check.issues}});
    }

    // 3. 已完成制作任务：逐单元跑正文质检，只报告不改写。
    if (job.status === 'succeeded' && job.productionState?.plan && Object.keys(job.productionState.texts).length > 0) {
      if (decisions.exists(job.id, 'qa_report', job.updatedAt)) return null;
      const issues: { unit: string; message: string }[] = [];
      let checkedUnits = 0;
      for (const [key, text] of Object.entries(job.productionState.texts)) {
        checkedUnits++;
        const check = checkUnit(job.productionState.plan, key, text);
        if (!check.passed) issues.push({unit: key, message: check.message});
      }
      return decisions.record({jobId: job.id, action: 'qa_report', jobUpdatedAt: job.updatedAt,
        summary: issues.length
          ? `已写单元质检发现 ${issues.length} 处问题：${issues.map(issue => `${issue.unit}：${issue.message}`).join('；')}`
          : `已写单元质检全部通过（${checkedUnits} 单元）`,
        detail: {checkedUnits, issues}});
    }
    return null;
  }
}
