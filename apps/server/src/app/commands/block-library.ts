import {
  deleteCatalogEntryInputSchema, upsertBlockOverrideInputSchema, upsertFunProfileOverrideInputSchema,
  upsertSimulationStrategyOverrideInputSchema, upsertStatTemplateOverrideInputSchema,
} from '@novel-game/contracts';
import type { Workbench } from '../workbench.js';
import { command, emptySchema } from './definition.js';

/** 所有写命令都是 confirm + expectedVersion 乐观锁；HTTP 与 Agent 共用这些应用用例。 */
export function blockLibraryCommands(w: Workbench) {
  return [
    command('get_block_library', '读取积木、爽感画像、数值模板与模拟策略的完整维护目录及中文 lint 诊断，只读。',
      emptySchema, true, () => w.blockLibrary.view()),
    command('upsert_block_override', '新增自定义积木或保存自定义覆盖；内置定义不被改写。expectedVersion 防止陈旧覆盖，结构性修改必须递增 version，保存前执行 zod 与组合 lint。',
      upsertBlockOverrideInputSchema, false, input => w.blockLibrary.upsert('block', input)),
    command('delete_block_override', '删除未被引用的自定义积木；内置积木只读禁删，被画像、其他积木或品类配方引用时拒绝删除。',
      deleteCatalogEntryInputSchema, false, input => w.blockLibrary.delete('block', input)),
    command('upsert_fun_profile_override', '新增自定义爽感画像或保存自定义覆盖；校验 suggestedBlocks/strategies 引用，结构性修改必须递增 version。',
      upsertFunProfileOverrideInputSchema, false, input => w.blockLibrary.upsert('fun-profile', input)),
    command('delete_fun_profile_override', '删除未被品类配方引用的自定义爽感画像；内置画像只读禁删。',
      deleteCatalogEntryInputSchema, false, input => w.blockLibrary.delete('fun-profile', input)),
    command('upsert_stat_template_override', '新增自定义数值模板或保存自定义覆盖；校验变量类型、角色和初值，结构性修改必须递增 version。',
      upsertStatTemplateOverrideInputSchema, false, input => w.blockLibrary.upsert('stat-template', input)),
    command('delete_stat_template_override', '删除未被草稿、生成任务或积木参数引用的自定义数值模板；内置模板只读禁删。',
      deleteCatalogEntryInputSchema, false, input => w.blockLibrary.delete('stat-template', input)),
    command('upsert_simulation_strategy_override', '新增自定义模拟策略或保存自定义覆盖；baseStrategy 只能复用现有审计过的选择器，切换选择器必须递增 version。',
      upsertSimulationStrategyOverrideInputSchema, false, input => w.blockLibrary.upsert('simulation-strategy', input)),
    command('delete_simulation_strategy_override', '删除未被画像引用的自定义模拟策略；内置策略只读禁删。',
      deleteCatalogEntryInputSchema, false, input => w.blockLibrary.delete('simulation-strategy', input)),
  ];
}
