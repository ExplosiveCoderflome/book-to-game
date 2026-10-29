import type { WorkspaceTab } from './workbench-navigation';

export interface WorkspaceSearchEntry {
  key: string; title: string; detail: string; tab: WorkspaceTab; entityId?: string;
}

export function searchWorkspace(entries: WorkspaceSearchEntry[], query: string): WorkspaceSearchEntry[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return entries.filter(entry => terms.every(term => `${entry.title} ${entry.detail}`.toLocaleLowerCase().includes(term))).slice(0, 30);
}

export type JobFilter = 'all' | 'active' | 'review' | 'failed' | 'done';
export function matchesJobFilter(job: {status: string; productionBrief?: {title: string}; playerRole?: string; stage: string}, filter: JobFilter, query: string) {
  const statuses: Record<JobFilter, string[]> = {all: [], active: ['queued', 'running'], review: ['awaiting_review'], failed: ['failed', 'cancelled'], done: ['succeeded']};
  return (filter === 'all' || statuses[filter].includes(job.status)) &&
    `${job.productionBrief?.title ?? ''} ${job.playerRole ?? ''} ${job.stage}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
}

export interface AgentHandoff { label: string; prompt: string; worldId?: string }

export function draftSwitchIssue(currentId: string, nextId: string, dirty: boolean, busy: boolean): 'dirty' | 'busy' | null {
  if (currentId === nextId) return null;
  return busy ? 'busy' : dirty ? 'dirty' : null;
}
