import type {WorldPackageManifest} from './world-package.js';
import { z } from 'zod';
import { worldbookSchema } from './worldbook.js';
import { worldMapSchema, type MapFillIcon } from './world-map.js';
import { openingRollSchema } from './opening-roll.js';
export const SYSTEM_WAIT_ACTION_ID = '__wait__';

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/, '标识只允许字母、数字、短横线和下划线');
const extensionParamSchema = z.object({type: z.enum(['number', 'integer', 'boolean', 'string']), required: z.boolean().default(true),
  default: z.union([z.number().finite(), z.boolean(), z.string()]).optional(), min: z.number().finite().optional(), max: z.number().finite().optional(),
  maxLength: z.number().int().min(0).max(1000).optional()}).strict();
export const extensionDeclarationSchema = z.object({id, version: z.string().regex(/^\d+\.\d+\.\d+$/), point: z.enum(['condition', 'effect']),
  name: z.string().min(1).max(120), reads: z.array(z.string().regex(/^(resource|fact):[a-zA-Z0-9_-]{1,80}$|^elapsed$/)).max(80), writes: z.array(z.object({state: z.string().regex(/^(resource|fact):[a-zA-Z0-9_-]{1,80}$/), minDelta: z.number().finite(), maxDelta: z.number().finite()}).refine(w => w.maxDelta >= w.minDelta)).max(80),
  hooks: z.array(z.enum(['onStart', 'onTurn', 'onTimeAdvance', 'onAction', 'onEnter', 'onEnding', 'onLoad'])).min(1).max(7), params: z.record(id, extensionParamSchema),
  reason: z.string().trim().min(1).max(1000), tests: z.array(z.object({input: z.object({
    state: z.record(z.string(), z.union([z.number().finite(), z.boolean()])).default({}),
    params: z.record(z.string(), z.union([z.number().finite(), z.boolean(), z.string().max(1000)])).default({}),
    seed: z.number().int().min(0).max(4294967295).default(1),
  }).strict(), expected: z.unknown()}).strict()).min(3).max(100),
  code: z.string().min(1).max(32768)}).strict().superRefine((d, ctx) => {
    const issue = (message: string) => ctx.addIssue({code: 'custom', message});
    if (d.point === 'condition' && d.writes.length) issue('condition extensions cannot write state');
    if (d.point === 'effect' && d.hooks.includes('onLoad')) issue('onLoad is read-only');
    for (const keys of [d.reads, d.writes.map(w => w.state), d.hooks]) if (new Set(keys).size !== keys.length) issue('duplicate declaration entry');
    for (const w of d.writes) if (w.state.startsWith('fact:') && (w.minDelta < 0 || w.maxDelta > 1)) issue('fact write bounds must be within 0..1');
    for (const [key, p] of Object.entries(d.params)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) issue(`reserved parameter: ${key}`);
      const numeric = p.type === 'number' || p.type === 'integer';
      if (numeric && (p.min === undefined || p.max === undefined || p.min > p.max)) issue(`numeric parameter ${key} requires min <= max`);
      if (p.type === 'string' && p.maxLength === undefined) issue(`string parameter ${key} requires maxLength`);
      if (!numeric && (p.min !== undefined || p.max !== undefined)) issue(`non-numeric parameter ${key} cannot have min/max`);
      if (p.type !== 'string' && p.maxLength !== undefined) issue(`non-string parameter ${key} cannot have maxLength`);
      if (p.default !== undefined && (numeric ? typeof p.default !== 'number' || (p.type === 'integer' && !Number.isInteger(p.default)) || p.default < p.min! || p.default > p.max!
        : typeof p.default !== p.type || (typeof p.default === 'string' && p.default.length > p.maxLength!))) issue(`invalid default for ${key}`);
    }
  });
