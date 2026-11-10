import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type {
  GenerationJob, MapFillPlacement, MapFillProposalItem, ResourceDef, Storylet, WorldCondition, WorldContent, WorldDraft, WorldEffect, WorldPatchChange,
} from '@novel-game/contracts';
import { completeWorldSchemaResult, type ChatTool } from '../modules/agent/index.js';
import { jobSummary, type JobService } from '../modules/generation/index.js';
import type { WorldService } from '../modules/worlds/index.js';
import type { GameService } from '../modules/games/index.js';
import type { BlockLibraryService } from '../modules/block-library/index.js';
import type { CatalogKind } from '@novel-game/contracts';
import { AppError } from '../shared/errors.js';
import type { Command } from './commands/definition.js';

type Args = Record<string, unknown>;
export interface AgentChatCommandState {
  jobs: Pick<JobService, 'get'>;
  worlds: Pick<WorldService, 'get'> & Partial<Pick<WorldService, 'proposeReshape' | 'confirmAuthorReshape'>>;
  games: Pick<GameService, 'get'>;
  blockLibrary?: Pick<BlockLibraryService, 'getVersion'>;
  createWorldFromIdea?: (input: import('@novel-game/contracts').CreateWorldFromIdeaInput) => unknown;
}
type Summarize = (args: Args, state: AgentChatCommandState) => string;
type AgentChatCommandMetadata = {
  /** Legacy override only. New commands arrive with confirmation on their Command definition. */
  confirmation?: 'auto' | 'confirm';
  summarize: Summarize;
} & (
  | {versionCheck: 'none'; readVersion?: never}
  | {versionCheck: 'version' | 'updatedAt'; readVersion: (args: Args, state: AgentChatCommandState) => string | number}
);

const argsSummary = (label: string): Summarize => args => `${label}：${JSON.stringify(args).slice(0, 1000)}`;
const jobConfirmationSummary = (label: string): Summarize => (args, state) => {
  const job = state.jobs.get(String(args.id));
  return `${label}：任务 ${job.id}（${job.status}，${job.stage}）`;
};
const worldSummary = (label: string): Summarize => (args, state) => {
  const draft = state.worlds.get(String(args.id));
  const fields: Record<string, string> = {title: '标题', premise: '背景', goal: '目标', adaptationNotes: '改编说明'};
  const changes = Object.entries(args).filter(([key]) => !['id', 'version'].includes(key))
    .map(([key, value]) => `${fields[key] ?? key}: ${JSON.stringify(draft.content[key as keyof typeof draft.content])} → ${JSON.stringify(value)}`).join('；');
  return `${label}：「${draft.content.title}」v${draft.version}${changes ? `；${changes}` : ''}`;
};
const jobVersion = (args: Args, state: AgentChatCommandState) => state.jobs.get(String(args.id)).updatedAt;
const worldVersion = (args: Args, state: AgentChatCommandState) => state.worlds.get(String(args.id)).version;
type WorldLocation = WorldContent['locations'][number];
const shortJson = (value: unknown, limit = 180) => {
  const text = value === undefined ? '未设置' : JSON.stringify(value);
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
};
const clipped = (value: unknown, limit = 60) => {
  const text = typeof value === 'string' ? value.trim() : '';
  return text ? (text.length > limit ? `${text.slice(0, limit)}…` : text) : undefined;
};
const textField = (label: string, value: unknown, limit = 60) => {
  const text = clipped(value, limit);
  return text ? `${label}：${text}` : undefined;
};
const generationJobSummary: Summarize = args => {
  const details = [
    `模式：${args.mode === 'open' ? '局部世界' : '分支故事'}`,
    textField('方向', args.direction, 80),
    textField('身份', args.playerRole, 40),
    Array.isArray(args.chapterIds) && args.chapterIds.length ? `章节：${args.chapterIds.length}章` : undefined,
  ].filter((item): item is string => Boolean(item));
  return `创建改编任务：${details.join('；')}`;
};
const productionJobSummary: Summarize = args => {
  const brief = (args.brief ?? {}) as Record<string, unknown>;
  const details = [
    textField('身份', brief.playerRole, 40),
    textField('目标', brief.goal, 60),
    textField('基调', brief.tone, 30),
    textField('体量', brief.tier, 10),
    textField('设定', brief.setting, 60),
  ].filter((item): item is string => Boolean(item));
  return `创建角色扮演制作任务：「${clipped(brief.title, 80) ?? '未命名'}」${details.length ? `；${details.join('；')}` : ''}`;
};
const repairSummary = (label: string): Summarize => args => `${label}：${String(args.id)}`;
const catalogVersion = (kind: CatalogKind) => (args: Args, state: AgentChatCommandState) =>
  state.blockLibrary?.getVersion(kind, String(args.id)) ?? Number(args.expectedVersion ?? 0);
