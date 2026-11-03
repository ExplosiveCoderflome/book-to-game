import type { AdventureResourceMeta, StatRole, VariableValue } from '@novel-game/contracts';
import { displayLabelForVariable, roleForVariable } from '@novel-game/contracts';
import {
  formatVariableValue,
  meterFillPercent,
  toneForDelta,
  type DeltaTone,
  type OptionChangeSummary,
  type VariableDelta,
} from './variable-delta';

/**
 * Scene-lens HUD contract: at most a handful of "what matters right now" readouts.
 * Pure helpers only — no React, no game rules. The surfaces render what the contract already exposes.
 */
export interface LensStatDelta {
  line: string;
  /** Compact value-only suffix for the HUD, e.g. `+5` / `→ 真`. */
  short: string;
  tone: DeltaTone;
  direction?: 'up' | 'down' | 'flat';
}

export interface LensStat {
  key: string;
  label: string;
  value: string;
  kind: 'variable' | 'resource';
  role?: StatRole;
  /** 0–100 visual fill; absent for non-numeric / boolean stats. */
  fillPercent?: number;
  /** Author-declared danger (resource warn) or a pressure delta. */
  warn?: boolean;
  delta?: LensStatDelta;
}

export interface LensDeltaChip {
  key: string;
  line: string;
  tone: DeltaTone;
}

export interface PickLensStatsInput {
  variables?: Record<string, VariableValue>;
  resources?: Record<string, number> | null;
  resourceLabels?: Record<string, string> | null;
  /** Adventure S1 declarations; preferred over raw resources. */
  resourceMeta?: AdventureResourceMeta[] | null;
  statTemplateId?: string | null;
  statTemplateVersion?: number | null;
  deltas?: VariableDelta[] | null;
  /** Adventure S1 projected chips (`id-0`, `max-id-0`) keyed differently from VariableDelta. */
  deltaChips?: LensDeltaChip[] | null;
  /** Clock countdown resource id → rendered first, like a time meter. */
  countdownId?: string;
  max?: number;
}

const DEFAULT_MAX = 4;

const MONEY_LABEL = /(coin|cash|money|gold|silver|currency|wallet|银|钱|金|币|资|粮)/i;

/** Role order for the lens: danger/time first, cosmetics last. */
function roleScore(role: StatRole | undefined, isTime: boolean, isMoney: boolean): number {
  if (isTime) return 0;
  if (role === 'pressure') return 1;
  if (isMoney) return 2;
  if (role === 'resource') return 3;
  if (role === 'progress') return 4;
  if (role === 'relationship') return 5;
  if (role === 'flag') return 6;
  return 7;
}

function findDelta(
  key: string,
  deltas: VariableDelta[] | null | undefined,
  chips: LensDeltaChip[] | null | undefined,
  role?: StatRole,
): LensStatDelta | undefined {
  const direct = deltas?.find(d => d.name === key);
  if (direct) {
    if (typeof direct.from === 'number' && typeof direct.to === 'number') {
      const delta = direct.to - direct.from;
      return {
        line: direct.line,
        short: delta > 0 ? `+${delta}` : delta < 0 ? `−${Math.abs(delta)}` : '±0',
        tone: toneForDelta(direct, role),
        direction: delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat',
      };
    }
    return {
      line: direct.line,
      short: typeof direct.to === 'boolean' ? (direct.to ? '→ 真' : '→ 假') : `→ ${direct.to}`,
      tone: toneForDelta(direct, role),
    };
  }
  const chip = chips?.find(c => c.key === key || c.key.startsWith(`${key}-`) || c.key.startsWith(`max-${key}-`));
  if (!chip) return undefined;
  // Chip lines are pre-formatted (e.g. 「修为 +1（已封顶）」); surface the tail as the compact suffix.
  const short = chip.line.replace(/^\S+\s*/, '').replace(/（已封顶）$/, '').trim();
  return { line: chip.line, short: short || chip.line, tone: chip.tone };
}

/**
 * Pick 2–4 key stats for the top HUD.
 *
 * Priority: countdown/time → pressure role → money-ish resource → other resources → progress →
 * relationship → flag → unknown numeric variables. Numeric stats win over booleans; when fewer than
 * two numeric stats exist, booleans top the line up so the HUD still says something useful.
 */
