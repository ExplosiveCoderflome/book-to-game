import { z } from 'zod';
import {
  acceptMapFillInputSchema, applyEndConditionsInputSchema, applyWorldPatchInputSchema, authorReadSchema, extractMapDraftInputSchema, mapFillPlacementSchema,
  proposeClockPatchInputSchema, proposeEndConditionsInputSchema, proposeMapFillInputSchema, proposeStoryletPatchInputSchema,
  resourceDefSchema, storyletSchema, worldConditionSchema, worldContentSchema, worldEffectSchema,
  createWorldFromIdeaInputSchema, validateWorldCompositionInputSchema, applyWorldCompositionInputSchema,
  checkWorldLedgerInputSchema,
  checkWorldCausalityInputSchema,
  checkWorldPreservationInputSchema,
} from '@novel-game/contracts';
import {worldQualityContentHash} from '../../modules/preflight/index.js';
import {
  acceptMapFill, applyEndConditions, applyWorldPatch, extractMapDraft, mockEndConditionsModel, mockMapFillModel, mockWorldPatchModel, placeMapFill,
  proposeClockPatch, proposeEndConditions, proposeMapFill, proposeStoryletPatch, updateMapFillPlacement, validateWorldComposition, applyWorldComposition, checkWorldLedger, checkWorldCausality, checkWorldPreservation,
} from '../../modules/worlds/index.js';
import { AppError } from '../../shared/errors.js';
import type { Workbench } from '../workbench.js';
import { command, emptySchema, idSchema } from './definition.js';

const versioned = {id: z.string().min(1), version: z.number().int().positive()};
const entityId = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
const locationSchema = worldContentSchema.shape.locations.element;
const conditionTarget = z.object({
  ...versioned, storyletId: entityId, choiceId: entityId.optional(),
  target: z.enum(['when', 'availableWhen', 'requires']).default('when'),
}).refine(input => input.target === 'when' ? !input.choiceId : !!input.choiceId,
  'when 不能指定 choiceId；availableWhen/requires 必须指定 choiceId');