const catalogSaveSummary = (action: string): Summarize => args => {
  const data = args.data as {id: string; version: number; label?: string};
  return `${action}：「${data.label ?? data.id}」（${data.id}）；目标 v${data.version}，基于 v${String(args.expectedVersion)}。只保存自定义目录，不修改世界或存档。`;
};
const catalogDeleteSummary = (label: string): Summarize => args =>
  `删除自定义${label}：${String(args.id)}（基于 v${String(args.expectedVersion)}）；不影响内置条目，仍被引用时会拒绝。`;
const worldEditSummary = (label: string, args: Args, state: AgentChatCommandState, detail: string) => {
  const draft = state.worlds.get(String(args.id));
  return `${label}：世界「${draft.content.title}」v${draft.version}；${detail}`;
};
const changedValues = (before: object, after: object, labels: Record<string, string>) => {
  const oldValues = Object.fromEntries(Object.entries(before));
  const newValues = Object.fromEntries(Object.entries(after));
  const keys = [...new Set([...Object.keys(oldValues), ...Object.keys(newValues)])]
    .filter(key => key !== 'id' && JSON.stringify(oldValues[key]) !== JSON.stringify(newValues[key]));
  return keys.length ? keys.map(key => `${labels[key] ?? key}: ${shortJson(oldValues[key])} → ${shortJson(newValues[key])}`).join('；') : '内容无变化';
};
const required = <T>(value: T | undefined, label: string): T => {
  if (value === undefined) throw new AppError('CHAT_ACTION_STALE', `${label}不存在，请重新读取世界草稿`, 409);
  return value;
};
const indexed = <T>(items: readonly T[], index: unknown, label: string): T => {
  const value = Number(index);
  if (!Number.isSafeInteger(value) || value < 0 || value >= items.length) throw new AppError('INVALID_INDEX', `${label}索引不存在：${index}`, 400);
  return items[value]!;
};
const storyletFrom = (args: Args, state: AgentChatCommandState) => {
  const draft = state.worlds.get(String(args.id));
  const storylet = required((draft.content.storylets ?? []).find(item => item.id === args.storyletId), `剧情卡 ${String(args.storyletId)}`);
  return {draft, storylet};
};
const choiceFrom = (storylet: Storylet, args: Args) =>
  required(storylet.choices.find(choice => choice.id === args.choiceId), `剧情卡选项 ${String(args.choiceId)}`);
const locationFields = {title: '标题', text: '正文', parentLocationId: '父地点', textVariants: '条件文本', origin: '来源类型', evidence: '来源证据'};
const storyletFields = {title: '标题', kind: '类别', locationIds: '地点', when: '出现条件', weight: '权重', repeat: '重复规则', urgent: '紧急',
  text: '正文', textVariants: '正文变体', variantMode: '变体模式', textCases: '条件正文', batch: '批次', choices: '选项'};
const resourceFields = {label: '名称', unit: '单位', min: '最小值', max: '最大值', initial: '初始值', display: '展示',
  warnAtMost: '低值警告', warnAtLeast: '高值警告', onMin: '最小值触发', onMax: '最大值触发', valueLabels: '数值标签', description: '说明'};
