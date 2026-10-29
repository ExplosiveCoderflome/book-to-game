import { command, emptySchema } from './definition.js';
import type { Workbench } from '../workbench.js';

/** Agent 监督动态：只读。监督进程本身不批规划、不改写单元。 */
export function agentCommands(w: Workbench) {
  return [
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
