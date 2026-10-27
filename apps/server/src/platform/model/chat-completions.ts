import { analysisSchema, branchSkeletonSchema, gameContentSchema, worldContentSchema, type Analysis, type AnalysisResult, type BranchSkeleton, type GameContent, type WorldContent } from '@novel-game/contracts';
import { setTimeout as delay } from 'node:timers/promises';
import type { ZodType } from 'zod';
import type { GenerationProvider, ModelRepairIssue, SourceChunk, WorldGenerationOptions } from '../../modules/generation/index.js';
import { AppError } from '../../shared/errors.js';
import type { Logger } from '../../shared/logger.js';
import { schemaIssueMessage, schemaIssues } from '../../shared/schema-issues.js';
import { extractJsonValue, JsonContentError } from './extract-json.js';
import { ANALYSIS_SYSTEM, EXPAND_SYSTEM, GAME_SYSTEM, SKELETON_SYSTEM, compactForGame } from './prompts.js';
import { classifyStatus, parseRetryAfter, retryDelayMs } from './retry.js';
import { sanitizeWorldCandidate } from './sanitize-world.js';
import { WORLD_SYSTEM, compactWorldDossier } from './world-prompts.js';

export const DEFAULT_MAX_ATTEMPTS = 3;
export const DEFAULT_RETRY_BASE_MS = 500;
export const DEFAULT_RETRY_MAX_MS = 8000;
export const DEFAULT_REPAIR_ATTEMPTS = 3;

export interface ModelConfig {
  baseUrl: string; model: string; apiKey: string; timeoutMs: number;
  maxAttempts?: number; retryBaseMs?: number; retryMaxMs?: number; repairAttempts?: number;
}
export interface ModelClientHooks {
  sleep?(ms: number, signal: AbortSignal): Promise<void>;
  random?(): number;
}
export class ChatCompletionsProvider implements GenerationProvider {
  constructor(private readonly config: ModelConfig, private readonly logger?: Logger, private readonly hooks: ModelClientHooks = {}) {}

  async analyze(chunk: SourceChunk, signal: AbortSignal, feedback?: {errors: ModelRepairIssue[]}): Promise<Analysis> {
    return this.complete('analyze', ANALYSIS_SYSTEM, chunk, signal, analysisSchema, feedback?.errors ?? []);
  }
  async generateSkeleton(analysis: AnalysisResult, direction: string, signal: AbortSignal, feedback?: {errors: ModelRepairIssue[]}): Promise<BranchSkeleton> {
    return this.complete('generate_skeleton', SKELETON_SYSTEM, {direction, dossier: compactForGame(analysis)}, signal, branchSkeletonSchema, feedback?.errors ?? []);
  }
  async expandScenes(analysis: AnalysisResult, direction: string, skeleton: BranchSkeleton, signal: AbortSignal, feedback?: {errors: ModelRepairIssue[]}): Promise<GameContent> {
    return this.complete('expand_scenes', EXPAND_SYSTEM, {direction, dossier: compactForGame(analysis), skeleton}, signal, gameContentSchema, feedback?.errors ?? []);
  }
  async generate(analysis: AnalysisResult, direction: string, signal: AbortSignal, feedback?: {errors: ModelRepairIssue[]}): Promise<GameContent> {
    const skeleton = await this.generateSkeleton(analysis, direction, signal, feedback);
    return this.expandScenes(analysis, direction, skeleton, signal, feedback);
  }
  async generateWorld(analysis: AnalysisResult, options: WorldGenerationOptions, signal: AbortSignal, feedback?: {errors: ModelRepairIssue[]}): Promise<WorldContent> {
    return this.complete('generate_world', WORLD_SYSTEM, {plan: options, dossier: compactWorldDossier(analysis)}, signal, worldContentSchema, feedback?.errors ?? [], sanitizeWorldCandidate);
  }

  private async complete<T>(operation: string, system: string, data: unknown, signal: AbortSignal, schema: ZodType<T>, issues: ModelRepairIssue[], preprocess?: (value: unknown) => unknown): Promise<T> {
    const repairs = bound(this.config.repairAttempts, DEFAULT_REPAIR_ATTEMPTS, 1, 6);
    let feedback = issues.slice(0, 8);
    let last: AppError | undefined;
    for (let attempt = 1; attempt <= repairs; attempt++) {
      signal.throwIfAborted();
      const content = await this.requestText(operation, system, data, signal, feedback);
      const accepted = acceptOutput(content.text, content.finishReason, schema, attempt, preprocess);
      if (accepted.ok) {
        this.logger?.info('model.request.completed', {operation, model: this.config.model, attempt, durationMs: content.durationMs, responseBytes: content.responseBytes});
        return accepted.value;
      }
      last = accepted.error;
      const path = detailString(last.details, 'path');
      this.logger?.warn('model.output.rejected', {operation, model: this.config.model, attempt, code: last.code, path, durationMs: content.durationMs});
      if (attempt >= repairs || detailBoolean(last.details, 'retryable') === false) throw last;
      feedback = repairIssues(last);
    }
    throw last ?? new AppError('MODEL_INVALID_RESPONSE', '模型未返回完整且有效的 JSON。', 502);
  }

