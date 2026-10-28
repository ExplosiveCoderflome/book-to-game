/**
 * P1 open-fill: project map fill placements → compile-down adventure actions.
 * Pure; no IO. Catalog shapes ⊕ localOverrides → resource/set/reveal effects.
 * Honesty: no true price / unbound target → no successful buy/heal projection.
 */
import type {
  BuildingAsset,
  BuildingLibrary,
  EncounterContent,
  ItemCatalog,
  LocalPlacementOverrides,
  LootLine,
  MapFillKind,
  MapFillPlacement,
  QuestSlot,
  ShelfLine,
  SupplyRecipe,
  WorldContent,
  WorldEffect,
} from '@novel-game/contracts';
import { findBuildingAsset, MAP_FILL_KIND_LABEL } from '@novel-game/contracts';
import { resourceDisplayLabel as resourceLabel, resourceLabelsForWorld } from './resource-labels.js';

export type FillKindHint = MapFillKind;

export type FillCompiledAction = WorldContent['actions'][number] & {
  costHints?: string[];
  kindHint?: FillKindHint;
  fillGroupId?: string;
  /** Internal: preferred blockedReason when resource/stock gates fail (overrides generic). */
  fillBlockHints?: { money?: string; stock?: string; uses?: string; unbound?: string; missingItem?: string; resolved?: string };
};

export type FillGroupView = {
  id: string;
  label: string;
  kindHint: FillKindHint;
  locationId: string;
  lineActionIds: string[];
  emptyMessage?: string;
  sheetEyebrow?: string;
};

export type FillProjection = {
  actions: FillCompiledAction[];
  groups: FillGroupView[];
  /** Stock / use-count resources to seed into session.resources on start (if absent). */
  seedResources: Record<string, number>;
  /** Encounter resolve/engage/flee/defeat (+ loot own_*) facts to seed false if absent. */
  seedFacts: Record<string, boolean>;
};

export type FillProjectOptions = {
  library?: BuildingLibrary;
  catalog?: ItemCatalog;
  /** Resource display labels (id → displayLabel). */
  resourceLabels?: Record<string, string>;
};

type ResolvedPlacement = {
  placement: MapFillPlacement;
  asset?: BuildingAsset;
  overrides: LocalPlacementOverrides;
  displayLabel: string;
};

const PROVENANCE = { origin: 'adapted' as const, evidence: [] as [] };

function asOverrides(raw: Record<string, unknown> | undefined): LocalPlacementOverrides {
  return (raw ?? {}) as LocalPlacementOverrides;
}

function resolvePlacement(
  placement: MapFillPlacement,
  library: BuildingLibrary | undefined,
): ResolvedPlacement {
  const overrides = asOverrides(placement.localOverrides as Record<string, unknown> | undefined);
  let asset: BuildingAsset | undefined;
  if (placement.buildingAssetId && library) {
    asset = findBuildingAsset(library, placement.buildingAssetId, placement.buildingAssetVersion);
  }
  const displayLabel =
    (typeof overrides.label === 'string' && overrides.label.trim()
      ? overrides.label.trim()
      : undefined)
    || placement.label
    || asset?.label
    || MAP_FILL_KIND_LABEL[placement.kind];
  return { placement, asset, overrides, displayLabel };
}

function itemLabel(itemId: string, catalog: ItemCatalog | undefined, override?: string): string {
  if (override?.trim()) return override.trim();
  const hit = catalog?.items.find(i => i.id === itemId);
  return hit?.label ?? itemId.replace(/_/g, ' ');
}

function stockResourceId(placementId: string, lineKey: string): string {
  return `fs_${placementId}_${lineKey}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
}

function usesResourceId(placementId: string, recipeId: string): string {
  return `fu_${placementId}_${recipeId}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
}

