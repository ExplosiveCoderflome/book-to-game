import { z } from 'zod';
import { PLAYTEST_MAX_SEEDS } from '../../modules/preflight/index.js';
import type { Workbench } from '../workbench.js';
import { command, idSchema } from './definition.js';

export function preflightCommands(w: Workbench) {
  return [
    command('lint_world_draft', '体检世界草稿（§6.6）：结构、资源来去、卡池、文字（禁用句/过短/近重复）与体量档；返回 LintReport 并按草稿落库。新系统世界有 error 时不能发布（D7）。',
      idSchema, false, ({id}) => w.preflight.lintWorldDraft(id)),
     command('playtest_world_draft', '试玩模拟（§6.7）：多策略 × 多种子跑同一引擎，返回 PlaytestReport 与有界可重放证据（服务端内容 hash、检查 spec hash、策略/种子/动作 witness、raw/effective steps 分布、死路/截断）并落库。抽样未命中不证明不可达。可传 expectedVersion 与 profileId；证据参数受 runs/seed/maxSteps 边界限制。只读草稿，不发布。',
      z.object({id: z.string().min(1), expectedVersion: z.number().int().min(1).optional(), seeds: z.number().int().min(1).max(PLAYTEST_MAX_SEEDS).optional(),
         strategies: z.array(z.string().min(1).max(40)).max(10).optional(),
         profileId: z.string().min(1).max(40).optional(), evidenceRuns: z.number().int().min(1).max(20).optional(),
         evidenceSeed: z.number().int().min(0).max(0xffffffff).optional(), maxSteps: z.number().int().min(1).max(300).optional()}), false, input => w.preflight.playtestWorldDraft(input)),
    command('get_world_preflight', '读取世界草稿最近一次体检与模拟报告（含是否基于旧版本）。', idSchema, true, ({id}) => w.preflight.getWorldPreflight(id)),
    command('lint_draft', '体检剧情草稿（§6.6 文字规则：禁用句、过短、近重复、空选项名）；只报告，不挡发布。', idSchema, false, ({id}) => w.preflight.lintStoryDraft(id)),
  ];
}
