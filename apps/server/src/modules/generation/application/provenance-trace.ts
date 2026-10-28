/**
 * S1 ⑦ legacy provenance: drafts created before the runner stamped `provenance` carry no mark. Their generation run
 * can still be traced — first from the job record's `model` (recorded since S1), else from the worker/api JSONL logs:
 * the `model.request.*` lines written by the same process while that job was running. Only an unambiguous single
 * model counts; anything else is "untraced" and the caller falls back to the preflight text lint.
 */
import type { JobRepository, ModelLogEvent, ModelLogReader } from '../domain/ports.js';
import { isMockModel } from './runner.js';

export interface TracedProvenance {generator: 'mock' | 'llm'; model: string; source: 'backfill'}

export class ProvenanceTracer {
  constructor(private readonly jobs: Pick<JobRepository, 'list'>, private readonly logs?: ModelLogReader) {}

  /** Provenance of the generation run that produced `draftId` (story or world), or undefined when it cannot be traced. */
  trace(draftId: string): TracedProvenance | undefined {
    const runs = this.jobs.list().filter(j => j.draftId === draftId && j.status === 'succeeded');
    if (runs.length !== 1) return undefined;
    const job = runs[0]!;
    const model = job.model ?? this.modelFromLogs(job.id);
    return model ? {generator: isMockModel(model) ? 'mock' : 'llm', model: model.slice(0, 200), source: 'backfill'} : undefined;
  }

  private modelFromLogs(jobId: string): string | undefined {
    const events = this.logs?.events() ?? [];
    const own = events.filter(e => e.jobId === jobId);
    const done = own.filter(e => e.event === 'generation.succeeded').at(-1);
    if (!done) return undefined;
    // The successful attempt: from its last `generation.started` (same process) to `generation.succeeded`.
    const start = own.filter(e => e.event === 'generation.started' && e.pid === done.pid && e.timestamp <= done.timestamp).at(-1);
    if (!start) return undefined;
    const models = new Set(events.filter(e => e.model && e.pid === done.pid && e.event.startsWith('model.')
      && e.timestamp >= start.timestamp && e.timestamp <= done.timestamp).map(e => e.model!));
    return models.size === 1 ? [...models][0] : undefined;
  }
}
export type { ModelLogEvent };
