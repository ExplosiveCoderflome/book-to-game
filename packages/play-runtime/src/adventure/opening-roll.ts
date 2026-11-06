import type { OpeningRollConfig, OpeningRollSession, OpeningRollSet, OpeningRollTag, WorldContent } from '@novel-game/contracts';
import { seedFromString } from './s1-core.js';
import { isS1World, newEffectContext } from './s1-core.js';
import { settle } from './rules.js';
import { locationText, refreshHand } from './storylets.js';
import type { AdventureState } from './adventure-state.js';

function next(session: OpeningRollSession): number {
  let t = (session.seed + session.seedCursor++ * 0x6d2b79f5) | 0;
  t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61);
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
}
function sample(session: OpeningRollSession, min: number, max: number, step: number, dist: string) {
  const count = Math.floor((max - min) / step) + 1;
  const draw = dist === 'bell' ? (next(session) + next(session) + next(session)) / 3
    : dist === 'skewLow' ? next(session) ** 2 : dist === 'skewHigh' ? 1 - next(session) ** 2 : next(session);
  return Math.min(max, min + Math.floor(draw * count) * step);
}
function rawSet(config: OpeningRollConfig, session: OpeningRollSession): OpeningRollSet {
  if (config.mode === 'preset') {
    const presets = config.presets!; const total = presets.reduce((n, p) => n + p.weight, 0); let pick = next(session) * total;
    const preset = presets.find(p => (pick -= p.weight) < 0) ?? presets[presets.length - 1]!;
    const values = {...preset.values};
    for (const stat of config.stats) values[stat.resourceId] = Math.max(stat.min, Math.min(stat.max, (values[stat.resourceId] ?? stat.min) + Math.floor(next(session) * 3) - 1));
    return {values, tags:[...(preset.tags ?? [])], presetId:preset.id};
  }
  const values: Record<string,number> = {};
  if (config.mode === 'perStat') for (const stat of config.stats) values[stat.resourceId] = sample(session, stat.min, stat.max, stat.step, stat.dist);
  else {
    const min = config.pointBuy!.total && typeof config.pointBuy!.total === 'object' ? config.pointBuy!.total.min : config.pointBuy!.total as number;
    const max = typeof config.pointBuy!.total === 'object' ? config.pointBuy!.total.max : config.pointBuy!.total as number;
    let points = min + Math.floor(next(session) * (Math.floor(max - min) + 1));
    const low = config.pointBuy!.perStatMin ?? Math.min(...config.stats.map(s => s.min));
    const high = config.pointBuy!.perStatMax ?? Math.max(...config.stats.map(s => s.max));
    for (const stat of config.stats) values[stat.resourceId] = Math.max(stat.min, config.pointBuy!.perStatMin ?? stat.min);
    points = Math.max(0, points - Object.values(values).reduce((a,b) => a+b,0));
    while (points > 0) {
      const available = config.stats.filter(stat => values[stat.resourceId]! < Math.min(stat.max, config.pointBuy!.perStatMax ?? stat.max));
      if (!available.length) break;
      const stat = available[Math.floor(next(session) * available.length)]!; values[stat.resourceId]!++; points--;
    }
  }
  return {values};
}
function score(config: OpeningRollConfig, values: Record<string,number>) { return Object.entries(values).reduce((n,[id,v]) => n + v * (config.score?.[id] ?? 1), 0); }
function triggered(config: OpeningRollConfig, values: Record<string,number>): OpeningRollTag[] {
  const selected = new Set<string>(); const groups = new Set<string>();
  for (const tag of config.tags) {
    const v = values[tag.when.kind === 'anyOf' ? tag.when.conditions[0]!.resourceId : tag.when.resourceId];
    const matches = tag.when.kind === 'atLeast' ? v >= tag.when.value : tag.when.kind === 'atMost' ? v <= tag.when.value
      : tag.when.kind === 'range' ? v >= tag.when.min && v <= tag.when.max : tag.when.conditions.some(c => values[c.resourceId]! >= (c.atLeast ?? -Infinity) && values[c.resourceId]! <= (c.atMost ?? Infinity));
    if (matches && (!tag.exclusive || !groups.has(tag.exclusive))) { selected.add(tag.id); if (tag.exclusive) groups.add(tag.exclusive); }
  }
  return config.tags.filter(tag => selected.has(tag.id));
}
function materialize(config: OpeningRollConfig, raw: OpeningRollSet): OpeningRollSet {
  const tags = triggered(config, raw.values);
  const tier = [...config.tiers].sort((a,b) => b.minScore-a.minScore).find(t => score(config, raw.values) >= t.minScore);
  return {...raw, tags: [...new Set([...(raw.tags ?? []), ...tags.map(t => t.id)])], ...(tier ? {tierId:tier.id, tierLabel:tier.label, verdict:tier.verdict} : {})} as OpeningRollSet;
}
function passesFloor(config: OpeningRollConfig, set: OpeningRollSet) {
  const floor = config.floor; return !floor || ((floor.minScore === undefined || score(config,set.values) >= floor.minScore)
    && (floor.minAny === undefined || Object.values(set.values).some(v => v >= floor.minAny!)));
}
function drawOne(world: WorldContent, session: OpeningRollSession): OpeningRollSet {
  const config = world.openingRoll!; let attempts = 0;
  while (attempts++ < 1000) { const result = materialize(config, rawSet(config, session)); if (passesFloor(config,result)) return result; }
  throw new Error('开局保底无法满足，请检查配置');
}
export function createOpeningRollSession(world: WorldContent, seed: number, initialResources: Record<string,number> = {}): OpeningRollSession {
  const config = world.openingRoll!; const actualSeed = config.seedPolicy === 'fixed' ? config.fixedSeed! : seed;
  return {phase:'opening', seed:actualSeed, seedCursor:0, history:[], selectedIndex:null, rerollsLeft:config.rerolls, status:'rolling', ...(Object.keys(initialResources).length ? {initialResources} : {})};
}
export function applyOpeningRollCommand(world: WorldContent, session: OpeningRollSession, command: 'roll'|'reroll'|'select'|'confirm'|'useStandard', index?: number) {
  const config = world.openingRoll!; const nextSession = structuredClone(session);
  if (session.phase !== 'opening' || session.status !== 'rolling') throw new Error('开局阶段已结束');
  if (command === 'select') { if (index === undefined || !Number.isInteger(index) || index < 0 || index >= nextSession.history.length) throw new Error('开局记录不存在'); nextSession.selectedIndex=index; return nextSession; }
  if (command === 'confirm') { if (nextSession.selectedIndex === null) throw new Error('请先选择一套开局'); nextSession.phase='play'; nextSession.status='confirmed'; return nextSession; }
   if (command === 'useStandard') { if (nextSession.history.length) throw new Error('已经掷出开局'); if (!config.standard) throw new Error('没有标准开局'); nextSession.history=[materialize(config, config.standard)]; nextSession.selectedIndex=0; return nextSession; }
   if (command === 'reroll') { if (!nextSession.history.length) throw new Error('请先掷出开局'); if (nextSession.rerollsLeft <= 0) throw new Error('重掷次数已用完'); nextSession.rerollsLeft--; if (!config.keepBest || config.choice.kind === 'pickOf') { nextSession.history=[]; nextSession.selectedIndex=null; } }
  if (command === 'roll' && nextSession.history.length) throw new Error('已经掷出开局');
  const count = config.choice.kind === 'pickOf' ? config.choice.n : 1;
  for (let i=0;i<count;i++) nextSession.history.push(drawOne(world,nextSession));
  nextSession.selectedIndex = count === 1 ? nextSession.history.length-1 : null;
  return nextSession;
}
export function applyOpeningSet(world: WorldContent, state: {resources:Record<string,number>;facts:Record<string,boolean>;forcedStorylets?:string[]}, session: OpeningRollSession) {
  const choice = session.history[session.selectedIndex ?? -1]; if (!choice) return state;
  Object.assign(state.resources, choice.values);
  for (const id of Object.keys(choice.values)) { const max = world.resourceDefs?.[id]?.max; if (max !== undefined) state.resources[id] = Math.min(max, state.resources[id]!); }
  for (const tagId of choice.tags ?? []) { const tag = world.openingRoll!.tags.find(t => t.id === tagId); if (!tag) continue;
    for (const fact of tag.grant.facts ?? []) state.facts[fact]=true;
    for (const [id,delta] of Object.entries(tag.grant.resources ?? {})) {
      const def=world.resourceDefs?.[id]; const value=(state.resources[id] ?? 0)+delta;
      state.resources[id]=def ? Math.min(def.max ?? Infinity,Math.max(def.min,value)) : value;
    }
    state.forcedStorylets ??=[]; state.forcedStorylets.push(...(tag.grant.storylets ?? []));
    state.forcedStorylets.push(...(tag.grant.events ?? []));
  }
  return state;
}
export function completeOpening(world: WorldContent, state: AdventureState): void {
  if (!state.openingRoll || state.openingRoll.phase !== 'play') throw new Error('请先确认开局');
  applyOpeningSet(world,state,state.openingRoll);
  const events=settle(world,state,isS1World(world) ? newEffectContext() : undefined);
  if (isS1World(world)) refreshHand(world,state,false);
  const location=world.locations.find(item=>item.id===state.locationId);
  if (location) state.history=[{turn:0,elapsed:0,text:[isS1World(world) ? locationText(world,state,state.locationId) : location.text,...events].join('\n')}];
}
export function openingSeedForId(id: string) { return seedFromString(id); }