export type ExtensionDeclaration = z.infer<typeof extensionDeclarationSchema>;
export const extensionAuditSchema = z.object({severity: z.literal('error'), code: z.string(), extensionId: id.optional(), message: z.string()});
const evidence = z.object({chapterId: z.string().min(1).max(80), paragraphId: z.string().min(1).max(80)});
const provenance = {origin: z.enum(['source', 'adapted']), evidence: z.array(evidence).max(30)};
export const FACTION_STANCES = ['ally', 'neutral', 'hostile'] as const;
export const factionStanceSchema = z.enum(FACTION_STANCES);
export type FactionStance = z.infer<typeof factionStanceSchema>;
/** Authored faction relation (unordered pair). standing −100..100. */
export const factionRelationSchema = z.object({a: id, b: id, stance: factionStanceSchema, standing: z.number().int().min(-100).max(100)});
export type FactionRelation = z.infer<typeof factionRelationSchema>;
const cell = z.string().regex(/^-?\d{1,3},-?\d{1,3}$/);
export const ledgerAssertionSchema = z.object({
  id, factId: id, claim: z.enum(['world-true', 'world-false', 'player-knows', 'holds', 'consumed', 'committed']),
}).strict();
export type LedgerAssertion = z.infer<typeof ledgerAssertionSchema>;
export const ledgerEffectSchema = z.object({kind: z.literal('ledger'), factId: id, operation: z.enum(['acquire', 'release', 'consume', 'commit', 'fulfill'])}).strict();
export type LedgerEffect = z.infer<typeof ledgerEffectSchema>;
const baseConditionOptions = [
  z.object({kind: z.literal('fact'), factId: id, value: z.boolean()}),
  z.object({kind: z.literal('known'), factId: id}),
  z.object({kind: z.literal('npc_knows'), npcId: id, factId: id}),
  z.object({kind: z.literal('time'), atLeast: z.number().int().min(0).max(100)}),
  /** Map-aware (optional map layer): player's current location POI cell terrain ∈ terrainIds. No map/POI → false. */
  z.object({kind: z.literal('at_terrain'), terrainIds: z.array(id).min(1).max(20)}),
  /** Map-aware: player's current location POI cell is owned by one of factionIds (authored baseline). */
  z.object({kind: z.literal('in_faction_territory'), factionIds: z.array(id).min(1).max(20)}),
  /** Map-aware: player's current location lies in one of the named regions/districts. */
  z.object({kind: z.literal('in_region'), regionIds: z.array(id).min(1).max(20)}),
  /** Faction relation (effective = session override ?? authored). stances any-of; standing bounds inclusive. */
  z.object({kind: z.literal('faction_relation'), a: id, b: id, stances: z.array(factionStanceSchema).min(1).max(3).optional(),
    atLeast: z.number().int().min(-100).max(100).optional(), atMost: z.number().int().min(-100).max(100).optional()}),
  /** NPC currently at a location (session state). */
  z.object({kind: z.literal('npc_at_location'), npcId: id, locationId: id}),
  /** Open-world numeric resource gate (P1 fill buy/supply). S1: atLeast and/or atMost (inclusive interval). */
  z.object({kind: z.literal('resource'), resourceId: id, atLeast: z.number().finite().optional(), atMost: z.number().finite().optional()})
    .refine(c => c.atLeast !== undefined || c.atMost !== undefined, 'resource 条件至少需要 atLeast 或 atMost'),
  z.object({kind: z.literal('extension'), extensionId: id, params: z.record(z.string(), z.unknown()).default({})}),
  /** S1 monthly clock: months elapsed since the clock start (0 = start month). Inclusive bounds. */
  z.object({kind: z.literal('clock'), atLeastMonth: z.number().int().min(0).max(2400).optional(), atMostMonth: z.number().int().min(0).max(2400).optional(),
    /** Calendar months (1–12) in which the condition holds, e.g. autumn = [9, 10]. */
    monthOfYearIn: z.array(z.number().int().min(1).max(12)).min(1).max(12).optional()})
    .refine(c => c.atLeastMonth !== undefined || c.atMostMonth !== undefined || c.monthOfYearIn !== undefined, 'clock 条件至少需要 atLeastMonth / atMostMonth / monthOfYearIn'),
  /** S1: how many times a storylet has been played (atLeast default 1). */
  z.object({kind: z.literal('storylet_seen'), storyletId: id, atLeast: z.number().int().min(0).max(1000).optional(), atMost: z.number().int().min(0).max(1000).optional()}),
] as const;
export const worldBaseConditionSchema = z.discriminatedUnion('kind', [...baseConditionOptions]);
/** S1 one-level OR group. Nested anyOf is not allowed (members are base conditions only). */
export const worldAnyOfConditionSchema = z.object({kind: z.literal('anyOf'), conditions: z.array(worldBaseConditionSchema).min(1).max(10)});
export const worldConditionSchema = z.discriminatedUnion('kind', [...baseConditionOptions, worldAnyOfConditionSchema]);
const baseEffectOptions = [
  z.object({kind: z.literal('set'), factId: id, value: z.boolean()}),
  ledgerEffectSchema,
  z.object({kind: z.literal('reveal'), factId: id}),
  z.object({kind: z.literal('npc_learn'), npcId: id, factId: id}),
  z.object({kind: z.literal('move'), locationId: id}),
  z.object({kind: z.literal('npc_move'), npcId: id, locationId: id}),
  /** Adjust open-world numeric resource (power/upgrade pools). Capped by worldbook. */
  z.object({kind: z.literal('resource'), resourceId: id, delta: z.number().finite()}),
  /** Session territory change: cells and/or a whole region → faction (null = unclaimed). Authored map never mutates. */
  z.object({kind: z.literal('set_territory'), factionId: id.nullable(), cells: z.array(cell).max(200).optional(), regionId: id.optional(), mapId: id.optional()})
    .refine(e => (e.cells?.length ?? 0) > 0 || !!e.regionId, '须指定格或区域'),
  /** Session faction relation change: set stance and/or standing, or shift standing by delta (clamped ±100). */
  z.object({kind: z.literal('set_faction_relation'), a: id, b: id, stance: factionStanceSchema.optional(),
    standing: z.number().int().min(-100).max(100).optional(), standingDelta: z.number().int().min(-200).max(200).optional()}),
  /**
   * Encounter stub (P2): writes auditable engage fact (enc_engaged_*). Full combat runtime out of scope.
   */
  z.object({kind: z.literal('start_encounter'), placementId: id.optional(), encounterId: id.optional(), label: z.string().max(80).optional()}),
  /** S1: change a resource's current maximum (set or delta). Current value is clamped down to the new max. */
  z.object({kind: z.literal('resource_max'), resourceId: id, set: z.number().finite().optional(), delta: z.number().finite().optional()})
    .refine(e => (e.set === undefined) !== (e.delta === undefined), 'resource_max 需且仅需 set 或 delta 之一'),
  /** S1: end the adventure with an authored ending (by id). */
  z.object({kind: z.literal('ending'), endingId: id}),
  z.object({kind: z.literal('extension'), extensionId: id, params: z.record(z.string(), z.unknown()).default({})}),
] as const;
export const worldBaseEffectSchema = z.discriminatedUnion('kind', [...baseEffectOptions]);
const chanceModSchema = z.object({resourceId: id.optional(), atLeast: z.number().finite().optional(), atMost: z.number().finite().optional(),
  /** Fact bonus: applies `add` when the fact equals `value` (default true). Mutually exclusive with resourceId. */
  factId: id.optional(), value: z.boolean().optional(),
  add: z.number().min(-1).max(1).optional(), per: z.number().min(-1).max(1).optional(), label: z.string().min(1).max(80).optional()})
  .refine(m => (m.resourceId === undefined) !== (m.factId === undefined), 'chance 修正需且仅需 resourceId 或 factId 之一')
  .refine(m => m.factId === undefined || (m.add !== undefined && m.per === undefined && m.atLeast === undefined && m.atMost === undefined), 'factId 修正只能带 add')
  .refine(m => (m.add === undefined) !== (m.per === undefined), 'chance 修正需且仅需 add 或 per 之一')
  .refine(m => m.per === undefined || (m.atLeast === undefined && m.atMost === undefined), 'per 修正不可带 atLeast/atMost');
