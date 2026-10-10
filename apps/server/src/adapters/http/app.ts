import express from 'express';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Workbench } from '../../app/workbench.js';
import { createCommands } from '../../app/commands/index.js';
import { mcpRouter } from '../mcp/router.js';
import { errorResponse } from '../errors.js';
import { apiRouter } from './routes.js';
import { authenticate, localBoundary, type HttpOptions } from './security.js';
import { requestLogger } from './request-logger.js';

export function createApp(workbench: Workbench, options: HttpOptions) {
  const app = express();
  app.disable('x-powered-by');
  app.use(requestLogger(options.logger));
  app.use(localBoundary(options));
  app.get('/health', (_req, res) => {res.json({status: 'ok', version: '0.1.0'});});
  const commands = createCommands(workbench);
  app.use('/api', express.json({limit: '8mb'}));
  app.use('/api', apiRouter(commands));
  app.use('/mcp', authenticate(options.token), express.json({limit: '8mb'}));
  app.use('/mcp', mcpRouter(commands));
  if (options.staticDir && existsSync(options.staticDir)) {
    app.use(express.static(options.staticDir, {index: 'index.html'}));
    app.get('/', (_req, res) => res.sendFile(path.join(options.staticDir!, 'index.html')));
  }
  app.use((_req, res) => {res.status(404).json({error: {code: 'NOT_FOUND', message: '接口不存在'}});});
  const handler: express.ErrorRequestHandler = (error, req, res, _next) => {
    const response = errorResponse(error);
    const requestId = typeof res.locals.requestId === 'string' ? res.locals.requestId : undefined;
    const body = requestId ? {...response.body, error: {...response.body.error, requestId}} : response.body;
    options.logger?.error('http.error', {
      requestId, method: req.method, path: req.path, status: response.status,
      code: response.body.error.code, message: response.body.error.message.slice(0, 500),
    });
    res.status(response.status).json(body);
  };
  app.use(handler);
  return app;
}
