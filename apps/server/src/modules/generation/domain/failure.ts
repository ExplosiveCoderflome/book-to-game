import type { JobFailure } from '@novel-game/contracts';
import { ZodError } from 'zod';
import { AppError } from '../../../shared/errors.js';
import { schemaIssueMessage, schemaIssues, type SchemaIssue } from '../../../shared/schema-issues.js';
import type { ModelRepairFeedback, ModelRepairIssue } from './ports.js';

export function formatJobError(failure: JobFailure): string {
  const message = failure.message.replace(/\s+/g, ' ').trim().slice(0, 600);
  const path = failure.path ? `字段 ${failure.path}` : '无具体字段';
  return `${message}（${failure.code}；${path}；步骤 ${failure.step}；第 ${failure.attempt} 次；请求 ${failure.requestId}）`;
}

export function toJobFailure(error: unknown, context: {step: string; attempt: number; requestId: string; completedChunks: number}): JobFailure {
  if (error instanceof AppError) {
    const details = record(error.details);
    const message = error.code === 'MODEL_CONNECTION_FAILED'
      ? `模型连接失败或超时，请检查服务地址与网络。已保存 ${context.completedChunks} 个分析块。`
      : withSaved(error.message, context.completedChunks);
    return {
      code: error.code,
      message,
      path: pathFrom(details) || undefined,
      step: stringField(details.step) || context.step,
      attempt: numberField(details.attempt) || context.attempt,
      requestId: context.requestId,
    };
  }
  if (error instanceof ZodError) {
    const issues = schemaIssues(error);
    return {
      code: 'SCHEMA_VALIDATION_FAILED',
      message: withSaved(schemaIssueMessage(issues), context.completedChunks),
      path: issues[0]?.path,
      step: context.step,
      attempt: context.attempt,
      requestId: context.requestId,
    };
  }
  return {
    code: 'UNEXPECTED_ERROR',
    message: `本步骤执行失败，已保存 ${context.completedChunks} 个分析块。请检查模型配置或响应格式后重试。`,
    step: context.step,
    attempt: context.attempt,
    requestId: context.requestId,
  };
}

export function annotateFailure(error: unknown, step: string, runnerAttempt: number): unknown {
  if (error instanceof AppError) {
    const details = record(error.details);
    const path = pathFrom(details);
    return new AppError(error.code, error.message, error.status, {
      ...details,
      step,
      attempt: numberField(details.attempt) || runnerAttempt,
      ...(path ? {path} : {}),
    });
  }
  if (error instanceof ZodError) {
    const issues = schemaIssues(error);
    return new AppError('SCHEMA_VALIDATION_FAILED', schemaIssueMessage(issues), 422, {
      layer: 'output', step, attempt: runnerAttempt, path: issues[0]?.path, issues,
    });
  }
  return error;
}

export function feedbackFrom(error: unknown): ModelRepairFeedback {
  if (error instanceof AppError) return {errors: issuesFrom(error.code, error.message, error.details)};
  if (error instanceof ZodError) {
    return {errors: schemaIssues(error).map(issue => ({code: 'SCHEMA_VALIDATION_FAILED', path: issue.path, message: issue.message}))};
  }
  return {errors: [{code: 'UNEXPECTED_ERROR', message: '输出未通过校验'}]};
}

export function failureCode(error: unknown): string {
  if (error instanceof AppError) return error.code;
  if (error instanceof ZodError) return 'SCHEMA_VALIDATION_FAILED';
  return 'UNEXPECTED_ERROR';
}

export function failurePath(error: unknown): string {
  if (error instanceof AppError) return pathFrom(record(error.details));
  if (error instanceof ZodError) return schemaIssues(error)[0]?.path ?? '';
  return '';
}

function issuesFrom(code: string, message: string, details: unknown): ModelRepairIssue[] {
  const recordDetails = record(details);
  const issues = Array.isArray(recordDetails.issues) ? recordDetails.issues : [];
  const parsed: ModelRepairIssue[] = [];
  for (const issue of issues) {
    if (!issue || typeof issue !== 'object') continue;
    const item = issue as Partial<SchemaIssue> & {code?: unknown};
    if (typeof item.message !== 'string' || !item.message) continue;
    parsed.push({
      code: typeof item.code === 'string' ? item.code : code,
      message: item.message.slice(0, 300),
      path: typeof item.path === 'string' ? item.path : undefined,
    });
  }
  if (parsed.length) return parsed.slice(0, 8);
  return [{code, message: message.slice(0, 500), path: pathFrom(recordDetails) || undefined}];
}

function withSaved(message: string, completedChunks: number): string {
  if (message.includes('已保存')) return message;
  const trimmed = message.trim();
  const sentence = /[。！？.!?]$/.test(trimmed) ? trimmed : `${trimmed}。`;
  return `${sentence}已保存 ${completedChunks} 个分析块。`;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}
function pathFrom(details: Record<string, unknown>): string {
  if (typeof details.path === 'string') return details.path;
  const issues = Array.isArray(details.issues) ? details.issues : [];
  const first = issues[0];
  if (first && typeof first === 'object' && typeof (first as {path?: unknown}).path === 'string') return (first as {path: string}).path;
  return '';
}
function stringField(value: unknown): string {return typeof value === 'string' ? value : '';}
function numberField(value: unknown): number {return typeof value === 'number' && Number.isFinite(value) ? value : 0;}
