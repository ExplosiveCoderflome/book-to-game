import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import type { Logger } from '../../shared/logger.js';

const requestIdPattern = /^[A-Za-z0-9._:-]{1,100}$/;

export function requestLogger(logger?: Logger): RequestHandler {
  return (req, res, next) => {
    const supplied = req.get('x-request-id');
    const requestId = supplied && requestIdPattern.test(supplied) ? supplied : randomUUID();
    const started = performance.now();
    let recorded = false;
    res.locals.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);
    const record = (outcome: 'completed' | 'aborted') => {
      if (recorded) return;
      recorded = true;
      logger?.info('http.request', {
        requestId, method: req.method, path: req.path, status: outcome === 'completed' ? res.statusCode : 499,
        outcome, durationMs: Math.round((performance.now() - started) * 100) / 100,
      });
    };
    res.once('finish', () => record('completed'));
    res.once('close', () => record('aborted'));
    next();
  };
}
