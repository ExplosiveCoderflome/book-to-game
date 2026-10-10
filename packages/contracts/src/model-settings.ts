import { z } from 'zod';

export const modelSettingsInputSchema = z.object({
  baseUrl: z.string().trim().min(1).max(2000),
  model: z.string().trim().min(1, '请填写模型名称').max(200),
  timeoutMs: z.number().int().min(1000).max(300000),
  apiKey: z.string().trim().max(8192).optional(),
  clearApiKey: z.boolean().optional(),
  expectedRevision: z.number().int().nonnegative(),
}).refine(input => !(input.apiKey && input.clearApiKey), {message: '填写新密钥与清除密钥不能同时选择'});
export type ModelSettingsInput = z.infer<typeof modelSettingsInputSchema>;
export const modelListInputSchema = z.object({
  baseUrl: z.string().trim().min(1).max(2000),
  timeoutMs: z.number().int().min(1000).max(300000),
  apiKey: z.string().trim().max(8192).optional(),
  clearApiKey: z.boolean().optional(),
  expectedRevision: z.number().int().nonnegative(),
}).refine(input => !(input.apiKey && input.clearApiKey), {message: '填写新密钥与清除密钥不能同时选择'});
export type ModelListInput = z.infer<typeof modelListInputSchema>;
export interface ModelSettingsView {
  baseUrl: string; model: string; timeoutMs: number; hasApiKey: boolean;
  configured: boolean; revision: number; source: 'environment' | 'workspace';
}
export interface ModelConnectionResult {
  reachable: boolean; modelAvailable: boolean | null; models: string[]; message: string;
}
export interface ModelListResult {models: string[]; message: string}
