import { storyletBodies, type AdventureAction, type AdventureClockView, type AdventureHandView, type AdventureResourceMeta, type AdventureRollView, type AdventureView, type BuildingLibrary, type ItemCatalog, type WorldContent, type WorldEffect, type WorldRevision } from '@novel-game/contracts';
import { fillSpecificBlockedReason, projectFillActions, type FillCompiledAction } from '@novel-game/rules';
import { AppError } from '../errors.js';
import type { AdventureState } from './adventure-state.js';
import { visible, blockedReason, matches, requiresBlock } from './rules.js';
import { computeChance, countdownResource, formatCalendar, isS1World, timeLimitOf } from './s1-core.js';
import { inWindow, locationText, storyletChoiceId } from './storylets.js';
import { storyletChoiceBlock } from './advance-adventure.js';
import { systemWait } from './system-actions.js';
import { projectAdventureMap } from './map-view.js';

function softFactLabel(id: string): string {
  if (id.startsWith('own_')) return id.slice(4).replace(/_/g, ' ');
  if (id.startsWith('enc_engaged_')) return '遭遇开始';
  if (id.startsWith('enc_resolved_')) return '遭遇了结';
  if (id.startsWith('enc_fled_')) return '已撤离';
  if (id.startsWith('enc_defeated_')) return '已击败';
  return id.replace(/_/g, ' ');
}

export type ProjectAdventureOptions = {
  buildingLibrary?: BuildingLibrary;
  itemCatalog?: ItemCatalog;
  resourceLabels?: Record<string, string>;
};

function resourceLabelsFromWorld(world: WorldRevision['content']): Record<string, string> {
  const labels: Record<string, string> = {
    coin: '通货', primary_coin: '通货', hp: '体力', gold: '金币', reputation: '声望',
  };
  for (const f of world.map?.layers?.factions?.factions ?? []) {
    for (const st of f.stats ?? []) {
      if (st.resourceId && st.label) labels[st.resourceId] = st.label;
    }
  }
  return labels;
}

function projectOneAction(
  action: FillCompiledAction | WorldRevision['content']['actions'][number],
  world: WorldRevision['content'],
  state: AdventureState,
): AdventureView['actions'][number] {
  const fill = action as FillCompiledAction;
  const specific = fill.fillBlockHints
    ? fillSpecificBlockedReason(fill, state.resources ?? {}, state.facts)
    : undefined;
  const reason = specific ?? blockedReason(action, world, state);
  const s1 = isS1World(world) ? s1ActionExtras(action, world, state, reason, specific !== undefined) : {};
  return {
    id: action.id,
    label: action.label,
    description: action.description,
    timeCost: action.timeCost,
    risk: action.risk,
    enabled: reason === undefined,
    ...(reason === undefined ? {} : { blockedReason: reason }),
    ...(fill.costHints?.length ? { costHints: fill.costHints } : {}),
    ...(fill.kindHint ? { kindHint: fill.kindHint } : {}),
    ...(fill.fillGroupId ? { fillGroupId: fill.fillGroupId } : {}),
    ...s1,
  };
}

function firstRoll(effects: WorldEffect[]) { return effects.find(effect => effect.kind === 'roll'); }
function rollView(effects: WorldEffect[], world: WorldContent, state: AdventureState): AdventureRollView | undefined {
  const roll = firstRoll(effects);
  if (!roll || roll.kind !== 'roll') return undefined;
  const breakdown = computeChance(roll, state.resources ?? {}, world, state.facts);
  return roll.showChance === false
    ? {min: breakdown.min, max: breakdown.max}
    : {chance: breakdown.chance, parts: breakdown.parts, min: breakdown.min, max: breakdown.max};
}
/** C6/C7 extras for fixed actions in S1 worlds. */
function s1ActionExtras(action: WorldContent['actions'][number], world: WorldContent, state: AdventureState, reason: string | undefined, fillSpecific: boolean): Partial<AdventureAction> {
  const roll = rollView(action.effects, world, state);
  let kind: AdventureAction['blockedReasonKind'];
  if (reason !== undefined) {
    if (fillSpecific) kind = 'legacy';
    else if (reason === '剩余时间不足') kind = 'generated';
    else if (!matches(action.requires, state, world)) kind = requiresBlock(action.requires, world, state, action.blockedReason).kind;
    else kind = 'legacy';
  }
  return {...(roll ? {roll} : {}), ...(kind ? {blockedReasonKind: kind} : {})};
}

