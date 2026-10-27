import { ZodError } from 'zod';

export interface SchemaIssue {path: string; message: string}

export function schemaIssues(error: ZodError): SchemaIssue[] {
  return error.issues.slice(0, 8).map(issue => ({
    path: issue.path.length ? issue.path.map(part => String(part)).join('.') : '(root)',
    message: issue.message.slice(0, 240),
  }));
}

export function schemaIssueMessage(issues: SchemaIssue[]): string {
  if (!issues.length) return '模型输出不符合约定结构';
  return `模型输出不符合约定结构：${issues.map(issue => `${issue.path}: ${issue.message}`).join('；')}`;
}
