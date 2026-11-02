import { getBlockCatalog, lintBlocks } from '@novel-game/contracts';
import { command, emptySchema } from './definition.js';

/** V0b BlockSpec: read-only catalog. Risk = read, no confirmation needed. */
export function blocksCommands() {
  return [
    command('list_blocks', '目录当前引擎可复用积木（BlockSpec，含 funTags/requires/composesWith/params/provides/acceptance），只读；用于按爽感画像推荐组合，人审。',
      emptySchema, true, () => ({blocks: getBlockCatalog(), lint: lintBlocks()})),
  ];
}