/** S1 seeded roll: success probability = clamp(base + Σ mods, min, max); draws from the save's RNG. One level only. */
export const worldRollEffectSchema = z.object({kind: z.literal('roll'), chance: z.object({base: z.number().min(0).max(1),
  mods: z.array(chanceModSchema).max(10).optional(), min: z.number().min(0).max(1).optional(), max: z.number().min(0).max(1).optional()}),
  success: z.array(worldBaseEffectSchema).max(20), failure: z.array(worldBaseEffectSchema).max(20),
  successText: z.string().max(3000).optional(), failureText: z.string().max(3000).optional(), showChance: z.boolean().optional()});
export const worldEffectSchema = z.discriminatedUnion('kind', [...baseEffectOptions, worldRollEffectSchema]);
const thresholdTriggerSchema = z.object({ending: id.optional(), storylet: id.optional(), effects: z.array(worldBaseEffectSchema).max(10).optional()});
export const resourceDefSchema = z.object({
  label: z.string().min(1).max(40), unit: z.string().max(10).optional(),
  min: z.number().finite(), max: z.number().finite().optional(), initial: z.number().finite().optional(),
  display: z.enum(['bar', 'number', 'pips', 'hidden']).optional(),
  warnAtMost: z.number().finite().optional(), warnAtLeast: z.number().finite().optional(),
  onMin: thresholdTriggerSchema.optional(), onMax: thresholdTriggerSchema.optional(),
  /** Ordinal labels (e.g. 炼气 / 筑基 / 金丹) for value − min. */
  valueLabels: z.array(z.string().min(1).max(20)).max(20).optional(),
  description: z.string().max(500).optional(),
}).refine(d => d.max === undefined || d.max >= d.min, 'max 不能小于 min');
export type ResourceDef = z.infer<typeof resourceDefSchema>;
const clockUnitSchema = z.enum(['day', 'week', 'month', 'year']);
export type ClockUnit = z.infer<typeof clockUnitSchema>;
export const clockSchema = z.object({
  unit: clockUnitSchema.default('month'), startYear: z.number().int().min(-9999).max(9999), startMonth: z.number().int().min(1).max(12),
  /** Calendar template, tokens {year} {month}. */
  display: z.string().min(1).max(40).optional(),
  /** Clock-tick limit; the legacy field name is retained for saved-content compatibility. */
  limitMonths: z.number().int().min(1).max(2400),
  rules: z.array(z.object({id: id.optional(),
    /** Interval in clock ticks; the legacy field name is retained for saved-content compatibility. */
    everyMonths: z.number().int().min(1).max(1200), effects: z.array(worldBaseEffectSchema).min(1).max(10),
    label: z.string().max(80).optional(), /** Narration appended each time the rule fires. */ text: z.string().max(1000).optional()})).max(20).optional(),
  windows: z.array(z.object({id, label: z.string().min(1).max(80).optional(), fromMonth: z.number().int().min(0).max(2400), toMonth: z.number().int().min(0).max(2400), storyletId: id.optional()})
    .refine(w => w.toMonth >= w.fromMonth, 'toMonth 不能早于 fromMonth')).max(40).optional(),
  countdownResourceId: id.optional(),
  /** Authored ending used when limitMonths is reached (kind timeout). Absent → built-in 「时间已到」 + timeoutEnding. */
  timeoutEndingId: id.optional(),
});
export type WorldClock = z.infer<typeof clockSchema>;
export const storyletChoiceSchema = z.object({id, label: z.string().min(1).max(200),
  /** Months when the world has a clock (0–120); turns otherwise (0–5). 0 = no time passes. */
  timeCost: z.number().int().min(0).max(120),
  /** Hidden (not greyed out) while these fail. */
  availableWhen: z.array(worldConditionSchema).max(20).optional(),
  requires: z.array(worldConditionSchema).max(20).optional(),
  blockedReason: z.string().min(1).max(500).optional(), risk: z.string().max(500).optional(),
   effects: z.array(worldEffectSchema).max(20), text: z.string().min(1).max(3000), ledgerAssertions: z.array(ledgerAssertionSchema).max(20).optional()});
