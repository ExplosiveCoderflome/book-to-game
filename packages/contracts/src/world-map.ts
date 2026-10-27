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
});

export const worldMapSchema = z.object({
  mapSchemaVersion: z.literal(WORLD_MAP_SCHEMA_VERSION),
  geometry: worldMapGeometrySchema,
  /** Reserved layer bag (terrain/factions arrive in M2/M3); sparse by cell key. */
  layers: z.object({}).default({}),
  pois: z.array(worldMapPoiSchema).max(200),
});

export type HexGeometry = z.infer<typeof hexGeometrySchema>;
export type WorldMapGeometry = z.infer<typeof worldMapGeometrySchema>;
export type WorldMapPoi = z.infer<typeof worldMapPoiSchema>;
export type WorldMap = z.infer<typeof worldMapSchema>;
