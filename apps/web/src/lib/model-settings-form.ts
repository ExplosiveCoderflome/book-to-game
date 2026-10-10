import { modelListInputSchema, modelSettingsInputSchema, type ModelListInput, type ModelSettingsInput } from '@novel-game/contracts';
export interface ModelSettingsFields {
  baseUrl: string; model: string; timeoutSeconds: string; apiKey: string; clearApiKey: boolean;
}
export function settingsInput(fields: ModelSettingsFields, expectedRevision: number): ModelSettingsInput {
  return modelSettingsInputSchema.parse({
    baseUrl: fields.baseUrl, model: fields.model, timeoutMs: Number(fields.timeoutSeconds) * 1000,
    expectedRevision, clearApiKey: fields.clearApiKey,
    ...(fields.apiKey.trim() ? {apiKey: fields.apiKey.trim()} : {}),
  });
}
export function modelListInput(fields: ModelSettingsFields, expectedRevision: number): ModelListInput {
  return modelListInputSchema.parse({
    baseUrl: fields.baseUrl, timeoutMs: Number(fields.timeoutSeconds) * 1000,
    expectedRevision, clearApiKey: fields.clearApiKey,
    ...(fields.apiKey.trim() ? {apiKey: fields.apiKey.trim()} : {}),
  });
}
