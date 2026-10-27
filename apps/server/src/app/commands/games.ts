import { z } from 'zod';
import { actSchema, extendDraftSceneInputSchema, gameContentSchema } from '@novel-game/contracts';
import type { Workbench } from '../workbench.js';
import { command, emptySchema, idSchema } from './definition.js';
import { extendDraftScene } from '../../modules/generation/index.js';
import { ChatCompletionsProvider } from '../../platform/model/chat-completions.js';
import { AppError } from '../../shared/errors.js';

export function gameCommands(w: Workbench) {
  return [
    command('get_game_schema', '返回GameContent的JSON Schema。Agent据此提交草稿；语义/连边/证据还需validate_draft校验。', emptySchema, true,
      () => z.toJSONSchema(gameContentSchema)),
    command('create_draft', '保存结构合法的草稿；尚不发布。证据ID来自read_source。当前只实现story分支模式。',
      z.object({sourceId: z.string().min(1), content: gameContentSchema}), false, input => w.games.create(input)),
    command('list_drafts', '列出作者草稿及当前版本。', emptySchema, true, () => w.games.list()),
    command('get_draft', '读取作者草稿。可能包含全部分支和结局，不应用作玩家上下文。', idSchema, true, ({id}) => w.games.get(id)),
    command('update_draft', '替换草稿内容，必须携带读取时的version；409冲突时重新读取，不覆盖他人修改。',
      z.object({id: z.string(), version: z.number().int().positive(), content: gameContentSchema}), false,
      ({id, ...input}) => w.games.update(id, input)),
    command('validate_draft', '校验入口、分支、结局、图可达性与原文证据，不自动发布。', idSchema, true, ({id}) => w.games.validate(id)),
    command('publish_draft', '将通过校验的草稿版本发布为不可变游戏包；同一草稿版本重复发布返回原记录。',
      z.object({id: z.string(), version: z.number().int().positive()}), false, ({id, version}) => w.games.publish(id, {version})),
    command('extend_draft_scene', '从选中场景延申邻近节点与显式边，合并进草稿且不抹掉无关节点。需要模型配置。',
      extendDraftSceneInputSchema, false, async (input) => {
        if (!w.providerConfigured) throw new AppError('MODEL_NOT_CONFIGURED', '尚未配置模型。请进入“模型设置”后再延申节点。', 503);
        const endpoint = w.modelSettings.resolve();
        const provider = new ChatCompletionsProvider({...endpoint, maxAttempts: 2, repairAttempts: 2});
        return extendDraftScene(w.games, provider, input, {providerConfigured: true});
      }),
    command('list_games', '列出发布版本（作者视图，含所有分支）。', emptySchema, true, () => w.games.listRevisions()),
    command('start_session', '创建试玩存档，固定使用指定游戏发布版本；只返回当前场景。',
      z.object({gameRevisionId: z.string().min(1)}), false, input => w.sessions.start(input)),
    command('list_sessions', '列出本地试玩存档的当前场景与历史。', emptySchema, true, () => w.sessions.list()),
    command('get_session', '恢复存档；返回已发生经历与当前选择，不返回未到达的剧情。', idSchema, true, ({id}) => w.sessions.get(id)),
    command('act_session', '执行可见选项。expectedTurn防止陈旧输入；网络失败必须使用完全相同requestId和参数重试。',
      actSchema.extend({id: z.string()}), false, ({id, ...input}) => w.sessions.act(id, input)),
  ];
}
