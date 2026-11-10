import { catalogEntryIdSchema, funTagSchema, getBlock, getBlockCatalog, getBlockShelves, lintBlocks } from '@novel-game/contracts';
import { z } from 'zod';
import type { Workbench } from '../workbench.js';
import { AppError } from '../../shared/errors.js';
import { command } from './definition.js';

/** 内置目录默认保持不变；存在作者自定义覆盖时读取合并后的有效目录。 */
export function blocksCommands(w?: Workbench) {
  return [
    command('list_blocks', '目录当前可复用积木（BlockSpec，含 shelves/funTags/requires/composesWith/params/provides/acceptance）与货架元数据，只读；可按 funTag 过滤。K契约和示例按需用get_block读取，列表不展开engine详情。',
      z.object({funTag: funTagSchema.optional()}), true, input => {
        const blocks = (w?.blockLibrary?.effective('block') ?? getBlockCatalog()).filter(block => !input.funTag || block.funTags.includes(input.funTag!))
          .map(({engine: _details, ...summary}) => summary);
        const lint = w?.blockLibrary?.view().issues.filter(issue => issue.kind === 'block') ?? lintBlocks();
        return {blocks, shelves: getBlockShelves(), lint};
      }),
    command('get_block', '按 id 读取一个积木目录条目，含内置/自定义来源、version、完整 BlockSpec 与覆盖时间，只读。',
      z.object({id: catalogEntryIdSchema}), true, input => {
        if (w?.blockLibrary) return w.blockLibrary.get('block', input.id);
        const data = getBlock(input.id);
        if (!data) throw new AppError('CATALOG_NOT_FOUND', `目录条目不存在：block/${input.id}`, 404, {kind: 'block', id: input.id});
        return {kind: 'block', id: input.id, version: data.version, origin: 'builtin', data};
      }),
  ];
}
