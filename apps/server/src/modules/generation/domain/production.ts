import { worldContentSchema, type ProductionBrief, type ProductionPlan, type ProductionUnit, type ProductionNarrative, type SourceDocument, type WorldContent, type WorldEffect } from '@novel-game/contracts';
import { DEFAULT_BANNED_PHRASES, textLength, VOLUME_TIERS, jaccard, shingles } from '@novel-game/rules/preflight';
import { validateWorld } from '../../worlds/index.js';
import { AppError } from '../../../shared/errors.js';

function invalid(issues: {path: string; message: string}[]): void {
  if (issues.length) throw new AppError('INVALID_PRODUCTION', issues.slice(0, 5).map(issue => issue.message).join('；'), 422, {issues, path: issues[0]!.path});
}

/** Checks mechanics while prose is still a short writing brief. */
export function assertProductionPlan(plan: ProductionPlan, brief: ProductionBrief, source: SourceDocument): void {
  const w = plan.world;
  const issues: {path: string; message: string}[] = [];
  const add = (path: string, message: string) => issues.push({path, message});
  const target = VOLUME_TIERS[brief.tier];
  if (w.playerRole !== brief.playerRole) add('world.playerRole', '玩家身份必须原样保留作者指定的角色');
  if ((w.storylets?.length ?? 0) < target.cards) add('world.storylets', `${brief.tier} 档至少需要 ${target.cards} 张有规则的剧情卡`);
  if ((w.storylets?.filter(card => card.repeat).length ?? 0) < target.repeatable) add('world.storylets', `至少需要 ${target.repeatable} 张可重复事件`);
  if (w.npcs.length < 3) add('world.npcs', '至少需要三个有目标与互动的配角');
  const defs = Object.values(w.resourceDefs ?? {});
  if (defs.length < 4 || defs.some(def => def.max === undefined)) add('world.resourceDefs', '至少需要四种有上下限的资源，包含人物关系和压力');
  if (w.endings.filter(ending => !ending.kind || ending.kind === 'ending').length < target.endings || w.endings.filter(ending => ending.kind === 'failure').length < target.failureEndings) add('world.endings', '普通与失败结局数量不足');
  const endingIds = new Set(w.endings.map(ending => ending.id));
  const ordinaryEndingIds = new Set(w.endings.filter(ending => ending.kind !== 'failure').map(ending => ending.id));
  const routeEndings = new Set(plan.routes.flatMap(route => route.endingIds));
  if ([...routeEndings].filter(id => ordinaryEndingIds.has(id)).length < 3 ||
    plan.routes.some(route => !route.endingIds.some(id => ordinaryEndingIds.has(id))) ||
    [...routeEndings].some(id => !endingIds.has(id))) add('routes', '三条策略应覆盖至少三个不同的普通结局，失败结局不能替代通关策略');
  const chapterIds = source.chapters.map(chapter => chapter.id);
  if (chapterIds.length !== w.sourceChapterIds.length || chapterIds.some(id => !w.sourceChapterIds.includes(id))) add('world.sourceChapterIds', '章节范围必须与本次输入一致');
  for (const message of validateWorld(w, source).errors) add('world', message);
  invalid(issues);
}

export function productionUnits(plan: ProductionPlan): ProductionUnit[] {
  return [
    ...plan.world.locations.map(item => ({kind: 'location' as const, id: item.id, variants: 1 as const})),
    ...(plan.world.storylets ?? []).map(item => ({kind: 'storylet' as const, id: item.id, variants: item.repeat ? 2 as const : 1 as const})),
    ...plan.world.actions.map(item => ({kind: 'action' as const, id: item.id, variants: 1 as const})),
    ...plan.world.endings.map(item => ({kind: 'ending' as const, id: item.id, variants: 1 as const})),
    ...plan.world.events.map(item => ({kind: 'event' as const, id: item.id, variants: 1 as const})),
    {kind: 'timeout' as const, id: 'timeout', variants: 1 as const},
  ].map(unit => ({...unit, key: `${unit.kind}:${unit.id}`}));
}

export function productionTarget(plan: ProductionPlan, unit: ProductionUnit) {
  const world = plan.world;
  switch (unit.kind) {
    case 'location': return world.locations.find(item => item.id === unit.id)!;
    case 'storylet': return world.storylets!.find(item => item.id === unit.id)!;
    case 'action': return world.actions.find(item => item.id === unit.id)!;
    case 'ending': return world.endings.find(item => item.id === unit.id)!;
    case 'event': return world.events.find(item => item.id === unit.id)!;
    case 'timeout': return {id: 'timeout', title: '期限耗尽', text: world.timeoutEnding};
  }
}

