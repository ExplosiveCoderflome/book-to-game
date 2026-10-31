/** Shared display names for HUD, action costs and resource deltas. No state or rule changes. */
export type ResourceLabelSource = {
  resourceDefs?: Record<string, { label: string }>;
  map?: { layers?: { factions?: { factions?: { stats?: { label: string; resourceId: string }[] }[] } } };
};

export const GENERIC_LABELS: Record<string, string> = {
  hp: '体力', coin: '银两', gold: '金币', primary_coin: '通货',
  reputation: '声望', risk: '风险',
};

export const XIANXIA_LABEL_PRESET: Record<string, string> = {
  qi: '修为', lingshi: '灵石', xiuwei: '修为', xinmo: '心魔',
};

/** Explicit resource definitions win over faction stat labels, then the optional preset and generic defaults. */
export function resourceLabelsForWorld(
  world?: ResourceLabelSource | null,
  opts: {preset?: Record<string, string>} = {},
): Record<string, string> {
  return Object.fromEntries([
    ...Object.entries(GENERIC_LABELS),
    ...Object.entries(opts.preset ?? {}),
    ...(world?.map?.layers?.factions?.factions ?? []).flatMap(faction =>
      (faction.stats ?? []).filter(stat => stat.resourceId && stat.label).map(stat => [stat.resourceId, stat.label])),
    ...Object.entries(world?.resourceDefs ?? {}).map(([id, def]) => [id, def.label]),
  ]);
}

export function resourceDisplayLabel(id: string, labels: Record<string, string>): string {
  return Object.hasOwn(labels, id) ? labels[id]! : id.replace(/_/g, ' ');
}
