import { ZodError } from 'zod';
import { AppError } from '../shared/errors.js';
export function errorResponse(error: unknown) {
  if (error instanceof AppError) return {status: error.status, body: {error: {code: error.code, message: error.message, ...(error.details ? {details: error.details} : {})}}};
  if (error instanceof ZodError) return {status: 400, body: {error: {code: 'INVALID_INPUT', message: '输入不符合接口结构', details: error.issues.map(i => ({path: i.path, message: i.message}))}}};
  const bodyError = error as {type?: string};
  if (bodyError?.type === 'entity.too.large') return {status: 413, body: {error: {code: 'PAYLOAD_TOO_LARGE', message: '请求内容超过大小限制'}}};
  if (bodyError?.type === 'entity.parse.failed') return {status: 400, body: {error: {code: 'INVALID_JSON', message: '请求必须是有效的 JSON'}}};
  return {status: 500, body: {error: {code: 'INTERNAL_ERROR', message: '操作失败，请检查本地服务状态后重试'}}};
}
