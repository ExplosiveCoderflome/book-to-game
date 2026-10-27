import { z } from 'zod';

type VariableValue = string | number | boolean;

/**
 * Shared role vocabulary across genres.
 * Templates label intent; the runtime only sees variables/conditions/effects.
 *
 * - resource: spendable/stockpile numbers (coin, qi)
 * - relationship: interpersonal standing (trust, affection)
 * - flag: boolean unlock / possession
 * - progress: monotonic or soft-monotonic investigation/beat counters
 * - pressure: risk / suspicion / tension that threatens failure
 */
export const statRoleSchema = z.enum(['resource', 'relationship', 'flag', 'progress', 'pressure']);
export type StatRole = z.infer<typeof statRoleSchema>;

export const statTemplateVariableSchema = z.object({
  name: z.string().min(1).max(80).regex(/^[a-z][a-z0-9_]*$/, 'variable names must be snake_case ascii'),
  type: z.enum(['number', 'boolean', 'string']),
  initial: z.union([z.string().max(2000), z.number().finite(), z.boolean()]),
  displayLabel: z.string().min(1).max(40).optional(),
  role: statRoleSchema,
}).superRefine((value, ctx) => {
  if (value.type === 'number' && typeof value.initial !== 'number') {
    ctx.addIssue({ code: 'custom', message: 'number variables require numeric initial', path: ['initial'] });
  }
  if (value.type === 'boolean' && typeof value.initial !== 'boolean') {
    ctx.addIssue({ code: 'custom', message: 'boolean variables require boolean initial', path: ['initial'] });
  }
  if (value.type === 'string' && typeof value.initial !== 'string') {
    ctx.addIssue({ code: 'custom', message: 'string variables require string initial', path: ['initial'] });
  }
  if (value.role === 'flag' && value.type !== 'boolean') {
    ctx.addIssue({ code: 'custom', message: 'flag role should use boolean type', path: ['type'] });
  }
  if ((value.role === 'resource' || value.role === 'relationship' || value.role === 'progress' || value.role === 'pressure')
    && value.type !== 'number') {
    ctx.addIssue({ code: 'custom', message: `${value.role} role should use number type`, path: ['type'] });
  }
});
export type StatTemplateVariable = z.infer<typeof statTemplateVariableSchema>;

export const statTemplateSchema = z.object({
  id: z.string().min(1).max(40),
  /** Bump when variable names/roles/semantics change in a breaking way. */
  version: z.number().int().positive(),
  label: z.string().min(1).max(80),
  blurb: z.string().min(1).max(400),
  variables: z.array(statTemplateVariableSchema).min(1).max(12),
  /** Prompt fragment: how the model should spend these vars on choices. */
  promptHint: z.string().min(1).max(2000),
}).superRefine((template, ctx) => {
  const names = new Set<string>();
  for (const [index, variable] of template.variables.entries()) {
    if (names.has(variable.name)) {
      ctx.addIssue({ code: 'custom', message: `duplicate variable name: ${variable.name}`, path: ['variables', index, 'name'] });
    }
    names.add(variable.name);
  }
});
export type StatTemplate = z.infer<typeof statTemplateSchema>;

/** What GameContent may stamp — authoring metadata, ignored by the rule engine. */
export const statTemplateRefSchema = z.object({
  statTemplateId: z.string().min(1).max(40),
  statTemplateVersion: z.number().int().positive(),
});
export type StatTemplateRef = z.infer<typeof statTemplateRefSchema>;

