import { getBlockCatalog, getBlockShelves, lintBlocks } from '@novel-game/contracts';
import { command, emptySchema } from './definition.js';

/** V0b BlockSpec: read-only catalog. Risk = read, no confirmation needed. */
export function blocksCommands() {
  return [
    command('list_blocks', '目录当前引擎可复用积木（BlockSpec，含 shelves/funTags/requires/composesWith/params/provides/acceptance）与积木商店货架元数据，只读；用于按货架浏览与爽感画像推荐组合，人审。',
      emptySchema, true, () => ({blocks: getBlockCatalog(), shelves: getBlockShelves(), lint: lintBlocks()})),
  ];
}
