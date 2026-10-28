import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { ModelLogEvent, ModelLogReader } from '../domain/ports.js';

/** Reads `<dataDir>/logs/{worker,api}-*.jsonl` for provenance tracing; keeps only the needed fields; re-reads when files change. */
export class JsonlModelLogReader implements ModelLogReader {
  private cache: {key: string; events: ModelLogEvent[]} | undefined;
  constructor(private readonly directory: string) {}
  events(): ModelLogEvent[] {
    if (!existsSync(this.directory)) return [];
    const files = readdirSync(this.directory).filter(f => /^(worker|api)-.*\.jsonl$/.test(f)).sort();
    const key = files.map(f => `${f}:${statSync(path.join(this.directory, f)).size}`).join('|');
    if (this.cache?.key === key) return this.cache.events;
    const events: ModelLogEvent[] = [];
    for (const f of files) for (const line of readFileSync(path.join(this.directory, f), 'utf8').split('\n')) {
      if (!line.includes('"generation.') && !line.includes('"model.')) continue;
      try {
        const d = JSON.parse(line) as Record<string, unknown>;
        if (typeof d.timestamp !== 'string' || typeof d.event !== 'string') continue;
        events.push({timestamp: d.timestamp, event: d.event, ...(typeof d.pid === 'number' ? {pid: d.pid} : {}),
          ...(typeof d.jobId === 'string' ? {jobId: d.jobId} : {}), ...(typeof d.model === 'string' ? {model: d.model} : {})});
      } catch { /* torn line */ }
    }
    events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    this.cache = {key, events}; return events;
  }
}