  private async requestText(operation: string, system: string, data: unknown, signal: AbortSignal, feedback: ModelRepairIssue[]): Promise<{text: string; finishReason?: string; durationMs: number; responseBytes: number}> {
    const maxAttempts = bound(this.config.maxAttempts, DEFAULT_MAX_ATTEMPTS, 1, 8);
    const baseMs = bound(this.config.retryBaseMs, DEFAULT_RETRY_BASE_MS, 0, 60_000);
    const maxMs = Math.max(baseMs, bound(this.config.retryMaxMs, DEFAULT_RETRY_MAX_MS, 0, 120_000));
    const messages = [{role: 'system', content: system}, {role: 'user', content: JSON.stringify(data)}];
    if (feedback.length) messages.push({role: 'user', content: repairPrompt(feedback)});
    const body = JSON.stringify({model: this.config.model, response_format: {type: 'json_object'}, messages});
    const requestBytes = Buffer.byteLength(body, 'utf8');
    let last: AppError | undefined;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      signal.throwIfAborted();
      const startedAt = performance.now();
      this.logger?.info('model.request.started', {operation, model: this.config.model, attempt, requestBytes, timeoutMs: this.config.timeoutMs});
      try {
        const response = await fetch(`${this.config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
          method: 'POST', signal: AbortSignal.any([signal, AbortSignal.timeout(this.config.timeoutMs)]),
          headers: {'Content-Type': 'application/json', ...(this.config.apiKey ? {Authorization: `Bearer ${this.config.apiKey}`} : {})},
          body,
        });
        if (!response.ok) {
          const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'));
          const retryable = classifyStatus(response.status) === 'retryable';
          await response.body?.cancel().catch(() => undefined);
          throw new AppError('MODEL_HTTP_ERROR', `模型服务返回 HTTP ${response.status}。请检查凭据、模型名称、额度与 JSON 输出支持。`, 502, {
            layer: 'transport', status: response.status, retryable, retryAfterMs, attempt,
          });
        }
        return await readEnvelope(response, attempt, startedAt);
      } catch (error) {
        if (signal.aborted) throw error;
        last = asTransportError(error, attempt, startedAt);
        const details = record(last.details);
        const retryable = details.retryable === true && attempt < maxAttempts;
        this.logger?.error('model.request.failed', {
          operation, model: this.config.model, attempt, stage: details.reason === 'timeout' ? 'timeout' : details.status ? 'http' : 'fetch',
          status: typeof details.status === 'number' ? details.status : undefined,
          code: last.code, durationMs: Math.round(performance.now() - startedAt),
          errorName: error instanceof Error ? error.name : 'UNKNOWN',
        });
        if (!retryable) throw last;
        const delayMs = retryDelayMs({
          attempt, baseMs, maxMs, random: this.hooks.random?.() ?? Math.random(),
          retryAfterMs: typeof details.retryAfterMs === 'number' ? details.retryAfterMs : undefined,
        });
        this.logger?.warn('model.retry', {operation, model: this.config.model, attempt, status: details.status, code: last.code, delayMs, retryAfterMs: details.retryAfterMs});
        await this.sleep(delayMs, signal);
      }
    }
    throw last ?? new AppError('MODEL_CONNECTION_FAILED', '模型连接失败或超时，请检查服务地址与网络。已保存完成的步骤。', 502);
  }

  private async sleep(ms: number, signal: AbortSignal): Promise<void> {
    if (this.hooks.sleep) return this.hooks.sleep(ms, signal);
    if (signal.aborted) throw signal.reason ?? new DOMException('The operation was aborted', 'AbortError');
    if (ms <= 0) return;
    await delay(ms, undefined, {signal});
  }
}

function acceptOutput<T>(text: string, finishReason: string | undefined, schema: ZodType<T>, attempt: number, preprocess?: (value: unknown) => unknown): {ok: true; value: T} | {ok: false; error: AppError} {
  try {
    const extracted = extractJsonValue(text);
    const value = preprocess ? preprocess(extracted) : extracted;
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      const issues = schemaIssues(parsed.error);
      return {ok: false, error: new AppError('SCHEMA_VALIDATION_FAILED', schemaIssueMessage(issues), 422, {
        layer: 'output', attempt, path: issues[0]?.path ?? '(root)', issues, retryable: true,
      })};
    }
    return {ok: true, value: parsed.data};
  } catch (error) {
    if (error instanceof JsonContentError) {
      const truncated = error.reason === 'truncated' || finishReason === 'length';
      const retryable = error.reason !== 'too_large';
      const code = truncated ? 'MODEL_TRUNCATED_RESPONSE' : 'MODEL_INVALID_RESPONSE';
      const message = truncated ? '模型返回的 JSON 被截断，请重试或更换支持完整 JSON 输出的模型。' : '模型未返回完整且有效的 JSON。请选用支持 JSON 输出的模型后重试。';
      return {ok: false, error: new AppError(code, message, 502, {
        layer: 'output', attempt, path: '$', reason: error.reason, retryable,
        issues: [{path: '$', message: error.message}],
      })};
    }
    return {ok: false, error: new AppError('MODEL_INVALID_RESPONSE', '模型未返回完整且有效的 JSON。请选用支持 JSON 输出的模型后重试。', 502, {
      layer: 'output', attempt, path: '$', retryable: true,
    })};
  }
}

async function readEnvelope(response: Response, attempt: number, startedAt: number): Promise<{text: string; finishReason?: string; durationMs: number; responseBytes: number}> {
  const reader = response.body?.getReader();
  if (!reader) throw new AppError('MODEL_INVALID_RESPONSE', '模型服务未返回响应正文。', 502, {layer: 'transport', retryable: true, attempt, reason: 'empty'});
  const decoder = new TextDecoder();
  let text = '';
  let bytes = 0;
  try {
    while (true) {
      const {value, done} = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > 2 * 1024 * 1024) {
        await reader.cancel().catch(() => undefined);
        throw new JsonContentError('模型响应超过大小限制', 'too_large');
      }
      text += decoder.decode(value, {stream: true});
    }
    text += decoder.decode();
  } catch (error) {
    if (error instanceof JsonContentError) throw error;
    throw new AppError('MODEL_INVALID_RESPONSE', '读取模型响应失败。', 502, {layer: 'transport', retryable: true, attempt, reason: 'read'});
  }
  let envelope: {choices?: {message?: {content?: unknown}; finish_reason?: string}[]};
  try {envelope = JSON.parse(text);}
  catch {throw new AppError('MODEL_INVALID_RESPONSE', '模型服务未返回有效的响应信封。', 502, {layer: 'transport', retryable: true, attempt, reason: 'envelope'});}
  const content = envelope.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new AppError('MODEL_INVALID_RESPONSE', '模型响应缺少文本内容。', 502, {layer: 'transport', retryable: true, attempt, reason: 'content'});
  return {text: content, finishReason: envelope.choices?.[0]?.finish_reason, durationMs: Math.round(performance.now() - startedAt), responseBytes: bytes};
}

function asTransportError(error: unknown, attempt: number, startedAt: number): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof JsonContentError) {
    return new AppError('MODEL_INVALID_RESPONSE', '模型响应超过大小限制。', 502, {
      layer: 'output', attempt, path: '$', reason: error.reason, retryable: false, durationMs: Math.round(performance.now() - startedAt),
    });
  }
  const name = error instanceof Error ? error.name : '';
  const timeout = name === 'TimeoutError' || name === 'AbortError';
  return new AppError('MODEL_CONNECTION_FAILED', '模型连接失败或超时，请检查服务地址与网络。已保存完成的步骤。', 502, {
    layer: 'transport', retryable: true, reason: timeout ? 'timeout' : 'connection', attempt,
  });
}

function repairPrompt(errors: ModelRepairIssue[]): string {
  const lines = errors.slice(0, 8).map(error => `- [${error.code}] ${error.path ? `${error.path}: ` : ''}${error.message}`);
  return ['上一次输出未通过校验。请根据下列错误返回修正后的完整 JSON 对象。', '不要使用 Markdown 代码块，不要添加解释。', ...lines].join('\n');
}
function repairIssues(error: AppError): ModelRepairIssue[] {
  const details = record(error.details);
  const issues = Array.isArray(details.issues) ? details.issues : [];
  const parsed: ModelRepairIssue[] = [];
  for (const issue of issues) {
    if (!issue || typeof issue !== 'object') continue;
    const item = issue as {path?: unknown; message?: unknown};
    if (typeof item.message !== 'string') continue;
    parsed.push({code: error.code, message: item.message.slice(0, 300), path: typeof item.path === 'string' ? item.path : undefined});
  }
  if (parsed.length) return parsed;
  return [{code: error.code, message: error.message.slice(0, 500), path: detailString(error.details, 'path') || undefined}];
}
function bound(value: number | undefined, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}
function detailString(details: unknown, key: string): string {
  const value = record(details)[key];
  return typeof value === 'string' ? value : '';
}
function detailBoolean(details: unknown, key: string): boolean | undefined {
  const value = record(details)[key];
  return typeof value === 'boolean' ? value : undefined;
}