function projectResourceMeta(world: WorldContent, state: AdventureState): AdventureResourceMeta[] {
  const countdownId = countdownResource(world);
  return Object.entries(world.resourceDefs ?? {}).filter(([, def]) => def.display !== 'hidden').map(([id, def]) => {
    const value = state.resources?.[id] ?? def.min;
    const max = state.resourceMax?.[id] ?? def.max;
    const warn = def.warnAtMost !== undefined && value <= def.warnAtMost ? 'low' as const
      : def.warnAtLeast !== undefined && value >= def.warnAtLeast ? 'high' as const : undefined;
    // A countdown (寿元) is never 「已封顶」: being at its starting ceiling is not news to the player.
    const bound = value <= def.min ? 'min' as const : max !== undefined && value >= max && id !== countdownId ? 'max' as const : undefined;
    const valueLabel = def.valueLabels?.[value - def.min];
    return {id, label: def.label, ...(def.unit ? {unit: def.unit} : {}), value, min: def.min, ...(max !== undefined ? {max} : {}),
      display: def.display === 'bar' || def.display === 'pips' ? def.display : 'number' as const,
      ...(warn ? {warn} : {}), ...(bound ? {bound} : {}), ...(valueLabel ? {valueLabel} : {})};
  });
}

/** Countdown resources never read 「已封顶」 (old saves may still carry the clamp flag). */
function projectLastResult(world: WorldContent, last: NonNullable<AdventureState['lastResult']>): NonNullable<AdventureState['lastResult']> {
  const copy = structuredClone(last);
  const countdownId = countdownResource(world);
  if (!countdownId) return copy;
  copy.deltas = copy.deltas.flatMap(d => {
    if ('kind' in d || d.id !== countdownId || d.clamped !== 'max') return [d];
    const {clamped: _drop, ...rest} = d;
    return rest.delta === 0 ? [] : [rest];
  });
  return copy;
}
function projectClock(world: WorldContent, state: AdventureState): AdventureClockView | undefined {
  const clock = world.clock;
  if (!clock) return undefined;
  const openWindows = (clock.windows ?? []).filter(w => (state.openWindows ?? []).includes(w.id)).map(w => ({
    id: w.id, label: w.label ?? world.storylets?.find(sl => sl.id === w.storyletId)?.title ?? w.id, monthsLeft: Math.max(0, w.toMonth - state.elapsed),
  }));
  const countdownId = countdownResource(world);
  const def = countdownId ? world.resourceDefs?.[countdownId] : undefined;
  return {
    month: state.elapsed, label: formatCalendar(world, state.elapsed), limitMonths: clock.limitMonths, unit: 'month', openWindows,
    ...(countdownId ? {countdown: {resourceId: countdownId, label: def?.label ?? countdownId, value: state.resources?.[countdownId] ?? 0, ...(def?.unit ? {unit: def.unit} : {})}} : {}),
  };
}
function projectHand(world: WorldContent, state: AdventureState): AdventureHandView[] {
  return (state.hand ?? []).flatMap(card => {
    const sl = world.storylets?.find(item => item.id === card.storyletId);
    if (!sl) return [];
    const choices: AdventureAction[] = sl.choices.filter(choice => !choice.availableWhen?.length || matches(choice.availableWhen, state, world)).map(choice => {
      const block = storyletChoiceBlock(choice, world, state);
      const roll = rollView(choice.effects, world, state);
      return {id: storyletChoiceId(sl.id, choice.id), label: choice.label, description: '', timeCost: choice.timeCost, risk: choice.risk ?? '',
        enabled: !block, ...(block ? {blockedReason: block.reason, blockedReasonKind: block.kind} : {}), ...(roll ? {roll} : {})};
    });
    const bodies = storyletBodies(sl);
    return [{storyletId: sl.id, title: sl.title, text: bodies[card.variant] ?? bodies[0] ?? '',
      urgent: !!sl.urgent || !!card.forced, inWindow: inWindow(world, state, sl.id), seenCount: state.storyletState?.seen[sl.id] ?? 0,
      fresh: card.drawnTurn === state.turn, repeatable: !!sl.repeat, choices}];
  });
}
function s1View(world: WorldContent, state: AdventureState): Partial<AdventureView> {
  const clock = projectClock(world, state);
  return {
    ...(world.resourceDefs ? {resourceMeta: projectResourceMeta(world, state)} : {}),
    ...(state.lastResult ? {lastResult: projectLastResult(world, state.lastResult)} : {}),
    ...(clock ? {clock, timeUnit: 'month' as const} : {}),
    ...(world.storylets ? {hand: state.ending ? [] : projectHand(world, state)} : {}),
    ...(state.rng ? {rng: {...state.rng}} : {}),
  };
}