export function pickLensStats(input: PickLensStatsInput): LensStat[] {
  const max = Math.max(1, input.max ?? DEFAULT_MAX);
  const deltas = input.deltas ?? null;
  const chips = input.deltaChips ?? null;
  const templateId = input.statTemplateId;
  const templateVersion = input.statTemplateVersion;
  const candidates: Array<{ order: number; stat: LensStat; score: number; numeric: boolean }> = [];
  let order = 0;
  const seen = new Set<string>();

  for (const meta of input.resourceMeta ?? []) {
    if (seen.has(meta.id)) continue;
    seen.add(meta.id);
    const isTime = input.countdownId === meta.id;
    // A declared danger (warn low/high) outranks plain resources and money: it is the readout that
    // decides whether the next action is safe.
    const score = meta.warn ? roleScore('pressure', isTime, false) : roleScore('resource', isTime, MONEY_LABEL.test(meta.label) || MONEY_LABEL.test(meta.id));
    const unit = meta.unit ? ` ${meta.unit}` : '';
    const value = meta.valueLabel
      ?? (meta.max !== undefined && meta.display !== 'number' ? `${meta.value}/${meta.max}` : `${meta.value}${unit}`);
    const span = meta.max !== undefined ? (meta.max - meta.min) || 1 : undefined;
    const fillPercent = span !== undefined
      ? Math.max(0, Math.min(100, ((meta.value - meta.min) / span) * 100))
      : undefined;
    const delta = findDelta(meta.id, deltas, chips, meta.warn ? 'pressure' : 'resource');
    candidates.push({
      order: order++,
      score,
      numeric: true,
      stat: {
        key: meta.id,
        label: meta.label,
        value,
        kind: 'resource',
        role: 'resource',
        fillPercent,
        warn: !!meta.warn || delta?.tone === 'pressure',
        delta,
      },
    });
  }

  for (const [name, raw] of Object.entries(input.variables ?? {})) {
    if (seen.has(name)) continue;
    seen.add(name);
    const role = roleForVariable(name, templateId, templateVersion);
    const label = displayLabelForVariable(name, templateId, templateVersion);
    const isMoney = MONEY_LABEL.test(name) || MONEY_LABEL.test(label);
    const numeric = typeof raw === 'number';
    const delta = findDelta(name, deltas, chips, role);
    candidates.push({
      order: order++,
      score: roleScore(role, false, isMoney),
      numeric,
      stat: {
        key: name,
        label,
        value: formatVariableValue(raw),
        kind: 'variable',
        role,
        fillPercent: numeric ? meterFillPercent(raw as number) : undefined,
        warn: delta?.tone === 'pressure',
        delta,
      },
    });
  }

  for (const [name, value] of Object.entries(input.resources ?? {})) {
    if (seen.has(name) || name.startsWith('fs_') || name.startsWith('fu_')) continue;
    seen.add(name);
    const label = input.resourceLabels?.[name] ?? name.replace(/_/g, ' ');
    const delta = findDelta(name, deltas, chips, 'resource');
    const isMoney = MONEY_LABEL.test(name) || MONEY_LABEL.test(label);
    candidates.push({
      order: order++,
      score: roleScore('resource', false, isMoney),
      numeric: true,
      stat: {
        key: name,
        label,
        value: String(value),
        kind: 'resource',
        role: 'resource',
        fillPercent: meterFillPercent(value),
        warn: delta?.tone === 'pressure',
        delta,
      },
    });
  }

  const sorted = candidates.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    if (a.numeric !== b.numeric) return a.numeric ? -1 : 1;
    return a.order - b.order;
  });

  const numeric = sorted.filter(c => c.numeric);
  const picked = numeric.slice(0, max);
  if (picked.length < Math.min(2, sorted.length)) {
    for (const candidate of sorted) {
      if (picked.length >= Math.min(2, sorted.length)) break;
      if (!picked.includes(candidate)) picked.push(candidate);
    }
  }
  return picked.map(c => c.stat);
}

export interface LensActionSplit<T> {
  primary: T[];
  overflow: T[];
}

/**
 * Split play actions into a short primary dock and a secondary drawer.
 * Enabled options keep their order and fill the dock first; locked / disabled rows fall to the
 * drawer. If nothing is enabled, the first `maxPrimary` rows still render (so the player sees why).
 */
export function splitPrimaryActions<T>(
  items: T[],
  isEnabled: (item: T) => boolean = () => true,
  maxPrimary = DEFAULT_MAX,
): LensActionSplit<T> {
  const cap = Math.max(0, maxPrimary);
  const enabled = items.filter(item => isEnabled(item));
  const disabled = items.filter(item => !isEnabled(item));
  const primary = enabled.slice(0, cap);
  const overflow = [...enabled.slice(cap), ...disabled];
  if (!primary.length) return { primary: items.slice(0, cap), overflow: items.slice(cap) };
  return { primary, overflow };
}

/** Strip that only renders when the last beat changed something. */
export function hasLensFeedback(
  deltas: VariableDelta[] | null | undefined,
  optionChanges: OptionChangeSummary | null | undefined,
  chips?: LensDeltaChip[] | null,
): boolean {
  return !!deltas?.length || !!chips?.length
    || !!optionChanges?.newlyAvailable.length || !!optionChanges?.newlyUnavailable.length;
}