export const storyletSchema = z.object({id, title: z.string().min(1).max(120),
  /** Authoring category (main / repeat / trigger). Metadata only. */
  kind: z.enum(['main', 'repeat', 'trigger']).optional(),
  locationIds: z.array(id).max(40).optional(), when: z.array(worldConditionSchema).max(20).optional(),
  weight: z.object({base: z.number().min(0).max(1000), mods: z.array(z.object({
    /** Either a condition list or a single resource range. */
    when: z.array(worldConditionSchema).max(10).optional(), resourceId: id.optional(),
    atLeast: z.number().finite().optional(), atMost: z.number().finite().optional(), add: z.number().min(-1000).max(1000)})).max(10).optional()}).optional(),
  /** Absent = one-time card. maxTimes null/absent = unlimited. */
  repeat: z.object({cooldownTurns: z.number().int().min(0).max(100), maxTimes: z.number().int().min(1).max(1000).nullable().optional()}).optional(),
  urgent: z.boolean().optional(),
  /** Body text: `text` alone, or `textVariants` (random without consecutive repeats, or sequential by play count). */
  text: z.string().min(1).max(4000).optional(),
  textVariants: z.array(z.string().min(1).max(4000)).min(1).max(10).optional(),
  variantMode: z.enum(['random', 'sequential']).optional(),
  /** S4: state-dependent bodies. When the card is shown, the first case whose `when` holds (facts, resources, storylet_seen …,
   *  evaluated against the current state) replaces the rotated `text`/`textVariants` body; none holding → the old rotation. */
  textCases: z.array(z.object({id: id.optional(), when: z.array(worldConditionSchema).min(1).max(10), text: z.string().min(1).max(4000)})).max(10).optional(),
  /** Authoring batch number. Metadata only. */
  batch: z.number().int().min(0).max(100).optional(),
  choices: z.array(storyletChoiceSchema).min(1).max(6)}).refine(sl => !!sl.text || !!sl.textVariants?.length, '剧情卡需要 text 或 textVariants');
/** All body variants of a storylet (text first when both exist). */
export function storyletBodies(sl: {text?: string; textVariants?: string[]}): string[] {
  return sl.textVariants?.length ? sl.textVariants : sl.text ? [sl.text] : [];
}
/** S4: every body a storylet can show (rotation bodies, then state cases). */
export function storyletAllBodies(sl: {text?: string; textVariants?: string[]; textCases?: {text: string}[]}): string[] {
  return [...storyletBodies(sl), ...(sl.textCases ?? []).map(c => c.text)];
}
export type Storylet = z.infer<typeof storyletSchema>;
export type StoryletChoice = z.infer<typeof storyletChoiceSchema>;
/** K15 (§12): conditional ending passage. Existing Condition syntax only. */
/** K15 `when`: same syntax as storylet conditions — an array (all hold; one nested `anyOf` level allowed) or a single condition object. */
const k15WhenSchema = z.preprocess(v => (v && typeof v === 'object' && !Array.isArray(v) ? [v] : v), z.array(worldConditionSchema).max(10));
export const endingPassageSchema = z.object({id, when: k15WhenSchema, text: z.string().min(1).max(2000)});
/** K15 (§12): one line of the 「这一生」 recap. */
export const recapEntrySchema = z.object({id, when: k15WhenSchema, text: z.string().min(1).max(500), order: z.number().finite().optional()});
export type EndingPassage = z.infer<typeof endingPassageSchema>;
export type RecapEntry = z.infer<typeof recapEntrySchema>;
/**
 * 终局条件（阿拼 `end-conditions`）：胜负判定的结构化载荷。
 *
 * 积木只提供「判定槽位」与运行时判定路径；具体 when 谓词按每个游戏在生成/编辑时填入，
 * 不绑死经营或打怪题材。条件仍使用既有 WorldCondition 语法，不新增平行引擎。
 */
export const END_CONDITION_KINDS = ['win', 'lose'] as const;
export const endConditionKindSchema = z.enum(END_CONDITION_KINDS);
export type EndConditionKind = z.infer<typeof endConditionKindSchema>;

