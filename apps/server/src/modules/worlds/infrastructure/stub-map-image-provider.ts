import type { MapImageProvider, MapImageRequest, MapImageResult } from '@novel-game/contracts';

/** Placeholder adapter: real image-gen APIs plug in behind MapImageProvider. Not wired to any route yet. */
export class StubMapImageProvider implements MapImageProvider {
  readonly id = 'stub';
  async generate(_req: MapImageRequest): Promise<MapImageResult> {
    throw new Error('地图图片生成尚未接入：请配置实现 MapImageProvider 的图片生成适配器');
  }
}
