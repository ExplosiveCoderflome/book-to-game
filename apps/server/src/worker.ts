import { setTimeout as wait } from 'node:timers/promises';
import { createWorkbench } from './app/workbench.js';
import { loadConfig } from './platform/config.js';
import { openDatabase } from './platform/database.js';
import { ChatCompletionsProvider } from './platform/model/chat-completions.js';
import { createModelSettings } from './platform/create-model-settings.js';
import { createLogger } from './platform/logger.js';

const config = loadConfig();
const db = openDatabase(config.databasePath);
const settings = createModelSettings(db, config.dataDir, config.provider);
const logger = createLogger(config.dataDir, 'worker');
const workbench = createWorkbench(db, settings, logger);
const shutdown = new AbortController();
process.on('SIGINT', () => shutdown.abort()); process.on('SIGTERM', () => shutdown.abort());
logger.info('worker.started');
console.log('生成 worker 已启动；将自动读取工作台保存的模型配置，无需重启。');
try {
  while (!shutdown.signal.aborted) {
    try {
      // Each execution uses one configuration snapshot; the next run sees saved changes.
      const worked = settings.get().configured && await workbench
        .createRunner(new ChatCompletionsProvider(settings.resolve(), logger)).runOnce(shutdown.signal);
      if (!worked) await wait(1000, undefined, {signal: shutdown.signal});
    } catch (error) {
      if (!shutdown.signal.aborted) {
        logger.error('worker.loop_failed', {code: error instanceof Error ? error.name : 'UNEXPECTED_ERROR', message: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500)});
        console.error('worker 暂时不可用，2 秒后重试；已有任务断点已保留。');
        await wait(2000, undefined, {signal: shutdown.signal}).catch(() => {});
      }
    }
  }
} finally {logger.info('worker.stopped'); db.close();}
