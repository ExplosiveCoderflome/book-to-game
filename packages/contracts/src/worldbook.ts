import { z } from 'zod';

const variableNameSchema = z.string().min(1).max(80);
const tagSchema = z.string().min(1).max(40);

/** Soft lore vs hard rule / power / upgrade systems. */
export const worldbookEntryKindSchema = z.enum(['lore', 'rule', 'power', 'upgrade']);
export type WorldbookEntryKind = z.infer<typeof worldbookEntryKindSchema>;

export const worldbookScopeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('global') }),
  z.object({
    type: z.literal('scenes'),
    sceneIds: z.array(z.string().min(1).max(80)).min(1).max(50),
  }),
]);
export type WorldbookScope = z.infer<typeof worldbookScopeSchema>;

/**
 * Hard constraints enforced by the rules engine (not prompt-only).
 * - forbid_choice_tags: hide/block choices carrying these tags while entry is in scope
 * - gate_tagged_choices: choices with tags require a numeric variable range
 * - cap_variable_increment: clamp variable.increment deltas when applying effects
 */
export const worldbookConstraintSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('forbid_choice_tags'),
    tags: z.array(tagSchema).min(1).max(20),
    message: z.string().min(1).max(300),
  }),
  z.object({
    type: z.literal('gate_tagged_choices'),
    tags: z.array(tagSchema).min(1).max(20),
    variable: variableNameSchema,
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
    message: z.string().min(1).max(300),
  }),
  z.object({
    type: z.literal('cap_variable_increment'),
    variable: variableNameSchema,
    maxDelta: z.number().finite().positive(),
    message: z.string().min(1).max(300).optional(),
  }),
]);
export type WorldbookConstraint = z.infer<typeof worldbookConstraintSchema>;

export const worldbookEntrySchema = z.object({
  id: z.string().min(1).max(80),
  title: z.string().min(1).max(200),
  keys: z.array(z.string().min(1).max(80)).max(30).default([]),
  content: z.string().max(4000).default(''),
  kind: worldbookEntryKindSchema,
  scope: worldbookScopeSchema.default({ type: 'global' }),
  constraints: z.array(worldbookConstraintSchema).max(10).default([]),
});
export type WorldbookEntry = z.infer<typeof worldbookEntrySchema>;

export const worldbookSchema = z.object({
  entries: z.array(worldbookEntrySchema).max(100).default([]),
});
export type Worldbook = z.infer<typeof worldbookSchema>;

export function emptyWorldbook(): Worldbook {
  return { entries: [] };
}

export function entryAppliesToScene(entry: WorldbookEntry, sceneId: string): boolean {
  if (entry.scope.type === 'global') return true;
  return entry.scope.sceneIds.includes(sceneId);
}

export function entriesForScene(worldbook: Worldbook | undefined, sceneId: string): WorldbookEntry[] {
  return (worldbook?.entries ?? []).filter(entry => entryAppliesToScene(entry, sceneId));
}

function choiceHasTag(choice: { tags?: string[] }, tag: string): boolean {
  return (choice.tags ?? []).includes(tag);
}

function inRange(value: number, min?: number, max?: number): boolean {
  if (min !== undefined && value < min) return false;
  if (max !== undefined && value > max) return false;
  return true;
}

/**
 * Returns a zh-CN blocked reason when a hard worldbook rule forbids this choice
 * in the current scene / variable state. Undefined = allowed by worldbook.
 */
export function worldbookBlockReason(
  choice: { id: string; tags?: string[] },
  sceneId: string,
  variables: Record<string, string | number | boolean>,
  worldbook: Worldbook | undefined,
): string | undefined {
  for (const entry of entriesForScene(worldbook, sceneId)) {
    for (const constraint of entry.constraints ?? []) {
      if (constraint.type === 'forbid_choice_tags') {
        if (constraint.tags.some(tag => choiceHasTag(choice, tag))) {
          return constraint.message;
        }
      }
      if (constraint.type === 'gate_tagged_choices') {
        if (!constraint.tags.some(tag => choiceHasTag(choice, tag))) continue;
        const current = variables[constraint.variable];
        if (typeof current !== 'number' || !Number.isFinite(current) || !inRange(current, constraint.min, constraint.max)) {
          return constraint.message;
        }
      }
    }
  }
  return undefined;
}

