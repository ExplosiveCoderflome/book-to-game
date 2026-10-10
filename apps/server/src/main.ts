import path from 'node:path';
import { createApp } from './adapters/http/app.js';
import { createWorkbench } from './app/workbench.js';
import { loadAccessToken, loadConfig } from './platform/config.js';
import { openDatabase } from './platform/database.js';
import { createModelSettings } from './platform/create-model-settings.js';
import { createLogger } from './platform/logger.js';

const config = loadConfig();
const logger = createLogger(config.dataDir, 'api');
const db = openDatabase(config.databasePath);
const workbench = createWorkbench(db, createModelSettings(db, config.dataDir, config.provider));
const token = loadAccessToken(config.dataDir, process.env.APP_ACCESS_TOKEN);
const app = createApp(workbench, {token, allowedOrigins: config.allowedOrigins, staticDir: path.resolve('apps/web/dist'), logger});
const server = app.listen(config.port, '127.0.0.1', () => {
  logger.info('server.started', {port: config.port, mcpPath: `/mcp`});
  console.log(`小说游戏工作台: http://127.0.0.1:${config.port}`);
  console.log(`MCP: http://127.0.0.1:${config.port}/mcp`);
  console.log(process.env.APP_ACCESS_TOKEN ? '工作台访问码来自 APP_ACCESS_TOKEN' : `工作台访问码文件: ${path.join(config.dataDir, 'access-token.txt')}`);
  console.log(`模型${workbench.providerConfigured ? '已配置' : '未配置，请进入网页“模型设置”'}。生成任务需要同时运行 worker。`);
});
server.on('error', error => {logger.error('server.error', {message: error.message}); console.error('服务启动失败:', error.message); db.close(); process.exitCode = 1;});
let closing = false;
const shutdown = () => {
  if (closing) return; closing = true;
  logger.info('server.stopping');
  server.close(() => db.close()); server.closeIdleConnections();
};
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