const conditionSummary = (label: string, args: Args, state: AgentChatCommandState, removing: boolean) => {
  const {storylet} = storyletFrom(args, state);
  const target = String(args.target ?? 'when') as 'when' | 'availableWhen' | 'requires';
  const choice = target === 'when' ? undefined : choiceFrom(storylet, args);
  const targetLabel = target === 'when' ? '出现条件' : target === 'availableWhen' ? '选项可见条件' : '选项执行条件';
  const conditions = target === 'when' ? storylet.when ?? [] : choice![target] ?? [];
  const index = removing ? Number(args.conditionIndex) : conditions.length;
  const condition = removing ? indexed(conditions, args.conditionIndex, '条件') : args.condition as WorldCondition;
  return worldEditSummary(label, args, state,
    `${storylet.id}${choice ? `/${choice.id}` : ''} 的${targetLabel}[${index}]：${shortJson(condition, 400)}`);
};
const effectSummary = (label: string, args: Args, state: AgentChatCommandState, removing: boolean) => {
  const {storylet} = storyletFrom(args, state);
  const choice = choiceFrom(storylet, args);
  const index = removing ? Number(args.effectIndex) : choice.effects.length;
  const effect = removing ? indexed(choice.effects, args.effectIndex, '效果') : args.effect as WorldEffect;
  return worldEditSummary(label, args, state,
    `${storylet.id}/${choice.id} 的选项效果[${index}]：${shortJson(effect, 400)}`);
};
const mapFillPlacementFrom = (args: Args, state: AgentChatCommandState) => {
  const draft = state.worlds.get(String(args.id));
  const map = args.mapId === undefined ? draft.content.map : draft.content.subMaps?.find(item => item.id === args.mapId);
  return required(map?.fill?.placements.find(item => item.id === args.placementId), `地图填充 ${String(args.placementId)}`);
};
const mapFillFields = {label: '名称', localOverrides: '本地覆盖'};

