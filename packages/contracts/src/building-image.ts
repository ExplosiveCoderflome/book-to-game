import { z } from 'zod';
import { mapFillKindSchema, type MapFillKind } from './world-map.js';

/**
 * Port for building portrait / icon image generation (AI adapters layer).
 * Same seam pattern as MapImageProvider — UI / catalog never call vendors directly.
 * Display-only: never mutates play/session/rules state.
 */
export interface BuildingImageRequest {
  /** Short English or bilingual prompt describing the building. */
  prompt: string;
  label: string;
  kind: MapFillKind;
  tags?: string[];
  color?: string;
  /** Optional icon / emoji hint for the SVG illustrator. */
  icon?: string;
  width: number;
  height: number;
  /** Deterministic seed for SVG fallback / reproducible placeholders. */
  seed?: number;
}

export interface BuildingImageResult {
  mimeType: 'image/svg+xml' | 'image/png' | 'image/webp' | 'image/jpeg';
  data: Uint8Array;
  provider: string;
  revisedPrompt?: string;
}

export interface BuildingImageProvider {
  readonly id: string;
  generate(req: BuildingImageRequest): Promise<BuildingImageResult>;
}

export const generateBuildingImageInputSchema = z.object({
  assetId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
  expectedRevision: z.number().int().nonnegative(),
  /** Optional override prompt; default derived from label/kind/tags. */
  prompt: z.string().trim().min(1).max(2000).optional(),
  width: z.number().int().min(128).max(1024).optional(),
  height: z.number().int().min(128).max(1024).optional(),
  /** Force SVG illustrator even if an API provider is configured. */
  preferSvg: z.boolean().optional(),
});
export type GenerateBuildingImageInput = z.infer<typeof generateBuildingImageInputSchema>;

export const generateBuildingImagePreviewInputSchema = z.object({
  label: z.string().trim().min(1).max(80),
  kind: mapFillKindSchema,
  tags: z.array(z.string().min(1).max(40)).max(16).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  icon: z.string().min(1).max(40).optional(),
  blurb: z.string().max(500).optional(),
  prompt: z.string().trim().min(1).max(2000).optional(),
  width: z.number().int().min(128).max(1024).optional(),
  height: z.number().int().min(128).max(1024).optional(),
  preferSvg: z.boolean().optional(),
  seed: z.number().int().optional(),
});
export type GenerateBuildingImagePreviewInput = z.infer<typeof generateBuildingImagePreviewInputSchema>;

export const buildingImageViewSchema = z.object({
  imageUrl: z.string().min(1).max(200_000),
  imagePath: z.string().min(1).max(260).optional(),
  imageProvider: z.string().min(1).max(80),
  mimeType: z.enum(['image/svg+xml', 'image/png', 'image/webp', 'image/jpeg']),
  revisedPrompt: z.string().max(2000).optional(),
});
export type BuildingImageView = z.infer<typeof buildingImageViewSchema>;

/** Build a default bilingual-leaning prompt for image models / illustrator. */
export function defaultBuildingImagePrompt(input: {
  label: string;
  kind: MapFillKind;
  tags?: string[];
  blurb?: string;
}): string {
  const kindEn: Record<MapFillKind, string> = {
    shop: 'shop storefront',
    supply: 'supply depot / rest stop',
    quest: 'quest board / notice post',
    encounter: 'wilderness encounter site',
    boss: 'boss lair landmark',
  };
  const tags = (input.tags ?? []).slice(0, 6).join(', ');
  const blurb = input.blurb?.trim() ? ` Mood: ${input.blurb.trim().slice(0, 120)}.` : '';
  return [
    `Game building portrait icon, ${kindEn[input.kind]}, named "${input.label}".`,
    tags ? `Tags: ${tags}.` : '',
    blurb,
    'Clean readable silhouette, soft flat illustration, no text overlay, square composition.',
  ].filter(Boolean).join(' ');
}
