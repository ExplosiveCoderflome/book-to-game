import { z } from 'zod';
import { adventureActSchema, proposeAdventureActInputSchema } from '@novel-game/contracts';
import type { Workbench } from '../workbench.js';
import { command, emptySchema, idSchema } from './definition.js';
import { proposeActAdventure } from '../../modules/adventure-sessions/application/propose-act.js';
import { ChatCompletionsProvider } from '../../platform/model/chat-completions.js';
import { AppError } from '../../shared/errors.js';

export function adventureCommands(w: Workbench) {
  return [
    command('start_adventure', '创建固定发布版本的开放冒险存档，返回玩家可知内容。',
      z.object({worldRevisionId: z.string().min(1)}), false, input => w.adventures.start(input)),
    command('list_adventures', '列出开放冒险存档的玩家投影。', emptySchema, true, () => w.adventures.list()),
    command('get_adventure', '读取当前地点、可见行动、已知事实和历史；不推进时间，不暴露NPC秘密。', idSchema, true, ({id}) => w.adventures.get(id)),
    command('act_adventure', '执行当前可用的建议行动，由规则提交事实/时间/人物与事件变化。失败重试必须复用完全相同requestId、actionId和expectedTurn；不得把叙述当作已执行事实。',
      adventureActSchema.extend({id: z.string()}), false, ({id, ...input}) => w.adventures.act(id, input)),
    command('propose_act_adventure', 'L2：将自由文本映射到当前可用 actionId 或 none；默认成功后执行 act。禁止发明新行动。',
      proposeAdventureActInputSchema.extend({id: z.string()}), false, async ({id, ...input}) => {
        if (!w.providerConfigured) throw new AppError('MODEL_NOT_CONFIGURED', '尚未配置模型。请进入“模型设置”后再使用自由输入。', 503);
        const endpoint = w.modelSettings.resolve();
        const provider = new ChatCompletionsProvider({...endpoint, maxAttempts: 2, repairAttempts: 2});
        return proposeActAdventure(w.adventures, id, input, provider);
      }),
  ];
}