/** Adding a chat command requires a complete entry here; missing metadata is a TypeScript error. */
export const agentChatCommandMetadata = {
  propose_world_reshape: {versionCheck: 'none', summarize: argsSummary('只读提议精确世界重塑')},
  confirm_world_reshape: {confirmation: 'confirm', versionCheck: 'version', readVersion: (args, state) => {
    if (!state.worlds.proposeReshape) throw new AppError('RESHAPE_UNAVAILABLE', '重塑服务不可用', 503);
    const proposal = state.worlds.proposeReshape({worldId: String(args.worldId), expectedVersion: Number(args.expectedVersion), content: args.content as WorldContent});
    if (proposal.diffHash !== args.diffHash) throw new AppError('CHAT_ACTION_STALE', '重塑精确差异已变化，请重新提议', 409);
    return proposal.expectedVersion;
  }, summarize: (args, state) => state.worlds.proposeReshape!({worldId: String(args.worldId), expectedVersion: Number(args.expectedVersion), content: args.content as WorldContent}).summary},
  create_world_from_idea: {versionCheck: 'none', summarize: args => `按想法「${clipped(args.title, 80) ?? '未命名'}」创建世界；${String(args.idea ?? '').length}字想法；确认后写入来源与草稿。`},
  validate_world_composition: {versionCheck: 'none', summarize: argsSummary('只读预演世界积木组合')},
  apply_world_composition: {versionCheck: 'version', readVersion: (args, state) => {
    const version = state.worlds.get(String(args.worldId)).version;
    if (version !== args.expectedVersion) throw new AppError('CHAT_ACTION_STALE', '组合预演版本已陈旧，请重新预演', 409);
    return version;
  },
     summarize: (args, state) => `确认应用「${state.worlds.get(String(args.worldId)).content.title}」v${String(args.expectedVersion)} 的 ${Array.isArray(args.operations) ? args.operations.length : 0} 项实体组合。`},
  check_world_ledger: {versionCheck: 'none', summarize: argsSummary('只读检查世界事实/证据/承诺账本')},
  check_world_causality: {versionCheck: 'none', summarize: argsSummary('只读检查声明式因果及合法重放见证')},
  check_world_preservation: {versionCheck: 'none', summarize: argsSummary('只读检查世界编辑保留基线与差异')},
  list_game_dev_skills: {versionCheck: 'none', summarize: argsSummary('查询内置游戏开发技能')},
  load_game_dev_skill: {versionCheck: 'none', summarize: argsSummary('读取内置游戏开发技能')},
  runtime_info: {versionCheck: 'none', summarize: argsSummary('查询运行信息')},
  list_sources: {versionCheck: 'none', summarize: argsSummary('查询来源列表')},
  read_source: {versionCheck: 'none', summarize: argsSummary('读取来源')},
  list_blocks: {versionCheck: 'none', summarize: argsSummary('查询积木目录')},
  get_block: {versionCheck: 'none', summarize: argsSummary('读取单个积木')},
  get_block_library: {versionCheck: 'none', summarize: argsSummary('读取可维护积木库')},
  list_fun_profiles: {versionCheck: 'none', summarize: argsSummary('查询爽感画像目录')},
  list_genre_recipes: {versionCheck: 'none', summarize: argsSummary('查询品类配方目录')},
  list_jobs: {versionCheck: 'none', summarize: argsSummary('查询任务列表')},
  read_job: {versionCheck: 'none', summarize: argsSummary('读取任务')},
  check_job_plan: {versionCheck: 'none', summarize: argsSummary('检查制作规划')},
  list_world_drafts: {versionCheck: 'none', summarize: argsSummary('查询世界草稿列表')},
  get_world_schema: {versionCheck: 'none', summarize: argsSummary('查询开放世界 JSON Schema（只读）')},
  read_world_draft: {versionCheck: 'none', summarize: argsSummary('读取世界草稿')},
  get_world_preflight: {versionCheck: 'none', summarize: argsSummary('查询世界预检')},
  validate_world_draft: {versionCheck: 'none', summarize: argsSummary('校验世界草稿')},
  lint_world_draft: {confirmation: 'auto', versionCheck: 'none', summarize: argsSummary('体检世界草稿')},
  playtest_world_draft: {confirmation: 'auto', versionCheck: 'none', summarize: argsSummary('试玩世界草稿')},
  propose_fun_profile: {versionCheck: 'none', summarize: argsSummary('生成 Mock 爽感画像提案（只读）')},
  recommend_blocks_for_profile: {versionCheck: 'none', summarize: argsSummary('推荐画像积木（只读）')},
  propose_map_fill: {versionCheck: 'none', summarize: argsSummary('生成 Mock 地图填充提案（只读）')},
  propose_clock_patch: {versionCheck: 'none', summarize: argsSummary('生成 Mock 时钟补丁提案（只读）')},
  propose_storylet_patch: {versionCheck: 'none', summarize: argsSummary('生成 Mock 剧情卡补丁提案（只读）')},
  propose_end_conditions: {versionCheck: 'none', summarize: argsSummary('生成 Mock 终局条件提案（只读，含多套胜负包）')},
  agent_status: {versionCheck: 'none', summarize: argsSummary('查询 Agent 状态')},
  list_agent_decisions: {versionCheck: 'none', summarize: argsSummary('查询 Agent 决策列表')},
  list_agent_repairs: {versionCheck: 'none', summarize: argsSummary('查询修复候选列表')},
  create_agent_repair: {confirmation: 'auto', versionCheck: 'none', summarize: argsSummary('创建修复候选')},
  list_drafts: {versionCheck: 'none', summarize: argsSummary('查询游戏草稿列表')},
  get_draft: {versionCheck: 'none', summarize: argsSummary('读取游戏草稿')},
  validate_draft: {versionCheck: 'none', summarize: argsSummary('校验游戏草稿')},
  lint_draft: {confirmation: 'auto', versionCheck: 'none', summarize: argsSummary('体检游戏草稿')},
  list_world_revisions: {versionCheck: 'none', summarize: argsSummary('查询世界版本列表')},
  list_games: {versionCheck: 'none', summarize: argsSummary('查询游戏列表')},
  create_generation_job: {versionCheck: 'none', summarize: generationJobSummary},
  create_production_job: {versionCheck: 'none', summarize: productionJobSummary},
  retry_job: {versionCheck: 'updatedAt', readVersion: jobVersion, summarize: jobConfirmationSummary('恢复生成任务')},
  cancel_job: {versionCheck: 'updatedAt', readVersion: jobVersion, summarize: jobConfirmationSummary('取消生成任务')},
  rewrite_production_unit: {versionCheck: 'updatedAt', readVersion: jobVersion, summarize: jobConfirmationSummary('重写指定正文')},
  approve_saved_production_plan: {
    versionCheck: 'updatedAt',
    readVersion: (args, state) => {
      const job = state.jobs.get(String(args.id));
      if (job.updatedAt !== args.expectedUpdatedAt || job.status !== 'awaiting_review' || !job.productionState || job.productionState.approved) {
        throw new AppError('CHAT_ACTION_STALE', '任务已变化或不在待审阅状态，请重新读取规划', 409);
      }
      return job.updatedAt;
    },
    summarize: (args, state) => {
      const plan = state.jobs.get(String(args.id)).productionState!.plan;
      return `确认「${plan.world.title}」当前玩法并开始正文生成：扮演${plan.world.playerRole}；${plan.world.storylets?.length ?? 0}张剧情卡、${plan.world.actions.length}个行动；路线：${plan.routes.map(r => r.name).join('、')}。将使用配置的模型产生费用，不发布游戏。`;
    },
  },
  apply_agent_repair: {versionCheck: 'none', summarize: repairSummary('应用修复候选')},
  reject_agent_repair: {versionCheck: 'none', summarize: repairSummary('驳回修复候选')},
  publish_world_draft: {versionCheck: 'version', readVersion: worldVersion, summarize: worldSummary('发布世界版本')},
  publish_draft: {
    versionCheck: 'version',
    readVersion: (args, state) => state.games.get(String(args.id)).version,
    summarize: (args, state) => {
      const draft = state.games.get(String(args.id));
      return `发布「${draft.content.title}」v${draft.version}`;
    },
  },
  edit_world_summary: {versionCheck: 'version', readVersion: worldVersion, summarize: worldSummary('修改世界摘要')},
  add_world_location: {versionCheck: 'version', readVersion: worldVersion,
    summarize: (args, state) => {
      const location = args.location as WorldLocation;
      return worldEditSummary('新增地点', args, state, `${location.id}「${location.title}」；正文：${shortJson(location.text)}`);
    }},
  update_world_location: {versionCheck: 'version', readVersion: worldVersion,
    summarize: (args, state) => {
      const draft = state.worlds.get(String(args.id));
      const location = args.location as WorldLocation;
      const previous = required(draft.content.locations.find(item => item.id === location.id), `地点 ${location.id}`);
      return worldEditSummary('修改地点', args, state, `${location.id}；${changedValues(previous, location, locationFields)}`);
    }},
  add_world_storylet: {versionCheck: 'version', readVersion: worldVersion,
    summarize: (args, state) => {
      const storylet = args.storylet as Storylet;
      return worldEditSummary('新增剧情卡', args, state,
        `${storylet.id}「${storylet.title}」；地点：${storylet.locationIds?.join('、') || '不限'}；${storylet.choices.length} 个选项`);
    }},
  update_world_storylet: {versionCheck: 'version', readVersion: worldVersion,
    summarize: (args, state) => {
      const draft = state.worlds.get(String(args.id));
      const storylet = args.storylet as Storylet;
      const previous = required((draft.content.storylets ?? []).find(item => item.id === storylet.id), `剧情卡 ${storylet.id}`);
      return worldEditSummary('修改剧情卡', args, state, `${storylet.id}；${changedValues(previous, storylet, storyletFields)}`);
    }},
  add_storylet_condition: {versionCheck: 'version', readVersion: worldVersion,
    summarize: (args, state) => conditionSummary('新增剧情卡条件', args, state, false)},
  remove_storylet_condition: {versionCheck: 'version', readVersion: worldVersion,
    summarize: (args, state) => conditionSummary('删除剧情卡条件', args, state, true)},
  add_storylet_effect: {versionCheck: 'version', readVersion: worldVersion,
    summarize: (args, state) => effectSummary('新增剧情卡效果', args, state, false)},
  remove_storylet_effect: {versionCheck: 'version', readVersion: worldVersion,
    summarize: (args, state) => effectSummary('删除剧情卡效果', args, state, true)},
  add_world_resource_def: {versionCheck: 'version', readVersion: worldVersion,
    summarize: (args, state) => {
      const definition = args.definition as ResourceDef;
      return worldEditSummary('新增资源定义', args, state,
        `${String(args.resourceId)}「${definition.label}」；范围 ${definition.min}–${definition.max ?? '∞'}，初始 ${definition.initial ?? '未设置'}`);
    }},
  update_world_resource_def: {versionCheck: 'version', readVersion: worldVersion,
    summarize: (args, state) => {
      const draft = state.worlds.get(String(args.id));
      const resourceId = String(args.resourceId);
      const previous = required(draft.content.resourceDefs?.[resourceId], `资源定义 ${resourceId}`);
      return worldEditSummary('修改资源定义', args, state,
        `${resourceId}；${changedValues(previous, args.definition as ResourceDef, resourceFields)}`);
    }},
  place_map_fill: {versionCheck: 'version', readVersion: worldVersion,
    summarize: (args, state) => {
      const placement = args.placement as MapFillPlacement;
      const asset = placement.buildingAssetId
        ? `；资产 ${placement.buildingAssetId}${placement.buildingAssetVersion ? `@${placement.buildingAssetVersion}` : ''}` : '';
      return worldEditSummary('放置地图填充', args, state,
        `${args.mapId ? `地图 ${String(args.mapId)}；` : ''}${placement.id}（${placement.kind}）→ 地点 ${placement.locationId}${asset}`);
    }},
  update_map_fill_placement: {versionCheck: 'version', readVersion: worldVersion,
    summarize: (args, state) => {
      const previous = mapFillPlacementFrom(args, state);
      const patch = args.patch as Partial<Pick<MapFillPlacement, 'label' | 'localOverrides'>>;
      return worldEditSummary('修改地图填充', args, state,
        `${args.mapId ? `地图 ${String(args.mapId)}；` : ''}${previous.id}；${changedValues(previous, {...previous, ...patch}, mapFillFields)}`);
    }},
  apply_world_patch: {
    versionCheck: 'version',
    readVersion: (args, state) => state.worlds.get(String(args.worldDraftId)).version,
    summarize: (args, state) => {
      const draft = state.worlds.get(String(args.worldDraftId));
      const changes = args.changes as WorldPatchChange[];
      const details = changes.slice(0, 3).map(change => `${change.op} ${change.path}`).join('、');
      return `应用世界补丁：「${draft.content.title}」v${draft.version}；${changes.length} 项：${details}${changes.length > 3 ? '……' : ''}`;
    },
  },
  apply_end_conditions: {
    versionCheck: 'version',
    readVersion: (args, state) => state.worlds.get(String(args.worldDraftId)).version,
    summarize: (args, state) => {
      const draft = state.worlds.get(String(args.worldDraftId));
      const selection = args.selection as {kind: 'package' | 'custom'; packageId?: string; win?: unknown[]; lose?: unknown[]; text?: string};
      const detail = selection.kind === 'custom'
        ? `自定义文本 ${clipped(selection.text, 80) ?? ''}`
        : `条件包 ${selection.packageId ?? '（未命名）'}：${selection.win?.length ?? 0} 胜 / ${selection.lose?.length ?? 0} 负`;
      const reshape = draft.content.endConditions ? '；注意：将重塑整局（原终局条件被覆盖）' : '';
      return `应用终局条件：「${draft.content.title}」v${draft.version}；${detail}${reshape}`;
    },
  },
  accept_map_fill: {versionCheck: 'version', readVersion: worldVersion,
    summarize: (args, state) => {
      const items = args.items as MapFillProposalItem[];
      const details = items.slice(0, 3).map(item => `${item.proposalId}（${item.kind}@${item.locationId}）`).join('、');
      return worldEditSummary('接受地图填充提案', args, state,
        `${args.mapId ? `地图 ${String(args.mapId)}；` : ''}${items.length} 项：${details}${items.length > 3 ? '……' : ''}；仅接受已审核项，新资产须先入库`);
    }},
  upsert_block_override: {versionCheck: 'version', readVersion: catalogVersion('block'), summarize: catalogSaveSummary('保存自定义积木')},
  delete_block_override: {versionCheck: 'version', readVersion: catalogVersion('block'), summarize: catalogDeleteSummary('积木')},
  upsert_fun_profile_override: {versionCheck: 'version', readVersion: catalogVersion('fun-profile'), summarize: catalogSaveSummary('保存自定义爽感画像')},
  delete_fun_profile_override: {versionCheck: 'version', readVersion: catalogVersion('fun-profile'), summarize: catalogDeleteSummary('爽感画像')},
  upsert_stat_template_override: {versionCheck: 'version', readVersion: catalogVersion('stat-template'), summarize: catalogSaveSummary('保存自定义数值模板')},
  delete_stat_template_override: {versionCheck: 'version', readVersion: catalogVersion('stat-template'), summarize: catalogDeleteSummary('数值模板')},
  upsert_simulation_strategy_override: {versionCheck: 'version', readVersion: catalogVersion('simulation-strategy'), summarize: catalogSaveSummary('保存自定义模拟策略')},
  delete_simulation_strategy_override: {versionCheck: 'version', readVersion: catalogVersion('simulation-strategy'), summarize: catalogDeleteSummary('模拟策略')},
} satisfies Record<string, AgentChatCommandMetadata>;

