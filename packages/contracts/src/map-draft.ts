import { z } from 'zod';

/**
 * AI "extract map draft from novel" (P5). The model only proposes; output is a draft diff the author reviews.
 * Spatial placement is NOT trusted from the model: it gives relative directions, rules place deterministically.
 */
export const MAP_DIRECTIONS = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw', 'inside', 'near'] as const;
const name = z.string().trim().min(1).max(80);
export const mapDraftModelOutputSchema = z.object({
  locations: z.array(z.object({
    name, description: z.string().max(600).default(''),
    /** Anchor: another proposed or existing location name. Absent = placed around the map centre. */
    relativeTo: name.optional(), direction: z.enum(MAP_DIRECTIONS).optional(), distance: z.number().int().min(1).max(8).optional(),
    faction: name.optional(), terrain: z.string().max(40).optional(),
  })).max(24).default([]),
  factions: z.array(z.object({ name, description: z.string().max(400).optional() })).max(12).default([]),
  npcs: z.array(z.object({ name, description: z.string().max(600).default(''), location: name, faction: name.optional() })).max(24).default([]),
  routes: z.array(z.object({ from: name, to: name })).max(60).default([]),
});
export type MapDraftModelOutput = z.infer<typeof mapDraftModelOutputSchema>;

export const extractMapDraftInputSchema = z.object({
  /** Novel excerpt; when absent the server uses the draft's source chapters. */
  text: z.string().max(40_000).optional(),
  chapterIds: z.array(z.string().min(1).max(120)).max(50).optional(),
});
export type ExtractMapDraftInput = z.infer<typeof extractMapDraftInputSchema>;

export type MapDraftItem =
  | { id: string; kind: 'faction'; label: string; faction: { id: string; name: string; color: string; description?: string } }
  | { id: string; kind: 'location'; label: string; location: { id: string; title: string; text: string }; cell: string; factionId?: string; existing: boolean; anchor?: string }
  | { id: string; kind: 'npc'; label: string; npc: { id: string; name: string; description: string; locationId: string; factionId?: string } }
  | { id: string; kind: 'route'; label: string; from: string; to: string };
export interface MapDraftDiff { items: MapDraftItem[]; warnings: string[]; model?: string }
