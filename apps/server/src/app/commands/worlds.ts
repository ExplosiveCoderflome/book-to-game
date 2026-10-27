import { z } from 'zod';
import { worldContentSchema } from '@novel-game/contracts';
import type { Workbench } from '../workbench.js';
import { command, emptySchema, idSchema } from './definition.js';

export function worldCommands(w: Workbench) {
  return [
    command('get_world_schema', '获取v1开放世界JSON Schema；草稿需校验引用与来源后再发布。', emptySchema, true, () => z.toJSONSchema(worldContentSchema)),
    command('create_world_draft', '建立开放世界草稿；作者视图含隐藏事实和NPC私有目标，不可直接作为玩家上下文。',
      z.object({sourceId: z.string().min(1), content: worldContentSchema}), false, input => w.worlds.create(input)),
    command('list_world_drafts', '列出开放世界作者草稿，可能包含秘密。', emptySchema, true, () => w.worlds.list()),
    command('get_world_draft', '读取完整作者草稿。玩家只使用get_adventure返回的投影。', idSchema, true, ({id}) => w.worlds.get(id)),
    command('update_world_draft', '替换世界草稿，version防止覆盖陈旧编辑。',
      z.object({id: z.string(), version: z.number().int().positive(), content: worldContentSchema}), false,
      ({id, ...input}) => w.worlds.update(id, input)),
    command('archive_world_draft', '归档世界草稿：从列表隐藏，已发布版本与冒险存档保留，不做硬删除。', idSchema, false, ({id}) => w.worlds.archive(id)),
    command('validate_world_draft', '检查世界引用、原文范围和潜在连通；不能保证文学质量或所有策略可解。', idSchema, true, ({id}) => w.worlds.validate(id)),
    command('publish_world_draft', '发布已校验的世界版本，内容不可变；同一草稿版本重复发布幂等。',
      z.object({id: z.string(), version: z.number().int().positive()}), false, ({id, version}) => w.worlds.publish(id, {version})),
    command('list_world_revisions', '读取开放世界发布版本（作者视图，包含全部规则和秘密）。', emptySchema, true, () => w.worlds.listRevisions()),
  ];
}