const jobResults = new Set(['create_generation_job', 'create_production_job', 'retry_job', 'cancel_job', 'rewrite_production_unit', 'approve_saved_production_plan']);
// Explicit command contracts only: never compact READ results or infer a commit from input arguments.
const worldDraftResults = new Set([
  'create_world_from_idea', 'edit_world_summary', 'add_world_location', 'update_world_location',
  'add_world_storylet', 'update_world_storylet', 'add_storylet_condition', 'remove_storylet_condition',
  'add_storylet_effect', 'remove_storylet_effect', 'add_world_resource_def', 'update_world_resource_def',
]);
const wrappedWorldDraftResults = new Set([
  'apply_world_composition', 'apply_world_patch', 'place_map_fill', 'update_map_fill_placement', 'accept_map_fill',
]);
const worldDraftReceipt = (draft: WorldDraft) => ({
  id: draft.id, sourceId: draft.sourceId, version: draft.version, title: draft.content.title,
});
const isWorldDraftResult = (value: unknown): value is WorldDraft => {
  if (!value || typeof value !== 'object' || 'error' in value || 'status' in value) return false;
  const draft = value as Partial<WorldDraft>;
  return typeof draft.id === 'string' && typeof draft.sourceId === 'string'
    && Number.isSafeInteger(draft.version) && Number(draft.version) > 0
    && !!draft.content && typeof draft.content.title === 'string';
};