/** 作者/AI 提交的条件描述：id 可省略（应用时分配），when 必填。 */
export const endConditionDraftSchema = z.object({
  id: id.optional(),
  label: z.string().min(1).max(200),
  when: z.array(worldConditionSchema).min(1).max(10),
  note: z.string().max(300).optional(),
});
export type EndConditionDraft = z.infer<typeof endConditionDraftSchema>;

/** Agent 提议的一整套胜负条件包：用户从中挑一套，或改用自定义文本。 */
export const endConditionSetDraftSchema = z.object({
  id: id,
  label: z.string().min(1).max(120),
  summary: z.string().min(1).max(500),
  /** 软提示：温和 / 标准 / 高压，帮助作者比较代价。 */
  tone: z.enum(['gentle', 'standard', 'harsh']).optional(),
  win: z.array(endConditionDraftSchema).min(1).max(6),
  lose: z.array(endConditionDraftSchema).min(1).max(6),
});
export type EndConditionSetDraft = z.infer<typeof endConditionSetDraftSchema>;

/** 写入世界后的条件（带稳定 id 与结局引用）。 */
export const endConditionSchema = z.object({
  id: id,
  kind: endConditionKindSchema,
  label: z.string().min(1).max(200),
  when: z.array(worldConditionSchema).min(1).max(10),
  /** 命中的结局 id；必须存在于 world.endings。 */
  endingId: id,
  note: z.string().max(300).optional(),
});
export type EndCondition = z.infer<typeof endConditionSchema>;

const endConditionsShape = {
  /** 来源：AI 提议包 / 作者自定义文本 / 作者事后编辑。 */
  source: z.enum(['agent-proposed', 'author-custom', 'author-edited']),
  packageId: id.optional(),
  packageLabel: z.string().max(120).optional(),
  /** 固定的严重度标记：改胜负条件会重塑整局游戏。 */
  severity: z.literal('reshapes-game'),
  win: z.array(endConditionSchema).min(1).max(6),
  lose: z.array(endConditionSchema).min(1).max(6),
};
export const worldEndConditionsSchema = z.object(endConditionsShape).superRefine((value, ctx) => {
  const ids = new Set<string>();
  for (const [kind, items] of [['win', value.win], ['lose', value.lose]] as const) {
    for (const [index, item] of items.entries()) {
      if (item.kind !== kind) ctx.addIssue({code: 'custom', message: `${kind} 列表只能放 ${kind} 条件`, path: [kind, index, 'kind']});
      const key = item.id;
      if (ids.has(key)) ctx.addIssue({code: 'custom', message: `终点条件 id 重复：${key}`, path: [kind, index, 'id']});
      ids.add(key);
    }
  }
});
export type WorldEndConditions = z.infer<typeof worldEndConditionsSchema>;

/** K15: resolved ending snapshot (saved with the run; never recomputed on load). */
export interface EndingSnapshot {id: string; title: string; text: string; kind?: 'ending' | 'failure' | 'timeout'; path?: string[];
  /** K15: passages that held when the ending fired (array order). */
  passages?: {id: string; text: string}[];
  /** K15: recap lines that held when the ending fired (sorted by order). */
  recap?: {id: string; text: string}[]}
