import { z } from 'zod';
import { command, emptySchema, idSchema } from './definition.js';
import type { Workbench } from '../workbench.js';

export function agentChatCommands(w: Workbench) {
  return [
    command('create_agent_chat', '创建持久Agent对话。沿用工作台模型设置，不自动发送消息。', emptySchema, false, () => w.agentChat.create()),
    command('list_agent_chats', '列出最近50个Agent对话。', emptySchema, true, () => ({conversations: w.agentChat.list()})),
    command('get_agent_chat', '读取Agent对话、工具回执、待确认操作与运行状态。', idSchema, true, ({id}) => w.agentChat.get(id)),
    command('send_agent_message', '给Agent发送消息；相同requestId不会重复调用模型。写操作只提议，需要作者明确确认。',
      z.object({id: z.string().min(1), requestId: z.string().min(1).max(100), text: z.string().min(1).max(8000)}), false, input => w.agentChat.send(input)),
    command('decide_agent_action', '仅按作者明确选择确认或拒绝具体待执行操作；不能由模型代替作者决定。重复决定不会重复执行。',
      z.object({id: z.string().min(1), actionId: z.string().min(1), decision: z.enum(['confirm', 'reject'])}), false, input => w.agentChat.decide(input)),
  ];
}