/** Small author tool surface. Model settings, raw files, exports, player actions and chat-control tools are excluded. */
export function createAgentChatTools(commands: Command[], state: AgentChatCommandState): ChatTool[] {
  return commands.flatMap(c => {
    const metadata = Object.hasOwn(agentChatCommandMetadata, c.name)
      ? agentChatCommandMetadata[c.name as keyof typeof agentChatCommandMetadata] : undefined;
    if (!metadata) return [];
    const tool: ChatTool = {
      name: c.name, description: c.description + (c.name === 'playtest_world_draft' ? '（对话内最多40种子）' : ''),
      parameters: z.toJSONSchema(c.inputSchema, {unrepresentable: 'any', reused: 'ref'}) as Record<string, unknown>,
      requiresConfirmation: (('confirmation' in metadata ? metadata.confirmation : undefined) ?? c.confirmation) === 'confirm',
      validate: input => {
        const value = input && typeof input === 'object' ? {...input} as Record<string, unknown> : {};
        if ('requestId' in c.inputSchema.shape && !value.requestId) value.requestId = randomUUID();
        if (c.name === 'create_production_job') {
          const brief = value.brief && typeof value.brief === 'object' ? {...value.brief as Record<string, unknown>} : {};
          const tier = typeof brief.tier === 'string' ? brief.tier.trim().toLowerCase() : '';
          if (tier) brief.tier = ['s', 'small', 'standard'].includes(tier) ? 'S'
            : ['m', 'medium', 'large', 'big', 'l'].includes(tier) ? 'M' : brief.tier;
          value.brief = brief;
        }
        if (c.name === 'playtest_world_draft') value.seeds = Math.min(typeof value.seeds === 'number' ? value.seeds : 40, 40);
        return c.inputSchema.parse(value) as Record<string, unknown>;
      },
      prepare: args => {
        const guard = metadata.versionCheck === 'none' ? undefined : String(metadata.readVersion(args, state));
        if (c.name === 'confirm_world_reshape') return {summary: metadata.summarize(args, state), guard: `${guard}:${String(args.diffHash)}`};
        return {summary: metadata.summarize(args, state), ...(guard === undefined ? {} : {guard})};
      },
      execute: async args => {
        // AgentChatService invokes a confirmation tool's execute only after author decide + guard recheck.
        // This trusted dispatch never comes from JSON authorization flags or a public command credential.
        if (c.name === 'confirm_world_reshape') {
          if (!state.worlds.confirmAuthorReshape) throw new AppError('RESHAPE_UNAVAILABLE', '重塑服务不可用', 503);
          return worldDraftReceipt(state.worlds.confirmAuthorReshape(c.inputSchema.parse(args) as Parameters<WorldService['confirmAuthorReshape']>[0]));
        }
        const result = await c.execute(args);
        if (c.name === 'get_world_schema' && c.readOnly && result && typeof result === 'object') return completeWorldSchemaResult(result);
        if (jobResults.has(c.name)) return jobSummary(result as GenerationJob);
        if (Array.isArray(result) && ['list_world_drafts', 'list_drafts', 'list_jobs', 'list_world_revisions', 'list_games'].includes(c.name)) {
          return result.map(row => ({id: row.id, sourceId: row.sourceId, version: row.version, title: row.content?.title,
            status: row.status, stage: row.stage, draftId: row.draftId, updatedAt: row.updatedAt, failure: row.failure?.code}));
        }
        if (worldDraftResults.has(c.name) && isWorldDraftResult(result)) {
          const receipt = worldDraftReceipt(result);
          return c.name === 'edit_world_summary'
            ? {...receipt, changed: Object.keys(args).filter(k => !['id', 'version'].includes(k))} : receipt;
        }
        if (wrappedWorldDraftResults.has(c.name) && result && typeof result === 'object' && !('error' in result) && !('status' in result)
          && 'draft' in result && isWorldDraftResult(result.draft)) {
          const written = result as {draft: WorldDraft; applied?: number};
          return {...worldDraftReceipt(written.draft), ...(written.applied === undefined ? {} : {applied: written.applied})};
        }
        if (c.name === 'apply_end_conditions' && result && typeof result === 'object' && !('error' in result) && !('status' in result)
          && 'draftId' in result && typeof result.draftId === 'string' && 'version' in result && Number.isSafeInteger(result.version)) {
          const written = result as {draftId: string; version: number; severity: string; severityNote: string};
          return {id: written.draftId, draftId: written.draftId, version: written.version, severity: written.severity, severityNote: written.severityNote};
        }
        if (['publish_world_draft', 'publish_draft'].includes(c.name)) {
          const revision = result as {id: string; draftId: string; version: number; content: {title: string}};
          return {id: revision.id, draftId: revision.draftId, version: revision.version, title: revision.content.title};
        }
        return result;
      },
    };
    return [tool];
  });
}