export const worldContentSchema = z.object({
  schemaVersion: z.literal(1), mode: z.literal('open'), title: z.string().min(1).max(200),
  premise: z.string().min(1).max(4000), playerRole: z.string().min(1).max(500), goal: z.string().min(1).max(1000),
  worldRules: z.array(z.string().min(1).max(1000)).min(1).max(20), adaptationNotes: z.string().max(4000),
  sourceChapterIds: z.array(z.string().min(1).max(80)).min(1).max(1000),
  initialLocationId: id, timeLimit: z.number().int().min(3).max(100), timeoutEnding: z.string().min(1).max(3000),
  /** 终局条件块：判胜/判负的结构化载荷（阿拼 end-conditions）。缺省 = 沿用结局 when 的旧判定。 */
  endConditions: worldEndConditionsSchema.optional(),
  locations: z.array(z.object({id, title: z.string().min(1).max(200), text: z.string().min(1).max(4000),
    /** Location hierarchy (city → district → room). Enter/exit are ordinary move actions. */
    parentLocationId: id.optional(),
    /** S1: conditional descriptions; the first variant whose `when` holds replaces `text`. */
    textVariants: z.array(z.object({when: z.array(worldConditionSchema).min(1).max(10), text: z.string().min(1).max(4000)})).max(10).optional(),
    ...provenance})).min(3).max(40),
  facts: z.array(z.object({id, label: z.string().min(1).max(120), description: z.string().max(1000),
    kind: z.enum(['clue', 'item', 'relationship', 'event']), initialValue: z.boolean(), playerKnown: z.boolean(), ...provenance})).max(80),
  ledgerVersion: z.literal(1).optional(),
  npcs: z.array(z.object({id, name: z.string().min(1).max(120), description: z.string().max(1000),
    goal: z.string().min(1).max(1000), initialLocationId: id, knownFactIds: z.array(id).max(80),
    /** World layer (P4): affiliation, home, tags, bio and links into worldbook entries. Authoring metadata. */
    factionId: id.optional(), homeLocationId: id.optional(), tags: z.array(z.string().min(1).max(40)).max(10).optional(),
    bio: z.string().max(4000).optional(), worldbookEntryIds: z.array(z.string().min(1).max(80)).max(20).optional(),
    ...provenance})).max(40),
  actions: z.array(z.object({id, label: z.string().min(1).max(200), description: z.string().max(1000), locationId: id,
    npcId: id.optional(), availableWhen: z.array(worldConditionSchema).max(20), requires: z.array(worldConditionSchema).max(20),
    blockedReason: z.string().min(1).max(500), risk: z.string().max(500),
    /** 1–5 turns; with an S1 `clock` the unit is months, 0 (instant, e.g. selling) is allowed and the cap is 120 (checked at content level). */
    timeCost: z.number().int().min(0).max(120),
    once: z.boolean(), effects: z.array(worldEffectSchema).min(1).max(20), text: z.string().min(1).max(3000),
    ledgerAssertions: z.array(ledgerAssertionSchema).max(20).optional(),
    /** Optional tags for worldbook hard rules (same constraint types as story choices). */
    tags: z.array(z.string().min(1).max(40)).max(10).optional(), ...provenance})).min(3).max(80),
  events: z.array(z.object({id, label: z.string().min(1).max(120), when: z.array(worldConditionSchema).min(1).max(20),
    effects: z.array(worldEffectSchema).min(1).max(20), text: z.string().max(2000), visibility: z.enum(['public', 'hidden']),
    ledgerAssertions: z.array(ledgerAssertionSchema).max(20).optional()})).max(40),
  endings: z.array(z.object({id, title: z.string().min(1).max(200), text: z.string().min(1).max(3000),
    /** Empty only in S1 worlds: the ending is then reached by an `ending` effect / onMin / onMax, never by `when`. */
    when: z.array(worldConditionSchema).max(20),
    /** S1: failure endings render as 「失败结局」; timeout = clock limit. Absent = ordinary ending. */
    kind: z.enum(['ending', 'failure', 'timeout']).optional(),
    /** Authoring status (e.g. stub). Metadata only. */
    status: z.string().max(40).optional(),
    /** S1: conditional ending texts (first match wins). */
    textVariants: z.array(z.object({when: z.array(worldConditionSchema).min(1).max(10), text: z.string().min(1).max(3000)})).max(10).optional(),
    /** K15: passages appended after the ending body, in array order, for every `when` that holds at the moment the ending fires. */
    passages: z.array(endingPassageSchema).max(40).optional(),
    ledgerAssertions: z.array(ledgerAssertionSchema).max(20).optional(),
  })).min(1).max(40),
  /** K15: 「这一生」 recap shown at the bottom of the ending page (entries whose `when` holds at the ending; by `order`, else array order). */
  recap: z.array(recapEntrySchema).max(120).optional(),
  /** Numeric power/upgrade pools for worldbook gates/spends/ladders (not boolean facts). */
  resources: z.record(z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/), z.number().finite()).optional(),
  /** S1: resource definitions (bounds, display, threshold triggers). Absent = legacy unbounded resources. */
  resourceDefs: z.record(z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/), resourceDefSchema).optional(),
  /** Explicit scope for causal checks; omission means no resource/choice/commitment is asserted as important. */
  causalClaims: z.object({keyResourceIds: z.array(id).max(80).default([]), keyChoiceIds: z.array(id).max(200).default([]),
    commitments: z.array(z.object({id, actionId: id, factId: id}).strict()).max(100).default([])}).strict().optional(),
  /** K16: optional seeded opening values; omitted/disabled preserves the legacy start flow. */
  openingRoll: openingRollSchema.optional(),
  /** S1 clock. When present, `limitMonths` replaces `timeLimit` and timeCost means clock ticks. */
  clock: clockSchema.optional(),
  /** S1: storylet hand rules. */
  storyletRules: z.object({handSize: z.number().int().min(1).max(5).optional(), refreshOn: z.array(z.enum(['move', 'clock'])).max(2).optional(),
    refreshEveryMonths: z.number().int().min(1).max(120).optional()}).optional(),
  /** S1: authoring progress. `complete: false` = content delivered in batches; lint reports tier shortfalls as warnings. */
  production: z.object({batch: z.number().int().min(1).max(100).optional(), complete: z.boolean().optional(), tier: z.enum(['S', 'M', 'L']).optional(), note: z.string().max(2000).optional()}).optional(),
  /** S1 acceptance ⑦: who produced this draft. `generator: 'mock'` = fixture model output; publishing it is refused outside tests. */
  provenance: z.object({generator: z.string().min(1).max(80), model: z.string().max(200).optional(),
    source: z.enum(['runner', 'backfill', 'copy']).optional(), copiedFrom: z.string().max(80).optional()}).optional(),
  /** T2: immutable-at-selection catalog contract receipts for author-time composition. */
  blockSelections: z.array(z.object({blockId: id, version: z.number().int().positive(), params: z.record(z.string(), z.unknown())}).strict()).max(40).optional(),
  extensions: z.array(extensionDeclarationSchema).max(100).optional(),
  extensionAudit: z.array(extensionAuditSchema).max(1000).optional(),
  /** S1: storylet card pool. */
  storylets: z.array(storyletSchema).max(400).optional(),
  /** Same hard worldbook as story; scope may use locations. */
  worldbook: worldbookSchema.optional(),
  /** Optional infinite-canvas location positions; authoring metadata, ignored by adventure runtime. */
  canvasLayout: z.record(z.string().min(1).max(80), z.object({ x: z.number().finite(), y: z.number().finite() })).optional(),
  /** Optional spatial map layer (hex v1). Never creates movement edges; absent = no map. */
  map: worldMapSchema.optional(),
  /** Child maps (city/district/interior). Each must carry an `id` and a `parent` link. */
  subMaps: z.array(worldMapSchema).max(32).optional(),
  /** Authored faction relation matrix (pairs; factions come from map faction layers). */
  factionRelations: z.array(factionRelationSchema).max(200).optional(),
  /** Eras (P4): named periods with per-map territory snapshots (mapId → cell → faction id, '' = unclaimed). Authoring/preview. */
  eras: z.array(z.object({id, name: z.string().min(1).max(80), description: z.string().max(1000).optional(),
    territory: z.record(id, z.record(z.string().regex(/^-?\d{1,3},-?\d{1,3}$/), z.string().max(80)))})).max(12).optional(),
}).superRefine((world, ctx) => {
  const s1 = usesS1Systems(world);
  if (!world.clock) world.actions.forEach((a, i) => {
    if (a.timeCost > 5 || a.timeCost < 1) ctx.addIssue({code: 'custom', path: ['actions', i, 'timeCost'], message: '未启用 clock 时 timeCost 只能为 1–5'});
  });
  world.endings.forEach((e, i) => {
    if (!s1 && e.when.length === 0) ctx.addIssue({code: 'custom', path: ['endings', i, 'when'], message: '结局至少需要一个条件'});
  });
  if (!s1 && world.endings.length > 12) ctx.addIssue({code: 'custom', path: ['endings'], message: '结局最多 12 个'});
  if (world.endConditions) {
    const endingIds = new Set(world.endings.map(ending => ending.id));
    for (const kind of ['win', 'lose'] as const) {
      world.endConditions[kind].forEach((item, i) => {
        if (!endingIds.has(item.endingId)) ctx.addIssue({code: 'custom', path: ['endConditions', kind, i, 'endingId'], message: `终局条件引用了不存在的结局：${item.endingId}`});
        // 胜负必须能改变游戏走向：win 命中的结局不能是失败/超时结局，lose 不能是普通结局。
        const ending = world.endings.find(candidate => candidate.id === item.endingId);
        if (ending && kind === 'win' && ending.kind === 'failure') ctx.addIssue({code: 'custom', path: ['endConditions', kind, i, 'endingId'], message: `胜利条件不能指向失败结局：${item.endingId}`});
        if (ending && kind === 'lose' && (ending.kind === 'ending' || ending.kind === 'timeout')) ctx.addIssue({code: 'custom', path: ['endConditions', kind, i, 'endingId'], message: `失败条件不能指向普通或超时结局：${item.endingId}`});
      });
    }
  }
});
/** True when the world opts into any S1 system (resourceDefs / clock / storylets). Old worlds return false. */
export function usesS1Systems(world: {resourceDefs?: unknown; clock?: unknown; storylets?: unknown}): boolean {
  return !!(world.resourceDefs || world.clock || world.storylets);
}
export type WorldContent = z.infer<typeof worldContentSchema>;
export type WorldCondition = z.infer<typeof worldConditionSchema>;
export type WorldBaseCondition = z.infer<typeof worldBaseConditionSchema>;
export type WorldEffect = z.infer<typeof worldEffectSchema>;
export type WorldBaseEffect = z.infer<typeof worldBaseEffectSchema>;
export type WorldRollEffect = z.infer<typeof worldRollEffectSchema>;
export interface WorldDraft {id: string; sourceId: string; content: WorldContent; version: number; createdAt: string; updatedAt: string; qualityContractVersion?: number}
export interface WorldRevision {id: string; draftId: string; sourceId: string; content: WorldContent; version: number; createdAt: string; packageManifest?: WorldPackageManifest}
export const adventureActSchema = z.object({actionId: id, expectedTurn: z.number().int().nonnegative(), requestId: z.string().uuid()});
export type AdventureActInput = z.infer<typeof adventureActSchema>;
export interface AdventureHistory {turn: number; elapsed: number; actionLabel?: string; text: string}
export interface AdventureView {
  id: string; worldRevisionId: string; turn: number; elapsed: number; timeLimit: number; ended: boolean;
  phase?: 'opening' | 'play'; openingRoll?: import('./opening-roll.js').OpeningRollSession;
  playerRole: string; goal: string; location: {id: string; title: string; text: string};
  facts: {id: string; label: string; description: string; kind: 'clue' | 'item' | 'relationship' | 'event'; value: boolean}[];
  resources?: Record<string, number>;
  npcs: {id: string; name: string; description: string; factionId?: string; tags?: string[]}[];
  actions: {
    id: string; label: string; description: string; timeCost: number; risk: string; enabled: boolean; blockedReason?: string;
    /** Decide-side spend hints already resolved to displayLabel×amount — never invent client-side. */
    costHints?: string[];
    /** Mute kind eyebrow for fill actions (shop/supply/quest…). Pure text, not a rainbow chip. */
    kindHint?: 'shop' | 'supply' | 'quest' | 'encounter' | 'boss';
    /** When set, UI may group this line into a FillInteractionSheet (hybrid A/B). */
    fillGroupId?: string;
    /** S1 (C7): who wrote blockedReason — generated sentence, author override, or legacy text. */
    blockedReasonKind?: 'generated' | 'author' | 'legacy';
    /** S1 (C6): roll odds for this option (chance omitted when the author hides it). */
    roll?: AdventureRollView;
  }[];
  /**
   * Fill interaction groups projected from map.fill placements (P1).
   * Entry rows are UI-only; line actions live in `actions` and POST through adventures/.../actions.
   */
  fillGroups?: AdventureFillGroup[];
  ending?: EndingSnapshot; history: AdventureHistory[]; createdAt: string; updatedAt: string;
  /** Spatial status for the play map (absent when the world has no map). Session-derived, read-only. */
  map?: AdventureMapView;
  // ── S1 projection (absent for worlds without resourceDefs / clock / storylets) ──
  /** C1: declared resources in order (hidden ones omitted). */
  resourceMeta?: AdventureResourceMeta[];
  /** C2/C6: what the last action changed. */
  lastResult?: AdventureLastResultView;
  /** C3/C4: monthly clock. */
  clock?: AdventureClockView;
  /** C11: unit of timeCost / elapsed. */
  timeUnit?: ClockUnit;
  /** C5: storylet hand; choice ids go through the same act endpoint. */
  hand?: AdventureHandView[];
  /** Author-only diagnostics: the save's RNG position. */
  rng?: {seed: number; cursor: number};
}
export type AdventureAction = AdventureView['actions'][number];
export interface AdventureRollView {chance?: number; parts?: {label: string; add: number}[]; min: number; max: number}
export interface AdventureResourceMeta {
  id: string; label: string; unit?: string; value: number; min: number; max?: number;
  display: 'bar' | 'number' | 'pips'; warn?: 'low' | 'high'; bound?: 'min' | 'max'; valueLabel?: string;
}
export interface AdventureLastResultView {
  actionLabel: string; months: number;
  deltas: ({id: string; label: string; delta: number; clamped?: 'min' | 'max'} | {kind: 'max'; id: string; label: string; from: number; to: number})[];
  roll?: {chance?: number; success: boolean};
  windows?: {opened: string[]; closed: string[]};
}
export interface AdventureClockView {
  month: number; label: string; limitMonths: number; unit: ClockUnit;
  openWindows: {id: string; label: string; monthsLeft: number}[];
  countdown?: {resourceId: string; label: string; value: number; unit?: string};
}
export interface AdventureHandView {
  storyletId: string; title: string; text: string; urgent: boolean; inWindow: boolean;
  /** Times already played (0 = first meeting). */
  seenCount: number; fresh: boolean; repeatable: boolean;
  choices: AdventureAction[];
}

