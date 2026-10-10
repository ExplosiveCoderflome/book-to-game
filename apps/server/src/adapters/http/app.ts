import express from 'express';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Workbench } from '../../app/workbench.js';
import { createCommands } from '../../app/commands/index.js';
import { mcpRouter } from '../mcp/router.js';
import { errorResponse } from '../errors.js';
import { apiRouter } from './routes.js';
import { authenticate, localBoundary, type HttpOptions } from './security.js';

export function createApp(workbench: Workbench, options: HttpOptions) {
  const app = express();
  app.disable('x-powered-by');
  app.use(localBoundary(options));
  app.get('/health', (_req, res) => {res.json({status: 'ok', version: '0.1.0'});});
  const commands = createCommands(workbench);
  app.use(['/api', '/mcp'], authenticate(options.token), express.json({limit: '8mb'}));
  app.use('/api', apiRouter(commands));
  app.use('/mcp', mcpRouter(commands));
  if (options.staticDir && existsSync(options.staticDir)) {
    app.use(express.static(options.staticDir, {index: 'index.html'}));
    app.get('/', (_req, res) => res.sendFile(path.join(options.staticDir!, 'index.html')));
  }
  app.use((_req, res) => {res.status(404).json({error: {code: 'NOT_FOUND', message: '接口不存在'}});});
  const handler: express.ErrorRequestHandler = (error, _req, res, _next) => {
    const response = errorResponse(error); res.status(response.status).json(response.body);
  };
  app.use(handler);
  return app;
}
