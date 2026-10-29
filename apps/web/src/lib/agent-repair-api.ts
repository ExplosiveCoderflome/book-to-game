import type { AgentRepairCandidate, WorldDraft } from '@novel-game/contracts';
import { request } from './api';

export const listAgentRepairs = (token: string, id: string) => request<{candidates: AgentRepairCandidate[]}>(token, `/worlds/drafts/${id}/agent-repairs`);
export const createAgentRepair = (token: string, id: string, version: number, endingId: string) =>
  request<AgentRepairCandidate>(token, `/worlds/drafts/${id}/agent-repairs`, 'POST', {version, endingId});
export const applyAgentRepair = (token: string, id: string) =>
  request<{candidate: AgentRepairCandidate; draft: WorldDraft}>(token, `/agent/repairs/${id}/apply`, 'POST', {});
export const rejectAgentRepair = (token: string, id: string) => request<AgentRepairCandidate>(token, `/agent/repairs/${id}/reject`, 'POST', {});
