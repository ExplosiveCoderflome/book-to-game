import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import type { LogFields, Logger } from '../shared/logger.js';

type Level = 'info' | 'warn' | 'error';

export class JsonlLogger implements Logger {
  constructor(private readonly directory: string, private readonly component: string) {
    mkdirSync(directory, {recursive: true});
  }

  info(event: string, fields?: LogFields): void { this.write('info', event, fields); }
  warn(event: string, fields?: LogFields): void { this.write('warn', event, fields); }
  error(event: string, fields?: LogFields): void { this.write('error', event, fields); }

  private write(level: Level, event: string, fields: LogFields = {}): void {
    const now = new Date();
    const record = {timestamp: now.toISOString(), level, component: this.component, event, pid: process.pid, ...fields};
    const filename = path.join(this.directory, `${this.component}-${now.toISOString().slice(0, 10)}.jsonl`);
    try {
      appendFileSync(filename, `${JSON.stringify(record)}\n`, 'utf8');
    } catch (error) {
      process.stderr.write(`[logger] unable to write ${filename}: ${error instanceof Error ? error.message : String(error)}\n`);
    }
  }
}

export function createLogger(dataDir: string, component: string): Logger {
  return new JsonlLogger(path.join(dataDir, 'logs'), component);
}
