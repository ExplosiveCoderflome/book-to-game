import { getFunProfileCatalog, proposeFunProfileInputSchema, recommendBlocksForProfileInputSchema } from '@novel-game/contracts';
import { mockFunProfileModel, proposeFunProfile, recommendBlocksForProfile } from '../../modules/worlds/index.js';
import type { Workbench } from '../workbench.js';
import { command, emptySchema } from './definition.js';

/** Catalog-only FunProfile directory. Risk = read, no confirmation needed. */
export function funProfileCommands(w: Workbench) {
  return [
    command('list_fun_profiles', '目录当前爽感画像（FunProfile，含 funTags/suggestedBlocks/pacingLine/strategies/thresholds/metricMatrix），只读；suggestedBlocks 引用 list_blocks 的真实积木 id，用于按画像推荐组合，人审。',
      emptySchema, true, () => ({profiles: getFunProfileCatalog()})),
    command('propose_fun_profile', 'Mock AI：按世界草稿短摘要提议一个内置爽感画像（含中文理由与可选提示）并附推荐积木，只读；不写草稿元数据，确认留待后续流程。',
      proposeFunProfileInputSchema, true, input => proposeFunProfile(w.worlds, input.worldDraftId, input, mockFunProfileModel,
        AbortSignal.timeout(30_000), 'mock-fun-profile')),
    command('recommend_blocks_for_profile', '只读：按爽感画像 id 返回 suggestedBlocks 中真实注册的积木（id/标题/简述），非法画像明确报错；不改画像目录或积木注册表。',
      recommendBlocksForProfileInputSchema, true, input => recommendBlocksForProfile(input.profileId)),
  ];
}
