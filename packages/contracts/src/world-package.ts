import {z} from 'zod';

export const WORLD_PACKAGE_FORMAT = 'novel-game-world-package' as const;
export const WORLD_PACKAGE_SPEC = 1 as const;
export const worldPackageManifestSchema = z.object({
  format: z.literal(WORLD_PACKAGE_FORMAT), specVersion: z.literal(WORLD_PACKAGE_SPEC),
  target: z.literal('world-content-json'), selectionMode: z.enum(['explicit','inferred']),
  blocks: z.array(z.object({blockId: z.string().min(1).max(80), version: z.number().int().positive()}).strict()).max(512),
  // Preserve absent versus explicitly empty optional arrays without changing the world.
  collections: z.array(z.enum(['blockSelections', 'extensions'])).max(2),
  files: z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/)),
}).strict();
export const worldPackageSchema = z.object({
  manifest: worldPackageManifestSchema,
  files: z.record(z.string(), z.string().max(8 * 1024 * 1024)),
}).strict();
export type WorldPackageManifest = z.infer<typeof worldPackageManifestSchema>;
export type WorldPackage = z.infer<typeof worldPackageSchema>;
