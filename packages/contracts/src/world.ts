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
export const worldConditionSchema = z.discriminatedUnion('kind', [
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
]);
export const worldEffectSchema = z.discriminatedUnion('kind', [
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
]);
export const worldContentSchema = z.object({
  schemaVersion: z.literal(1), mode: z.literal('open'), title: z.string().min(1).max(200),
  premise: z.string().min(1).max(4000), playerRole: z.string().min(1).max(500), goal: z.string().min(1).max(1000),
  worldRules: z.array(z.string().min(1).max(1000)).min(1).max(20), adaptationNotes: z.string().max(4000),
  sourceChapterIds: z.array(z.string().min(1).max(80)).min(1).max(1000),
  initialLocationId: id, timeLimit: z.number().int().min(3).max(100), timeoutEnding: z.string().min(1).max(3000),
  locations: z.array(z.object({id, title: z.string().min(1).max(200), text: z.string().min(1).max(4000),
    /** Location hierarchy (city → district → room). Enter/exit are ordinary move actions. */
    parentLocationId: id.optional(), ...provenance})).min(3).max(40),
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
    blockedReason: z.string().min(1).max(500), risk: z.string().max(500), timeCost: z.number().int().min(1).max(5),
    once: z.boolean(), effects: z.array(worldEffectSchema).min(1).max(20), text: z.string().min(1).max(3000),
    /** Optional tags for worldbook hard rules (same constraint types as story choices). */
    tags: z.array(z.string().min(1).max(40)).max(10).optional(), ...provenance})).min(3).max(80),
  events: z.array(z.object({id, label: z.string().min(1).max(120), when: z.array(worldConditionSchema).min(1).max(20),
    effects: z.array(worldEffectSchema).min(1).max(20), text: z.string().max(2000), visibility: z.enum(['public', 'hidden'])})).max(40),
  endings: z.array(z.object({id, title: z.string().min(1).max(200), text: z.string().min(1).max(3000),
    when: z.array(worldConditionSchema).min(1).max(20)})).min(1).max(12),
  /** Numeric power/upgrade pools for worldbook gates/spends/ladders (not boolean facts). */
  resources: z.record(z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/), z.number().finite()).optional(),
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
});
export type WorldContent = z.infer<typeof worldContentSchema>;
export type WorldCondition = z.infer<typeof worldConditionSchema>;
export type WorldEffect = z.infer<typeof worldEffectSchema>;
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
  actions: {id: string; label: string; description: string; timeCost: number; risk: string; enabled: boolean; blockedReason?: string}[];
  ending?: {id: string; title: string; text: string}; history: AdventureHistory[]; createdAt: string; updatedAt: string;
  /** Spatial status for the play map (absent when the world has no map). Session-derived, read-only. */
  map?: AdventureMapView;
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