function ownFactId(itemId: string): string {
  return `own_${itemId}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
}

function shelfOf(r: ResolvedPlacement): ShelfLine[] {
  return r.overrides.shop?.shelf ?? r.asset?.shop?.shelf ?? [];
}

function recipesOf(r: ResolvedPlacement): SupplyRecipe[] {
  return r.overrides.supply?.recipes ?? r.asset?.supply?.recipes ?? [];
}

function slotsOf(r: ResolvedPlacement): QuestSlot[] {
  return r.overrides.quest?.slots ?? r.asset?.quest?.slots ?? [];
}


function encounterOf(r: ResolvedPlacement): EncounterContent {
  return r.overrides.encounter ?? r.asset?.encounter ?? { loot: [] };
}

/** World-bound encounter extras (placement UX Out — fixture / overrides may set). */
type EncounterWorldBind = EncounterContent & {
  defeatFactId?: string;
  resolveFactId?: string;
  fleeFactId?: string;
  engageFactId?: string;
  fleeCost?: { resourceId: string; amount: number };
  riskFight?: string;
  riskFlee?: string;
};

function asEncounterBind(enc: EncounterContent): EncounterWorldBind {
  return enc as EncounterWorldBind;
}

function encFactId(prefix: string, placementId: string, override?: string): string {
  if (override?.trim()) return override.trim().slice(0, 80);
  return `${prefix}_${placementId}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
}

