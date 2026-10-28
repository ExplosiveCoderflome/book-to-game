/** S1 structural checks (ids, references, bounds) shared by validate-world and lint v2. Pure. */
import type { WorldCondition, WorldContent, WorldEffect } from '@novel-game/contracts';

export type S1Issue = { level: 'error' | 'warning'; ruleId: string; message: string; target?: string };

/** Visit every condition (anyOf members included) and every effect (roll branches included) of a world. */
export function walkWorldLogic(world: WorldContent,
  onCondition: (condition: WorldCondition, owner: string) => void,
  onEffect: (effect: WorldEffect, owner: string) => void): void {
  const conds = (items: readonly WorldCondition[] | undefined, owner: string) => {
    for (const item of items ?? []) {
      onCondition(item, owner);
      if (item.kind === 'anyOf') for (const member of item.conditions) onCondition(member as WorldCondition, owner);
    }
  };
  const effs = (items: readonly WorldEffect[] | undefined, owner: string) => {
    for (const item of items ?? []) {
      onEffect(item, owner);
      if (item.kind === 'roll') { for (const e of item.success) onEffect(e as WorldEffect, owner); for (const e of item.failure) onEffect(e as WorldEffect, owner); }
    }
  };
  for (const a of world.actions) { conds(a.availableWhen, `行动 ${a.id}`); conds(a.requires, `行动 ${a.id}`); effs(a.effects, `行动 ${a.id}`); }
  for (const e of world.events) { conds(e.when, `事件 ${e.id}`); effs(e.effects, `事件 ${e.id}`); }
  for (const e of world.endings) {
    conds(e.when, `结局 ${e.id}`); for (const v of e.textVariants ?? []) conds(v.when, `结局 ${e.id}`);
    for (const p of e.passages ?? []) conds(p.when, `结局 ${e.id} 附加段落 ${p.id}`);
  }
  for (const r of world.recap ?? []) conds(r.when, `回顾 ${r.id}`);
  for (const l of world.locations) for (const v of l.textVariants ?? []) conds(v.when, `地点 ${l.id}`);
  for (const sl of world.storylets ?? []) {
    const owner = `剧情卡 ${sl.id}`;
    conds(sl.when, owner);
    for (const mod of sl.weight?.mods ?? []) conds(mod.when, owner);
    for (const c of sl.choices) { conds(c.availableWhen, `${owner}/${c.id}`); conds(c.requires, `${owner}/${c.id}`); effs(c.effects, `${owner}/${c.id}`); }
  }
  for (const [rid, def] of Object.entries(world.resourceDefs ?? {})) {
    effs(def.onMin?.effects as WorldEffect[] | undefined, `资源 ${rid}.onMin`);
    effs(def.onMax?.effects as WorldEffect[] | undefined, `资源 ${rid}.onMax`);
  }
  for (const [i, rule] of (world.clock?.rules ?? []).entries()) effs(rule.effects as WorldEffect[], `时钟规则 ${rule.id ?? i + 1}`);
}

