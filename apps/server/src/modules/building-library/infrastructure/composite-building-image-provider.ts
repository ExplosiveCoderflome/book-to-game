import type { BuildingImageProvider, BuildingImageRequest, BuildingImageResult } from '@novel-game/contracts';
import { SvgBuildingImageProvider } from './svg-building-image-provider.js';

/**
 * Tries preferred providers in order; always ends with deterministic SVG.
 * Records which provider produced the result via result.provider.
 */
export class CompositeBuildingImageProvider implements BuildingImageProvider {
  readonly id = 'composite';
  private readonly fallback = new SvgBuildingImageProvider();

  constructor(private readonly preferred: BuildingImageProvider[] = []) {}

  async generate(req: BuildingImageRequest): Promise<BuildingImageResult> {
    const errors: string[] = [];
    for (const p of this.preferred) {
      try {
        return await p.generate(req);
      } catch (e) {
        errors.push(`${p.id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    const svg = await this.fallback.generate(req);
    if (errors.length) {
      return {
        ...svg,
        revisedPrompt: [
          svg.revisedPrompt ?? req.prompt,
          `[fallback after: ${errors.map(e => e.slice(0, 120)).join(' | ')}]`,
        ].join(' '),
      };
    }
    return svg;
  }
}
