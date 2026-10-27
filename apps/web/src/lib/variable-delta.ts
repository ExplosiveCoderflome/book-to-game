import type { Choice, GameContent, StoryEffect, VariableValue } from '@novel-game/contracts';
import { displayLabelForVariable } from '@novel-game/contracts';
import { formatEffect } from './edge-summary';

export type VariableMap = Record<string, VariableValue>;

/** Format a variable value for zh-CN UI (布尔 → 真/假). */
export function formatVariableValue(value: VariableValue): string {
  if (typeof value === 'boolean') return value ? '真' : '假';
  return String(value);
}

export interface VariableDelta {
  name: string;
  from: VariableValue | undefined;
  to: VariableValue;
  /** Human-readable change line, e.g. `门派信任 +1` or `has_materials → 真`. */
  line: string;
}

export type VariableLabelFn = (name: string) => string;

function formatDeltaLine(
  name: string,
  from: VariableValue | undefined,
  to: VariableValue,
  label: string = name,
): string {
  if (typeof from === 'number' && typeof to === 'number') {
    const delta = to - from;
    if (delta === 0) return `${label} ${formatVariableValue(to)}`;
    const sign = delta > 0 ? `+${delta}` : String(delta);
    return `${label} ${sign}`;
  }
  if (from === undefined) return `${label} → ${formatVariableValue(to)}`;
  if (from === to) return `${label} ${formatVariableValue(to)}`;
  return `${label} → ${formatVariableValue(to)}`;
}

/** Diff two variable maps; returns only keys whose value changed (or appeared). */
export function diffVariables(
  before: VariableMap,
  after: VariableMap,
  labelFor?: VariableLabelFn,
): VariableDelta[] {
  const names = new Set([...Object.keys(before), ...Object.keys(after)]);
  const deltas: VariableDelta[] = [];
  for (const name of [...names].sort()) {
    const from = Object.hasOwn(before, name) ? before[name] : undefined;
    if (!Object.hasOwn(after, name)) continue;
    const to = after[name]!;
    if (from === to) continue;
    const label = labelFor?.(name) ?? name;
    deltas.push({ name, from, to, line: formatDeltaLine(name, from, to, label) });
  }
  return deltas;
}

/** Label resolver from content template stamp (ChoiceScript-style poetic names). */
export function labelFnFromContent(
  content: Pick<GameContent, 'statTemplateId' | 'statTemplateVersion'> | null | undefined,
): VariableLabelFn {
  return name => displayLabelForVariable(name, content?.statTemplateId, content?.statTemplateVersion);
}

/** Compact cost hint from choice effects; empty string if none. Does not invent effects. */
export function choiceCostHint(
  choice: Pick<Choice, 'effects'>,
  labelFor?: VariableLabelFn,
): string {
  const effects = choice.effects ?? [];
  if (!effects.length) return '';
  if (!labelFor) return effects.map((effect: StoryEffect) => formatEffect(effect)).join(' · ');
  return effects.map((effect: StoryEffect) => {
    const label = labelFor(effect.variable);
    const raw = formatEffect(effect);
    if (label === effect.variable) return raw;
    return raw.replace(effect.variable, label);
  }).join(' · ');
}

/** Join delta lines for a short toast, e.g. `状态变化：a +1；b → 真`. */
export function formatDeltaSummary(deltas: VariableDelta[], prefix = '状态变化：'): string | null {
  if (!deltas.length) return null;
  return `${prefix}${deltas.map(d => d.line).join('；')}`;
}

/** Resolve full choice effects from published graph (session view strips them). */
export function effectsForChoice(
  content: GameContent | null | undefined,
  sceneId: string,
  choiceId: string,
): StoryEffect[] {
  if (!content) return [];
  const scene = content.scenes.find(s => s.id === sceneId);
  const choice = scene?.choices.find(c => c.id === choiceId);
  return choice?.effects ?? [];
}

export function costHintForChoice(
  content: GameContent | null | undefined,
  sceneId: string,
  choiceId: string,
): string {
  return choiceCostHint(
    { effects: effectsForChoice(content, sceneId, choiceId) },
    content ? labelFnFromContent(content) : undefined,
  );
}

/**
 * Meter bar fill % for play HUD.
 * - value in 0..100 inclusive → exact percent
 * - otherwise soft relative: clamp(abs(value), 0, 100) for visual only; number text stays truthful
 */
export function meterFillPercent(value: number): number {
  if (Number.isNaN(value) || !Number.isFinite(value)) return 0;
  if (value >= 0 && value <= 100) return value;
  return Math.min(100, Math.max(0, Math.abs(value)));
}