export function validateS1References(world: WorldContent): S1Issue[] {
  const issues: S1Issue[] = [];
  const err = (ruleId: string, message: string, target?: string) => issues.push({level: 'error', ruleId, message, ...(target ? {target} : {})});
  const warn = (ruleId: string, message: string, target?: string) => issues.push({level: 'warning', ruleId, message, ...(target ? {target} : {})});
  const defs = world.resourceDefs ?? {};
  const resourceIds = new Set([...Object.keys(world.resources ?? {}), ...Object.keys(defs)]);
  const storyletIds = new Set<string>(); const endingIds = new Set(world.endings.map(e => e.id));
  const locationIds = new Set(world.locations.map(l => l.id)); const factIds = new Set(world.facts.map(f => f.id));
  for (const sl of world.storylets ?? []) {
    if (storyletIds.has(sl.id)) err('s1.duplicate-id', `剧情卡 ID 重复：${sl.id}`, sl.id);
    storyletIds.add(sl.id);
    const choiceIds = new Set<string>();
    for (const c of sl.choices) {
      if (choiceIds.has(c.id)) err('s1.duplicate-id', `剧情卡 ${sl.id} 的选项 ID 重复：${c.id}`, sl.id);
      choiceIds.add(c.id);
      if (`sl__${sl.id}__${c.id}`.length > 80) err('s1.id-length', `剧情卡 ${sl.id} 的选项 ${c.id}：组合 ID 超过 80 字符`, sl.id);
      if (!world.clock && c.timeCost > 5) err('s1.time-cost', `剧情卡 ${sl.id}/${c.id}：没有时钟时 timeCost 不能超过 5`, sl.id);
    }
    for (const lid of sl.locationIds ?? []) if (!locationIds.has(lid)) err('s1.unknown-location', `剧情卡 ${sl.id} 的地点不存在：${lid}`, sl.id);
    for (const mod of sl.weight?.mods ?? []) if (mod.resourceId && !resourceIds.has(mod.resourceId)) err('s1.unknown-resource', `剧情卡 ${sl.id} 的权重修正引用了不存在的资源：${mod.resourceId}`, sl.id);
  }
  for (const [rid, def] of Object.entries(defs)) {
    if (def.initial !== undefined && (def.initial < def.min || (def.max !== undefined && def.initial > def.max))) err('s1.resource-bounds', `资源 ${rid} 的初始值 ${def.initial} 不在 [${def.min}, ${def.max ?? '∞'}]`, rid);
    for (const [side, trig] of [['onMin', def.onMin], ['onMax', def.onMax]] as const) {
      if (!trig) continue;
      if (side === 'onMax' && def.max === undefined) err('s1.resource-bounds', `资源 ${rid} 没有 max，onMax 永不触发`, rid);
      if (trig.ending && !endingIds.has(trig.ending)) err('s1.unknown-ending', `资源 ${rid}.${side} 的结局不存在：${trig.ending}`, rid);
      if (trig.storylet && !storyletIds.has(trig.storylet)) err('s1.unknown-storylet', `资源 ${rid}.${side} 的剧情卡不存在：${trig.storylet}`, rid);
    }
  }
  const clock = world.clock;
  if (clock) {
    if (clock.countdownResourceId && !resourceIds.has(clock.countdownResourceId)) err('s1.unknown-resource', `时钟倒计时资源不存在：${clock.countdownResourceId}`);
    if (clock.timeoutEndingId && !endingIds.has(clock.timeoutEndingId)) err('s1.unknown-ending', `时钟超时结局不存在：${clock.timeoutEndingId}`);
    const windowIds = new Set<string>();
    for (const w of clock.windows ?? []) {
      if (windowIds.has(w.id)) err('s1.duplicate-id', `时间窗口 ID 重复：${w.id}`, w.id);
      windowIds.add(w.id);
      if (w.storyletId && !storyletIds.has(w.storyletId)) err('s1.unknown-storylet', `时间窗口 ${w.id} 的剧情卡不存在：${w.storyletId}`, w.id);
      if (w.fromMonth > clock.limitMonths) warn('s1.window-after-limit', `时间窗口 ${w.id} 开始于时限之后，永远不会打开`, w.id);
    }
  }
  walkWorldLogic(world, (c, owner) => {
    if (c.kind === 'resource' && !resourceIds.has(c.resourceId)) err('s1.unknown-resource', `${owner} 的资源不存在：${c.resourceId}`, owner);
    if (c.kind === 'resource' && defs[c.resourceId]) {
      const def = defs[c.resourceId]!; const hi = def.max ?? Infinity;
      if (c.atLeast !== undefined && (c.atLeast > hi)) err('s1.gate-out-of-range', `${owner}：${def.label} ≥ ${c.atLeast} 超出上限 ${hi}，永远无法满足`, owner);
      if (c.atMost !== undefined && c.atMost < def.min) err('s1.gate-out-of-range', `${owner}：${def.label} ≤ ${c.atMost} 低于下限 ${def.min}，永远无法满足`, owner);
    }
    if (c.kind === 'storylet_seen' && !storyletIds.has(c.storyletId)) err('s1.unknown-storylet', `${owner} 的剧情卡不存在：${c.storyletId}`, owner);
    if (c.kind === 'clock' && !clock) err('s1.clock-missing', `${owner} 使用时钟条件，但世界没有 clock`, owner);
  }, (e, owner) => {
    if ((e.kind === 'resource' || e.kind === 'resource_max') && !resourceIds.has(e.resourceId)) err('s1.unknown-resource', `${owner} 的资源不存在：${e.resourceId}`, owner);
    if (e.kind === 'ending' && !endingIds.has(e.endingId)) err('s1.unknown-ending', `${owner} 的结局不存在：${e.endingId}`, owner);
    if (e.kind === 'roll') for (const m of e.chance.mods ?? []) {
      if (m.resourceId && !resourceIds.has(m.resourceId)) err('s1.unknown-resource', `${owner} 的成功率修正资源不存在：${m.resourceId}`, owner);
      if (m.factId && !factIds.has(m.factId)) err('s1.unknown-fact', `${owner} 的成功率修正事实不存在：${m.factId}`, owner);
    }
  });
  issues.push(...validateEndingExtras(world));
  // Endings with empty `when` must be reachable through an ending effect / onMin / onMax / timeoutEndingId.
  const referenced = new Set<string>(clock?.timeoutEndingId ? [clock.timeoutEndingId] : []);
  for (const def of Object.values(defs)) { if (def.onMin?.ending) referenced.add(def.onMin.ending); if (def.onMax?.ending) referenced.add(def.onMax.ending); }
  walkWorldLogic(world, () => {}, e => { if (e.kind === 'ending') referenced.add(e.endingId); });
  for (const e of world.endings) if (!e.when.length && !referenced.has(e.id)) warn('s1.ending-unreferenced', `结局 ${e.id} 没有触发条件，也没有被任何效果/阈值引用（不可达）`, e.id);
  return issues;
}

