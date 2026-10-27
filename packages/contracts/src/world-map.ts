import { z } from 'zod';

/**
 * Optional world map layer (M1: hex geometry + POIs). Authoring/spatial metadata only:
 * movement truth stays on the location graph (actions with `move` effects).
 * Absent `map` = world behaves exactly as before.
 */
export const WORLD_MAP_SCHEMA_VERSION = 1 as const;
export const WORLD_MAP_MAX_COLS = 64;
export const WORLD_MAP_MAX_ROWS = 48;

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
/** Axial hex cell key: "q,r". */
export const cellKeySchema = z.string().regex(/^-?\d{1,3},-?\d{1,3}$/, '格键必须为 "q,r"');
export type CellKey = z.infer<typeof cellKeySchema>;

export const hexGeometrySchema = z.object({
  kind: z.literal('hex'),
  orientation: z.enum(['pointy', 'flat']),
  cols: z.number().int().min(1).max(WORLD_MAP_MAX_COLS),
  rows: z.number().int().min(1).max(WORLD_MAP_MAX_ROWS),
  size: z.number().finite().min(8).max(128),
});
/** Discriminated by `kind`; voronoi/image land in later phases. */
export const worldMapGeometrySchema = z.discriminatedUnion('kind', [hexGeometrySchema]);

export const worldMapPoiSchema = z.object({
  locationId: id,
  anchor: z.object({ cell: cellKeySchema }),
  label: z.string().min(1).max(120).optional(),
  /** Optional venue/POI type id (e.g. hospital, safehouse); must exist in map.venueTypes. Authoring metadata. */
  venueType: id.optional(),
});
/** Venue/POI type vocabulary (author-defined; templates may seed it). */
export const venueTypeSchema = z.object({ id, label: z.string().min(1).max(60), tags: z.array(z.string().min(1).max(40)).max(10).optional() });

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, '颜色须为 #rrggbb');
/** Terrain layer (M2): palette + sparse cell→terrain id. Purely descriptive until rule kinds use it. */
export const terrainLayerSchema = z.object({
  palette: z.array(z.object({ id, label: z.string().min(1).max(60), color, tags: z.array(z.string().min(1).max(40)).max(10).optional() })).max(64),
  cells: z.record(cellKeySchema, id),
});
/** Faction layer (M3): factions + sparse cell→faction id (authored baseline; session overlays come later). */
export const factionLayerSchema = z.object({
  factions: z.array(z.object({ id, name: z.string().min(1).max(80), color, description: z.string().max(1000).optional(),
    /** Faction stats are ordinary world resources (shared numeric substrate): label → resource id. */
    stats: z.array(z.object({ label: z.string().min(1).max(40), resourceId: id })).max(12).optional() })).max(32),
  cells: z.record(cellKeySchema, id),
});

/** Region / district layer (city-map step 1): named areas, sparse cell→region id (one region per cell). */
export const regionLayerSchema = z.object({
  regions: z.array(z.object({ id, name: z.string().min(1).max(80), color, tags: z.array(z.string().min(1).max(40)).max(10).optional() })).max(64),
  cells: z.record(cellKeySchema, id),
});

/**
 * Map grid kind. Only 'hex' today; future kinds (square / vector / image) add a geometry schema here,
 * a GeometryAdapter in @novel-game/rules and an editor in the web map-kind registry. Rules never branch on it.
 */
export const WORLD_MAP_KINDS = ['hex'] as const;
export type WorldMapKind = (typeof WORLD_MAP_KINDS)[number];

export const worldMapSchema = z.object({
  /** Map id. Optional for the root map (implicit "root"); required on sub-maps. */
  id: id.optional(),
  name: z.string().min(1).max(80).optional(),
  /** Sub-map link: the location (on the parent map) that owns this map. */
  parent: z.object({ mapId: id, locationId: id }).optional(),
  mapSchemaVersion: z.literal(WORLD_MAP_SCHEMA_VERSION),
  geometry: worldMapGeometrySchema,
  /** Optional layers, all sparse by cell key; absent layer = not authored. */
  layers: z.object({ terrain: terrainLayerSchema.optional(), factions: factionLayerSchema.optional(), regions: regionLayerSchema.optional() }).default({}),
  pois: z.array(worldMapPoiSchema).max(200),
  venueTypes: z.array(venueTypeSchema).max(64).optional(),
  /** Authoring metadata: which genre map template seeded this map (never read by rules). */
  /** Play-time fog of war: only explored cells (visited locations + radius 1) are revealed. Session-only state. */
  fog: z.boolean().optional(),
  mapTemplate: z.object({ mapTemplateId: z.string().min(1).max(40), mapTemplateVersion: z.number().int().positive() }).optional(),
});

export type HexGeometry = z.infer<typeof hexGeometrySchema>;
export type WorldMapGeometry = z.infer<typeof worldMapGeometrySchema>;
export type WorldMapPoi = z.infer<typeof worldMapPoiSchema>;
export type WorldMap = z.infer<typeof worldMapSchema>;
export type TerrainLayer = z.infer<typeof terrainLayerSchema>;
export type FactionLayer = z.infer<typeof factionLayerSchema>;
export type VenueType = z.infer<typeof venueTypeSchema>;
export type RegionLayer = z.infer<typeof regionLayerSchema>;

/** Port for future image-generation adapters (AI layer). Input is the deterministic prompt + schematic reference. */
export interface MapImageRequest { prompt: string; schematicSvg?: string; width: number; height: number; seed?: number }
export interface MapImageResult { mimeType: 'image/png' | 'image/webp' | 'image/jpeg'; data: Uint8Array; provider: string; revisedPrompt?: string }
export interface MapImageProvider { readonly id: string; generate(req: MapImageRequest): Promise<MapImageResult> }
