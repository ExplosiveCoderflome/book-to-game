import { productionPlanSchema, storyletSchema, type AnalysisResult, type ProductionBrief, type ProductionPlan, type ProductionPlanningState, type SourceDocument } from '@novel-game/contracts';
import { VOLUME_TIERS } from '@novel-game/rules/preflight';
import { assertProductionPlan } from '../domain/production.js';
import { assertPlanMechanics } from './plan-check.js';
import type { ModelRepairFeedback } from '../domain/ports.js';
import { AppError } from '../../../shared/errors.js';

export type PlanPart = {key: string; kind: string; ids: string[]; skeleton?: unknown; completed: Record<string, unknown>};
export type PlanPartWriter = (part: PlanPart, feedback?: ModelRepairFeedback) => Promise<unknown>;

function normalizeResources(world: Record<string, any>): void {
  const defs = object(world.resourceDefs);
  if (Object.keys(defs).length >= 4 && Object.values(defs).every(def => ['min', 'max', 'initial'].every(key => typeof object(def)[key] === 'number'))) return;
  for (const def of Object.values(defs)) {
    const value = object(def);
    if (typeof value.max !== 'number') value.max = Math.max(100, Number(value.min) || 0, Number(value.initial) || 0);
    if (typeof value.initial !== 'number') value.initial = Number(value.min) || 0;
  }
  const has = (pattern: RegExp) => Object.entries(defs).some(([id, def]) => pattern.test(id) || pattern.test(String(object(def).label)));
  const fallbacks = [
    [!has(/relation|trust|affinity|关系|信任|好感/i), 'relationship', '人物关系', 20],
    [!has(/pressure|stress|suspicion|压力|嫌疑|心魔/i), 'pressure', '压力', 0],
    [true, 'stamina', '体力', 10], [true, 'money', '盘缠', 0],
  ] as const;
  for (const [needed, id, label, initial] of fallbacks) {
    if (Object.keys(defs).length >= 4) break;
    if (needed && !defs[id]) {
      defs[id] = {label, min: 0, max: 100, initial, display: 'bar'};
      if (!object(world.resources)[id]) (world.resources ??= {})[id] = initial;
    }
  }
  world.resourceDefs = defs;
}

/** A calendar unit describes ticks, not a one-tick game. Keep at least ten costly decisions in generated plans. */
function normalizeTimeBudget(world: Record<string, any>): void {
  const costs = [...array(world.actions), ...array(world.storylets).flatMap(card => array(object(card).choices))]
    .map(option => Number(object(option).timeCost)).filter(cost => Number.isFinite(cost) && cost > 0);
  const budget = Math.max(Number(world.timeLimit) || 0, 10 * Math.max(1, ...costs));
  if (world.clock) {
    const clock = object(world.clock);
    clock.limitMonths = Math.min(2400, Math.max(Number(clock.limitMonths) || 0, budget));
  } else world.timeLimit = Math.min(100, budget);
}

function normalizeMergedPlan(root: Record<string, any>): void {
  const world = object(root.world);
  normalizeResources(world);
  normalizeTimeBudget(world);
  const endings = array(world.endings).map(object);
  const tier = object(world.production).tier === 'M' ? 'M' : 'S';
  const target = VOLUME_TIERS[tier];
  let missingFailures = target.failureEndings - endings.filter(ending => ending.kind === 'failure').length;
  if (missingFailures > 0 && endings.filter(ending => ending.kind !== 'failure').length > Math.max(3, target.endings)) {
    for (const ending of endings) {
      if (!missingFailures) break;
      if (ending.kind !== 'timeout') continue;
      const routes = array(root.routes).map(object);
      const ordinaryWithout = new Set(endings.filter(item => item !== ending && item.kind !== 'failure').map(item => item.id));
      if (ordinaryWithout.size < 3 || routes.some(route => array(route.endingIds).includes(ending.id) &&
        !array(route.endingIds).some(id => id !== ending.id && ordinaryWithout.has(id)))) continue;
      ending.kind = 'failure';
      missingFailures--;
    }
  }
  const factIds = new Set(array(world.facts).map(fact => object(fact).id));
  const missingFacts = new Set<string>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {value.forEach(visit); return;}
    if (!value || typeof value !== 'object') return;
    const item = value as Record<string, any>;
    if (!world.clock && item.kind === 'clock' && Number.isInteger(item.atLeastMonth) && item.atMostMonth === undefined && item.monthOfYearIn === undefined) {
      const atLeast = Math.min(Number(world.timeLimit) || 100, Math.max(0, item.atLeastMonth));
      for (const key of Object.keys(item)) delete item[key];
      Object.assign(item, {kind: 'time', atLeast});
    }
    if (typeof item.factId === 'string' && !factIds.has(item.factId)) missingFacts.add(item.factId);
    Object.values(item).forEach(visit);
  };
  visit(world);
  for (const id of missingFacts) array(world.facts).push({id, label: id, description: '分段规划引用的待补事实。', kind: 'event', initialValue: false, playerKnown: false, origin: 'adapted', evidence: []});
}

