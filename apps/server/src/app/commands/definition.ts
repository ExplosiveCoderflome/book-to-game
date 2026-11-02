import { z } from 'zod';
export interface Command {
  name: string; description: string; inputSchema: z.ZodObject; readOnly: boolean;
  /** Author confirmation policy. Defaults to `auto` for readOnly commands and `confirm` otherwise. */
  confirmation: 'auto' | 'confirm';
  /** Coarse risk label. Defaults to `read` for readOnly commands and `write` otherwise. */
  risk: 'read' | 'write';
  execute(input: unknown): unknown;
}
export interface CommandOptions {
  /** Override the default confirmation derived from readOnly. */
  confirmation?: 'auto' | 'confirm';
  /** Override the default risk derived from readOnly. */
  risk?: 'read' | 'write';
}
export function command<T extends z.ZodRawShape>(name: string, description: string, schema: z.ZodObject<T>,
  readOnly: boolean, run: (input: z.infer<z.ZodObject<T>>) => unknown, options: CommandOptions = {}): Command {
  return {
    name, description, inputSchema: schema, readOnly,
    confirmation: options.confirmation ?? (readOnly ? 'auto' : 'confirm'),
    risk: options.risk ?? (readOnly ? 'read' : 'write'),
    execute: input => run(schema.parse(input)),
  };
}
export const idSchema = z.object({id: z.string().min(1)});
export const emptySchema = z.object({});
