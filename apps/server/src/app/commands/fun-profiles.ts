import { getFunProfileCatalog } from '@novel-game/contracts';
import { command, emptySchema } from './definition.js';

/** Catalog-only FunProfile directory. Risk = read, no confirmation needed. */
export function funProfileCommands() {
  return [
    command('list_fun_profiles', '目录当前爽感画像（FunProfile，含 funTags/suggestedBlocks/pacingLine/strategies/thresholds/metricMatrix），只读；suggestedBlocks 引用 list_blocks 的真实积木 id，用于按画像推荐组合，人审。',
      emptySchema, true, () => ({profiles: getFunProfileCatalog()})),
  ];
}