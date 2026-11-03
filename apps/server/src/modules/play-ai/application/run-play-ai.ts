/**
 * Shared play-time AI entry (积木 ai-narration / ai-npc-dialog 的薄运行时）。
 *
 * Discipline (same as the existing narrate_* commands):
 * - AI only writes ephemeral text: narration, an NPC bubble, or a suggestion.
 * - It never mutates graph/state, variables/facts, or invents choices/actions.
 * - Every failure is soft: status=unavailable, engine state stays untouched.
 *
 * The cache and per-session counters are single-process memory only. They are
 * lost on restart and are not shared across workers/replicas — never durable.
 */

export type PlayAiKind = 'narration' | 'npc_dialog';

export interface PlayAiWorldbookSnippet {
  title: string;
  content: string;
  kind: string;
}

export interface PlayAiBudget {
  /** When set together with maxCallsPerSession, counts model calls per save. In-memory only. */
  sessionId?: string;
  /** Hard cap for this save. Omit = unlimited (client still controls the toggle). */
  maxCallsPerSession?: number;
  /** Upper bound for returned text; defaults per kind (narration 800, npc_dialog 400). */
  maxChars?: number;
}

export interface PlayAiNarrationContext {
  kind: 'narration';
  sceneTitle: string;
  sceneText: string;
  choices: {id: string; label: string}[];
  variables: Record<string, string | number | boolean>;
  worldbookSnippets: PlayAiWorldbookSnippet[];
  tiandaoCorrect?: boolean;
}

export interface PlayAiNpcDialogContext {
  kind: 'npc_dialog';
  npcName: string;
  /** Author hint only; never resolved into graph/facts by this helper. */
  npcHint?: string;
  sceneTitle: string;
  sceneText: string;
  variables: Record<string, string | number | boolean>;
  worldbookSnippets: PlayAiWorldbookSnippet[];
  facts?: Record<string, string | number | boolean>;
  maxTurnsHint?: number;
  tiandaoCorrect?: boolean;
}

export type PlayAiContext = PlayAiNarrationContext | PlayAiNpcDialogContext;

export interface PlayAiModel {
  narrate(input: {
    sceneTitle: string;
    sceneText: string;
    choices: {id: string; label: string}[];
    variables: Record<string, string | number | boolean>;
    worldbookSnippets: PlayAiWorldbookSnippet[];
    tiandaoCorrect?: boolean;
  }, signal: AbortSignal): Promise<{narration: string}>;
  /** Optional: only providers that support the npc-dialog prompt implement it. */
  npcDialog?(input: {
    npcName: string;
    npcHint?: string;
    sceneTitle: string;
    sceneText: string;
    variables: Record<string, string | number | boolean>;
    worldbookSnippets: PlayAiWorldbookSnippet[];
    facts?: Record<string, string | number | boolean>;
    maxTurnsHint?: number;
    tiandaoCorrect?: boolean;
  }, signal: AbortSignal): Promise<{dialog: string}>;
}

export interface RunPlayAiInput {
  kind: PlayAiKind;
  context: PlayAiContext;
  model: PlayAiModel;
  budget?: PlayAiBudget;
  signal?: AbortSignal;
  /** When provided, a successful text is cached under this key (per-process, non-durable). */
  cacheKey?: string;
  force?: boolean;
}

export interface RunPlayAiResult {
  status: 'ok' | 'unavailable';
  text: string | null;
  reason: string | null;
  cached?: boolean;
}

const DEFAULT_MAX_CHARS: Record<PlayAiKind, number> = {narration: 800, npc_dialog: 400};

const textCache = new Map<string, string>();
const callCounts = new Map<string, number>();

/** Clear cached text. Optional prefix narrows it (e.g. 'narration:story:'). */
export function clearPlayAiCache(prefix?: string): void {
  if (!prefix) {
    textCache.clear();
    return;
  }
  for (const key of [...textCache.keys()]) {
    if (key.startsWith(prefix)) textCache.delete(key);
  }
}

/** Test/ops hook: reset the in-memory per-session call counters. */
export function resetPlayAiBudgets(): void {
  callCounts.clear();
}

/** Read the in-memory call counter for one save (diagnostics/tests only). */
export function playAiCallCount(sessionId: string): number {
  return callCounts.get(sessionId) ?? 0;
}

function maxCharsFor(kind: PlayAiKind, budget?: PlayAiBudget): number {
  const requested = budget?.maxChars;
  if (typeof requested === 'number' && Number.isInteger(requested) && requested > 0) return requested;
  return DEFAULT_MAX_CHARS[kind];
}

function unavailable(reason: string): RunPlayAiResult {
  return {status: 'unavailable', text: null, reason, cached: false};
}

function errorReason(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'AI 生成失败';
}

/**
 * Unified soft-fail play-time AI call. Callers map the result onto their own
 * surface (narration box / dialog bubble / suggestion) and keep the engine as
 * the single source of truth.
 */
export async function runPlayAi(input: RunPlayAiInput): Promise<RunPlayAiResult> {
  const {kind, context, model, budget} = input;
  const signal = input.signal ?? AbortSignal.timeout(60_000);
  const maxChars = maxCharsFor(kind, budget);
  const key = input.cacheKey ? `${kind}:${input.cacheKey}` : undefined;
  if (key && !input.force) {
    const hit = textCache.get(key);
    if (hit !== undefined) return {status: 'ok', text: hit, reason: null, cached: true};
  }
  const sessionId = budget?.sessionId;
  if (sessionId && budget?.maxCallsPerSession !== undefined) {
    const used = callCounts.get(sessionId) ?? 0;
    if (used >= budget.maxCallsPerSession) {
      return unavailable(`AI 调用额度已用完（${budget.maxCallsPerSession} 次/存档）。`);
    }
  }
  try {
    let text: string;
    if (kind === 'narration') {
      if (context.kind !== 'narration') return unavailable('AI 上下文类型不匹配：需要 narration。');
      if (sessionId) callCounts.set(sessionId, (callCounts.get(sessionId) ?? 0) + 1);
      const out = await model.narrate({
        sceneTitle: context.sceneTitle,
        sceneText: context.sceneText,
        choices: context.choices,
        variables: context.variables,
        worldbookSnippets: context.worldbookSnippets,
        tiandaoCorrect: context.tiandaoCorrect,
      }, signal);
      text = out.narration;
    } else {
      if (context.kind !== 'npc_dialog') return unavailable('AI 上下文类型不匹配：需要 npc_dialog。');
      if (!model.npcDialog) return unavailable('当前模型未提供 NPC 临场对话能力。');
      if (sessionId) callCounts.set(sessionId, (callCounts.get(sessionId) ?? 0) + 1);
      const out = await model.npcDialog({
        npcName: context.npcName,
        npcHint: context.npcHint,
        sceneTitle: context.sceneTitle,
        sceneText: context.sceneText,
        variables: context.variables,
        worldbookSnippets: context.worldbookSnippets,
        facts: context.facts,
        maxTurnsHint: context.maxTurnsHint,
        tiandaoCorrect: context.tiandaoCorrect,
      }, signal);
      text = out.dialog;
    }
    const trimmed = text.trim().slice(0, maxChars);
    if (!trimmed) return unavailable('AI 返回了空文案。');
    if (key) textCache.set(key, trimmed);
    return {status: 'ok', text: trimmed, reason: null, cached: false};
  } catch (error) {
    // Never cache hard failures so a refresh can retry.
    return unavailable(errorReason(error));
  }
}