export interface AdventureFillGroup {
  id: string;
  label: string;
  kindHint: 'shop' | 'supply' | 'quest' | 'encounter' | 'boss';
  locationId: string;
  /** Action ids belonging to this group (buy/supply/accept/deliver lines). */
  lineActionIds: string[];
  /** Honest empty copy when there are no playable lines (尚未开张 / 暂无任务). */
  emptyMessage?: string;
  /** Sheet eyebrow (本店货架 / 可恢复 / 可接任务). */
  sheetEyebrow?: string;
}
export interface AdventureMapView {
  mapId: string;
  cell?: string;
  terrain?: {id: string; label: string};
  faction?: {id: string; name: string};
  regions: {id: string; name: string}[];
  /** Move destinations offered by currently visible actions. */
  reachable: {locationId: string; actionId: string; enabled: boolean}[];
  fog: boolean;
  /** Explored cells on this map (only when fog is on). */
  explored?: string[];
  /** Session territory overlay for this map (cell → faction id, '' = unclaimed). Fold over the authored map to render. */
  territory?: Record<string, string>;
  /** Effective faction relation table (authored + session). */
  relations?: FactionRelation[];
  /** NPCs currently on this map (session positions), for map markers. */
  npcs?: {id: string; name: string; locationId: string; cell: string; factionId?: string}[];
  /** Fog-filtered, catalog-resolved fill icons. Display only; actions still come from rules. */
  fillIcons?: MapFillIcon[];
}
