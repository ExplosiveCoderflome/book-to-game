import { z } from 'zod';
import { command, emptySchema, idSchema } from './definition.js';
import type { Workbench } from '../workbench.js';

/** Supervision is read-only; repair application is a separate, explicit author command. */
export function agentCommands(w: Workbench) {
  return [
    command('create_agent_repair', '根据当前世界体检生成规则修复候选与差异，不修改草稿、不调用模型。先运行模拟试玩。',
      z.object({id: z.string().min(1), version: z.number().int().positive(), endingId: z.string().min(1).max(80)}), false,
      ({id, ...input}) => w.agentRepairs.create({draftId: id, ...input})),
    command('list_agent_repairs', '读取世界草稿最近20份Agent修复候选、差异与验证状态。', idSchema, true,
      ({id}) => ({candidates: w.agentRepairs.list(id)})),
    command('apply_agent_repair', '仅在作者明确确认候选后调用。重新体检与模拟，通过后保存新草稿；旧版本拒绝，重复确认不重复修改，绝不发布。', idSchema, false,
      ({id}) => w.agentRepairs.apply(id)),
    command('reject_agent_repair', '按作者决定驳回修复候选，不修改草稿。', idSchema, false, ({id}) => w.agentRepairs.reject(id)),
    command('list_agent_decisions', '查询 agent 监督动态（最近 50 条决策），只读。', emptySchema, true,
      () => ({decisions: w.agentDecisions.list(50)})),
    command('agent_status', '查询 agent 监督进程心跳与决策总数，只读。', emptySchema, true,
      () => {
        const lastBeat = w.agentDecisions.lastBeat();
        return {lastBeat, totalDecisions: w.agentDecisions.total(),
          alive: lastBeat !== null && Date.now() - Date.parse(lastBeat) < 60000};
      }),
  ];
}