function normalizeSkeleton(value: unknown): unknown {
  const root = structuredClone(object(value));
  normalizeResources(object(root.world));
  normalizeTimeBudget(object(root.world));
  return root;
}

export function productionPlanParts(skeleton: unknown, batchSize: number): PlanPart[] {
  const root = object(skeleton);
  const world = object(root.world);
  const groups = [
    ['routes', array(root.routes)], ['locations', array(world.locations)], ['actions', array(world.actions)],
    ...['facts', 'npcs', 'events', 'endings', 'storylets'].map(key => [key, array(world[key])] as [string, unknown[]]),
  ] as [string, unknown[]][];
  const size = Math.max(1, Math.min(20, Math.floor(batchSize) || 4));
  const idParts = groups.flatMap(([kind, items]) => chunks(items.map(item => String(object(item).id)), size).map((ids, index) => ({
    key: `${kind}:${index}`, kind, ids, skeleton, completed: {},
  })));
  const shell = object(skeleton);
  const shellWorld = object(shell.world);
  const compact = {bible: shell.bible, routes: array(shell.routes).map(item => ({id: object(item).id})), world: {
    ...Object.fromEntries(Object.entries(shellWorld).filter(([key, value]) => !Array.isArray(value))),
    ...Object.fromEntries(groups.filter(([kind]) => kind !== 'routes').map(([kind, items]) => [kind, items.map(item => ({id: object(item).id, ...(kind === 'endings' ? {kind: object(item).kind ?? 'ending'} : {})}))])),
  }};
  return [{key: 'skeleton', kind: 'skeleton', ids: [], completed: {}, skeleton: compact}, ...idParts.map(part => ({...part, skeleton: compact}))];
}

export function mergeProductionPlan(skeleton: unknown, parts: Record<string, unknown>): ProductionPlan {
  const result = structuredClone(object(skeleton)) as Record<string, unknown>;
  const world = {...object(result.world)};
  const arrays = new Set(['routes', 'locations', 'actions', 'facts', 'npcs', 'events', 'endings', 'storylets']);
  for (const [key, value] of Object.entries(parts)) {
    const kind = key.slice(0, key.lastIndexOf(':'));
    const payload = object(value);
    const list = Array.isArray(payload.items) ? payload.items : Array.isArray(payload[kind]) ? payload[kind] as unknown[] : [];
    if (kind === 'routes') result.routes = replaceById(array(result.routes), list);
    else if (arrays.has(kind)) world[kind] = replaceById(array(world[kind]), list);
    else Object.assign(world, payload.world ?? payload);
  }
  result.world = world;
  normalizeMergedPlan(result);
  return productionPlanSchema.parse(result);
}

export function validateStagedProductionPlan(plan: ProductionPlan, brief: ProductionBrief, source: SourceDocument): void {
  assertProductionPlan(plan, brief, source);
  assertPlanMechanics(plan, {probe: false});
}

export async function runStagedProductionPlan(input: {
  analysis: AnalysisResult; brief: ProductionBrief; chapterIds: string[]; source: SourceDocument;
  state?: ProductionPlanningState; batchSize: number; signal: AbortSignal; save(state: ProductionPlanningState): boolean;
  write(part: PlanPart, feedback?: ModelRepairFeedback): Promise<unknown>;
}): Promise<ProductionPlanningState | null> {
  const state: ProductionPlanningState = input.state ? structuredClone(input.state) : {completed: [], parts: {}};
  if (state.skeleton) state.skeleton = normalizeSkeleton(state.skeleton);
  if (!state.skeleton) {
    const part: PlanPart = {key: 'skeleton', kind: 'skeleton', ids: [], completed: {}};
    const value = await retryPart(async feedback => {
      const response = await input.write(part, feedback);
      const parsed = normalizeSkeleton(object(response).skeleton ?? response);
      validatePart(part, parsed, parsed);
      return parsed;
    });
    state.skeleton = value;
    state.completed.push(part.key);
    if (!input.save(state)) return null;
  }
  // Skeleton outputs provide the ID inventory; detail calls are deliberately small and resume independently.
  const parts = productionPlanParts(state.skeleton, input.batchSize);
  for (const part of parts) {
    input.signal.throwIfAborted();
    if (state.completed.includes(part.key)) continue;
    part.completed = Object.fromEntries(Object.entries(state.parts).filter(([key]) => key.startsWith(`${part.kind}:`)).map(([key, value]) => [key, object(value).items ?? value]));
    state.parts[part.key] = await retryPart(async feedback => {
      const value = await input.write(part, feedback);
      validatePart(part, value, state.skeleton);
      return value;
    });
    state.completed.push(part.key);
    if (!input.save(state)) return null;
  }
  const plan = mergeProductionPlan(state.skeleton, state.parts);
  validateStagedProductionPlan(plan, input.brief, input.source);
  state.plan = plan;
  if (!input.save(state)) return null;
  return state;
}