export function worldCommands(w: Workbench) {
  return [
    command('create_world_from_idea', '按作者想法创建开放世界小版本；Pi须提交完整合法WorldContent，想法会成为来源，sourceIds只作参考关联。不启动制作任务/worker。requestId相同输入幂等。',
      createWorldFromIdeaInputSchema, false, input => w.createWorldFromIdea(input)),
    command('validate_world_composition', '只读预演受限的实体级积木组合；返回经世界引用与积木依赖契约验证的候选内容，不写数据库。',
      validateWorldCompositionInputSchema, true, input => validateWorldComposition(w.worlds, w.blockLibrary, input)),
    command('apply_world_composition', '应用已预演的实体级积木组合；完整候选校验后按expectedVersion一次CAS写入。',
      applyWorldCompositionInputSchema, false, input => applyWorldComposition(w.worlds, w.blockLibrary, input)),
    command('check_world_ledger', '按草稿真实内容和expectedVersion运行有界、只读的账本重放；返回内容hash、已观察范围、缺失断言与状态反例。不接受模型自报库存。',
      checkWorldLedgerInputSchema, true, input => checkWorldLedger(w.worlds, input)),
    command('check_world_causality', '对世界声明运行有界、只读因果检查；使用合法动作分支和正式引擎重放，返回hash、依赖发现及可重放见证。未覆盖范围标记unsupported/inconclusive，不作不可达证明。',
      checkWorldCausalityInputSchema, true, input => checkWorldCausality(w.worlds, input)),
    command('check_world_preservation', '只读比较服务器保留基线与当前草稿的实体ID、正文anchors及hash；不证明自然语言语义。',
      checkWorldPreservationInputSchema, true, input => checkWorldPreservation(w.worlds, input)),
    command('edit_world_summary', '按指定版本修改世界草稿标题、背景、目标或改编说明，保留所有玩法及其余内容，不发布。',
      z.object({id: z.string().min(1), version: z.number().int().positive(), title: z.string().min(1).max(200).optional(),
        premise: z.string().min(1).max(4000).optional(), goal: z.string().min(1).max(2000).optional(), adaptationNotes: z.string().max(4000).optional()})
        .refine(input => ['title', 'premise', 'goal', 'adaptationNotes'].some(key => input[key as keyof typeof input] !== undefined), '至少提供一项需要修改的内容'), false,
      ({id, version, ...changes}) => {
        const draft = w.worlds.get(id); return w.worlds.update(id, {version, content: {...draft.content, ...changes}});
      }),
    command('add_world_location', '按指定版本新增一个地点，只修改地点列表；通过世界引用与来源规则校验后保存，不修改地图。',
      z.object({...versioned, location: locationSchema}), false,
      ({id, ...input}) => w.worlds.addLocation(id, input)),
    command('update_world_location', '按指定版本整体修改一个已有地点，地点ID保持不变；通过世界引用与来源规则校验后保存，不修改地图。',
      z.object({...versioned, location: locationSchema}), false,
      ({id, ...input}) => w.worlds.updateLocation(id, input)),
    command('add_world_storylet', '按指定版本新增一张剧情卡及其选项；通过世界引用和剧情卡规则校验后保存。',
      z.object({...versioned, storylet: storyletSchema}), false,
      ({id, ...input}) => w.worlds.addStorylet(id, input)),
    command('update_world_storylet', '按指定版本整体修改一张已有剧情卡，剧情卡ID保持不变；通过世界引用和剧情卡规则校验后保存。',
      z.object({...versioned, storylet: storyletSchema}), false,
      ({id, ...input}) => w.worlds.updateStorylet(id, input)),
    command('add_storylet_condition', '按指定版本给剧情卡出现条件（when）或指定选项的可见/执行条件追加一项条件。',
      conditionTarget.extend({condition: worldConditionSchema}), false,
      ({id, ...input}) => w.worlds.addStoryletCondition(id, input)),
    command('remove_storylet_condition', '按指定版本从剧情卡出现条件（when）或指定选项的可见/执行条件中按索引删除一项条件。',
      conditionTarget.extend({conditionIndex: z.number().int().nonnegative()}), false,
      ({id, ...input}) => w.worlds.removeStoryletCondition(id, input)),
    command('add_storylet_effect', '按指定版本给剧情卡指定选项追加一项效果，并通过世界引用规则校验。',
      z.object({...versioned, storyletId: entityId, choiceId: entityId, effect: worldEffectSchema}), false,
      ({id, ...input}) => w.worlds.addStoryletEffect(id, input)),
    command('remove_storylet_effect', '按指定版本从剧情卡指定选项中按索引删除一项效果。',
      z.object({...versioned, storyletId: entityId, choiceId: entityId, effectIndex: z.number().int().nonnegative()}), false,
      ({id, ...input}) => w.worlds.removeStoryletEffect(id, input)),
    command('add_world_resource_def', '按指定版本新增资源定义（范围、初始值、展示和阈值触发），并通过资源引用规则校验。',
      z.object({...versioned, resourceId: entityId, definition: resourceDefSchema}), false,
      ({id, ...input}) => w.worlds.addResourceDef(id, input)),
    command('update_world_resource_def', '按指定版本整体修改已有资源定义，资源ID保持不变，并通过资源引用规则校验。',
      z.object({...versioned, resourceId: entityId, definition: resourceDefSchema}), false,
      ({id, ...input}) => w.worlds.updateResourceDef(id, input)),
    command('extract_map_draft', 'AI：从小说原文抽取地图草案（地点/势力/人物/通路），返回待作者逐项审阅的 diff；不修改草稿。',
      extractMapDraftInputSchema.extend({id: z.string()}), true, async ({id, ...input}) => {
        if (!w.providerConfigured) throw new AppError('MODEL_NOT_CONFIGURED', '尚未配置模型。请进入“模型设置”后再使用 AI 提取。', 503);
        const provider = w.createPlayProvider();
        return extractMapDraft(w.worlds, sid => w.sources.get(sid), id, input, provider, AbortSignal.timeout(180_000), provider.modelName);
      }),
    command('place_map_fill', '在已确认地图的已绑定地点放置建筑库资产或遭遇；本地覆盖不写回库。',
      z.object({id: z.string(), version: z.number().int().positive(), mapId: z.string().optional(), placement: mapFillPlacementSchema}), false,
      ({id, ...input}) => placeMapFill(w.worlds, w.buildingLibrary, id, input)),
    command('update_map_fill_placement', '修改已确认地图上的单条填充名称或本地覆盖；不修改建筑库资产。',
      z.object({id: z.string(), version: z.number().int().positive(), mapId: z.string().optional(), placementId: z.string(),
        patch: z.object({label: z.string().min(1).max(80).optional(), localOverrides: z.record(z.string(), z.unknown()).optional()})}), false,
      ({id, ...input}) => updateMapFillPlacement(w.worlds, w.buildingLibrary, id, input)),
    command('propose_map_fill', 'Mock AI：基于已确认地图与建筑库生成填充提案，只读；不发明未绑定地点，不写草稿或存档。',
      proposeMapFillInputSchema.extend({id: z.string(), mapId: z.string().optional()}), true, async ({id, ...input}) =>
        proposeMapFill(w.worlds, w.buildingLibrary, id, input, mockMapFillModel, AbortSignal.timeout(30_000), 'mock-map-fill')),
    command('accept_map_fill', '接受已审核的既有资产填充提案并一次性写入草稿；新资产须先经建筑库审核入库。',
      acceptMapFillInputSchema.extend({id: z.string()}), false, ({id, ...input}) => acceptMapFill(w.worlds, w.buildingLibrary, id, input)),
    command('propose_clock_patch', 'Mock AI：生成时钟块级补丁提案，只读；返回可审阅的字段级 diff，不写草稿。',
      proposeClockPatchInputSchema, true, input => proposeClockPatch(w.worlds, input.worldDraftId, input, mockWorldPatchModel,
        AbortSignal.timeout(30_000), 'mock-clock-patch')),
    command('propose_storylet_patch', 'Mock AI：生成剧情卡块级补丁提案，只读；返回可审阅的字段级 diff，不写草稿。',
      proposeStoryletPatchInputSchema, true, input => proposeStoryletPatch(w.worlds, input.worldDraftId, input, mockWorldPatchModel,
        AbortSignal.timeout(30_000), 'mock-storylet-patch')),
    command('apply_world_patch', '应用已审阅的时钟或剧情卡块级补丁，按版本乐观锁一次性写入草稿并走世界规则校验；拒绝整稿替换与非法路径。',
      applyWorldPatchInputSchema, false, input => applyWorldPatch(w.worlds, input.worldDraftId, input)),
    command('propose_end_conditions', 'Mock AI：从世界草稿的资源/事实/剧情卡提议 2–4 套「胜利 + 失败」终局条件包，只读；不写草稿。作者挑一套或改用自定义文本，确认后再写入。',
      proposeEndConditionsInputSchema, true, input => proposeEndConditions(w.worlds, input.worldDraftId, input, mockEndConditionsModel,
        AbortSignal.timeout(30_000), 'mock-end-conditions')),
    command('apply_end_conditions', '应用已确认的终局条件包或作者自定义文本（解析成同一结构），按版本乐观锁写入 world.endConditions；已有终局条件时必须显式 acknowledgeReshape，因为改胜负会重塑整局。',
      applyEndConditionsInputSchema, false, input => applyEndConditions(w.worlds, input)),
    command('get_world_schema', '获取v1开放世界JSON Schema；草稿需校验引用与来源后再发布。', emptySchema, true, () => z.toJSONSchema(worldContentSchema)),
    command('create_world_draft', '建立开放世界草稿；作者视图含隐藏事实和NPC私有目标，不可直接作为玩家上下文。',
      z.object({sourceId: z.string().min(1), content: worldContentSchema}), false, input => w.worlds.create(input)),
    command('list_world_drafts', '列出开放世界作者草稿，可能包含秘密。', emptySchema, true, () => w.worlds.list()),
    command('get_world_draft', '读取完整作者草稿。玩家只使用get_adventure返回的投影。', idSchema, true, ({id}) => w.worlds.get(id)),
    command('read_world_draft', '分段读取作者世界草稿（含秘密）。省略path返回摘要和字段目录；path相对content，如["storylets"]、["storylets","0"]、["actions","2","effects"]。集合按offset/limit分页；reference条目按其path继续读取；长文本每页6000字符。每页返回version，版本变化须重新读取。',
      authorReadSchema.extend({id: z.string().min(1)}), true, ({id, ...input}) => w.worlds.read(id, input)),
    command('update_world_draft', '替换世界草稿，version防止覆盖陈旧编辑。',
      z.object({id: z.string(), version: z.number().int().positive(), content: worldContentSchema}), false,
      ({id, ...input}) => w.worlds.update(id, input)),
    command('archive_world_draft', '归档世界草稿：从列表隐藏，已发布版本与冒险存档保留，不做硬删除。', idSchema, false, ({id}) => w.worlds.archive(id)),
    command('validate_world_draft', '检查世界引用、原文范围和潜在连通；不能保证文学质量或所有策略可解。', idSchema, true, ({id}) => w.worlds.validate(id)),
    command('publish_world_draft', '发布已校验的世界版本，内容不可变；同一草稿版本重复发布幂等。',
      z.object({id: z.string(), version: z.number().int().positive()}), false, async ({id, version}) => {
        const draft = w.worlds.get(id);
        if (draft.version !== version) return w.worlds.publish(id, {version});
        if (draft.qualityContractVersion === 1 && w.worlds.validate(id).valid) {
          const report = w.preflight.getWorldPreflight(id).playtest;
          if (!report || report.draftVersion !== version || report.evidence?.contentHash !== worldQualityContentHash(draft.content))
            await w.preflight.playtestWorldDraft({id, expectedVersion: version, seeds: 6, strategies: ['random', 'greedy-growth', 'greedy-money', 'merchant', 'lazy'], evidenceRuns: 6, maxSteps: 300});
        }
        return w.worlds.publish(id, {version});
      }),
    command('list_world_revisions', '读取开放世界发布版本（作者视图，包含全部规则和秘密）。', emptySchema, true, () => w.worlds.listRevisions()),
  ];
}