const RAW_TEMPLATES = [
  {
    id: 'xianxia_pressure',
    version: 1,
    label: '江湖 / 修仙压迫',
    blurb: '修为资源、门派人情与劫数压力；关键选择常增减数值，结局可被信物/信任门控。',
    variables: [
      { name: 'qi', type: 'number' as const, initial: 0, displayLabel: '修为', role: 'resource' as const },
      { name: 'sect_trust', type: 'number' as const, initial: 0, displayLabel: '门派信任', role: 'relationship' as const },
      { name: 'calamity', type: 'number' as const, initial: 0, displayLabel: '劫数', role: 'pressure' as const },
      { name: 'has_token', type: 'boolean' as const, initial: false, displayLabel: '持有信物', role: 'flag' as const },
    ],
    promptHint:
      '数值骨架：qi（修为/资源）、sect_trust（门派人情）、calamity（劫数/压力）、has_token（信物旗标）。中段选择多用 increment 增减 qi/sect_trust/calamity；至少一条结局路径用 condition 门控（如 has_token=真 或 sect_trust≥某值）。不要发明战斗回合制。',
  },
  {
    id: 'mystery_deduction',
    version: 1,
    label: '悬疑推理',
    blurb: '线索进度、嫌疑压力与同盟信任；收集与对峙推动状态，结局依赖线索或不在场证明。',
    variables: [
      { name: 'clues', type: 'number' as const, initial: 0, displayLabel: '线索', role: 'progress' as const },
      { name: 'suspicion', type: 'number' as const, initial: 0, displayLabel: '嫌疑', role: 'pressure' as const },
      { name: 'ally_trust', type: 'number' as const, initial: 0, displayLabel: '同盟信任', role: 'relationship' as const },
      { name: 'has_alibi', type: 'boolean' as const, initial: false, displayLabel: '不在场证明', role: 'flag' as const },
    ],
    promptHint:
      '数值骨架：clues（线索进度）、suspicion（嫌疑压力）、ally_trust（同盟信任）、has_alibi（不在场证明）。调查选项常 +clues 或 ±suspicion；对峙选项动 ally_trust；至少一条结局用 clues≥n 或 has_alibi 门控。',
  },
  {
    id: 'trade_venture',
    version: 1,
    label: '商途 / 资源经营',
    blurb: '金钱、声望与风险；买卖与押运产生代价，结局看货仓与声誉。',
    variables: [
      { name: 'coin', type: 'number' as const, initial: 2, displayLabel: '银两', role: 'resource' as const },
      { name: 'reputation', type: 'number' as const, initial: 0, displayLabel: '声望', role: 'relationship' as const },
      { name: 'risk', type: 'number' as const, initial: 0, displayLabel: '风险', role: 'pressure' as const },
      { name: 'has_cargo', type: 'boolean' as const, initial: false, displayLabel: '持有货物', role: 'flag' as const },
    ],
    promptHint:
      '数值骨架：coin（银两）、reputation（声望）、risk（风险）、has_cargo（货物）。交易/押运选项应增减 coin/risk，人情选项动 reputation；至少一条结局用 has_cargo 或 reputation/coin 门槛门控。',
  },
  {
    id: 'relationship_drama',
    version: 1,
    label: '关系向 / 互动',
    blurb: '好感与张力拉锯，承诺旗标与章节节拍；选择改变关系曲线。',
    variables: [
      { name: 'affection', type: 'number' as const, initial: 0, displayLabel: '好感', role: 'relationship' as const },
      { name: 'tension', type: 'number' as const, initial: 0, displayLabel: '张力', role: 'pressure' as const },
      { name: 'promise_kept', type: 'boolean' as const, initial: false, displayLabel: '守住承诺', role: 'flag' as const },
      { name: 'chapter_beat', type: 'number' as const, initial: 0, displayLabel: '节拍', role: 'progress' as const },
    ],
    promptHint:
      '数值骨架：affection（好感）、tension（张力）、promise_kept（承诺）、chapter_beat（节拍进度）。互动选项应可见地改变 affection/tension；关键承诺用 set promise_kept；至少一条结局用 affection/tension 或 promise_kept 门控。',
  },
] as const;

/** Shipped presets — validated at module load so catalog drift fails fast. */
export const STAT_TEMPLATES: readonly StatTemplate[] = RAW_TEMPLATES.map(t => statTemplateSchema.parse(t));

export const statTemplateIdSchema = z.enum([
  'xianxia_pressure',
  'mystery_deduction',
  'trade_venture',
  'relationship_drama',
]);
export type StatTemplateId = z.infer<typeof statTemplateIdSchema>;

export function getStatTemplate(id: string | undefined | null): StatTemplate | undefined {
  if (!id) return undefined;
  return STAT_TEMPLATES.find(t => t.id === id);
}

export function getStatTemplateRef(id: string | undefined | null): StatTemplateRef | undefined {
  const template = getStatTemplate(id);
  if (!template) return undefined;
  return { statTemplateId: template.id, statTemplateVersion: template.version };
}

/** Compile template → engine-native variables record (the only runtime shape). */
export function templateInitialVariables(template: StatTemplate): Record<string, VariableValue> {
  return Object.fromEntries(template.variables.map(v => [v.name, v.initial as VariableValue]));
}

/**
 * Author-time apply: merge template initials into an existing variables map.
 * Does not overwrite keys already present (author/custom wins).
 */
export function applyStatTemplateVariables(
  template: StatTemplate,
  existing: Record<string, VariableValue> = {},
): Record<string, VariableValue> {
  return { ...templateInitialVariables(template), ...existing };
}

/** Prefer template displayLabel when variable name matches; else raw name. Old drafts without template still work. */
export function displayLabelForVariable(
  name: string,
  preferredTemplateId?: string | null,
  preferredVersion?: number | null,
): string {
  const preferred = getStatTemplate(preferredTemplateId ?? undefined);
  if (preferred && (preferredVersion == null || preferred.version === preferredVersion)) {
    const fromPreferred = preferred.variables.find(v => v.name === name)?.displayLabel;
    if (fromPreferred) return fromPreferred;
  }
  for (const template of STAT_TEMPLATES) {
    const hit = template.variables.find(v => v.name === name)?.displayLabel;
    if (hit) return hit;
  }
  return name;
}

/** Compact payload fragment injected into skeleton user JSON (generation hook). */
export function statTemplatePromptPayload(template: StatTemplate) {
  return {
    statTemplateId: template.id,
    statTemplateVersion: template.version,
    label: template.label,
    preferredVariables: template.variables.map(v => ({
      name: v.name,
      type: v.type,
      initial: v.initial,
      displayLabel: v.displayLabel ?? v.name,
      role: v.role,
    })),
    guidance: template.promptHint,
    rules: [
      '优先使用 preferredVariables 的名称与初值声明 GameContent.variables；必要时可微调命名但须保持 role 语义。',
      'effects/conditions 只能使用引擎已支持的 set/increment/equals/gte，不要发明新机制或题材专属运行时。',
      '中段与临结局关键选择应更多带 effects；至少一条结局路径用 condition 门控某一变量。',
      '可把 statTemplateId 与 statTemplateVersion 原样写入输出 JSON（作者元数据，不参与规则运算）。',
      '模板不是通关条件表：不要把全部结局锁死在单一变量上；保留可达的失败/代价结局。',
    ],
  };
}