function outcomeIds(plan: ProductionPlan, unit: ProductionUnit): string[] {
  if (unit.kind === 'storylet') return plan.world.storylets!.find(item => item.id === unit.id)!.choices.map(choice => choice.id);
  return unit.kind === 'action' ? [unit.id] : [];
}

/** Text quality is checked per unit; repairs do not touch accepted mechanics. */
export function assertProductionNarrative(plan: ProductionPlan, unit: ProductionUnit, text: ProductionNarrative): void {
  const issues: {path: string; message: string}[] = [];
  // Match publication's scene floors; total volume is checked once the game is assembled.
  const min = unit.kind === 'storylet' ? 120 : unit.kind === 'location' ? 150 : ['ending', 'timeout'].includes(unit.kind) ? 180 : unit.kind === 'action' ? 20 : 60;
  if (text.texts.length !== unit.variants) issues.push({path: 'texts', message: `需要 ${unit.variants} 段独立正文`});
  text.texts.forEach((body, i) => {
    if (textLength(body) < min) issues.push({path: `texts.${i}`, message: `第 ${i + 1} 段正文实际只有 ${textLength(body)} 字，至少需要 ${min} 字；请写到 ${min * 2} 字左右，须呈现具体人物、处境和可行动线索`});
  });
  const ids = outcomeIds(plan, unit);
  if (Object.keys(text.outcomes).length !== ids.length || ids.some(id => !text.outcomes[id])) issues.push({path: 'outcomes', message: `结果文案须恰好覆盖这些行动/选项：${ids.join(', ')}`});
  for (const [id, outcome] of Object.entries(text.outcomes)) if (textLength(outcome.text) < 60) issues.push({path: `outcomes.${id}.text`, message: '选择后果至少 60 字，明确描写本次行为造成的变化'});
  const choices = unit.kind === 'storylet' ? plan.world.storylets!.find(item => item.id === unit.id)!.choices
    : unit.kind === 'action' ? [plan.world.actions.find(item => item.id === unit.id)!] : [];
  for (const choice of choices) if (choice.effects.some(effect => effect.kind === 'roll')) {
    const outcome = text.outcomes[choice.id];
    if (!outcome?.successText || !outcome.failureText || textLength(outcome.successText) < 60 || textLength(outcome.failureText) < 60)
      issues.push({path: `outcomes.${choice.id}`, message: '概率行动必须分别提供至少 60 字的成功与失败结果'});
  }
  const all = [...text.texts, ...Object.values(text.outcomes).flatMap(value => [value.text, value.successText ?? '', value.failureText ?? ''])];
  for (const phrase of DEFAULT_BANNED_PHRASES) if (all.some(body => body.includes(phrase))) issues.push({path: 'texts', message: `禁止使用模板句「${phrase}」`});
  if (text.texts.length === 2 && jaccard(shingles(text.texts[0]!), shingles(text.texts[1]!)) >= 0.6) issues.push({path: 'texts.1', message: '重复事件的两段正文须有不同情境，不能只改少数词语'});
  invalid(issues);
}

function fillEffects(effects: WorldEffect[], outcome: ProductionNarrative['outcomes'][string]): WorldEffect[] {
  return effects.map(effect => effect.kind === 'roll' ? {...effect,
    ...(outcome.successText ? {successText: outcome.successText} : {}), ...(outcome.failureText ? {failureText: outcome.failureText} : {})} : effect);
}

/** Deterministic assembly. The prose model has no opportunity to change costs, gates or topology. */
export function assembleProduction(plan: ProductionPlan, texts: Record<string, ProductionNarrative>, brief: ProductionBrief): WorldContent {
  const world = structuredClone(plan.world);
  for (const unit of productionUnits(plan)) {
    const written = texts[unit.key]!;
    if (unit.kind === 'storylet') {
      const card = world.storylets!.find(item => item.id === unit.id)!;
      delete card.text; delete card.textVariants;
      if (written.texts.length === 2) card.textVariants = written.texts; else card.text = written.texts[0]!;
      card.choices = card.choices.map(choice => ({...choice, text: written.outcomes[choice.id]!.text, effects: fillEffects(choice.effects, written.outcomes[choice.id]!)}));
    } else if (unit.kind === 'action') {
      const action = world.actions.find(item => item.id === unit.id)!;
      action.description = written.texts[0]!;
      action.text = written.outcomes[action.id]!.text;
      action.effects = fillEffects(action.effects, written.outcomes[action.id]!);
    } else if (unit.kind === 'timeout') {
      world.timeoutEnding = written.texts[0]!;
    } else {
      productionTarget({ ...plan, world }, unit).text = written.texts[0]!;
    }
  }
  world.playerRole = brief.playerRole;
  world.production = {complete: true, tier: brief.tier};
  return worldContentSchema.parse(world);
}
