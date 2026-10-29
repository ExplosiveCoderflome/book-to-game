import { setTimeout as wait } from 'node:timers/promises';
import { createWorkbench } from './app/workbench.js';
import { loadConfig } from './platform/config.js';
import { openDatabase } from './platform/database.js';
import { createModelSettings } from './platform/create-model-settings.js';
import { createLogger } from './platform/logger.js';
import { AgentSupervisor } from './modules/agent/index.js';

/**
 * Tier A 监督 agent：独立进程，轮询任务并做监督、重试与质检。
 * 不调用模型，不批规划，不改写单元，不发布；审批权始终在人工手里。
 * 用法与 worker 相同：npx tsx apps/server/src/agent.ts（与 server 共用同一 SQLite）。
 */
const config = loadConfig();
const db = openDatabase(config.databasePath);
const settings = createModelSettings(db, config.dataDir, config.provider);
const logger = createLogger(config.dataDir, 'agent');
const workbench = createWorkbench(db, settings, logger, {repairAttempts: config.provider.repairAttempts ?? 3, dataDir: config.dataDir});
const supervisor = new AgentSupervisor({jobs: workbench.jobs, sources: workbench.sources, decisions: workbench.agentDecisions, logger});
const shutdown = new AbortController();
process.on('SIGINT', () => shutdown.abort()); process.on('SIGTERM', () => shutdown.abort());
logger.info('agent.started');
console.log('Agent 监督已启动；只做监督、重试与质检，不批规划、不改已发布内容。');
try {
  while (!shutdown.signal.aborted) {
    try {
      const report = supervisor.runOnce();
      if (report.acted) logger.info('agent.supervised', {acted: report.acted, actions: report.decisions.map(d => `${d.action}:${d.jobId.slice(0, 8)}`)});
    } catch (error) {
      if (!shutdown.signal.aborted) logger.error('agent.loop_failed', {message: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500)});
    }
    await wait(15000, undefined, {signal: shutdown.signal}).catch(() => {});
  }
} finally { logger.info('agent.stopped'); db.close(); }
