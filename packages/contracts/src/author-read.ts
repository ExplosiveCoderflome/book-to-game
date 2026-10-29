import { z } from 'zod';

/** Paths address JSON fields and zero-based array indexes, never host files. */
export const authorReadSchema = z.object({
  path: z.array(z.string().min(1).max(160)).max(16).optional(),
  offset: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).default(0),
  limit: z.number().int().min(1).max(10).default(5),
});
export type AuthorReadInput = z.infer<typeof authorReadSchema>;
