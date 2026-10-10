import { timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
export interface HttpOptions {token: string; allowedOrigins: string[]; staticDir?: string}
export const localBoundary = (options: HttpOptions): RequestHandler => (req, res, next) => {
  let host = '';
  try {host = new URL(`http://${req.headers.host ?? ''}`).hostname;} catch {}
  if (!['localhost', '127.0.0.1', '[::1]'].includes(host) ||
    (req.headers.origin && !options.allowedOrigins.includes(req.headers.origin))) {
    res.status(403).json({error: {code: 'FORBIDDEN_ORIGIN', message: '仅允许已配置的本地工作台来源'}}); return;
  }
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'");
  next();
};
export const authenticate = (token: string): RequestHandler => (req, res, next) => {
  const received = Buffer.from(req.headers.authorization ?? '');
  const expected = Buffer.from(`Bearer ${token}`);
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    res.status(401).json({error: {code: 'UNAUTHORIZED', message: '请输入正确的工作台访问码（不是模型 API Key）'}}); return;
  }
  res.setHeader('Cache-Control', 'no-store');
  next();
};
