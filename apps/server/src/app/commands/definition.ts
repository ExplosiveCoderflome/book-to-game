import { z } from 'zod';
export interface Command {
  name: string; description: string; inputSchema: z.ZodObject; readOnly: boolean;
  execute(input: unknown): unknown;
}
export function command<T extends z.ZodRawShape>(name: string, description: string, schema: z.ZodObject<T>,
  readOnly: boolean, run: (input: z.infer<z.ZodObject<T>>) => unknown): Command {
  return {name, description, inputSchema: schema, readOnly, execute: input => run(schema.parse(input))};
}
export const idSchema = z.object({id: z.string().min(1)});
export const emptySchema = z.object({});
