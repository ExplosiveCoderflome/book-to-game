import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  defaultBuildingImagePrompt,
  type BuildingAsset, type BuildingImageProvider, type BuildingImageRequest,
  type BuildingImageView, type BuildingLibraryView, type GenerateBuildingImageInput,
  type GenerateBuildingImagePreviewInput, type MapFillKind,
} from '@novel-game/contracts';
import { AppError } from '../../../shared/errors.js';
import type { BuildingLibraryService } from '../application/library-service.js';
import { hashSeed } from './svg-building-image-provider.js';

const EXT: Record<string, string> = {
  'image/svg+xml': 'svg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
};

export class BuildingImageService {
  constructor(
    private readonly library: BuildingLibraryService,
    private readonly provider: BuildingImageProvider,
    private readonly mediaDir: string,
    private readonly svgOnly?: BuildingImageProvider,
  ) {
    mkdirSync(mediaDir, { recursive: true });
  }

  async generateForAsset(input: GenerateBuildingImageInput): Promise<BuildingLibraryView & { image: BuildingImageView; asset: BuildingAsset }> {
    const current = this.library.get();
    if (input.expectedRevision !== current.revision) {
      throw new AppError('BUILDING_LIBRARY_CONFLICT', '建筑库已更新，请重新载入后再生成图片', 409);
    }
    const asset = current.library.assets.find(a => a.id === input.assetId);
    if (!asset) throw new AppError('BUILDING_NOT_FOUND', `建筑库中找不到资产：${input.assetId}`, 404);

    const prompt = input.prompt?.trim() || defaultBuildingImagePrompt({
      label: asset.label, kind: asset.kind, tags: asset.tags, blurb: asset.blurb,
    });
    const width = input.width ?? 512;
    const height = input.height ?? 512;
    const req: BuildingImageRequest = {
      prompt, label: asset.label, kind: asset.kind, tags: asset.tags, color: asset.color,
      icon: asset.icon, width, height, seed: hashSeed([asset.id, asset.label, asset.kind]),
    };
    const provider = input.preferSvg && this.svgOnly ? this.svgOnly : this.provider;
    const result = await provider.generate(req);
    const image = this.persist(asset.id, result, prompt);
    const view = this.library.updateAsset(asset.id, {
      imageUrl: image.imageUrl,
      imagePath: image.imagePath,
      imageProvider: image.imageProvider,
      imagePrompt: image.revisedPrompt ?? prompt,
      version: asset.version,
    }, input.expectedRevision);
    const updated = view.library.assets.find(a => a.id === asset.id)!;
    return { ...view, image, asset: updated };
  }

  async preview(input: GenerateBuildingImagePreviewInput): Promise<BuildingImageView> {
    const prompt = input.prompt?.trim() || defaultBuildingImagePrompt({
      label: input.label, kind: input.kind as MapFillKind, tags: input.tags, blurb: input.blurb,
    });
    const width = input.width ?? 384;
    const height = input.height ?? 384;
    const req: BuildingImageRequest = {
      prompt, label: input.label, kind: input.kind, tags: input.tags, color: input.color,
      icon: input.icon, width, height,
      seed: input.seed ?? hashSeed([input.label, input.kind, ...(input.tags ?? [])]),
    };
    const provider = input.preferSvg && this.svgOnly ? this.svgOnly : this.provider;
    const result = await provider.generate(req);
    return this.persist(`preview_${hashSeed([input.label, input.kind]).toString(16)}`, result, prompt, true);
  }

  private persist(
    idHint: string,
    result: { mimeType: string; data: Uint8Array; provider: string; revisedPrompt?: string },
    prompt: string,
    preview = false,
  ): BuildingImageView {
    const ext = EXT[result.mimeType] ?? 'bin';
    const safe = idHint.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60) || 'building';
    const stamp = preview ? `p${Date.now().toString(36)}` : Date.now().toString(36);
    const fileName = `${safe}-${stamp}.${ext}`;
    writeFileSync(path.join(this.mediaDir, fileName), result.data, { mode: 0o644 });
    const imagePath = path.posix.join('building-images', fileName);
    const publicUrl = `/media/building-images/${fileName}`;

    // SVG is small — embed as data URL so cards render without depending on /media proxy.
    // Raster stays as /media file URL (and we still write the file for download).
    let imageUrl = publicUrl;
    if (result.mimeType === 'image/svg+xml') {
      const text = new TextDecoder().decode(result.data);
      imageUrl = `data:image/svg+xml;utf8,${encodeURIComponent(text)}`;
    }

    const view: BuildingImageView = {
      imageUrl,
      imagePath,
      imageProvider: result.provider,
      mimeType: result.mimeType as BuildingImageView['mimeType'],
    };
    if (result.revisedPrompt ?? prompt) view.revisedPrompt = (result.revisedPrompt ?? prompt).slice(0, 2000);
    return view;
  }
}