async function retryPart<T>(run: (feedback?: ModelRepairFeedback) => Promise<T>): Promise<T> {
  let feedback: ModelRepairFeedback | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {return await run(feedback);}
    catch (error) {
      if (attempt === 2 || !isRepairable(error)) throw error;
      feedback = {errors: [{code: 'PLAN_PART_REPAIR', message: error instanceof Error ? error.message.slice(0, 500) : '规划分段无效'}]};
    }
  }
  throw new Error('unreachable');
}

function isRepairable(error: unknown): boolean {
  return !!error && typeof error === 'object' && ('issues' in error || 'code' in error);
}
function validatePart(part: PlanPart, value: unknown, skeleton: unknown): void {
  if (part.kind === 'skeleton') {
    const root = object(value);
    const world = object(root.world);
    const routeIds = new Set(array(root.routes).map(item => object(item).id));
    const locationIds = new Set(array(world.locations).map(item => object(item).id));
    const required = ['routes', 'locations', 'actions', 'facts', 'npcs', 'events', 'endings', 'storylets'];
    const missing = required.filter(key => !Array.isArray(key === 'routes' ? root.routes : world[key]));
    const bible = object(root.bible);
    const target = VOLUME_TIERS[object(world.production).tier === 'M' ? 'M' : 'S'];
    const endings = array(world.endings).map(object);
    const defs = Object.values(object(world.resourceDefs)).map(object);
    const problems = [...missing];
    if (defs.length < 4 || defs.some(def => typeof def.min !== 'number' || typeof def.max !== 'number' || typeof def.initial !== 'number')) problems.push('resourceDefs(至少4种且有min/max/initial)');
    if (endings.filter(ending => ending.kind !== 'failure').length < Math.max(3, target.endings) ||
      endings.filter(ending => ending.kind === 'failure').length < target.failureEndings) problems.push('endings(必须逐项标kind并满足普通/失败数量)');
    if (typeof bible.premise !== 'string' || !Array.isArray(bible.identityBoundaries) || !Array.isArray(bible.cast) || typeof bible.styleGuide !== 'string') problems.push('bible');
    if (routeIds.size < 3) problems.push(`routes(${routeIds.size}<3)`);
    if (locationIds.size < 3 || !locationIds.has(world.initialLocationId)) problems.push('locations(至少3个且initialLocationId存在)');
    if (array(world.actions).length < 3) problems.push(`actions(${array(world.actions).length}<3)`);
    if (array(world.npcs).length < 3) problems.push(`npcs(${array(world.npcs).length}<3)`);
    if (array(world.storylets).length < target.cards) problems.push(`storylets(${array(world.storylets).length}<${target.cards})`);
    if (endings.length < 4) problems.push(`endings(${endings.length}<4)`);
    if (problems.length) {
      throw new AppError('INVALID_PRODUCTION', `规划骨架无效：${problems.join('、')}`, 422, {issues: [{path: 'skeleton', message: `missing or invalid: ${problems.join(', ')}`} ]});
    }
    return;
  }
  const payload = object(value);
  const items = array(payload.items);
  const ids = items.map(item => object(item).id);
  if (items.length !== part.ids.length || new Set(ids).size !== ids.length || part.ids.some(id => !ids.includes(id))) {
    throw new AppError('INVALID_PRODUCTION', `规划分段 ${part.key} 必须恰好返回指定 ID`, 422, {path: part.key, issues: [{path: part.key, message: `expected ids: ${part.ids.join(', ')}`} ]});
  }
  const tentative = {...object(skeleton)};
  const world = {...object(tentative.world)};
  if (part.kind === 'routes') tentative.routes = items;
  else world[part.kind] = items;
  tentative.world = world;
  // Validate each returned object against the production schema while preserving other skeleton arrays.
  const field = part.kind === 'routes' ? 'routes' : part.kind;
  const schema = productionPlanSchema.shape;
  const itemSchema = field === 'routes' ? schema.routes.element : field === 'storylets' ? storyletSchema : (schema.world.shape as Record<string, any>)[field]?.element;
  if (!itemSchema) throw new AppError('INVALID_PRODUCTION', `规划字段 ${field} 不支持分段`, 422);
  items.forEach((item, index) => itemSchema.parse(item, {path: [part.key, index]}));
}
function object(value: unknown): Record<string, any> {return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};}
function array(value: unknown): unknown[] {return Array.isArray(value) ? value : [];}
function chunks<T>(items: T[], size: number): T[][] {const out: T[][] = []; for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size)); return out;}
function replaceById(base: unknown[], replacements: unknown[]): unknown[] {
  const byId = new Map(replacements.map(item => [object(item).id, item]));
  return base.map(item => byId.get(object(item).id) ?? item);
}