/** Deterministic unit in [0,1) from placementId+itemId — Q2 chance stub (no RNG service). */
export function stableLootUnit(placementId: string, itemId: string): number {
  const seed = `${placementId}:${itemId}`;
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

/** Q2=A: chance>=1 always; <=0 never; mid uses stable hash. */
export function lootChancePasses(chance: number, placementId: string, itemId: string): boolean {
  if (chance >= 1) return true;
  if (chance <= 0) return false;
  return stableLootUnit(placementId, itemId) < chance;
}

function compileLootEffects(
  placementId: string,
  loot: LootLine[],
  catalog: ItemCatalog | undefined,
  world?: WorldContent,
): { effects: WorldEffect[]; gainedLabels: string[] } {
  const effects: WorldEffect[] = [];
  const gainedLabels: string[] = [];
  for (const line of loot) {
    // G2: missing itemId must not compile as a successful drop.
    // Catalog membership is authoring validation; play mirrors shop (label falls back to id).
    if (!line.itemId) continue;
    if (!lootChancePasses(line.chance, placementId, line.itemId)) continue;
    const factId = ownFactId(line.itemId);
    effects.push({ kind: 'set', factId, value: true });
    effects.push({ kind: 'reveal', factId });
    const factLabel = world?.facts.find(f => f.id === factId)?.label;
    gainedLabels.push(factLabel || itemLabel(line.itemId, catalog));
    for (const rd of line.resourceDrops ?? []) {
      if (!rd.resourceId || typeof rd.amount !== 'number' || !Number.isFinite(rd.amount)) continue;
      effects.push({ kind: 'resource', resourceId: rd.resourceId, delta: rd.amount });
    }
  }
  return { effects, gainedLabels };
}


/** True price = amount + resourceId present. */
function truePrice(line: { price?: { resourceId?: string; amount?: number }; cost?: { resourceId?: string; amount?: number } }, field: 'price' | 'cost'): { resourceId: string; amount: number } | undefined {
  const hint = field === 'price' ? line.price : line.cost;
  if (!hint || typeof hint.amount !== 'number' || !Number.isFinite(hint.amount)) return undefined;
  if (!hint.resourceId) return undefined;
  return { resourceId: hint.resourceId, amount: hint.amount };
}

type QuestBind = QuestSlot & {
  /** World-bound accept flag (fact id). */
  acceptFactId?: string;
  /** Optional turn-in: require this fact, then grant rewards. */
  turnInRequiresFactId?: string;
};

function asQuestBind(slot: QuestSlot): QuestBind {
  return slot as QuestBind;
}

function collectPlacements(world: WorldContent): MapFillPlacement[] {
  const out: MapFillPlacement[] = [];
  const root = world.map?.fill?.placements ?? [];
  out.push(...root);
  for (const sm of world.subMaps ?? []) {
    out.push(...(sm.fill?.placements ?? []));
  }
  return out;
}

/**
 * Compile fill placements at a world into synthetic actions + UI groups.
 * Unbound prices / unbound supply targets are not projected as successful acts
 * (locked empty or omitted per honesty rules).
 */
export function projectFillActions(world: WorldContent, opts: FillProjectOptions = {}): FillProjection {
  const actions: FillCompiledAction[] = [];
  const groups: FillGroupView[] = [];
  const seedResources: Record<string, number> = {};
  const seedFacts: Record<string, boolean> = {};
  const labels = { ...resourceLabelsForWorld(world), ...opts.resourceLabels };

  for (const placement of collectPlacements(world)) {
    const resolved = resolvePlacement(placement, opts.library);
    const groupId = `fillgrp_${placement.id}`;
    const kind = placement.kind;

    if (kind === 'shop') {
      const shelf = shelfOf(resolved);
      const lineIds: string[] = [];
      if (shelf.length === 0) {
        groups.push({
          id: groupId,
          label: resolved.displayLabel,
          kindHint: 'shop',
          locationId: placement.locationId,
          lineActionIds: [],
          emptyMessage: '尚未开张。这里还没有上架货物。',
          sheetEyebrow: '本店货架',
        });
        continue;
      }
      for (const [i, line] of shelf.entries()) {
        const price = truePrice(line, 'price');
        const label = itemLabel(line.itemId, opts.catalog, line.labelOverride);
        const actionId = `fill_buy_${placement.id}_${i}`.slice(0, 80);
        const stockKey = String(i);
        const stockId = stockResourceId(placement.id, stockKey);
        const stockMax = line.stockMax ?? 1;
        seedResources[stockId] = stockMax;
        const factId = ownFactId(line.itemId);

        if (!price) {
          // Unbound → locked unplayable line (诚实锁), not a successful buy.
          actions.push({
            id: actionId,
            label: `购买·${label}`,
            description: '',
            locationId: placement.locationId,
            availableWhen: [],
            requires: [{ kind: 'fact', factId: '__fill_never__', value: true }],
            blockedReason: '未上架',
            risk: '',
            timeCost: 1,
            once: false,
            effects: [{ kind: 'set', factId: factId, value: false }],
            text: '',
            ...PROVENANCE,
            kindHint: 'shop',
            fillGroupId: groupId,
            fillBlockHints: { unbound: '未上架' },
          });
          lineIds.push(actionId);
          continue;
        }

        const costHint = `${resourceLabel(price.resourceId, labels)} ${price.amount}`;
        const effects: WorldEffect[] = [
          { kind: 'resource', resourceId: price.resourceId, delta: -price.amount },
          { kind: 'resource', resourceId: stockId, delta: -1 },
          { kind: 'set', factId, value: true },
          { kind: 'reveal', factId },
        ];
        // Ensure own fact exists in world? Projection still emits set/reveal; demo world declares facts.
        actions.push({
          id: actionId,
          label: `购买·${label}`,
          description: '',
          locationId: placement.locationId,
          availableWhen: [],
          requires: [
            { kind: 'resource', resourceId: price.resourceId, atLeast: price.amount },
            { kind: 'resource', resourceId: stockId, atLeast: 1 },
          ],
          blockedReason: `${resourceLabel(price.resourceId, labels)}不足`,
          risk: '',
          timeCost: 1,
          once: false,
          effects,
          text: `购得${label}。`,
          ...PROVENANCE,
          costHints: [costHint],
          kindHint: 'shop',
          fillGroupId: groupId,
          fillBlockHints: { money: `${resourceLabel(price.resourceId, labels)}不足`, stock: '无货' },
        });
        lineIds.push(actionId);
      }
      groups.push({
        id: groupId,
        label: resolved.displayLabel,
        kindHint: 'shop',
        locationId: placement.locationId,
        lineActionIds: lineIds,
        sheetEyebrow: '本店货架',
        ...(lineIds.length === 0 ? { emptyMessage: '尚未开张。这里还没有上架货物。' } : {}),
      });
      continue;
    }

    if (kind === 'supply') {
      const recipes = recipesOf(resolved);
      const lineIds: string[] = [];
      if (recipes.length === 0) {
        groups.push({
          id: groupId,
          label: resolved.displayLabel,
          kindHint: 'supply',
          locationId: placement.locationId,
          lineActionIds: [],
          emptyMessage: '这里暂时没有可执行的补给',
          sheetEyebrow: '可恢复',
        });
        continue;
      }
      for (const recipe of recipes) {
        const actionId = `fill_supply_${placement.id}_${recipe.id}`.slice(0, 80);
        const targetName = recipe.target?.name;
        const targetKind = recipe.target?.kind ?? 'resource';
        // Unbound target → must NOT appear as successful heal.
        if (!targetName) {
          actions.push({
            id: actionId,
            label: `补给·${recipe.label}`,
            description: '',
            locationId: placement.locationId,
            availableWhen: [],
            requires: [{ kind: 'fact', factId: '__fill_never__', value: true }],
            blockedReason: '此处补给尚未就绪',
            risk: '',
            timeCost: 1,
            once: false,
            effects: [{ kind: 'set', factId: '__fill_noop__', value: false }],
            text: '',
            ...PROVENANCE,
            kindHint: 'supply',
            fillGroupId: groupId,
            fillBlockHints: { unbound: '此处补给尚未就绪' },
          });
          lineIds.push(actionId);
          continue;
        }

        const cost = truePrice(recipe, 'cost');
        const effects: WorldEffect[] = [];
        const costHints: string[] = [];
        const requires: FillCompiledAction['requires'] = [];
        if (cost) {
          effects.push({ kind: 'resource', resourceId: cost.resourceId, delta: -cost.amount });
          requires.push({ kind: 'resource', resourceId: cost.resourceId, atLeast: cost.amount });
          costHints.push(`${resourceLabel(cost.resourceId, labels)} ${cost.amount}`);
        }
        // Target: resource kind → resource effect; variable kind also maps to resource pool in open (no separate variables).
        if (targetKind === 'resource' || targetKind === 'variable') {
          effects.push({ kind: 'resource', resourceId: targetName, delta: recipe.amount });
        }
        const uses = recipe.uses?.perVisit;
        let usesId: string | undefined;
        if (uses && uses > 0) {
          usesId = usesResourceId(placement.id, recipe.id);
          seedResources[usesId] = uses;
          requires.push({ kind: 'resource', resourceId: usesId, atLeast: 1 });
          effects.push({ kind: 'resource', resourceId: usesId, delta: -1 });
        }
        if (recipe.requiresItemId) {
          requires.push({ kind: 'fact', factId: ownFactId(recipe.requiresItemId), value: true });
        }
        if (effects.length === 0) {
          // Should not happen when target bound; skip as unbound.
          continue;
        }
        actions.push({
          id: actionId,
          label: `补给·${recipe.label}`,
          description: '',
          locationId: placement.locationId,
          availableWhen: [],
          requires,
          blockedReason: usesId ? '次数已用尽' : (cost ? `${resourceLabel(cost.resourceId, labels)}不足` : '当前条件不满足'),
          risk: '',
          timeCost: 1,
          once: false,
          effects,
          text: '补给完成。',
          ...PROVENANCE,
          ...(costHints.length ? { costHints } : {}),
          kindHint: 'supply',
          fillGroupId: groupId,
          fillBlockHints: {
            ...(cost ? { money: `${resourceLabel(cost.resourceId, labels)}不足` } : {}),
            uses: '次数已用尽',
            missingItem: '缺少所需物品',
          },
        });
        lineIds.push(actionId);
      }
      groups.push({
        id: groupId,
        label: resolved.displayLabel,
        kindHint: 'supply',
        locationId: placement.locationId,
        lineActionIds: lineIds,
        sheetEyebrow: '可恢复',
        ...(lineIds.length === 0 ? { emptyMessage: '这里暂时没有可执行的补给' } : {}),
      });
      continue;
    }

    if (kind === 'quest') {
      const slots = slotsOf(resolved);
      const lineIds: string[] = [];
      if (slots.length === 0) {
        groups.push({
          id: groupId,
          label: resolved.displayLabel,
          kindHint: 'quest',
          locationId: placement.locationId,
          lineActionIds: [],
          emptyMessage: '这里暂时没有任务',
          sheetEyebrow: '可接任务',
        });
        continue;
      }
      for (const [i, raw] of slots.entries()) {
        const slot = asQuestBind(raw);
        const acceptFact = slot.acceptFactId || slot.marker;
        if (!acceptFact) {
          // No world-bound flag → locked placeholder (not silently accept).
          const actionId = `fill_quest_accept_${placement.id}_${i}`.slice(0, 80);
          actions.push({
            id: actionId,
            label: `接到·${slot.label}`,
            description: '',
            locationId: placement.locationId,
            availableWhen: [],
            requires: [{ kind: 'fact', factId: '__fill_never__', value: true }],
            blockedReason: '当前条件不满足',
            risk: '',
            timeCost: 1,
            once: true,
            effects: [{ kind: 'set', factId: '__fill_noop__', value: false }],
            text: '',
            ...PROVENANCE,
            kindHint: 'quest',
            fillGroupId: groupId,
          });
          lineIds.push(actionId);
          continue;
        }
        const acceptId = `fill_quest_accept_${placement.id}_${i}`.slice(0, 80);
        actions.push({
          id: acceptId,
          label: `接到·${slot.label}`,
          description: '',
          locationId: placement.locationId,
          availableWhen: [{ kind: 'fact', factId: acceptFact, value: false }],
          requires: [],
          blockedReason: '当前条件不满足',
          risk: '',
          timeCost: 1,
          once: true,
          effects: [
            { kind: 'set', factId: acceptFact, value: true },
            { kind: 'reveal', factId: acceptFact },
          ],
          text: `接到任务：${slot.label}`,
          ...PROVENANCE,
          kindHint: 'quest',
          fillGroupId: groupId,
        });
        lineIds.push(acceptId);

        // Optional minimal turn-in when data exists.
        if (slot.turnInRequiresFactId && slot.rewards) {
          const deliverId = `fill_quest_deliver_${placement.id}_${i}`.slice(0, 80);
          const effects: WorldEffect[] = [
            { kind: 'set', factId: acceptFact, value: false },
          ];
          for (const r of slot.rewards.resources ?? []) {
            if (r.resourceId && typeof r.amount === 'number') {
              effects.push({ kind: 'resource', resourceId: r.resourceId, delta: r.amount });
            }
          }
          for (const flag of slot.rewards.flags ?? []) {
            effects.push({ kind: 'set', factId: flag, value: true });
            effects.push({ kind: 'reveal', factId: flag });
          }
          actions.push({
            id: deliverId,
            label: `交付·${slot.label}`,
            description: '',
            locationId: placement.locationId,
            // Visible after accept; item gate → honest lock (not hidden).
            availableWhen: [
              { kind: 'fact', factId: acceptFact, value: true },
            ],
            requires: [
              { kind: 'fact', factId: slot.turnInRequiresFactId, value: true },
            ],
            blockedReason: '缺少所需物品',
            risk: '',
            timeCost: 1,
            once: true,
            effects,
            text: '交付完成。',
            ...PROVENANCE,
            kindHint: 'quest',
            fillGroupId: groupId,
            fillBlockHints: { missingItem: '缺少所需物品' },
          });
          lineIds.push(deliverId);
        }
      }
      groups.push({
        id: groupId,
        label: resolved.displayLabel,
        kindHint: 'quest',
        locationId: placement.locationId,
        lineActionIds: lineIds,
        sheetEyebrow: '可接任务',
        ...(lineIds.length === 0 ? { emptyMessage: '这里暂时没有任务' } : {}),
      });
      continue;
    }

    if (kind === 'encounter' || kind === 'boss') {
      const enc = asEncounterBind(encounterOf(resolved));
      const isBoss = kind === 'boss' || enc.boss === true;
      const kindHint: FillKindHint = isBoss ? 'boss' : 'encounter';
      const resolveFact = encFactId('enc_resolved', placement.id, enc.resolveFactId);
      const engageFact = encFactId('enc_engaged', placement.id, enc.engageFactId);
      const fleeFact = encFactId('enc_fled', placement.id, enc.fleeFactId);
      const defeatFact = isBoss
        ? encFactId('enc_defeated', placement.id, enc.defeatFactId)
        : undefined;
      seedFacts[resolveFact] = false;
      seedFacts[engageFact] = false;
      seedFacts[fleeFact] = false;
      if (defeatFact) seedFacts[defeatFact] = false;

      const loot = enc.loot ?? [];
      const { effects: lootEffects, gainedLabels } = compileLootEffects(placement.id, loot, opts.catalog, world);
      for (const line of loot) {
        if (line.itemId) seedFacts[ownFactId(line.itemId)] = false;
      }

      const fightId = `fill_enc_fight_${placement.id}`.slice(0, 80);
      const fleeId = `fill_enc_flee_${placement.id}`.slice(0, 80);
      const fightEffects: WorldEffect[] = [
        { kind: 'start_encounter', placementId: placement.id, label: resolved.displayLabel },
        { kind: 'set', factId: resolveFact, value: true },
        { kind: 'reveal', factId: resolveFact },
      ];
      if (defeatFact) {
        fightEffects.push({ kind: 'set', factId: defeatFact, value: true });
        fightEffects.push({ kind: 'reveal', factId: defeatFact });
      }
      fightEffects.push(...lootEffects);

      let fightText: string;
      if (gainedLabels.length) {
        fightText = isBoss
          ? `击败了${resolved.displayLabel}。取得${gainedLabels.join('、')}。`
          : `交锋了结。取得${gainedLabels.join('、')}。`;
      } else if (isBoss) {
        fightText = `击败了${resolved.displayLabel}。`;
      } else if (loot.length === 0) {
        fightText = '了结了这处威胁。这里没有可拿走的东西。';
      } else {
        // Bound loot rows existed but chance/unknown skipped all — honest, no fake drop claim.
        fightText = isBoss ? `击败了${resolved.displayLabel}。` : '交锋了结。';
      }

      actions.push({
        id: fightId,
        label: '交锋',
        description: '',
        locationId: placement.locationId,
        availableWhen: [],
        requires: [{ kind: 'fact', factId: resolveFact, value: false }],
        blockedReason: '已经了结',
        risk: enc.riskFight ?? (isBoss ? '高' : '中'),
        timeCost: 1,
        once: false,
        effects: fightEffects,
        text: fightText,
        ...PROVENANCE,
        kindHint,
        fillGroupId: groupId,
        fillBlockHints: { resolved: '已经了结' },
      });

      const fleeEffects: WorldEffect[] = [
        { kind: 'set', factId: fleeFact, value: true },
        { kind: 'reveal', factId: fleeFact },
        { kind: 'set', factId: resolveFact, value: true },
        { kind: 'reveal', factId: resolveFact },
      ];
      const fleeRequires: FillCompiledAction['requires'] = [
        { kind: 'fact', factId: resolveFact, value: false },
      ];
      const costHints: string[] = [];
      let fleeBlocked = '已经了结';
      if (enc.fleeCost?.resourceId && typeof enc.fleeCost.amount === 'number') {
        fleeEffects.push({
          kind: 'resource',
          resourceId: enc.fleeCost.resourceId,
          delta: -enc.fleeCost.amount,
        });
        fleeRequires.push({
          kind: 'resource',
          resourceId: enc.fleeCost.resourceId,
          atLeast: enc.fleeCost.amount,
        });
        costHints.push(`${resourceLabel(enc.fleeCost.resourceId, labels)} ${enc.fleeCost.amount}`);
        fleeBlocked = '已经了结';
      }
      const fleeText = costHints.length ? '脱身，付出了代价' : '脱身…';
      actions.push({
        id: fleeId,
        label: '撤离',
        description: '',
        locationId: placement.locationId,
        availableWhen: [],
        requires: fleeRequires,
        blockedReason: fleeBlocked,
        risk: enc.riskFlee ?? '',
        timeCost: 1,
        once: false,
        effects: fleeEffects,
        text: fleeText,
        ...PROVENANCE,
        ...(costHints.length ? { costHints } : {}),
        kindHint,
        fillGroupId: groupId,
        fillBlockHints: {
          resolved: '已经了结',
          ...(enc.fleeCost ? { money: '体力不足' } : {}),
        },
      });

      groups.push({
        id: groupId,
        label: resolved.displayLabel,
        kindHint,
        locationId: placement.locationId,
        lineActionIds: [fightId, fleeId],
        sheetEyebrow: '解决抉择',
      });
      continue;
    }
  }

  return { actions, groups, seedResources, seedFacts };
}

/**
 * Prefer specific fill lock reasons (money vs stock vs uses) over a single blockedReason.
 */
export function fillSpecificBlockedReason(
  action: FillCompiledAction,
  resources: Record<string, number>,
  facts: Record<string, boolean>,
): string | undefined {
  const hints = action.fillBlockHints;
  if (!hints) return undefined;
  // Once-resolved encounter (requires fact==false but fact is true) wins over resource gates.
  for (const req of action.requires) {
    if (req.kind === 'fact' && req.value === false && facts[req.factId] === true) {
      return hints.resolved ?? action.blockedReason;
    }
  }
  // Inspect requires for resource gates in order: stock/uses first, then money.
  for (const req of action.requires) {
    if (req.kind === 'resource') {
      const cur = resources[req.resourceId] ?? 0;
      if ((req.atLeast !== undefined && cur < req.atLeast) || (req.atMost !== undefined && cur > req.atMost)) {
        if (req.resourceId.startsWith('fs_') && hints.stock) return hints.stock;
        if (req.resourceId.startsWith('fu_') && hints.uses) return hints.uses;
        if (hints.money) return hints.money;
        return action.blockedReason;
      }
    }
    if (req.kind === 'fact' && req.factId === '__fill_never__') {
      return hints.unbound ?? action.blockedReason;
    }
    if (req.kind === 'fact' && req.value === true && facts[req.factId] !== true && hints.missingItem) {
      return hints.missingItem;
    }
  }
  return undefined;
}

/** Merge fill seed stock/uses into starting resources (does not overwrite existing keys). */
export function mergeFillSeedResources(
  base: Record<string, number>,
  seed: Record<string, number>,
): Record<string, number> {
  const out = { ...base };
  for (const [k, v] of Object.entries(seed)) {
    if (!(k in out)) out[k] = v;
  }
  return out;
}

/** Merge fill seed facts (engage/resolve/loot own_*) without overwriting authored values. */
export function mergeFillSeedFacts(
  base: Record<string, boolean>,
  seed: Record<string, boolean>,
): Record<string, boolean> {
  const out = { ...base };
  for (const [k, v] of Object.entries(seed)) {
    if (!(k in out)) out[k] = v;
  }
  return out;
}

/** Look up a fill-compiled action by id (for advanceAdventure). */
export function findFillAction(
  world: WorldContent,
  actionId: string,
  opts?: FillProjectOptions,
): FillCompiledAction | undefined {
  if (!actionId.startsWith('fill_')) return undefined;
  return projectFillActions(world, opts).actions.find(a => a.id === actionId);
}