export function projectAdventure(
  state: AdventureState,
  revision: WorldRevision,
  opts: ProjectAdventureOptions = {},
): AdventureView {
  const world = revision.content;
  const location = world.locations.find(item => item.id === state.locationId);
  if (!location) throw new AppError('INVALID_WORLD_STATE', '存档地点不存在', 500);
  const resources = { ...(state.resources ?? world.resources ?? {}) };
  const labels = opts.resourceLabels ?? resourceLabelsFromWorld(world);
  const fill = projectFillActions(world, {
    library: opts.buildingLibrary,
    catalog: opts.itemCatalog,
    resourceLabels: labels,
  });

  const worldActions = state.ending
    ? []
    : [...world.actions, systemWait(state.locationId)]
      .filter(action => visible(action, state, world))
      .map(action => projectOneAction(action, world, state));

  const fillActions = state.ending
    ? []
    : fill.actions
      .filter(action => visible(action, state, world))
      .map(action => projectOneAction(action, world, state));

  const actions = [...worldActions, ...fillActions];

  const fillGroups = state.ending
    ? undefined
    : fill.groups
      .filter(g => g.locationId === state.locationId)
      .map(g => ({
        id: g.id,
        label: g.label,
        kindHint: g.kindHint,
        locationId: g.locationId,
        lineActionIds: g.lineActionIds.filter(id => actions.some(a => a.id === id)),
        ...(g.emptyMessage ? { emptyMessage: g.emptyMessage } : {}),
        ...(g.sheetEyebrow ? { sheetEyebrow: g.sheetEyebrow } : {}),
      }));

  const map = projectAdventureMap(world, state, actions);
  return {
    id: state.id, worldRevisionId: state.worldRevisionId, turn: state.turn, elapsed: state.elapsed,
    timeLimit: timeLimitOf(world), ended: !!state.ending, playerRole: world.playerRole, goal: world.goal,
    location: { id: location.id, title: location.title, text: location.textVariants ? locationText(world, state, location.id) : location.text },
    facts: (() => {
      const fromWorld = world.facts.filter(fact => state.knownFactIds.includes(fact.id)).map(fact => ({
        id: fact.id, label: fact.label, description: fact.description, kind: fact.kind as 'clue' | 'item' | 'relationship' | 'event', value: state.facts[fact.id],
      }));
      const seen = new Set(fromWorld.map(f => f.id));
      const extras = state.knownFactIds
        .filter(id => !seen.has(id) && Object.hasOwn(state.facts, id))
        .map(id => ({
          id,
          label: softFactLabel(id),
          description: '',
          kind: 'event' as const,
          value: state.facts[id],
        }));
      return [...fromWorld, ...extras];
    })(),
    resources,
    npcs: world.npcs.filter(npc => state.npcs[npc.id]?.locationId === state.locationId).map(npc => ({
      id: npc.id, name: npc.name, description: npc.description,
      ...(npc.factionId ? { factionId: npc.factionId } : {}),
      ...(npc.tags?.length ? { tags: [...npc.tags] } : {}),
    })),
    actions,
    ...(fillGroups?.length ? { fillGroups } : {}),
    ...(state.ending ? { ending: { ...state.ending } } : {}),
    history: state.history.map(entry => ({ ...entry })),
    createdAt: state.createdAt, updatedAt: state.updatedAt,
    ...(map ? { map } : {}),
    ...(isS1World(world) ? s1View(world, state) : {}),
  };
}
