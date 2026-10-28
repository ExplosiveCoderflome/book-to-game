import { analysisSchema, branchSkeletonSchema, fillSceneTextModelOutputSchema, gameContentSchema, narrateModelOutputSchema, proposeActModelOutputSchema, proposeAdventureModelOutputSchema, sceneExtensionSchema, worldContentSchema, type Analysis, type AnalysisResult, type BranchSkeleton, type FillSceneTextModelOutput, type GameContent, type NarrateModelOutput, type ProposeActModelOutput, type ProposeAdventureModelOutput, type ProposeCandidate, type ScanDepth, type SceneExtension, type WorldContent } from '@novel-game/contracts';
import { setTimeout as delay } from 'node:timers/promises';
import { z, type ZodType } from 'zod';
import { productionPlanSchema, productionNarrativeSchema, type ProductionBrief, type ProductionPlan, type ProductionUnit, type ProductionNarrative } from '@novel-game/contracts';
import { productionTarget } from '../../modules/generation/index.js';
import { PRODUCTION_PLAN_SYSTEM, PRODUCTION_TEXT_SYSTEM } from './production-prompts.js';
import type { GenerationProvider, ModelRepairIssue, SourceChunk, WorldGenerationOptions } from '../../modules/generation/index.js';
import { AppError } from '../../shared/errors.js';
import type { Logger } from '../../shared/logger.js';
import { schemaIssueMessage, schemaIssues } from '../../shared/schema-issues.js';
import { extractJsonValue, JsonContentError } from './extract-json.js';
import { ANALYSIS_SYSTEM, EXPAND_SYSTEM, EXTEND_SCENE_SYSTEM, FILL_SCENE_TEXT_SYSTEM, GAME_SYSTEM, NARRATE_SYSTEM, PROPOSE_ACT_SYSTEM, PROPOSE_ADVENTURE_SYSTEM, SKELETON_SYSTEM, compactForGame, skeletonUserPayload, withTiandaoCorrect } from './prompts.js';
import { classifyStatus, parseRetryAfter, retryDelayMs } from './retry.js';
import { sanitizeWorldCandidate } from './sanitize-world.js';
import { BUILDING_DRAFT_SYSTEM, ITEM_DRAFT_SYSTEM, LOOT_DRAFT_SYSTEM, MAP_DRAFT_SYSTEM, SHELF_DRAFT_SYSTEM, WORLD_SYSTEM, compactWorldDossier } from './world-prompts.js';
import { buildingDraftModelOutputSchema, itemDraftModelOutputSchema, lootDraftModelOutputSchema, mapDraftModelOutputSchema, shelfDraftModelOutputSchema, type BuildingDraftModelOutput, type ItemDraftModelOutput, type LootDraftModelOutput, type MapDraftModelOutput, type ShelfDraftModelOutput } from '@novel-game/contracts';

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
  async planProduction(analysis: AnalysisResult, brief: ProductionBrief, chapterIds: string[], signal: AbortSignal, feedback?: {errors: ModelRepairIssue[]}): Promise<ProductionPlan> {
    return this.complete('plan_production', PRODUCTION_PLAN_SYSTEM, {
      brief, chapterIds, dossier: compactWorldDossier(analysis),
      schema: z.toJSONSchema(productionPlanSchema, {unrepresentable: 'any'}),
    }, signal, productionPlanSchema, feedback?.errors ?? []);
  }
  async writeProductionUnit(plan: ProductionPlan, unit: ProductionUnit, previousTexts: ProductionNarrative[], signal: AbortSignal, feedback?: {errors: ModelRepairIssue[]}): Promise<ProductionNarrative> {
    return this.complete('write_production_unit', PRODUCTION_TEXT_SYSTEM, {
      bible: plan.bible, playerRole: plan.world.playerRole, goal: plan.world.goal, routes: plan.routes,
      resources: plan.world.resourceDefs, facts: plan.world.facts, unit, target: productionTarget(plan, unit),
      variants: unit.variants, nearbyWriting: previousTexts.map(text => text.texts[0]).slice(-2),
    }, signal, productionNarrativeSchema, feedback?.errors ?? []);
  }
  async generateSkeleton(analysis: AnalysisResult, direction: string, signal: AbortSignal, feedback?: {errors: ModelRepairIssue[]}, scanDepth: ScanDepth = 'medium', options?: { statTemplateId?: string }): Promise<BranchSkeleton> {
    return this.complete('generate_skeleton', SKELETON_SYSTEM, skeletonUserPayload(analysis, direction, scanDepth, options), signal, branchSkeletonSchema, feedback?.errors ?? []);
  }
  async extendScenes(content: GameContent, sceneId: string, direction: string, signal: AbortSignal, feedback?: {errors: ModelRepairIssue[]}, options?: {neighborCount?: 1 | 2}): Promise<SceneExtension> {
    const anchor = content.scenes.find(scene => scene.id === sceneId);
    const neighborCount = options?.neighborCount === 2 ? 2 : 1;
    return this.complete('extend_scenes', EXTEND_SCENE_SYSTEM, {
      direction: direction || content.premise,
      sceneId,
      neighborCount,
      neighborGuide: neighborCount === 1
        ? '本轮只新增 1 个邻近场景，并给锚点挂 1 条新选择边。'
        : '本轮新增 2 个邻近场景（可互连或各自回锚点），锚点挂 1–2 条新选择边。',
      anchor: anchor ?? null,
      existingSceneIds: content.scenes.map(scene => scene.id),
      graph: {title: content.title, startSceneId: content.startSceneId, variables: content.variables, scenes: content.scenes},
    }, signal, sceneExtensionSchema, feedback?.errors ?? []);
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
  async proposeAct(input: { text: string; sceneTitle: string; sceneText: string; candidates: ProposeCandidate[]; tiandaoCorrect?: boolean }, signal: AbortSignal): Promise<ProposeActModelOutput> {
    return this.complete('propose_act', withTiandaoCorrect(PROPOSE_ACT_SYSTEM, input.tiandaoCorrect), {
      text: input.text,
      scene: { title: input.sceneTitle, text: input.sceneText.slice(0, 1200) },
      candidates: input.candidates,
      rule: 'choiceId 必须是 candidates 中的 id，或 none',
      tiandaoCorrect: !!input.tiandaoCorrect,
    }, signal, proposeActModelOutputSchema, []);
  }


  async fillSceneText(input: {
    gameTitle: string;
    premise: string;
    direction: string;
    polishTitle: boolean;
    scene: { id: string; title: string; text: string; ending?: string; choiceLabels: string[] };
    neighborHints: { id: string; title: string }[];
    worldbookSnippets: { title: string; content: string; kind: string }[];
    sourceExcerpts: { chapterId: string; paragraphId: string; text: string }[];
  }, signal: AbortSignal): Promise<FillSceneTextModelOutput> {
    return this.complete('fill_scene_text', FILL_SCENE_TEXT_SYSTEM, {
      gameTitle: input.gameTitle,
      premise: input.premise.slice(0, 800),
      direction: input.direction.slice(0, 800),
      polishTitle: input.polishTitle,
      scene: {
        id: input.scene.id,
        title: input.scene.title,
        text: input.scene.text.slice(0, 2000),
        ending: input.scene.ending,
        choiceLabels: input.scene.choiceLabels,
      },
      neighborHints: input.neighborHints,
      worldbookSnippets: input.worldbookSnippets,
      sourceExcerpts: input.sourceExcerpts,
      rule: input.polishTitle
        ? '输出加深后的 text，并可输出润色 title；禁止新选项/新边/新状态'
        : '只输出加深后的 text；禁止新选项/新边/新状态；不要改 title',
    }, signal, fillSceneTextModelOutputSchema, []);
  }

  async narrate(input: {
    sceneTitle: string;
    sceneText: string;
    choices: { id: string; label: string }[];
    variables: Record<string, string | number | boolean>;
    worldbookSnippets: { title: string; content: string; kind: string }[];
    tiandaoCorrect?: boolean;
  }, signal: AbortSignal): Promise<NarrateModelOutput> {
    return this.complete('narrate', withTiandaoCorrect(NARRATE_SYSTEM, input.tiandaoCorrect), {
      scene: { title: input.sceneTitle, text: input.sceneText.slice(0, 1200) },
      choices: input.choices,
      variables: input.variables,
      worldbookSnippets: input.worldbookSnippets,
      rule: '只输出旁白 narration；禁止新选项、新状态、新边',
      tiandaoCorrect: !!input.tiandaoCorrect,
    }, signal, narrateModelOutputSchema, []);
  }

  async proposeAdventureAct(input: { text: string; locationTitle: string; locationText: string; candidates: ProposeCandidate[]; tiandaoCorrect?: boolean }, signal: AbortSignal): Promise<ProposeAdventureModelOutput> {
    return this.complete('propose_adventure_act', withTiandaoCorrect(PROPOSE_ADVENTURE_SYSTEM, input.tiandaoCorrect), {
      text: input.text,
      location: { title: input.locationTitle, text: input.locationText.slice(0, 1200) },
      candidates: input.candidates,
      rule: 'actionId 必须是 candidates 中的 id，或 none',
      tiandaoCorrect: !!input.tiandaoCorrect,
    }, signal, proposeAdventureModelOutputSchema, []);
  }

  /** P5: novel → map draft proposal (validated by schema; placement happens in rules, review in the UI). */
  async extractMapDraft(input: { text: string; existingLocations: string[]; existingFactions: string[] }, signal: AbortSignal): Promise<MapDraftModelOutput> {
    return this.complete('extract_map_draft', MAP_DRAFT_SYSTEM, input, signal, mapDraftModelOutputSchema, []);
  }

  /** Author-time: propose reusable building-library assets. Does not write the catalog. */
  async proposeBuildings(input: {
    prompt: string; kinds?: string[]; genre?: string; context?: string; count: number; existingLabels: string[];
  }, signal: AbortSignal): Promise<BuildingDraftModelOutput> {
    return this.complete('propose_buildings', BUILDING_DRAFT_SYSTEM, input, signal, buildingDraftModelOutputSchema, []);
  }

  /** Author-time: propose Item Catalog drafts. Soft price hints only; no world resourceId required. */
  async proposeItems(input: {
    prompt: string; categories?: string[]; genre?: string; context?: string; count: number;
    existingLabels: string[]; categoryLabels: Record<string, string>;
  }, signal: AbortSignal): Promise<ItemDraftModelOutput> {
    return this.complete('propose_items', ITEM_DRAFT_SYSTEM, input, signal, itemDraftModelOutputSchema, []);
  }

  /** Author-time: propose shop shelf rows referencing existing Catalog itemIds only. */
  async proposeShelfRows(input: {
    prompt: string; genre?: string; context?: string; count: number;
    catalogItems: Array<{ id: string; label: string; category: string }>; categoryFilters?: string[];
  }, signal: AbortSignal): Promise<ShelfDraftModelOutput> {
    return this.complete('propose_shelf_rows', SHELF_DRAFT_SYSTEM, input, signal, shelfDraftModelOutputSchema, []);
  }

  /** Author-time: propose encounter loot rows referencing existing Catalog itemIds only. */
  async proposeLootRows(input: {
    prompt: string; genre?: string; context?: string; count: number;
    catalogItems: Array<{ id: string; label: string; category: string }>;
  }, signal: AbortSignal): Promise<LootDraftModelOutput> {
    return this.complete('propose_loot_rows', LOOT_DRAFT_SYSTEM, input, signal, lootDraftModelOutputSchema, []);
  }

  get modelName(): string { return this.config.model; }

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
    const body = JSON.stringify({model: this.config.model, response_format: {type: 'json_object'}, messages,
      ...(operation === 'plan_production' ? {max_tokens: 20000} : operation === 'write_production_unit' ? {max_tokens: 4000} : {})});
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
