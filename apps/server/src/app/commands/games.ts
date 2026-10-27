import { z } from 'zod';
import { actSchema, extendDraftSceneInputSchema, fillSceneTextInputSchema, gameContentSchema, narrateInputSchema, proposeActInputSchema } from '@novel-game/contracts';
import type { Workbench } from '../workbench.js';
import { command, emptySchema, idSchema } from './definition.js';
import { extendDraftScene, fillDraftSceneText } from '../../modules/generation/index.js';
import { proposeActSession } from '../../modules/sessions/application/propose-act.js';
import { narrateSession } from '../../modules/sessions/application/narrate.js';
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
    command('fill_draft_scene_text', '作者态：加深选中场景正文（不改图/选项）。返回文案由客户端写入本地 dirty，不自动保存草稿。失败 soft-fail。',
      fillSceneTextInputSchema, false, async (input) => {
        if (!w.providerConfigured) {
          return { status: 'unavailable', sceneId: input.sceneId, text: null, title: null, reason: '尚未配置模型。请进入“模型设置”后再补全文。' };
        }
        const endpoint = w.modelSettings.resolve();
        const provider = new ChatCompletionsProvider({...endpoint, maxAttempts: 2, repairAttempts: 2});
        return fillDraftSceneText(w.games, w.sources, input, provider);
      }),
    command('list_games', '列出发布版本（作者视图，含所有分支）。', emptySchema, true, () => w.games.listRevisions()),
    command('start_session', '创建试玩存档，固定使用指定游戏发布版本；只返回当前场景。',
      z.object({gameRevisionId: z.string().min(1)}), false, input => w.sessions.start(input)),
    command('list_sessions', '列出本地试玩存档的当前场景与历史。', emptySchema, true, () => w.sessions.list()),
    command('get_session', '恢复存档；返回已发生经历与当前选择，不返回未到达的剧情。', idSchema, true, ({id}) => w.sessions.get(id)),
    command('act_session', '执行可见选项。expectedTurn防止陈旧输入；网络失败必须使用完全相同requestId和参数重试。',
      actSchema.extend({id: z.string()}), false, ({id, ...input}) => w.sessions.act(id, input)),
    command('propose_act_session', 'L2：将玩家自由文本映射到当前可见且可用（含世界书过滤后）的 choiceId，或 none；默认映射成功后执行 act。禁止发明新边。',
      proposeActInputSchema.extend({id: z.string()}), false, async ({id, ...input}) => {
        if (!w.providerConfigured) throw new AppError('MODEL_NOT_CONFIGURED', '尚未配置模型。请进入“模型设置”后再使用自由输入。', 503);
        const endpoint = w.modelSettings.resolve();
        const provider = new ChatCompletionsProvider({...endpoint, maxAttempts: 2, repairAttempts: 2});
        return proposeActSession(w.sessions, id, input, provider);
      }),
    command('narrate_session', 'L1：为当前场景生成可选表演旁白（风味文案）。不改图、不改变量、不发明选项；失败时 soft-fail。默认由客户端关闭。',
      narrateInputSchema.extend({id: z.string()}), false, async ({id, ...input}) => {
        if (!w.providerConfigured) {
          const view = w.sessions.get(id);
          return { status: 'unavailable', text: null, sceneId: view.scene.id, turn: view.turn, reason: '尚未配置模型。请进入“模型设置”后再开启旁白。', cached: false };
        }
        const endpoint = w.modelSettings.resolve();
        const provider = new ChatCompletionsProvider({...endpoint, maxAttempts: 2, repairAttempts: 2});
        return narrateSession(w.sessions, w.games, id, input, provider);
      }),
  ];
}