/** Lowest maxDelta cap for a variable across all entries (global caps apply everywhere). */
export function worldbookIncrementCap(
  variable: string,
  worldbook: Worldbook | undefined,
): number | undefined {
  let cap: number | undefined;
  for (const entry of worldbook?.entries ?? []) {
    for (const constraint of entry.constraints ?? []) {
      if (constraint.type !== 'cap_variable_increment') continue;
      if (constraint.variable !== variable) continue;
      cap = cap === undefined ? constraint.maxDelta : Math.min(cap, constraint.maxDelta);
    }
  }
  return cap;
}

export function validateWorldbookContent(input: {
  worldbook?: Worldbook;
  sceneIds: Set<string>;
  variables: Record<string, string | number | boolean>;
  choiceTags: Set<string>;
}): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const worldbook = input.worldbook;
  if (!worldbook) return { errors, warnings };
  const parsed = worldbookSchema.safeParse(worldbook);
  if (!parsed.success) {
    errors.push('世界书结构无效，请检查条目字段');
    return { errors, warnings };
  }
  const ids = new Set<string>();
  const caps = new Map<string, number>();
  for (const entry of parsed.data.entries) {
    if (ids.has(entry.id)) errors.push(`世界书条目 ID 重复：${entry.id}`);
    ids.add(entry.id);
    if (entry.scope.type === 'scenes') {
      for (const sceneId of entry.scope.sceneIds) {
        if (!input.sceneIds.has(sceneId)) errors.push(`世界书「${entry.title}」引用了不存在的场景：${sceneId}`);
      }
    }
    if (entry.kind === 'lore' && (entry.constraints?.length ?? 0) > 0) {
      warnings.push(`世界书「${entry.title}」标记为 lore，但仍含硬约束；建议改为 rule/power/upgrade`);
    }
    for (const constraint of entry.constraints ?? []) {
      if (constraint.type === 'forbid_choice_tags') {
        const unused = constraint.tags.filter(tag => !input.choiceTags.has(tag));
        if (unused.length === constraint.tags.length) {
          warnings.push(`世界书「${entry.title}」禁止标签 ${constraint.tags.join('、')}，但当前没有选项使用这些标签`);
        }
      }
      if (constraint.type === 'gate_tagged_choices') {
        if (constraint.min === undefined && constraint.max === undefined) {
          errors.push(`世界书「${entry.title}」的门控约束需要至少设置 min 或 max`);
        }
        if (constraint.min !== undefined && constraint.max !== undefined && constraint.min > constraint.max) {
          errors.push(`世界书「${entry.title}」的门控范围无效：min > max`);
        }
        if (!Object.hasOwn(input.variables, constraint.variable)) {
          errors.push(`世界书「${entry.title}」引用了不存在的变量：${constraint.variable}`);
        } else if (typeof input.variables[constraint.variable] !== 'number') {
          errors.push(`世界书「${entry.title}」的门控变量必须是数值：${constraint.variable}`);
        }
        const unused = constraint.tags.filter(tag => !input.choiceTags.has(tag));
        if (unused.length === constraint.tags.length) {
          warnings.push(`世界书「${entry.title}」门控标签 ${constraint.tags.join('、')} 尚未出现在任何选项上`);
        }
      }
      if (constraint.type === 'cap_variable_increment') {
        if (!Object.hasOwn(input.variables, constraint.variable)) {
          errors.push(`世界书「${entry.title}」的增量上限引用了不存在的变量：${constraint.variable}`);
        } else if (typeof input.variables[constraint.variable] !== 'number') {
          errors.push(`世界书「${entry.title}」的增量上限变量必须是数值：${constraint.variable}`);
        }
        const prev = caps.get(constraint.variable);
        if (prev !== undefined && prev !== constraint.maxDelta) {
          warnings.push(`变量 ${constraint.variable} 存在多个增量上限（将取更严的 ${Math.min(prev, constraint.maxDelta)}）`);
        }
        caps.set(constraint.variable, prev === undefined ? constraint.maxDelta : Math.min(prev, constraint.maxDelta));
      }
    }
  }
  return { errors, warnings };
}
