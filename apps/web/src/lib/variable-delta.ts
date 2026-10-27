import type { Choice, GameContent, StoryEffect, VariableValue } from '@novel-game/contracts';
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
  /** Human-readable change line, e.g. `caravan_trust +1` or `has_materials → 真`. */
  line: string;
}

function formatDeltaLine(name: string, from: VariableValue | undefined, to: VariableValue): string {
  if (typeof from === 'number' && typeof to === 'number') {
    const delta = to - from;
    if (delta === 0) return `${name} ${formatVariableValue(to)}`;
    const sign = delta > 0 ? `+${delta}` : String(delta);
    return `${name} ${sign}`;
  }
  if (from === undefined) return `${name} → ${formatVariableValue(to)}`;
  if (from === to) return `${name} ${formatVariableValue(to)}`;
  return `${name} → ${formatVariableValue(to)}`;
}

/** Diff two variable maps; returns only keys whose value changed (or appeared). */
export function diffVariables(before: VariableMap, after: VariableMap): VariableDelta[] {
  const names = new Set([...Object.keys(before), ...Object.keys(after)]);
  const deltas: VariableDelta[] = [];
  for (const name of [...names].sort()) {
    const from = Object.hasOwn(before, name) ? before[name] : undefined;
    if (!Object.hasOwn(after, name)) continue;
    const to = after[name]!;
    if (from === to) continue;
    deltas.push({ name, from, to, line: formatDeltaLine(name, from, to) });
  }
  return deltas;
}

/** Compact cost hint from choice effects; empty string if none. Does not invent effects. */
export function choiceCostHint(choice: Pick<Choice, 'effects'>): string {
  const effects = choice.effects ?? [];
  if (!effects.length) return '';
  return effects.map((effect: StoryEffect) => formatEffect(effect)).join(' · ');
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
  return choiceCostHint({ effects: effectsForChoice(content, sceneId, choiceId) });
}
