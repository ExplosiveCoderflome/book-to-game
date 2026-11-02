import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type {
  GenerationJob, MapFillPlacement, MapFillProposalItem, ResourceDef, Storylet, WorldCondition, WorldContent, WorldEffect,
} from '@novel-game/contracts';
import type { ChatTool } from '../modules/agent/index.js';
import { jobSummary, type JobService } from '../modules/generation/index.js';
import type { WorldService } from '../modules/worlds/index.js';
import type { GameService } from '../modules/games/index.js';
import { AppError } from '../shared/errors.js';
import type { Command } from './commands/definition.js';

type Args = Record<string, unknown>;
export interface AgentChatCommandState {
  jobs: Pick<JobService, 'get'>;
  worlds: Pick<WorldService, 'get'>;
  games: Pick<GameService, 'get'>;
}
type Summarize = (args: Args, state: AgentChatCommandState) => string;
type AgentChatCommandMetadata = {
  confirmation: 'auto' | 'confirm';
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
  runtime_info: {confirmation: 'auto', versionCheck: 'none', summarize: argsSummary('查询运行信息')},
  list_sources: {confirmation: 'auto', versionCheck: 'none', summarize: argsSummary('查询来源列表')},
  read_source: {confirmation: 'auto', versionCheck: 'none', summarize: argsSummary('读取来源')},
  list_blocks: {confirmation: 'auto', versionCheck: 'none', summarize: argsSummary('查询积木目录')},
  list_fun_profiles: {confirmation: 'auto', versionCheck: 'none', summarize: argsSummary('查询爽感画像目录')},
  list_jobs: {confirmation: 'auto', versionCheck: 'none', summarize: argsSummary('查询任务列表')},
  read_job: {confirmation: 'auto', versionCheck: 'none', summarize: argsSummary('读取任务')},
  check_job_plan: {confirmation: 'auto', versionCheck: 'none', summarize: argsSummary('检查制作规划')},
  list_world_drafts: {confirmation: 'auto', versionCheck: 'none', summarize: argsSummary('查询世界草稿列表')},
  read_world_draft: {confirmation: 'auto', versionCheck: 'none', summarize: argsSummary('读取世界草稿')},
  get_world_preflight: {confirmation: 'auto', versionCheck: 'none', summarize: argsSummary('查询世界预检')},
  validate_world_draft: {confirmation: 'auto', versionCheck: 'none', summarize: argsSummary('校验世界草稿')},
  lint_world_draft: {confirmation: 'auto', versionCheck: 'none', summarize: argsSummary('体检世界草稿')},
  playtest_world_draft: {confirmation: 'auto', versionCheck: 'none', summarize: argsSummary('试玩世界草稿')},
  propose_map_fill: {confirmation: 'auto', versionCheck: 'none', summarize: argsSummary('生成 Mock 地图填充提案（只读）')},
  agent_status: {confirmation: 'auto', versionCheck: 'none', summarize: argsSummary('查询 Agent 状态')},
  list_agent_decisions: {confirmation: 'auto', versionCheck: 'none', summarize: argsSummary('查询 Agent 决策列表')},
  list_agent_repairs: {confirmation: 'auto', versionCheck: 'none', summarize: argsSummary('查询修复候选列表')},
  create_agent_repair: {confirmation: 'auto', versionCheck: 'none', summarize: argsSummary('创建修复候选')},
  list_drafts: {confirmation: 'auto', versionCheck: 'none', summarize: argsSummary('查询游戏草稿列表')},
  get_draft: {confirmation: 'auto', versionCheck: 'none', summarize: argsSummary('读取游戏草稿')},
  validate_draft: {confirmation: 'auto', versionCheck: 'none', summarize: argsSummary('校验游戏草稿')},
  lint_draft: {confirmation: 'auto', versionCheck: 'none', summarize: argsSummary('体检游戏草稿')},
  list_world_revisions: {confirmation: 'auto', versionCheck: 'none', summarize: argsSummary('查询世界版本列表')},
  list_games: {confirmation: 'auto', versionCheck: 'none', summarize: argsSummary('查询游戏列表')},
  create_generation_job: {confirmation: 'confirm', versionCheck: 'none', summarize: argsSummary('创建改编任务')},
  create_production_job: {confirmation: 'confirm', versionCheck: 'none', summarize: argsSummary('创建角色扮演制作任务')},
  retry_job: {confirmation: 'confirm', versionCheck: 'updatedAt', readVersion: jobVersion, summarize: jobConfirmationSummary('恢复生成任务')},
  cancel_job: {confirmation: 'confirm', versionCheck: 'updatedAt', readVersion: jobVersion, summarize: jobConfirmationSummary('取消生成任务')},
  rewrite_production_unit: {confirmation: 'confirm', versionCheck: 'updatedAt', readVersion: jobVersion, summarize: jobConfirmationSummary('重写指定正文')},
  approve_saved_production_plan: {
    confirmation: 'confirm', versionCheck: 'updatedAt',
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
  apply_agent_repair: {confirmation: 'confirm', versionCheck: 'none', summarize: argsSummary('应用修复候选')},
  reject_agent_repair: {confirmation: 'confirm', versionCheck: 'none', summarize: argsSummary('驳回修复候选')},
  publish_world_draft: {confirmation: 'confirm', versionCheck: 'version', readVersion: worldVersion, summarize: worldSummary('发布世界版本')},
  publish_draft: {
    confirmation: 'confirm', versionCheck: 'version',
    readVersion: (args, state) => state.games.get(String(args.id)).version,
    summarize: (args, state) => {
      const draft = state.games.get(String(args.id));
      return `发布「${draft.content.title}」v${draft.version}`;
    },
  },
  edit_world_summary: {confirmation: 'confirm', versionCheck: 'version', readVersion: worldVersion, summarize: worldSummary('修改世界摘要')},
  add_world_location: {confirmation: 'confirm', versionCheck: 'version', readVersion: worldVersion,
    summarize: (args, state) => {
      const location = args.location as WorldLocation;
      return worldEditSummary('新增地点', args, state, `${location.id}「${location.title}」；正文：${shortJson(location.text)}`);
    }},
  update_world_location: {confirmation: 'confirm', versionCheck: 'version', readVersion: worldVersion,
    summarize: (args, state) => {
      const draft = state.worlds.get(String(args.id));
      const location = args.location as WorldLocation;
      const previous = required(draft.content.locations.find(item => item.id === location.id), `地点 ${location.id}`);
      return worldEditSummary('修改地点', args, state, `${location.id}；${changedValues(previous, location, locationFields)}`);
    }},
  add_world_storylet: {confirmation: 'confirm', versionCheck: 'version', readVersion: worldVersion,
    summarize: (args, state) => {
      const storylet = args.storylet as Storylet;
      return worldEditSummary('新增剧情卡', args, state,
        `${storylet.id}「${storylet.title}」；地点：${storylet.locationIds?.join('、') || '不限'}；${storylet.choices.length} 个选项`);
    }},
  update_world_storylet: {confirmation: 'confirm', versionCheck: 'version', readVersion: worldVersion,
    summarize: (args, state) => {
      const draft = state.worlds.get(String(args.id));
      const storylet = args.storylet as Storylet;
      const previous = required((draft.content.storylets ?? []).find(item => item.id === storylet.id), `剧情卡 ${storylet.id}`);
      return worldEditSummary('修改剧情卡', args, state, `${storylet.id}；${changedValues(previous, storylet, storyletFields)}`);
    }},
  add_storylet_condition: {confirmation: 'confirm', versionCheck: 'version', readVersion: worldVersion,
    summarize: (args, state) => conditionSummary('新增剧情卡条件', args, state, false)},
  remove_storylet_condition: {confirmation: 'confirm', versionCheck: 'version', readVersion: worldVersion,
    summarize: (args, state) => conditionSummary('删除剧情卡条件', args, state, true)},
  add_storylet_effect: {confirmation: 'confirm', versionCheck: 'version', readVersion: worldVersion,
    summarize: (args, state) => effectSummary('新增剧情卡效果', args, state, false)},
  remove_storylet_effect: {confirmation: 'confirm', versionCheck: 'version', readVersion: worldVersion,
    summarize: (args, state) => effectSummary('删除剧情卡效果', args, state, true)},
  add_world_resource_def: {confirmation: 'confirm', versionCheck: 'version', readVersion: worldVersion,
    summarize: (args, state) => {
      const definition = args.definition as ResourceDef;
      return worldEditSummary('新增资源定义', args, state,
        `${String(args.resourceId)}「${definition.label}」；范围 ${definition.min}–${definition.max ?? '∞'}，初始 ${definition.initial ?? '未设置'}`);
    }},
  update_world_resource_def: {confirmation: 'confirm', versionCheck: 'version', readVersion: worldVersion,
    summarize: (args, state) => {
      const draft = state.worlds.get(String(args.id));
      const resourceId = String(args.resourceId);
      const previous = required(draft.content.resourceDefs?.[resourceId], `资源定义 ${resourceId}`);
      return worldEditSummary('修改资源定义', args, state,
        `${resourceId}；${changedValues(previous, args.definition as ResourceDef, resourceFields)}`);
    }},
  place_map_fill: {confirmation: 'confirm', versionCheck: 'version', readVersion: worldVersion,
    summarize: (args, state) => {
      const placement = args.placement as MapFillPlacement;
      const asset = placement.buildingAssetId
        ? `；资产 ${placement.buildingAssetId}${placement.buildingAssetVersion ? `@${placement.buildingAssetVersion}` : ''}` : '';
      return worldEditSummary('放置地图填充', args, state,
        `${args.mapId ? `地图 ${String(args.mapId)}；` : ''}${placement.id}（${placement.kind}）→ 地点 ${placement.locationId}${asset}`);
    }},
  update_map_fill_placement: {confirmation: 'confirm', versionCheck: 'version', readVersion: worldVersion,
    summarize: (args, state) => {
      const previous = mapFillPlacementFrom(args, state);
      const patch = args.patch as Partial<Pick<MapFillPlacement, 'label' | 'localOverrides'>>;
      return worldEditSummary('修改地图填充', args, state,
        `${args.mapId ? `地图 ${String(args.mapId)}；` : ''}${previous.id}；${changedValues(previous, {...previous, ...patch}, mapFillFields)}`);
    }},
  accept_map_fill: {confirmation: 'confirm', versionCheck: 'version', readVersion: worldVersion,
    summarize: (args, state) => {
      const items = args.items as MapFillProposalItem[];
      const details = items.slice(0, 3).map(item => `${item.proposalId}（${item.kind}@${item.locationId}）`).join('、');
      return worldEditSummary('接受地图填充提案', args, state,
        `${args.mapId ? `地图 ${String(args.mapId)}；` : ''}${items.length} 项：${details}${items.length > 3 ? '……' : ''}；仅接受已审核项，新资产须先入库`);
    }},
} satisfies Record<string, AgentChatCommandMetadata>;

const jobResults = new Set(['create_generation_job', 'create_production_job', 'retry_job', 'cancel_job', 'rewrite_production_unit', 'approve_saved_production_plan']);

/** Small author tool surface. Model settings, raw files, exports, player actions and chat-control tools are excluded. */
export function createAgentChatTools(commands: Command[], state: AgentChatCommandState): ChatTool[] {
  return commands.flatMap(c => {
    const metadata = Object.hasOwn(agentChatCommandMetadata, c.name)
      ? agentChatCommandMetadata[c.name as keyof typeof agentChatCommandMetadata] : undefined;
    if (!metadata) return [];
    const tool: ChatTool = {
      name: c.name, description: c.description + (c.name === 'playtest_world_draft' ? '（对话内最多40种子）' : ''),
      parameters: z.toJSONSchema(c.inputSchema, {unrepresentable: 'any', reused: 'ref'}) as Record<string, unknown>,
      requiresConfirmation: metadata.confirmation === 'confirm',
      validate: input => {
        const value = input && typeof input === 'object' ? {...input} as Record<string, unknown> : {};
        if ('requestId' in c.inputSchema.shape && !value.requestId) value.requestId = randomUUID();
        if (c.name === 'playtest_world_draft') value.seeds = Math.min(typeof value.seeds === 'number' ? value.seeds : 40, 40);
        return c.inputSchema.parse(value) as Record<string, unknown>;
      },
      prepare: args => {
        const guard = metadata.versionCheck === 'none' ? undefined : String(metadata.readVersion(args, state));
        return {summary: metadata.summarize(args, state), ...(guard === undefined ? {} : {guard})};
      },
      execute: async args => {
        const result = await c.execute(args);
        if (jobResults.has(c.name)) return jobSummary(result as GenerationJob);
        if (Array.isArray(result) && ['list_world_drafts', 'list_drafts', 'list_jobs', 'list_world_revisions', 'list_games'].includes(c.name)) {
          return result.map(row => ({id: row.id, sourceId: row.sourceId, version: row.version, title: row.content?.title,
            status: row.status, stage: row.stage, draftId: row.draftId, updatedAt: row.updatedAt, failure: row.failure?.code}));
        }
        if (c.name === 'edit_world_summary' && result && typeof result === 'object' && 'content' in result) {
          const draft = result as {id: string; version: number; content: {title: string}};
          return {id: draft.id, version: draft.version, title: draft.content.title, changed: Object.keys(args).filter(k => !['id', 'version'].includes(k))};
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
