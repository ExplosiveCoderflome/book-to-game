import { ZodError } from 'zod';
import { AppError } from '../shared/errors.js';
export function errorResponse(error: unknown) {
  if (error instanceof AppError) return {status: error.status, body: {error: {code: error.code, message: error.message, ...(error.details ? {details: error.details} : {})}}};
  if (error instanceof ZodError) {
    const issues = error.issues.map(issue => ({path: issue.path, message: chineseIssue(issue.code, issue.message)}));
    const summary = issues.slice(0, 3).map(issue => `${issue.path.join('.') || '根字段'}：${issue.message}`).join('；');
    return {status: 400, body: {error: {code: 'INVALID_INPUT', message: `输入不符合接口结构${summary ? `：${summary}` : ''}`, details: issues}}};
  }
  const bodyError = error as {type?: string};
  if (bodyError?.type === 'entity.too.large') return {status: 413, body: {error: {code: 'PAYLOAD_TOO_LARGE', message: '请求内容超过大小限制'}}};
  if (bodyError?.type === 'entity.parse.failed') return {status: 400, body: {error: {code: 'INVALID_JSON', message: '请求必须是有效的 JSON'}}};
  return {status: 500, body: {error: {code: 'INTERNAL_ERROR', message: '操作失败，请检查本地服务状态后重试'}}};
}

function chineseIssue(code: string, original: string): string {
  if (/[一-鿿]/.test(original)) return original;
  const messages: Record<string, string> = {
    invalid_type: '类型不正确或缺少必填字段', too_small: '小于允许的最小值、长度或数量',
    too_big: '超过允许的最大值、长度或数量', invalid_format: '格式不正确',
    invalid_enum_value: '不在允许的选项中', invalid_union: '不符合任何允许的结构',
    unrecognized_keys: '包含未允许的字段', custom: '未通过字段约束',
  };
  return messages[code] ?? '字段值不合法';
}
