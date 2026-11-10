import { worldContentSchema, type WorldContent, type WorldDraft } from '@novel-game/contracts';
import type { WorldCompositionInput, WorldCompositionOperation } from '@novel-game/contracts';
import type { BlockLibraryService } from '../../block-library/index.js';
import type { BlockSpec } from '@novel-game/contracts';
import { AppError } from '../../../shared/errors.js';
import type { WorldService } from './world-service.js';

type Selection = NonNullable<WorldCompositionInput['blockSelections']>[number];
type CompositionOperation = WorldCompositionOperation;

export function validateWorldComposition(worlds: WorldService, catalog: Pick<BlockLibraryService, 'get'>, input: WorldCompositionInput) {
  const draft = worlds.get(input.worldId);
  if (draft.version !== input.expectedVersion) throw new AppError('DRAFT_VERSION_CONFLICT', '草稿已更新，请重新读取后预演', 409);
  const {content} = compose(draft.content, input.operations, input.blockSelections, catalog);
  if (content.blockSelections?.length) validateSelectedBlocks(content, content.blockSelections, catalog);
  const parsed = worldContentSchema.parse(content);
  const validation = worlds.validateContent(draft.id, parsed);
  if (!validation.valid) throw new AppError('INVALID_WORLD_COMPOSITION', '组合内容未通过世界引用与来源校验', 422, validation);
  return {worldId: draft.id, expectedVersion: draft.version, valid: true as const, candidate: parsed, operations: input.operations.length, blockReceipts: parsed.blockSelections ?? []};
}

export function applyWorldComposition(worlds: WorldService, catalog: Pick<BlockLibraryService, 'get'>, input: WorldCompositionInput): {draft: WorldDraft; applied: number; blockReceipts: ReturnType<typeof compose>['receipts']} {
  const preview = validateWorldComposition(worlds, catalog, input);
  const draft = worlds.applyContent(input.worldId, {version: input.expectedVersion, content: preview.candidate});
  return {draft, applied: input.operations.length, blockReceipts: preview.blockReceipts};
}

function compose(base: WorldContent, operations: CompositionOperation[], selections: Selection[] | undefined, catalog: Pick<BlockLibraryService, 'get'>) {
  const content = structuredClone(base);
  for (const op of operations) {
    if (op.entity === 'resource') {
      const resources = {...content.resourceDefs};
      const resourceId = op.op === 'add' ? op.resourceId : op.id;
      const current = Object.hasOwn(resources, resourceId);
      if (op.op === 'add') {
        if (current) invalid(`资源定义已存在：${resourceId}`);
        resources[resourceId] = op.value;
      } else {
        if (!current) invalid(`资源定义不存在：${resourceId}`);
        if (op.op === 'remove') delete resources[resourceId];
        else resources[resourceId] = op.value;
      }
      content.resourceDefs = resources;
      continue;
    }
    if (op.entity === 'end-condition') {
      const groups = [content.endConditions?.win, content.endConditions?.lose].filter((items): items is NonNullable<typeof items> => !!items);
      const target = groups.flatMap(items => items).find(item => item.id === (op.op === 'add' ? op.value.id : op.id));
      if (op.op === 'add') {
        if (target) invalid(`end-condition ID 已存在：${op.value.id}`);
        const group = op.value.kind === 'win' ? content.endConditions?.win : content.endConditions?.lose;
        if (!group) invalid('必须先通过作者确认建立终局条件包');
        group.push(op.value);
      } else {
        if (!target) invalid(`end-condition 不存在：${op.id}`);
        if (op.op === 'replace' && (op.value.id !== op.id || target.kind !== op.value.kind)) invalid('replace 必须保持条件 ID 与胜负分组');
        for (const group of groups) {
          const index = group.findIndex(item => item.id === op.id);
          if (index >= 0) {
            if (op.op === 'remove') group.splice(index, 1);
            else group[index] = op.value;
          }
        }
      }
      continue;
    }
    const collection = collectionFor(content, op.entity);
    const id = op.op === 'add' ? op.value.id : op.id;
    const index = collection.findIndex(value => value.id === id);
    if (op.op === 'add') {
      if (index >= 0) invalid(`${op.entity} ID 已存在：${id}`);
      assertNestedIds(op.value);
      collection.push(op.value);
    } else {
      if (index < 0) invalid(`${op.entity} 不存在：${id}`);
      if (op.op === 'remove') collection.splice(index, 1);
      else {
        if (op.value.id !== op.id) invalid('replace 必须保持实体稳定 ID');
        assertNestedIds(op.value);
        collection[index] = op.value;
      }
    }
  }
  if (selections !== undefined) content.blockSelections = validateSelectedBlocks(content, selections, catalog);
  return {content, receipts: content.blockSelections ?? []};
}

