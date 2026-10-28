import { z } from 'zod';
import { worldbookSchema } from './worldbook.js';
import { worldMapSchema } from './world-map.js';
export const SYSTEM_WAIT_ACTION_ID = '__wait__';

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/, '标识只允许字母、数字、短横线和下划线');
const evidence = z.object({chapterId: z.string().min(1).max(80), paragraphId: z.string().min(1).max(80)});
const provenance = {origin: z.enum(['source', 'adapted']), evidence: z.array(evidence).max(30)};
export const FACTION_STANCES = ['ally', 'neutral', 'hostile'] as const;
export const factionStanceSchema = z.enum(FACTION_STANCES);
export type FactionStance = z.infer<typeof factionStanceSchema>;
/** Authored faction relation (unordered pair). standing −100..100. */
export const factionRelationSchema = z.object({a: id, b: id, stance: factionStanceSchema, standing: z.number().int().min(-100).max(100)});
export type FactionRelation = z.infer<typeof factionRelationSchema>;
const cell = z.string().regex(/^-?\d{1,3},-?\d{1,3}$/);
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
export const clockSchema = z.object({
  unit: z.literal('month'), startYear: z.number().int().min(-9999).max(9999), startMonth: z.number().int().min(1).max(12),
  /** Calendar template, tokens {year} {month}. */
  display: z.string().min(1).max(40).optional(),
  limitMonths: z.number().int().min(1).max(2400),
  rules: z.array(z.object({id: id.optional(), everyMonths: z.number().int().min(1).max(1200), effects: z.array(worldBaseEffectSchema).min(1).max(10),
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
  effects: z.array(worldEffectSchema).max(20), text: z.string().min(1).max(3000)});
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
  /** Authoring batch number. Metadata only. */
  batch: z.number().int().min(0).max(100).optional(),
  choices: z.array(storyletChoiceSchema).min(1).max(6)}).refine(sl => !!sl.text || !!sl.textVariants?.length, '剧情卡需要 text 或 textVariants');
/** All body variants of a storylet (text first when both exist). */
export function storyletBodies(sl: {text?: string; textVariants?: string[]}): string[] {
  return sl.textVariants?.length ? sl.textVariants : sl.text ? [sl.text] : [];
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
  locations: z.array(z.object({id, title: z.string().min(1).max(200), text: z.string().min(1).max(4000),
    /** Location hierarchy (city → district → room). Enter/exit are ordinary move actions. */
    parentLocationId: id.optional(),
    /** S1: conditional descriptions; the first variant whose `when` holds replaces `text`. */
    textVariants: z.array(z.object({when: z.array(worldConditionSchema).min(1).max(10), text: z.string().min(1).max(4000)})).max(10).optional(),
    ...provenance})).min(3).max(40),
  facts: z.array(z.object({id, label: z.string().min(1).max(120), description: z.string().max(1000),
    kind: z.enum(['clue', 'item', 'relationship', 'event']), initialValue: z.boolean(), playerKnown: z.boolean(), ...provenance})).max(80),
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
    /** Optional tags for worldbook hard rules (same constraint types as story choices). */
    tags: z.array(z.string().min(1).max(40)).max(10).optional(), ...provenance})).min(3).max(80),
  events: z.array(z.object({id, label: z.string().min(1).max(120), when: z.array(worldConditionSchema).min(1).max(20),
    effects: z.array(worldEffectSchema).min(1).max(20), text: z.string().max(2000), visibility: z.enum(['public', 'hidden'])})).max(40),
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
  })).min(1).max(40),
  /** K15: 「这一生」 recap shown at the bottom of the ending page (entries whose `when` holds at the ending; by `order`, else array order). */
  recap: z.array(recapEntrySchema).max(120).optional(),
  /** Numeric power/upgrade pools for worldbook gates/spends/ladders (not boolean facts). */
  resources: z.record(z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/), z.number().finite()).optional(),
  /** S1: resource definitions (bounds, display, threshold triggers). Absent = legacy unbounded resources. */
  resourceDefs: z.record(z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/), resourceDefSchema).optional(),
  /** S1: monthly clock (unit month). When present, `limitMonths` replaces `timeLimit` and timeCost means months. */
  clock: clockSchema.optional(),
  /** S1: storylet hand rules. */
  storyletRules: z.object({handSize: z.number().int().min(1).max(5).optional(), refreshOn: z.array(z.enum(['move', 'clock'])).max(2).optional(),
    refreshEveryMonths: z.number().int().min(1).max(120).optional()}).optional(),
  /** S1: authoring progress. `complete: false` = content delivered in batches; lint reports tier shortfalls as warnings. */
  production: z.object({batch: z.number().int().min(1).max(100).optional(), complete: z.boolean().optional(), tier: z.enum(['S', 'M', 'L']).optional(), note: z.string().max(2000).optional()}).optional(),
  /** S1 acceptance ⑦: who produced this draft. `generator: 'mock'` = fixture model output; publishing it is refused outside tests. */
  provenance: z.object({generator: z.string().min(1).max(80), model: z.string().max(200).optional(),
    source: z.enum(['runner', 'backfill', 'copy']).optional(), copiedFrom: z.string().max(80).optional()}).optional(),
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
export interface WorldDraft {id: string; sourceId: string; content: WorldContent; version: number; createdAt: string; updatedAt: string}
export interface WorldRevision {id: string; draftId: string; sourceId: string; content: WorldContent; version: number; createdAt: string}
export const adventureActSchema = z.object({actionId: id, expectedTurn: z.number().int().nonnegative(), requestId: z.string().uuid()});
export type AdventureActInput = z.infer<typeof adventureActSchema>;
export interface AdventureHistory {turn: number; elapsed: number; actionLabel?: string; text: string}
export interface AdventureView {
  id: string; worldRevisionId: string; turn: number; elapsed: number; timeLimit: number; ended: boolean;
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
  timeUnit?: 'month';
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
  month: number; label: string; limitMonths: number; unit: 'month';
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
}
