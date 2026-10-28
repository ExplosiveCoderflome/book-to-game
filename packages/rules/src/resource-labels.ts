/** Shared display names for HUD, action costs and resource deltas. No state or rule changes. */
export type ResourceLabelSource = {
  resourceDefs?: Record<string, { label: string }>;
  map?: { layers?: { factions?: { factions?: { stats?: { label: string; resourceId: string }[] }[] } } };
};

const COMMON: Record<string, string> = {
  hp: '体力', coin: '银两', gold: '金币', primary_coin: '通货',
  qi: '修为', reputation: '声望', risk: '风险',
};

/** Explicit resource definitions win over faction stat labels, then common defaults. */
export function resourceLabelsForWorld(world?: ResourceLabelSource | null): Record<string, string> {
  return Object.fromEntries([
    ...Object.entries(COMMON),
    ...(world?.map?.layers?.factions?.factions ?? []).flatMap(faction =>
      (faction.stats ?? []).filter(stat => stat.resourceId && stat.label).map(stat => [stat.resourceId, stat.label])),
    ...Object.entries(world?.resourceDefs ?? {}).map(([id, def]) => [id, def.label]),
  ]);
}

export function resourceDisplayLabel(id: string, labels: Record<string, string>): string {
  return Object.hasOwn(labels, id) ? labels[id]! : id.replace(/_/g, ' ');
}
