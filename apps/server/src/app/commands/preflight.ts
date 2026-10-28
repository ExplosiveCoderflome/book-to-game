import { z } from 'zod';
import { PLAYTEST_MAX_SEEDS } from '../../modules/preflight/index.js';
import type { Workbench } from '../workbench.js';
import { command, idSchema } from './definition.js';

export function preflightCommands(w: Workbench) {
  return [
    command('lint_world_draft', '体检世界草稿（§6.6）：结构、资源来去、卡池、文字（禁用句/过短/近重复）与体量档；返回 LintReport 并按草稿落库。新系统世界有 error 时不能发布（D7）。',
      idSchema, false, ({id}) => w.preflight.lintWorldDraft(id)),
    command('playtest_world_draft', '试玩模拟（§6.7）：多策略 × 多种子跑同一引擎，返回 PlaytestReport（结局分布、时长中位数、卡池、死路、G1–G8 判定）并落库。只读草稿，不发布。',
      z.object({id: z.string().min(1), seeds: z.number().int().min(1).max(PLAYTEST_MAX_SEEDS).optional(),
        strategies: z.array(z.string().min(1).max(40)).max(10).optional()}), false, input => w.preflight.playtestWorldDraft(input)),
    command('get_world_preflight', '读取世界草稿最近一次体检与模拟报告（含是否基于旧版本）。', idSchema, true, ({id}) => w.preflight.getWorldPreflight(id)),
    command('lint_draft', '体检剧情草稿（§6.6 文字规则：禁用句、过短、近重复、空选项名）；只报告，不挡发布。', idSchema, false, ({id}) => w.preflight.lintStoryDraft(id)),
  ];
}
