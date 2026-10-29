import { z } from 'zod';
import { authorReadSchema, extractMapDraftInputSchema, worldContentSchema } from '@novel-game/contracts';
import { extractMapDraft } from '../../modules/worlds/index.js';
import { AppError } from '../../shared/errors.js';
import type { Workbench } from '../workbench.js';
import { command, emptySchema, idSchema } from './definition.js';

export function worldCommands(w: Workbench) {
  return [
    command('edit_world_summary', '按指定版本修改世界草稿标题、背景、目标或改编说明，保留所有玩法及其余内容，不发布。',
      z.object({id: z.string().min(1), version: z.number().int().positive(), title: z.string().min(1).max(200).optional(),
        premise: z.string().min(1).max(4000).optional(), goal: z.string().min(1).max(2000).optional(), adaptationNotes: z.string().max(4000).optional()})
        .refine(input => ['title', 'premise', 'goal', 'adaptationNotes'].some(key => input[key as keyof typeof input] !== undefined), '至少提供一项需要修改的内容'), false,
      ({id, version, ...changes}) => {
        const draft = w.worlds.get(id); return w.worlds.update(id, {version, content: {...draft.content, ...changes}});
      }),
    command('extract_map_draft', 'AI：从小说原文抽取地图草案（地点/势力/人物/通路），返回待作者逐项审阅的 diff；不修改草稿。',
      extractMapDraftInputSchema.extend({id: z.string()}), true, async ({id, ...input}) => {
        if (!w.providerConfigured) throw new AppError('MODEL_NOT_CONFIGURED', '尚未配置模型。请进入“模型设置”后再使用 AI 提取。', 503);
        const provider = w.createPlayProvider();
        return extractMapDraft(w.worlds, sid => w.sources.get(sid), id, input, provider, AbortSignal.timeout(180_000), provider.modelName);
      }),
    command('get_world_schema', '获取v1开放世界JSON Schema；草稿需校验引用与来源后再发布。', emptySchema, true, () => z.toJSONSchema(worldContentSchema)),
    command('create_world_draft', '建立开放世界草稿；作者视图含隐藏事实和NPC私有目标，不可直接作为玩家上下文。',
      z.object({sourceId: z.string().min(1), content: worldContentSchema}), false, input => w.worlds.create(input)),
    command('list_world_drafts', '列出开放世界作者草稿，可能包含秘密。', emptySchema, true, () => w.worlds.list()),
    command('get_world_draft', '读取完整作者草稿。玩家只使用get_adventure返回的投影。', idSchema, true, ({id}) => w.worlds.get(id)),
    command('read_world_draft', '分段读取作者世界草稿（含秘密）。省略path返回摘要和字段目录；path相对content，如["storylets"]、["storylets","0"]、["actions","2","effects"]。集合按offset/limit分页；reference条目按其path继续读取；长文本每页6000字符。每页返回version，版本变化须重新读取。',
      authorReadSchema.extend({id: z.string().min(1)}), true, ({id, ...input}) => w.worlds.read(id, input)),
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
