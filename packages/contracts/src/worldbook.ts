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
 * v1: forbid_choice_tags / gate_tagged_choices / cap_variable_increment
 * v2 power/upgrade: require_min|max_variable, spend_on_choice, one_path_lock, upgrade_ladder
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
  z.object({
    type: z.literal('require_min_variable'),
    tags: z.array(tagSchema).min(1).max(20),
    variable: variableNameSchema,
    min: z.number().finite(),
    message: z.string().min(1).max(300),
  }),
  z.object({
    type: z.literal('require_max_variable'),
    tags: z.array(tagSchema).min(1).max(20),
    variable: variableNameSchema,
    max: z.number().finite(),
    message: z.string().min(1).max(300),
  }),
  z.object({
    type: z.literal('spend_on_choice'),
    tags: z.array(tagSchema).min(1).max(20),
    variable: variableNameSchema,
    amount: z.number().finite().positive(),
    message: z.string().min(1).max(300),
  }),
  z.object({
    type: z.literal('one_path_lock'),
    whenTags: z.array(tagSchema).min(1).max(20),
    forbidTags: z.array(tagSchema).min(1).max(20),
    message: z.string().min(1).max(300),
  }),
  z.object({
    type: z.literal('upgrade_ladder'),
    variable: variableNameSchema,
    steps: z.array(z.object({
      threshold: z.number().finite(),
      tags: z.array(tagSchema).min(1).max(20),
    })).min(1).max(20),
    message: z.string().min(1).max(300),
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
  constraints: z.array(worldbookConstraintSchema).max(16).default([]),
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

function choiceHasAnyTag(choice: { tags?: string[] }, tags: string[]): boolean {
  return tags.some(tag => choiceHasTag(choice, tag));
}

function inRange(value: number, min?: number, max?: number): boolean {
  if (min !== undefined && value < min) return false;
  if (max !== undefined && value > max) return false;
  return true;
}

function numericVar(
  variables: Record<string, string | number | boolean>,
  name: string,
): number | undefined {
  const current = variables[name];
  return typeof current === 'number' && Number.isFinite(current) ? current : undefined;
}

/**
 * Returns a zh-CN blocked reason when a hard worldbook rule forbids this choice
 * in the current scene / variable / taken-tag state. Undefined = allowed by worldbook.
 */
export function worldbookBlockReason(
  choice: { id: string; tags?: string[] },
  sceneId: string,
  variables: Record<string, string | number | boolean>,
  worldbook: Worldbook | undefined,
  takenTags: readonly string[] = [],
): string | undefined {
  const taken = new Set(takenTags);
  for (const entry of entriesForScene(worldbook, sceneId)) {
    for (const constraint of entry.constraints ?? []) {
      if (constraint.type === 'forbid_choice_tags') {
        if (choiceHasAnyTag(choice, constraint.tags)) return constraint.message;
      }
      if (constraint.type === 'gate_tagged_choices') {
        if (!choiceHasAnyTag(choice, constraint.tags)) continue;
        const current = numericVar(variables, constraint.variable);
        if (current === undefined || !inRange(current, constraint.min, constraint.max)) {
          return constraint.message;
        }
      }
      if (constraint.type === 'require_min_variable') {
        if (!choiceHasAnyTag(choice, constraint.tags)) continue;
        const current = numericVar(variables, constraint.variable);
        if (current === undefined || current < constraint.min) return constraint.message;
      }
      if (constraint.type === 'require_max_variable') {
        if (!choiceHasAnyTag(choice, constraint.tags)) continue;
        const current = numericVar(variables, constraint.variable);
        if (current === undefined || current > constraint.max) return constraint.message;
      }
      if (constraint.type === 'spend_on_choice') {
        if (!choiceHasAnyTag(choice, constraint.tags)) continue;
        const current = numericVar(variables, constraint.variable);
        if (current === undefined || current < constraint.amount) return constraint.message;
      }
      if (constraint.type === 'one_path_lock') {
        const triggered = constraint.whenTags.some(tag => taken.has(tag));
        if (triggered && choiceHasAnyTag(choice, constraint.forbidTags)) return constraint.message;
      }
      if (constraint.type === 'upgrade_ladder') {
        const current = numericVar(variables, constraint.variable);
        for (const step of constraint.steps) {
          if (!choiceHasAnyTag(choice, step.tags)) continue;
          if (current === undefined || current < step.threshold) return constraint.message;
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

/** Resource spends to apply after a tagged choice succeeds (same projection scope as block). */
export function worldbookSpendsForChoice(
  choice: { tags?: string[] },
  sceneId: string,
  worldbook: Worldbook | undefined,
): Array<{ variable: string; amount: number }> {
  const spends: Array<{ variable: string; amount: number }> = [];
  for (const entry of entriesForScene(worldbook, sceneId)) {
    for (const constraint of entry.constraints ?? []) {
      if (constraint.type !== 'spend_on_choice') continue;
      if (!choiceHasAnyTag(choice, constraint.tags)) continue;
      spends.push({ variable: constraint.variable, amount: constraint.amount });
    }
  }
  return spends;
}

/** Merge choice tags into the session's taken-tag set (for one_path_lock). */
export function mergeTakenTags(
  previous: readonly string[] | undefined,
  choiceTags: readonly string[] | undefined,
): string[] {
  const next = new Set(previous ?? []);
  for (const tag of choiceTags ?? []) next.add(tag);
  return [...next];
}

function warnUnusedTags(
  warnings: string[],
  entryTitle: string,
  label: string,
  tags: string[],
  choiceTags: Set<string>,
): void {
  const unused = tags.filter(tag => !choiceTags.has(tag));
  if (unused.length === tags.length) {
    warnings.push(`世界书「${entryTitle}」${label} ${tags.join('、')}，但当前没有选项使用这些标签`);
  }
}

function requireNumericVariable(
  errors: string[],
  entryTitle: string,
  label: string,
  variable: string,
  variables: Record<string, string | number | boolean>,
): void {
  if (!Object.hasOwn(variables, variable)) {
    errors.push(`世界书「${entryTitle}」${label}引用了不存在的变量：${variable}`);
  } else if (typeof variables[variable] !== 'number') {
    errors.push(`世界书「${entryTitle}」${label}变量必须是数值：${variable}`);
  }
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
        warnUnusedTags(warnings, entry.title, '禁止标签', constraint.tags, input.choiceTags);
      }
      if (constraint.type === 'gate_tagged_choices') {
        if (constraint.min === undefined && constraint.max === undefined) {
          errors.push(`世界书「${entry.title}」的门控约束需要至少设置 min 或 max`);
        }
        if (constraint.min !== undefined && constraint.max !== undefined && constraint.min > constraint.max) {
          errors.push(`世界书「${entry.title}」的门控范围无效：min > max`);
        }
        requireNumericVariable(errors, entry.title, '的门控', constraint.variable, input.variables);
        warnUnusedTags(warnings, entry.title, '门控标签', constraint.tags, input.choiceTags);
      }
      if (constraint.type === 'cap_variable_increment') {
        requireNumericVariable(errors, entry.title, '的增量上限', constraint.variable, input.variables);
        const prev = caps.get(constraint.variable);
        if (prev !== undefined && prev !== constraint.maxDelta) {
          warnings.push(`变量 ${constraint.variable} 存在多个增量上限（将取更严的 ${Math.min(prev, constraint.maxDelta)}）`);
        }
        caps.set(constraint.variable, prev === undefined ? constraint.maxDelta : Math.min(prev, constraint.maxDelta));
      }
      if (constraint.type === 'require_min_variable') {
        requireNumericVariable(errors, entry.title, '的最低战力', constraint.variable, input.variables);
        warnUnusedTags(warnings, entry.title, '最低要求标签', constraint.tags, input.choiceTags);
      }
      if (constraint.type === 'require_max_variable') {
        requireNumericVariable(errors, entry.title, '的最高限制', constraint.variable, input.variables);
        warnUnusedTags(warnings, entry.title, '最高限制标签', constraint.tags, input.choiceTags);
      }
      if (constraint.type === 'spend_on_choice') {
        requireNumericVariable(errors, entry.title, '的消耗', constraint.variable, input.variables);
        warnUnusedTags(warnings, entry.title, '消耗标签', constraint.tags, input.choiceTags);
      }
      if (constraint.type === 'one_path_lock') {
        warnUnusedTags(warnings, entry.title, '路径锁定 whenTags', constraint.whenTags, input.choiceTags);
        warnUnusedTags(warnings, entry.title, '路径锁定 forbidTags', constraint.forbidTags, input.choiceTags);
        const overlap = constraint.whenTags.filter(tag => constraint.forbidTags.includes(tag));
        if (overlap.length) {
          warnings.push(`世界书「${entry.title}」路径锁定 when/forbid 有重叠标签：${overlap.join('、')}`);
        }
      }
      if (constraint.type === 'upgrade_ladder') {
        requireNumericVariable(errors, entry.title, '的升级阶梯', constraint.variable, input.variables);
        const thresholds = constraint.steps.map(s => s.threshold);
        for (let i = 1; i < thresholds.length; i++) {
          if (thresholds[i]! < thresholds[i - 1]!) {
            warnings.push(`世界书「${entry.title}」升级阶梯阈值未按阈值非降序排列`);
            break;
          }
        }
        for (const step of constraint.steps) {
          warnUnusedTags(warnings, entry.title, `阶梯≥${step.threshold}标签`, step.tags, input.choiceTags);
        }
      }
    }
  }
  return { errors, warnings };
}