function assertNestedIds(value: unknown): void {
  const ids: string[] = [];
  const visit = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(visit); return; }
    const record = node as Record<string, unknown>;
    if (typeof record.id === 'string') ids.push(record.id);
    for (const child of Object.values(record)) visit(child);
  };
  visit(value);
  if (new Set(ids).size !== ids.length) invalid('实体内部出现重复的稳定 ID');
}

function collectionFor(content: WorldContent, entity: Exclude<CompositionOperation['entity'], 'resource'>): Array<{id: string; [key: string]: unknown}> {
  if (entity === 'location') return content.locations;
  if (entity === 'fact') return content.facts;
  if (entity === 'action') return content.actions;
  if (entity === 'storylet') return content.storylets ?? (content.storylets = []);
  if (entity === 'event') return content.events;
  if (entity === 'ending') return content.endings;
  return [];
}

export function validateSelectedBlocks(content: WorldContent, selections: Selection[], catalog: Pick<BlockLibraryService, 'get'>) {
  const ids = new Set<string>();
  const selected = new Map<string, {version: number; data: BlockSpec}>();
  const provides = new Set<string>();
  const receipts: {blockId: string; version: number; params: Record<string, unknown>}[] = [];
  for (const selection of selections) {
    if (ids.has(selection.blockId)) invalid(`积木重复选择：${selection.blockId}`);
    ids.add(selection.blockId);
    const entry = catalog.get('block', selection.blockId);
    if (entry.version !== selection.version) throw new AppError('BLOCK_VERSION_CONFLICT', `积木 ${selection.blockId} 版本已变化`, 409, {expected: selection.version, current: entry.version});
    const spec = entry.data;
    const params: Record<string, unknown> = {};
    for (const param of spec.params) {
      const supplied = selection.params[param.key];
      const value = supplied ?? param.default ?? (param.type === 'select' ? param.options?.[0] : undefined);
      if (value === undefined) {
        if (param.required === false) continue;
        invalid(`积木 ${spec.id} 缺少参数 ${param.key}`);
      }
      const matches = param.type === 'array' ? Array.isArray(value)
        : param.type === 'select' ? typeof value === 'string' && !!param.options?.includes(value)
        : typeof value === (param.type === 'integer' || param.type === 'number' ? 'number' : param.type)
          && (param.type === 'number' || param.type === 'integer' ? Number.isFinite(value) : true)
          && (param.type !== 'integer' || Number.isInteger(value));
      if (!matches) invalid(`积木 ${spec.id} 参数类型/选项错误：${param.key}`);
      if (typeof value === 'number' && ((param.min !== undefined && value < param.min) || (param.max !== undefined && value > param.max))) invalid(`积木 ${spec.id} 参数超出范围：${param.key}`);
      params[param.key] = value;
    }
    for (const key of Object.keys(selection.params)) if (!spec.params.some(param => param.key === key)) invalid(`积木 ${spec.id} 未知参数：${key}`);
    selected.set(spec.id, {version: entry.version, data: spec});
    for (const provide of spec.provides) provides.add(provide);
    receipts.push({blockId: spec.id, version: entry.version, params});
  }
  for (const [id, chosen] of selected) {
    const block = chosen.data;
    for (const dependency of block.composesWith.dependsOn) if (!selected.has(dependency)) invalid(`积木 ${id} 依赖未选择：${dependency}`);
    for (const conflict of block.composesWith.conflictsWith) if (selected.has(conflict)) invalid(`积木 ${id} 与 ${conflict} 冲突`);
    for (const requirement of block.requires) if (!hasContract(content, requirement)) invalid(`积木 ${id} 缺少契约：${requirement}`);
  }
  if (selected.has('fact-evidence-ledger')) content.ledgerVersion = 1;
  return receipts;
}

function hasContract(content: WorldContent, requirement: string): boolean {
  const lookup: Record<string, boolean> = {
    'world.locations': content.locations.length > 0, 'world.map': !!content.map || !!content.subMaps?.length,
    'world.clock': !!content.clock, 'world.storylets': !!content.storylets?.length, 'world.endings': content.endings.length > 0,
    'world.endConditions': !!content.endConditions, 'world.resourceDefs': !!Object.keys(content.resourceDefs ?? {}).length,
    'world.ledgerAssertions': content.ledgerVersion === 1,
    'world.facts': content.facts.length > 0, 'world.npcs': content.npcs.length > 0, 'world.actions': content.actions.length > 0,
    'game.variables': !!Object.keys(content.resources ?? {}).length, 'building.library': !!content.map?.fill?.placements.some(p => p.buildingAssetId),
    'item.catalog': !!content.map?.fill?.placements.some(p => 'itemId' in p && !!p.itemId),
  };
  return lookup[requirement] ?? false;
}

function invalid(message: string): never { throw new AppError('WORLD_COMPOSITION_INVALID', message, 422); }
