import type { BuildingImageProvider } from '@novel-game/contracts';
import { CompositeBuildingImageProvider } from './composite-building-image-provider.js';
import { OpenAiCompatBuildingImageProvider } from './openai-compat-building-image-provider.js';
import { SvgBuildingImageProvider } from './svg-building-image-provider.js';

/**
 * Wire image providers from env.
 * - IMAGE_MODEL set → try OpenAI-compat `/images/generations` first (xkrelay / OpenAI / local).
 * - Always fall back to deterministic SVG illustrator.
 * Probe (2026-10-28): xkrelay.com/v1 lists only gemini chat models; images/* returns model_not_found —
 * so without IMAGE_MODEL the SVG path is the honest default.
 */
export function createBuildingImageProvider(env: NodeJS.ProcessEnv = process.env): {
  provider: BuildingImageProvider;
  svg: BuildingImageProvider;
} {
  const svg = new SvgBuildingImageProvider();
  const preferred: BuildingImageProvider[] = [];
  const model = env.IMAGE_MODEL?.trim();
  const baseUrl = (env.IMAGE_BASE_URL || env.LLM_BASE_URL || '').trim();
  const apiKey = (env.IMAGE_API_KEY || env.LLM_API_KEY || '').trim();
  if (model && baseUrl && apiKey) {
    preferred.push(new OpenAiCompatBuildingImageProvider({
      baseUrl, apiKey, model,
      timeoutMs: Number(env.IMAGE_TIMEOUT_MS || 90_000) || 90_000,
      size: (env.IMAGE_SIZE as '256x256' | '512x512' | '1024x1024' | undefined) || '512x512',
    }));
  }
  return { provider: new CompositeBuildingImageProvider(preferred), svg };
}
