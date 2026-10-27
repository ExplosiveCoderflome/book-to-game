import type { Choice, StoryCondition, StoryEffect } from '@novel-game/contracts';

function formatValue(value: string | number | boolean): string {
  if (typeof value === 'boolean') return value ? '真' : '假';
  return String(value);
}

export function formatCondition(condition: StoryCondition): string {
  if (condition.type === 'variable.equals') return `${condition.variable} = ${formatValue(condition.value)}`;
  return `${condition.variable} ≥ ${condition.value}`;
}

export function formatEffect(effect: StoryEffect): string {
  if (effect.type === 'variable.set') return `${effect.variable} → ${formatValue(effect.value)}`;
  const sign = effect.value >= 0 ? `+${effect.value}` : String(effect.value);
  return `${effect.variable} ${sign}`;
}

export interface EdgeRuleSummary {
  fullLabel: string;
  shortLabel: string;
  conditions: string[];
  effects: string[];
  lines: string[];
}

/** Compact Chinese summary for edge hover / path labels. */
export function summarizeChoice(choice: Choice, shortMax = 12): EdgeRuleSummary {
  const conditions = (choice.conditions ?? []).map(formatCondition);
  const effects = (choice.effects ?? []).map(formatEffect);
  const lines: string[] = [];
  if (conditions.length) lines.push(`条件：${conditions.join('；')}`);
  if (effects.length) lines.push(`效果：${effects.join('；')}`);
  const fullLabel = choice.label.trim() || choice.id;
  return {
    fullLabel,
    shortLabel: fullLabel.length <= shortMax ? fullLabel : `${fullLabel.slice(0, shortMax - 1)}…`,
    conditions,
    effects,
    lines,
  };
}