/**
 * K15 lint (§12): passage / recap ids unique, text non-empty, condition references exist (facts, resources, storylets),
 * and — as a warning — every ending has at least one recap line that can hold when it fires.
 * Static approximation of "can hold": no unknown references, resource gates inside bounds, and no fact condition that
 * directly contradicts a fact condition of the ending's own `when`. The simulator reports the observed coverage.
 */
export function validateEndingExtras(world: WorldContent): S1Issue[] {
  const issues: S1Issue[] = [];
  const err = (ruleId: string, message: string, target?: string) => issues.push({level: 'error', ruleId, message, ...(target ? {target} : {})});
  const warn = (ruleId: string, message: string, target?: string) => issues.push({level: 'warning', ruleId, message, ...(target ? {target} : {})});
  const factIds = new Set(world.facts.map(f => f.id)); const defs = world.resourceDefs ?? {};
  const resourceIds = new Set([...Object.keys(world.resources ?? {}), ...Object.keys(defs)]);
  const storyletIds = new Set((world.storylets ?? []).map(s => s.id));
  const flat = (items: readonly WorldCondition[]): WorldCondition[] => items.flatMap(c => c.kind === 'anyOf' ? [c, ...(c.conditions as WorldCondition[])] : [c]);
  /** Returns the problems of one condition list (unknown refs / out-of-range gates). */
  const problems = (items: readonly WorldCondition[]): string[] => flat(items).flatMap(c => {
    if ((c.kind === 'fact' || c.kind === 'known') && !factIds.has(c.factId)) return [`事实不存在：${c.factId}`];
    if (c.kind === 'resource' && !resourceIds.has(c.resourceId)) return [`资源不存在：${c.resourceId}`];
    if (c.kind === 'resource' && defs[c.resourceId]) {
      const def = defs[c.resourceId]!;
      if (c.atLeast !== undefined && def.max !== undefined && c.atLeast > def.max) return [`${def.label} ≥ ${c.atLeast} 超出上限 ${def.max}`];
      if (c.atMost !== undefined && c.atMost < def.min) return [`${def.label} ≤ ${c.atMost} 低于下限 ${def.min}`];
    }
    if (c.kind === 'storylet_seen' && !storyletIds.has(c.storyletId)) return [`剧情卡不存在：${c.storyletId}`];
    return [];
  });
  const seenPassage = new Set<string>();
  for (const e of world.endings) {
    seenPassage.clear();
    for (const p of e.passages ?? []) {
      const owner = `结局 ${e.id} 附加段落 ${p.id}`;
      if (seenPassage.has(p.id)) err('k15.duplicate-id', `结局 ${e.id} 的附加段落 ID 重复：${p.id}`, e.id);
      seenPassage.add(p.id);
      if (!p.text.trim()) err('k15.empty-text', `${owner}：正文为空`, e.id);
      for (const msg of problems(p.when)) err('k15.unknown-reference', `${owner}：${msg}`, e.id);
    }
  }
  const recap = world.recap ?? [];
  const recapIds = new Set<string>();
  for (const r of recap) {
    if (recapIds.has(r.id)) err('k15.duplicate-id', `回顾 ID 重复：${r.id}`);
    recapIds.add(r.id);
    if (!r.text.trim()) err('k15.empty-text', `回顾 ${r.id}：正文为空`);
    for (const msg of problems(r.when)) err('k15.unknown-reference', `回顾 ${r.id}：${msg}`);
  }
  if (recap.length) {
    const viable = recap.filter(r => !problems(r.when).length);
    const plainFacts = (items: readonly WorldCondition[]) => items.flatMap(c => c.kind === 'fact' ? [c] : []);
    for (const e of world.endings) {
      const fixed = plainFacts(e.when);
      const any = viable.some(r => !plainFacts(r.when).some(rc => fixed.some(ec => ec.factId === rc.factId && ec.value !== rc.value)));
      if (!any) warn('k15.recap-unreachable', `结局 ${e.id}：没有任何一条「这一生」回顾可能成立（结局页回顾区块将不显示）`, e.id);
    }
  }
  return issues;
}
