import { WorkspaceHeader } from '../studio/WorkspaceHeader';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BUILDING_KIND_COLOR, BUILDING_KIND_LABEL, ITEM_CATEGORIES, ITEM_CATEGORY_LABEL, MAP_FILL_KINDS,
  type BuildingAsset, type BuildingDraftCard, type BuildingLibrary, type BuildingStockLine,
  type EncounterContent, type ItemAsset, type ItemCategory, type LootDraftRowCard, type LootLine,
  type MapFillKind, type QuestSlot, type ShelfDraftRow, type ShelfLine, type SupplyRecipe,
  ENCOUNTER_TRIGGER_PREFS, type EncounterTriggerPref,
} from '@novel-game/contracts';
import { useI18n } from '../../lib/i18n';
import {
  acceptBuildingDrafts, createBuildingAsset, deleteBuildingAsset, generateBuildingImage,
  generateBuildingImagePreview, loadBuildingLibrary, promoteBuildingVariant, proposeBuildingAssets,
  updateBuildingAsset,
} from '../../lib/building-library-api';
import {
  acceptLootRows, acceptShelfRows, loadItemCatalog, proposeLootRows, proposeShelfRows,
} from '../../lib/item-catalog-api';
import { RequestError } from '../../lib/api';
import { filterBuildingAssets } from '../../lib/building-library-filter';

type KindFilter = MapFillKind | 'all';

type ShelfRowDraft = {
  itemId: string;
  priceAmount: string;
  priceRoleHint: string;
  stockMax: string;
  labelOverride: string;
};

type RecipeRowDraft = {
  id: string;
  label: string;
  role: string;
  targetKind: 'variable' | 'resource';
  targetRoleHint: string;
  targetName: string;
  amount: string;
  costAmount: string;
  costRoleHint: string;
  requiresItemId: string;
};

type QuestGiveDraft = { itemId: string; qty: string };
type QuestSlotDraft = {
  label: string;
  questId: string;
  markerTag: string;
  marker: string;
  giveItems: QuestGiveDraft[];
  rewardItems: QuestGiveDraft[];
};

type LootRowDraft = {
  itemId: string;
  qty: string;
  qtyMax: string;
  chance: string;
  resourceAmount: string;
  resourceRoleHint: string;
};

type EditorDraft = {
  label: string;
  kind: MapFillKind;
  icon: string;
  color: string;
  tags: string;
  blurb: string;
  interactLabel: string;
  inventory: string;
  loot: string;
  worldbookTags: string;
  /** Shop hard template rows (M-item-2). Empty = legal Catalog skeleton. */
  shelfRows: ShelfRowDraft[];
  shopBuyback: boolean;
  shopCategoryFilters: ItemCategory[];
  /** Supply hard template recipes (M-item-2). */
  recipeRows: RecipeRowDraft[];
  /** Quest hard template slots (M-item-3). Empty = legal. */
  questSlots: QuestSlotDraft[];
  /** Encounter/boss loot + pack/trigger prefs (M-item-3). */
  lootRows: LootRowDraft[];
  encounterPackId: string;
  encounterPackTag: string;
  encounterTriggerPref: EncounterTriggerPref | '';
  encounterTriggerNote: string;
  encounterBoss: boolean;
};

const emptyShelfRow = (): ShelfRowDraft => ({
  itemId: '', priceAmount: '', priceRoleHint: 'primary_coin', stockMax: '', labelOverride: '',
});

const emptyRecipeRow = (): RecipeRowDraft => ({
  id: `recipe_${Date.now().toString(36)}`,
  label: '',
  role: 'heal_light',
  targetKind: 'variable',
  targetRoleHint: 'heal_light',
  targetName: '',
  amount: '10',
  costAmount: '',
  costRoleHint: 'primary_coin',
  requiresItemId: '',
});

const emptyQuestSlot = (): QuestSlotDraft => ({
  label: '', questId: '', markerTag: '', marker: '',
  giveItems: [], rewardItems: [],
});

const emptyLootRow = (): LootRowDraft => ({
  itemId: '', qty: '1', qtyMax: '', chance: '1',
  resourceAmount: '', resourceRoleHint: 'primary_coin',
});

const emptyDraft = (kind: MapFillKind = 'shop'): EditorDraft => ({
  label: '', kind, icon: '', color: BUILDING_KIND_COLOR[kind],
  tags: '', blurb: '', interactLabel: '', inventory: '', loot: '', worldbookTags: '',
  shelfRows: [], shopBuyback: false, shopCategoryFilters: [], recipeRows: [],
  questSlots: [], lootRows: [],
  encounterPackId: '', encounterPackTag: '',
  encounterTriggerPref: '', encounterTriggerNote: '',
  encounterBoss: kind === 'boss',
});

function linesToStock(text: string): BuildingStockLine[] | undefined {
  const lines = text.split('\n').map(s => s.trim()).filter(Boolean);
  if (!lines.length) return undefined;
  return lines.map(label => ({ label: label.slice(0, 80) }));
}
function stockToLines(stock?: BuildingStockLine[]): string {
  return (stock ?? []).map(s => s.label).join('\n');
}
function csv(text: string): string[] | undefined {
  const parts = text.split(/[,，]/).map(s => s.trim()).filter(Boolean).slice(0, 16);
  return parts.length ? parts : undefined;
}

function shelfToDraft(lines?: ShelfLine[]): ShelfRowDraft[] {
  return (lines ?? []).map(line => ({
    itemId: line.itemId,
    priceAmount: line.price?.amount !== undefined ? String(line.price.amount) : '',
    priceRoleHint: line.price?.roleHint ?? '',
    stockMax: line.stockMax !== undefined ? String(line.stockMax) : '',
    labelOverride: line.labelOverride ?? '',
  }));
}

function draftToShelf(rows: ShelfRowDraft[]): ShelfLine[] {
  return rows
    .filter(r => r.itemId.trim())
    .map(r => {
      const line: ShelfLine = { itemId: r.itemId.trim() };
      const amount = Number(r.priceAmount);
      if (Number.isFinite(amount) && r.priceAmount.trim() !== '') {
        line.price = { amount };
        const role = r.priceRoleHint.trim();
        if (role) line.price.roleHint = role.slice(0, 40);
      }
      const stock = Number(r.stockMax);
      if (Number.isFinite(stock) && stock > 0 && r.stockMax.trim() !== '') line.stockMax = Math.floor(stock);
      const lo = r.labelOverride.trim();
      if (lo) line.labelOverride = lo.slice(0, 80);
      return line;
    });
}

function recipesToDraft(recipes?: SupplyRecipe[]): RecipeRowDraft[] {
  return (recipes ?? []).map(r => ({
    id: r.id,
    label: r.label,
    role: r.role ?? '',
    targetKind: r.target.kind,
    targetRoleHint: r.target.roleHint ?? '',
    targetName: r.target.name ?? '',
    amount: String(r.amount),
    costAmount: r.cost?.amount !== undefined ? String(r.cost.amount) : '',
    costRoleHint: r.cost?.roleHint ?? '',
    requiresItemId: r.requiresItemId ?? '',
  }));
}

function draftToRecipes(rows: RecipeRowDraft[]): SupplyRecipe[] {
  return rows
    .filter(r => r.label.trim())
    .map(r => {
      const amount = Number(r.amount);
      const recipe: SupplyRecipe = {
        id: (r.id.trim() || `recipe_${Math.random().toString(36).slice(2, 8)}`).slice(0, 80),
        label: r.label.trim().slice(0, 80),
        target: { kind: r.targetKind },
        amount: Number.isFinite(amount) ? amount : 0,
      };
      const role = r.role.trim();
      if (role) recipe.role = role.slice(0, 40);
      const rh = r.targetRoleHint.trim();
      if (rh) recipe.target.roleHint = rh.slice(0, 40);
      const tn = r.targetName.trim();
      if (tn) recipe.target.name = tn.slice(0, 80);
      const costAmt = Number(r.costAmount);
      if (Number.isFinite(costAmt) && r.costAmount.trim() !== '') {
        recipe.cost = { amount: costAmt };
        const cr = r.costRoleHint.trim();
        if (cr) recipe.cost.roleHint = cr.slice(0, 40);
      }
      const req = r.requiresItemId.trim();
      if (req) recipe.requiresItemId = req;
      return recipe;
    });
}

function giveToDraft(rows?: { itemId: string; qty: number }[]): QuestGiveDraft[] {
  return (rows ?? []).map(r => ({ itemId: r.itemId, qty: String(r.qty) }));
}

function draftToGive(rows: QuestGiveDraft[]): { itemId: string; qty: number }[] {
  return rows
    .filter(r => r.itemId.trim())
    .map(r => {
      const qty = Number(r.qty);
      return { itemId: r.itemId.trim(), qty: Number.isFinite(qty) && qty > 0 ? qty : 1 };
    });
}

function slotsToDraft(slots?: QuestSlot[]): QuestSlotDraft[] {
  return (slots ?? []).map(s => ({
    label: s.label,
    questId: s.questId ?? '',
    markerTag: s.markerTag ?? '',
    marker: s.marker ?? '',
    giveItems: giveToDraft(s.giveItems),
    rewardItems: giveToDraft(s.rewards?.items),
  }));
}

function draftToSlots(rows: QuestSlotDraft[]): QuestSlot[] {
  return rows
    .filter(r => r.label.trim())
    .map(r => {
      const slot: QuestSlot = { label: r.label.trim().slice(0, 80) };
      const qid = r.questId.trim();
      if (qid) slot.questId = qid.slice(0, 80);
      const mt = r.markerTag.trim();
      if (mt) slot.markerTag = mt.slice(0, 80);
      const mk = r.marker.trim();
      if (mk) slot.marker = mk.slice(0, 80);
      const give = draftToGive(r.giveItems);
      if (give.length) slot.giveItems = give;
      const rewards = draftToGive(r.rewardItems);
      if (rewards.length) slot.rewards = { items: rewards };
      return slot;
    });
}

function lootToDraft(lines?: LootLine[]): LootRowDraft[] {
  return (lines ?? []).map(line => {
    const qty = typeof line.qty === 'number'
      ? { min: String(line.qty), max: '' }
      : { min: String(line.qty.min), max: String(line.qty.max) };
    const rd = line.resourceDrops?.[0];
    return {
      itemId: line.itemId,
      qty: qty.min,
      qtyMax: qty.max,
      chance: String(line.chance),
      resourceAmount: rd?.amount !== undefined ? String(rd.amount) : '',
      resourceRoleHint: rd?.roleHint ?? '',
    };
  });
}

function draftToLoot(rows: LootRowDraft[]): LootLine[] {
  return rows
    .filter(r => r.itemId.trim())
    .map(r => {
      const chanceRaw = Number(r.chance);
      const chance = Number.isFinite(chanceRaw) ? Math.min(1, Math.max(0, chanceRaw)) : 1;
      const min = Number(r.qty);
      const max = Number(r.qtyMax);
      let qty: LootLine['qty'] = Number.isFinite(min) && min > 0 ? min : 1;
      if (r.qtyMax.trim() !== '' && Number.isFinite(max) && max >= (typeof qty === 'number' ? qty : 1)) {
        qty = { min: typeof qty === 'number' ? qty : 1, max };
      }
      const line: LootLine = { itemId: r.itemId.trim(), qty, chance };
      const amt = Number(r.resourceAmount);
      if (Number.isFinite(amt) && r.resourceAmount.trim() !== '') {
        const drop: NonNullable<LootLine['resourceDrops']>[number] = { amount: amt };
        const role = r.resourceRoleHint.trim();
        if (role) drop.roleHint = role.slice(0, 40);
        line.resourceDrops = [drop];
      }
      return line;
    });
}

function draftToEncounter(draft: EditorDraft): EncounterContent {
  const encounter: EncounterContent = { loot: draftToLoot(draft.lootRows) };
  const packId = draft.encounterPackId.trim();
  if (packId) encounter.packId = packId.slice(0, 80);
  const packTag = draft.encounterPackTag.trim();
  if (packTag) encounter.packTag = packTag.slice(0, 80);
  if (draft.encounterTriggerPref || draft.encounterTriggerNote.trim()) {
    encounter.trigger = {};
    if (draft.encounterTriggerPref) encounter.trigger.preference = draft.encounterTriggerPref;
    const note = draft.encounterTriggerNote.trim();
    if (note) encounter.trigger.note = note.slice(0, 200);
  }
  if (draft.kind === 'boss' || draft.encounterBoss) encounter.boss = true;
  else if (draft.encounterBoss === false && draft.kind === 'encounter') {
    // leave unset / false optional — only set true when explicit
  }
  return encounter;
}

function assetToDraft(a: BuildingAsset): EditorDraft {
  return {
    label: a.label, kind: a.kind, icon: a.icon ?? '', color: a.color ?? BUILDING_KIND_COLOR[a.kind],
    tags: (a.tags ?? []).join(', '), blurb: a.blurb ?? '',
    interactLabel: a.defaultInteract?.label ?? '',
    inventory: stockToLines(a.inventoryDraft), loot: stockToLines(a.lootDraft),
    worldbookTags: (a.worldbookTags ?? []).join(', '),
    shelfRows: shelfToDraft(a.shop?.shelf),
    shopBuyback: a.shop?.buyback ?? false,
    shopCategoryFilters: [...(a.shop?.categoryFilters ?? [])],
    recipeRows: recipesToDraft(a.supply?.recipes),
    questSlots: slotsToDraft(a.quest?.slots),
    lootRows: lootToDraft(a.encounter?.loot),
    encounterPackId: a.encounter?.packId ?? '',
    encounterPackTag: a.encounter?.packTag ?? '',
    encounterTriggerPref: a.encounter?.trigger?.preference ?? '',
    encounterTriggerNote: a.encounter?.trigger?.note ?? '',
    encounterBoss: a.kind === 'boss' || a.encounter?.boss === true,
  };
}

type Props = { token: string };

/**
 * Building-library catalog studio — card grid + AI strip + inspector.
 * Images are display-only; library writes never touch play/session state.
 */
export function BuildingLibraryPage({ token }: Props) {
  const { t } = useI18n();
  const [library, setLibrary] = useState<BuildingLibrary | null>(null);
  const [revision, setRevision] = useState(0);
  const [items, setItems] = useState<ItemAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panel, setPanel] = useState<'browse' | 'create'>('browse');
  const [manualOpen, setManualOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [draft, setDraft] = useState<EditorDraft>(emptyDraft());
  const [imageBusyId, setImageBusyId] = useState<string | null>(null);

  const [aiPrompt, setAiPrompt] = useState('海边城镇的日常设施：杂货、补给、委托处');
  const [aiKinds, setAiKinds] = useState<MapFillKind[]>(['shop', 'supply', 'quest']);
  const [aiGenre, setAiGenre] = useState('');
  const [aiContext, setAiContext] = useState('');
  const [proposal, setProposal] = useState<BuildingDraftCard[] | null>(null);
  const [proposalModel, setProposalModel] = useState<string | undefined>();
  const [proposalWarnings, setProposalWarnings] = useState<string[]>([]);
  const [selectedDraftIds, setSelectedDraftIds] = useState<Set<string>>(new Set());
  const [draftImages, setDraftImages] = useState<Record<string, string>>({});
  const [generating, setGenerating] = useState(false);
  const [draftImaging, setDraftImaging] = useState(false);

  // M-item-4: shelf / loot propose (client drafts only until accept)
  const [shelfAiPrompt, setShelfAiPrompt] = useState('日常补给与消耗品');
  const [shelfProposing, setShelfProposing] = useState(false);
  const [shelfProposal, setShelfProposal] = useState<ShelfDraftRow[] | null>(null);
  const [shelfPendingItems, setShelfPendingItems] = useState<string[]>([]);
  const [shelfWarnings, setShelfWarnings] = useState<string[]>([]);
  const [selectedShelfDraftIds, setSelectedShelfDraftIds] = useState<Set<string>>(new Set());
  const [lootAiPrompt, setLootAiPrompt] = useState('常见材料与战利品');
  const [lootProposing, setLootProposing] = useState(false);
  const [lootProposal, setLootProposal] = useState<LootDraftRowCard[] | null>(null);
  const [lootPendingItems, setLootPendingItems] = useState<string[]>([]);
  const [lootWarnings, setLootWarnings] = useState<string[]>([]);
  const [selectedLootDraftIds, setSelectedLootDraftIds] = useState<Set<string>>(new Set());

  const accept = useCallback((view: { library: BuildingLibrary; revision: number }) => {
    setLibrary(view.library);
    setRevision(view.revision);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [libView, itemView] = await Promise.all([
        loadBuildingLibrary(token),
        loadItemCatalog(token).catch(() => null),
      ]);
      accept(libView);
      if (itemView) setItems(itemView.catalog.items);
      setError(null);
    } catch (e) {
      setError(e instanceof RequestError ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [token, accept]);

  useEffect(() => { void refresh(); }, [refresh]);

  const assets = useMemo(
    () => filterBuildingAssets(library?.assets ?? [], kindFilter, query),
    [library, kindFilter, query],
  );
  const selected = library?.assets.find(a => a.id === selectedId) ?? null;

  function startCreate(kind: MapFillKind = 'shop') {
    setPanel('create'); setManualOpen(true); setSelectedId(null);
    setDraft(emptyDraft(kind)); setAdvancedOpen(false); setNote(null); setError(null);
  }
  function selectAsset(a: BuildingAsset) {
    setPanel('browse'); setManualOpen(false); setSelectedId(a.id);
    setDraft(assetToDraft(a)); setAdvancedOpen(false); setNote(null); setError(null);
  }
  function patchDraft<K extends keyof EditorDraft>(key: K, value: EditorDraft[K]) {
    setDraft(prev => {
      const next = { ...prev, [key]: value };
      if (key === 'kind') {
        const kind = value as MapFillKind;
        if (prev.color === BUILDING_KIND_COLOR[prev.kind]) {
          next.color = BUILDING_KIND_COLOR[kind];
        }
        if (kind === 'boss') next.encounterBoss = true;
      }
      return next;
    });
  }
  function buildPatch() {
    const inventoryDraft = linesToStock(draft.inventory);
    const lootDraft = linesToStock(draft.loot);
    const tags = csv(draft.tags);
    const worldbookTags = csv(draft.worldbookTags);
    const patch: {
      label: string; kind: MapFillKind; color: string; icon?: string; tags?: string[];
      blurb?: string; defaultInteract?: { label: string };
      inventoryDraft?: BuildingStockLine[]; lootDraft?: BuildingStockLine[]; worldbookTags?: string[];
      shop?: BuildingAsset['shop']; supply?: BuildingAsset['supply'];
      quest?: BuildingAsset['quest']; encounter?: BuildingAsset['encounter'];
    } = {
      label: draft.label.trim(), kind: draft.kind,
      color: /^#[0-9a-fA-F]{6}$/.test(draft.color) ? draft.color : BUILDING_KIND_COLOR[draft.kind],
    };
    const icon = draft.icon.trim();
    if (icon) patch.icon = icon;
    if (tags) patch.tags = tags;
    const blurb = draft.blurb.trim();
    if (blurb) patch.blurb = blurb;
    if (draft.interactLabel.trim()) patch.defaultInteract = { label: draft.interactLabel.trim() };
    if (inventoryDraft) patch.inventoryDraft = inventoryDraft;
    if (lootDraft) patch.lootDraft = lootDraft;
    if (worldbookTags) patch.worldbookTags = worldbookTags;
    if (draft.kind === 'shop') {
      patch.shop = {
        shelf: draftToShelf(draft.shelfRows),
        buyback: draft.shopBuyback || undefined,
        categoryFilters: draft.shopCategoryFilters.length ? draft.shopCategoryFilters : undefined,
      };
      patch.supply = undefined; patch.quest = undefined; patch.encounter = undefined;
    } else if (draft.kind === 'supply') {
      patch.supply = { recipes: draftToRecipes(draft.recipeRows) };
      patch.shop = undefined; patch.quest = undefined; patch.encounter = undefined;
    } else if (draft.kind === 'quest') {
      patch.quest = { slots: draftToSlots(draft.questSlots) };
      patch.shop = undefined; patch.supply = undefined; patch.encounter = undefined;
    } else if (draft.kind === 'encounter' || draft.kind === 'boss') {
      patch.encounter = draftToEncounter(draft);
      patch.shop = undefined; patch.supply = undefined; patch.quest = undefined;
    }
    return patch;
  }

  async function onCreate() {
    if (busy || !draft.label.trim()) return;
    setBusy(true); setError(null); setNote(null);
    try {
      const view = await createBuildingAsset(token, {
        ...buildPatch(), expectedRevision: revision,
        provenance: { source: 'building-library-page', createdAt: new Date().toISOString() },
      });
      accept(view); selectAsset(view.asset);
      setNote(t('已创建：{name}', { name: view.asset.label }));
      setManualOpen(false);
    } catch (e) {
      setError(e instanceof RequestError ? e.message : String(e));
      if (e instanceof RequestError && e.code === 'BUILDING_LIBRARY_CONFLICT') await refresh();
    } finally { setBusy(false); }
  }

  async function onSave() {
    if (busy || !selectedId || !draft.label.trim()) return;
    setBusy(true); setError(null); setNote(null);
    try {
      const patch = buildPatch();
      const view = await updateBuildingAsset(token, selectedId, {
        ...patch, version: (selected?.version ?? 1) + 1,
      }, revision);
      accept(view);
      const updated = view.library.assets.find(a => a.id === selectedId);
      if (updated) selectAsset(updated);
      setNote(t('已保存：{name}', { name: patch.label }));
    } catch (e) {
      setError(e instanceof RequestError ? e.message : String(e));
      if (e instanceof RequestError && e.code === 'BUILDING_LIBRARY_CONFLICT') await refresh();
    } finally { setBusy(false); }
  }

  async function onDelete() {
    if (busy || !selectedId) return;
    if (!window.confirm(t('从建筑库删除此资产？地图上的引用会保留并由校验标错。'))) return;
    setBusy(true); setError(null); setNote(null);
    try {
      accept(await deleteBuildingAsset(token, selectedId, revision));
      setSelectedId(null); setDraft(emptyDraft()); setNote(t('已删除'));
    } catch (e) {
      setError(e instanceof RequestError ? e.message : String(e));
      if (e instanceof RequestError && e.code === 'BUILDING_LIBRARY_CONFLICT') await refresh();
    } finally { setBusy(false); }
  }

  async function onPromote() {
    if (busy || !selectedId) return;
    setBusy(true); setError(null); setNote(null);
    try {
      const view = await promoteBuildingVariant(token, selectedId, revision, {
        label: draft.label.trim() ? `${draft.label.trim()} · 变体` : undefined,
        overrides: {
          label: draft.label.trim() || undefined, color: draft.color || undefined,
          icon: draft.icon.trim() || undefined, blurb: draft.blurb.trim() || undefined,
          tags: csv(draft.tags), inventoryDraft: linesToStock(draft.inventory),
          lootDraft: linesToStock(draft.loot), worldbookTags: csv(draft.worldbookTags),
        },
      });
      accept(view); selectAsset(view.asset);
      setNote(t('已升格变体：{name}', { name: view.asset.label }));
    } catch (e) {
      setError(e instanceof RequestError ? e.message : String(e));
      if (e instanceof RequestError && e.code === 'BUILDING_LIBRARY_CONFLICT') await refresh();
    } finally { setBusy(false); }
  }

  async function onGenerateImage(assetId: string) {
    if (busy || imageBusyId) return;
    setImageBusyId(assetId); setError(null); setNote(null);
    try {
      const view = await generateBuildingImage(token, assetId, { expectedRevision: revision, preferSvg: true });
      accept(view);
      if (selectedId === assetId) {
        const updated = view.library.assets.find(a => a.id === assetId);
        if (updated) selectAsset(updated);
      }
      setNote(t('已生成图片（{provider}）', { provider: view.image.imageProvider }));
    } catch (e) {
      setError(e instanceof RequestError ? e.message : String(e));
      if (e instanceof RequestError && e.code === 'BUILDING_LIBRARY_CONFLICT') await refresh();
    } finally { setImageBusyId(null); }
  }

  function toggleAiKind(k: MapFillKind) {
    setAiKinds(prev => prev.includes(k) ? prev.filter(x => x !== k) : [...prev, k]);
  }

  async function onGenerate() {
    if (generating || busy || !aiPrompt.trim()) return;
    setGenerating(true); setError(null); setNote(null); setDraftImages({});
    try {
      const result = await proposeBuildingAssets(token, {
        prompt: aiPrompt.trim(),
        kinds: aiKinds.length ? aiKinds : undefined,
        genre: aiGenre.trim() || undefined,
        context: aiContext.trim() || undefined,
        count: 6,
      });
      setProposal(result.drafts);
      setProposalModel(result.model);
      setProposalWarnings(result.warnings ?? []);
      setSelectedDraftIds(new Set(result.drafts.map(d => d.draftId)));
      if (!result.drafts.length) setNote(t('没有生成到建筑草案，试试换个提示'));
    } catch (e) {
      setError(e instanceof RequestError ? e.message : String(e));
    } finally { setGenerating(false); }
  }

  function toggleDraft(id: string) {
    setSelectedDraftIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function onAcceptSelected() {
    if (busy || !proposal?.length) return;
    const drafts = proposal.filter(d => selectedDraftIds.has(d.draftId));
    if (!drafts.length) return;
    setBusy(true); setError(null); setNote(null);
    try {
      const withImages = drafts.map(d => {
        const url = draftImages[d.draftId];
        if (!url) return d;
        return { ...d, /* image carried via post-accept generate; keep card as-is */ };
      });
      const view = await acceptBuildingDrafts(token, { expectedRevision: revision, drafts: withImages });
      accept(view);
      // Attach preview images that were generated for accepted drafts
      let rev = view.revision;
      let lib = view.library;
      for (const asset of view.assets) {
        const card = drafts.find(d => d.label === asset.label || d.label === asset.label.replace(/ · \d+$/, ''));
        const preview = card ? draftImages[card.draftId] : undefined;
        if (preview && !asset.imageUrl) {
          try {
            const patched = await updateBuildingAsset(token, asset.id, { imageUrl: preview, imageProvider: 'svg-illustrator-preview' }, rev);
            rev = patched.revision; lib = patched.library;
          } catch { /* non-fatal */ }
        }
      }
      accept({ library: lib, revision: rev });
      setProposal(null); setSelectedDraftIds(new Set()); setDraftImages({});
      setNote(t('已入库 {n} 项', { n: view.assets.length }));
      const first = lib.assets.find(a => view.assets.some(x => x.id === a.id));
      if (first) selectAsset(first);
    } catch (e) {
      setError(e instanceof RequestError ? e.message : String(e));
      if (e instanceof RequestError && e.code === 'BUILDING_LIBRARY_CONFLICT') await refresh();
    } finally { setBusy(false); }
  }

  async function onGenerateDraftImages() {
    if (draftImaging || !proposal?.length) return;
    const targets = proposal.filter(d => selectedDraftIds.has(d.draftId));
    if (!targets.length) return;
    setDraftImaging(true); setError(null);
    try {
      const next: Record<string, string> = { ...draftImages };
      for (const card of targets) {
        const img = await generateBuildingImagePreview(token, {
          label: card.label, kind: card.kind, tags: card.tags, color: card.color,
          icon: card.icon, blurb: card.blurb, preferSvg: true,
        });
        next[card.draftId] = img.imageUrl;
      }
      setDraftImages(next);
      setNote(t('已为 {n} 张草案生成示意画像', { n: targets.length }));
    } catch (e) {
      setError(e instanceof RequestError ? e.message : String(e));
    } finally { setDraftImaging(false); }
  }

  async function onProposeShelf() {
    if (shelfProposing || busy || !shelfAiPrompt.trim() || !selectedId) return;
    setShelfProposing(true); setError(null); setNote(null);
    try {
      const result = await proposeShelfRows(token, {
        prompt: shelfAiPrompt.trim(),
        buildingAssetId: selectedId,
        categoryFilters: draft.shopCategoryFilters.length ? draft.shopCategoryFilters : undefined,
        count: 6,
      });
      setShelfProposal(result.rows);
      setShelfPendingItems(result.pendingItemDrafts.map(d => d.label));
      setShelfWarnings(result.warnings ?? []);
      setSelectedShelfDraftIds(new Set(result.rows.map(r => r.draftId)));
      if (!result.rows.length && result.pendingItemDrafts.length) {
        setNote(t('模型提出了未入库名词；请先到物品目录入库后再挂货架'));
      } else if (!result.rows.length) {
        setNote(t('没有生成到货架草案'));
      }
    } catch (e) {
      setError(e instanceof RequestError ? e.message : String(e));
    } finally { setShelfProposing(false); }
  }

  function clearShelfProposal() {
    setShelfProposal(null); setShelfPendingItems([]); setShelfWarnings([]);
    setSelectedShelfDraftIds(new Set());
  }

  async function onAcceptShelfProposal() {
    if (busy || !shelfProposal?.length || !selectedId) return;
    const rows = shelfProposal.filter(r => selectedShelfDraftIds.has(r.draftId));
    if (!rows.length) return;
    setBusy(true); setError(null); setNote(null);
    try {
      const view = await acceptShelfRows(token, {
        buildingAssetId: selectedId, expectedRevision: revision, rows, replace: false,
      });
      accept(view as { library: BuildingLibrary; revision: number });
      // Mirror into editor draft
      const asset = (view as { library: BuildingLibrary }).library.assets.find(a => a.id === selectedId);
      if (asset) selectAsset(asset);
      clearShelfProposal();
      setNote(t('已写入货架 {n} 行', { n: rows.length }));
    } catch (e) {
      setError(e instanceof RequestError ? e.message : String(e));
      if (e instanceof RequestError && e.code === 'BUILDING_LIBRARY_CONFLICT') await refresh();
    } finally { setBusy(false); }
  }

  async function onProposeLoot() {
    if (lootProposing || busy || !lootAiPrompt.trim() || !selectedId) return;
    setLootProposing(true); setError(null); setNote(null);
    try {
      const result = await proposeLootRows(token, {
        prompt: lootAiPrompt.trim(),
        buildingAssetId: selectedId,
        count: 6,
      });
      setLootProposal(result.rows);
      setLootPendingItems(result.pendingItemDrafts.map(d => d.label));
      setLootWarnings(result.warnings ?? []);
      setSelectedLootDraftIds(new Set(result.rows.map(r => r.draftId)));
      if (!result.rows.length && result.pendingItemDrafts.length) {
        setNote(t('模型提出了未入库名词；请先到物品目录入库后再挂掉落'));
      } else if (!result.rows.length) {
        setNote(t('没有生成到掉落草案'));
      }
    } catch (e) {
      setError(e instanceof RequestError ? e.message : String(e));
    } finally { setLootProposing(false); }
  }

  function clearLootProposal() {
    setLootProposal(null); setLootPendingItems([]); setLootWarnings([]);
    setSelectedLootDraftIds(new Set());
  }

  async function onAcceptLootProposal() {
    if (busy || !lootProposal?.length || !selectedId) return;
    const rows = lootProposal.filter(r => selectedLootDraftIds.has(r.draftId));
    if (!rows.length) return;
    setBusy(true); setError(null); setNote(null);
    try {
      const view = await acceptLootRows(token, {
        buildingAssetId: selectedId, expectedRevision: revision, rows, replace: false,
      });
      accept(view as { library: BuildingLibrary; revision: number });
      const asset = (view as { library: BuildingLibrary }).library.assets.find(a => a.id === selectedId);
      if (asset) selectAsset(asset);
      clearLootProposal();
      setNote(t('已写入掉落 {n} 行', { n: rows.length }));
    } catch (e) {
      setError(e instanceof RequestError ? e.message : String(e));
      if (e instanceof RequestError && e.code === 'BUILDING_LIBRARY_CONFLICT') await refresh();
    } finally { setBusy(false); }
  }

  const total = library?.assets.length ?? 0;
  const selectedCount = selectedDraftIds.size;
  const inspectorOpen = Boolean(selected) || manualOpen;

  return (
    <section className="work-section building-library-page" data-testid="building-library-page">
      <WorkspaceHeader title="建筑库" description="整理可复用建筑，审阅生成草案，供地图与世界引用。">
        <div className="building-library-page-actions">
          <span className="building-library-stat" data-testid="building-library-page-count">{t('{n} 项', { n: total })}</span>
          <button type="button" className="quiet small" disabled={busy || generating || loading} onClick={() => void refresh()}>{t('刷新')}</button>
          <button type="button" className="small" disabled={busy || loading}
            data-testid="building-library-manual-toggle"
            aria-expanded={manualOpen}
            onClick={() => {
              if (!manualOpen) startCreate(kindFilter === 'all' ? 'shop' : kindFilter);
              else { setManualOpen(false); setPanel('browse'); }
            }}>
            {manualOpen ? t('取消新建') : t('手动新建')}
          </button>
        </div>
      </WorkspaceHeader>

      {(error || note) && (
        <div className={`building-library-page-banner${error ? ' is-error' : ''}`} data-testid="building-library-page-banner" role="status">
          {error && <p className="hint error">{error}</p>}
          {note && !error && <p className="hint ok">{note}</p>}
        </div>
      )}

      <div className="building-ai-strip" data-testid="building-library-ai-card">
        <div className="building-ai-strip-head">
          <div>
            <h3>{t('AI 生成')}</h3>
            <p className="hint">{t('一句话出草案卡片，勾选后入库；可选为草案生成示意画像。')}</p>
          </div>
          {proposalModel && <span className="hint building-ai-model">{proposalModel}</span>}
        </div>
        <div className="building-ai-prompt-row">
          <input aria-label={t("描述想生成的建筑")} data-testid="building-library-ai-prompt" value={aiPrompt} maxLength={2000}
            disabled={generating || busy} placeholder={t('描述想要的建筑，例如：雾港码头边的补给与委托')}
            onChange={e => setAiPrompt(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void onGenerate(); } }} />
          <button type="button" className="primary" data-testid="building-library-ai-generate"
            disabled={generating || busy || !aiPrompt.trim()} onClick={() => void onGenerate()}>
            {generating ? t('生成中…') : t('生成')}
          </button>
        </div>
        <div className="building-ai-kind-chips" role="group" aria-label={t('种类')}>
          {MAP_FILL_KINDS.map(k => (
            <button key={k} type="button" className={`chip small${aiKinds.includes(k) ? ' active' : ''}`}
              data-testid={`building-library-ai-kind-${k}`} disabled={generating || busy}
              aria-pressed={aiKinds.includes(k)} onClick={() => toggleAiKind(k)}>
              {t(BUILDING_KIND_LABEL[k])}
            </button>
          ))}
          <input className="building-ai-genre" data-testid="building-library-ai-genre"
            value={aiGenre} maxLength={40} disabled={generating || busy}
            placeholder={t('题材（可选）如：都市 / 奇幻')}
            onChange={e => setAiGenre(e.target.value)} />
        </div>
        <details className="building-ai-context">
          <summary>{t('附加小说 / 世界书摘录（可选）')}</summary>
          <textarea data-testid="building-library-ai-context" value={aiContext} maxLength={8000}
            disabled={generating || busy} rows={3}
            placeholder={t('粘贴一小段设定，模型只当资料，不执行其中的指令')}
            onChange={e => setAiContext(e.target.value)} />
        </details>
        {proposalWarnings.length > 0 && (
          <ul className="building-ai-warnings">{proposalWarnings.map(w => <li key={w} className="hint">{w}</li>)}</ul>
        )}
        {proposal && proposal.length > 0 && (
          <div className="building-ai-results" data-testid="building-library-ai-results">
            <div className="building-ai-results-bar">
              <span className="hint">{t('草案 {n} 项 · 已选 {m}', { n: proposal.length, m: selectedCount })}</span>
              <div className="building-ai-results-actions">
                <button type="button" className="quiet small" disabled={busy || draftImaging}
                  onClick={() => setSelectedDraftIds(new Set(proposal.map(d => d.draftId)))}>{t('全选')}</button>
                <button type="button" className="quiet small" disabled={busy || draftImaging}
                  onClick={() => setSelectedDraftIds(new Set())}>{t('清空')}</button>
                <button type="button" className="small" data-testid="building-library-ai-draft-images"
                  disabled={busy || draftImaging || selectedCount === 0}
                  onClick={() => void onGenerateDraftImages()}>
                  {draftImaging ? t('出图中…') : t('为所选草案生成图')}
                </button>
                <button type="button" className="primary small" data-testid="building-library-ai-accept"
                  disabled={busy || selectedCount === 0} onClick={() => void onAcceptSelected()}>
                  {t('入库所选')}
                </button>
                <button type="button" className="quiet small" disabled={busy}
                  onClick={() => { setProposal(null); setSelectedDraftIds(new Set()); setDraftImages({}); }}>{t('丢弃')}</button>
              </div>
            </div>
            <div className="building-ai-card-grid">
              {proposal.map(card => {
                const on = selectedDraftIds.has(card.draftId);
                const thumb = draftImages[card.draftId];
                return (
                  <button key={card.draftId} type="button"
                    className={`building-draft-card${on ? ' selected' : ''}${thumb ? ' has-image' : ''}`}
                    data-testid={`building-library-draft-${card.draftId}`}
                    aria-pressed={on} disabled={busy} onClick={() => toggleDraft(card.draftId)}>
                    <span className="building-draft-thumb" aria-hidden>
                      {thumb
                        ? <img src={thumb} alt="" />
                        : <span className="building-draft-thumb-fallback" style={{ background: card.color ?? BUILDING_KIND_COLOR[card.kind] }} />}
                    </span>
                    <span className="building-draft-card-top">
                      <span className={`map-fill-kind ${card.kind}`}>{t(BUILDING_KIND_LABEL[card.kind])}</span>
                      <span className="building-draft-check" aria-hidden>{on ? '✓' : ''}</span>
                    </span>
                    <strong className="building-draft-title">{card.icon ? `${card.icon} ` : ''}{card.label}</strong>
                    {card.blurb && <p className="building-draft-blurb">{card.blurb}</p>}
                    {card.tags && card.tags.length > 0 && (
                      <p className="building-draft-tags">{card.tags.join(' · ')}</p>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="building-library-page-toolbar" role="toolbar" aria-label={t('筛选')}>
        <label className="building-library-search">
          <span className="sr-only">{t('搜索')}</span>
          <input data-testid="building-library-search" value={query} maxLength={80}
            placeholder={t('搜索名称、标签、简介…')} disabled={busy}
            onChange={e => setQuery(e.target.value)} />
        </label>
        <div className="building-library-kind-chips" role="tablist" aria-label={t('种类')}>
          <button type="button" role="tab" aria-selected={kindFilter === 'all'}
            className={`small${kindFilter === 'all' ? ' active' : ''}`}
            data-testid="building-library-filter-all" onClick={() => setKindFilter('all')}>{t('全部')}</button>
          {MAP_FILL_KINDS.map(k => (
            <button key={k} type="button" role="tab" aria-selected={kindFilter === k}
              className={`small${kindFilter === k ? ' active' : ''}`}
              data-testid={`building-library-filter-${k}`}
              onClick={() => setKindFilter(k)}>{t(BUILDING_KIND_LABEL[k])}</button>
          ))}
        </div>
      </div>

      <div className={`building-library-studio${inspectorOpen ? ' has-inspector' : ''}`}>
        <div className="building-library-catalog" aria-label={t('建筑列表')}>
          {loading && (
            <div className="building-library-state" role="status" data-testid="building-library-loading">
              <div className="building-library-skeleton-grid">
                {Array.from({ length: 8 }, (_, i) => <div key={i} className="building-library-skeleton-card" />)}
              </div>
              <p className="hint">{t('正在载入建筑库…')}</p>
            </div>
          )}
          {!loading && error && total === 0 && (
            <div className="building-library-state" data-testid="building-library-error">
              <p className="hint error">{error}</p>
              <button type="button" className="small" onClick={() => void refresh()}>{t('重试')}</button>
            </div>
          )}
          {!loading && !error && assets.length === 0 && (
            <div className="building-library-state" data-testid="building-library-empty">
              <p className="building-library-empty-title">{query || kindFilter !== 'all' ? t('没有匹配的建筑') : t('建筑库还是空的')}</p>
              <p className="hint">{query || kindFilter !== 'all'
                ? t('换个筛选，或清空搜索。')
                : t('用上方 AI 生成一批草案，或点「手动新建」。')}</p>
            </div>
          )}
          {!loading && assets.length > 0 && (
            <div className="building-asset-grid" data-testid="building-library-page-list">
              {assets.map(a => {
                const active = selectedId === a.id && panel === 'browse';
                const imaging = imageBusyId === a.id;
                return (
                  <article key={a.id}
                    className={`building-asset-card${active ? ' selected' : ''}`}
                    data-testid={`building-library-page-item-${a.id}`}>
                    <button type="button" className="building-asset-card-main" onClick={() => selectAsset(a)}>
                      <span className="building-asset-thumb" aria-hidden>
                        {a.imageUrl
                          ? <img src={a.imageUrl} alt="" />
                          : (
                            <span className="building-asset-thumb-fallback" style={{ background: a.color ?? BUILDING_KIND_COLOR[a.kind] }}>
                              <span>{a.icon || BUILDING_KIND_LABEL[a.kind].slice(0, 1)}</span>
                            </span>
                          )}
                      </span>
                      <span className="building-asset-body">
                        <span className="building-asset-title">{a.label}</span>
                        <span className="building-asset-meta">
                          <span className={`map-fill-kind ${a.kind}`}>{t(BUILDING_KIND_LABEL[a.kind])}</span>
                          <span className="hint">v{a.version}</span>
                        </span>
                        {a.blurb && <span className="building-asset-blurb">{a.blurb}</span>}
                      </span>
                    </button>
                    <div className="building-asset-card-actions">
                      <button type="button" className="quiet small"
                        data-testid={`building-library-gen-image-${a.id}`}
                        disabled={busy || Boolean(imageBusyId)}
                        onClick={() => void onGenerateImage(a.id)}>
                        {imaging ? t('出图中…') : a.imageUrl ? t('重新生成图') : t('生成图片')}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>

        <aside className="building-library-page-editor" data-testid="building-library-page-editor">
          {manualOpen && (
            <div className="building-inspector" data-testid="building-library-create-form">
              <div className="building-inspector-hero">
                <span className="building-inspector-swatch" style={{ background: draft.color || BUILDING_KIND_COLOR[draft.kind] }} aria-hidden />
                <div className="building-inspector-hero-text">
                  <h3>{t('手动新建')}</h3>
                  <p className="hint">{t('同名自动变为「原名 · 2」。')}</p>
                </div>
              </div>
              <InspectorFields draft={draft} patchDraft={patchDraft} busy={busy} t={t}
                advancedOpen={advancedOpen} setAdvancedOpen={setAdvancedOpen} items={items}
                selectedId={selectedId} manualOpen={manualOpen}
                shelfAiPrompt={shelfAiPrompt} setShelfAiPrompt={setShelfAiPrompt}
                shelfProposing={shelfProposing} onProposeShelf={() => void onProposeShelf()}
                shelfWarnings={shelfWarnings} shelfPendingItems={shelfPendingItems}
                shelfProposal={shelfProposal} selectedShelfDraftIds={selectedShelfDraftIds}
                setSelectedShelfDraftIds={setSelectedShelfDraftIds}
                onAcceptShelfProposal={() => void onAcceptShelfProposal()}
                clearShelfProposal={clearShelfProposal}
                lootAiPrompt={lootAiPrompt} setLootAiPrompt={setLootAiPrompt}
                lootProposing={lootProposing} onProposeLoot={() => void onProposeLoot()}
                lootWarnings={lootWarnings} lootPendingItems={lootPendingItems}
                lootProposal={lootProposal} selectedLootDraftIds={selectedLootDraftIds}
                setSelectedLootDraftIds={setSelectedLootDraftIds}
                onAcceptLootProposal={() => void onAcceptLootProposal()}
                clearLootProposal={clearLootProposal} />
              <div className="building-library-form-footer">
                <button type="button" className="primary" data-testid="building-library-form-create"
                  disabled={busy || !draft.label.trim()} onClick={() => void onCreate()}>
                  {t('创建并入库')}
                </button>
              </div>
            </div>
          )}

          {!manualOpen && selected && (
            <div className="building-inspector" data-testid="building-library-inspector">
              <div className="building-inspector-hero building-inspector-hero-image">
                <div className="building-inspector-portrait">
                  {selected.imageUrl
                    ? <img src={selected.imageUrl} alt={selected.label} />
                    : (
                      <span className="building-asset-thumb-fallback large"
                        style={{ background: draft.color || BUILDING_KIND_COLOR[draft.kind] }}>
                        <span>{draft.icon || BUILDING_KIND_LABEL[draft.kind].slice(0, 1)}</span>
                      </span>
                    )}
                </div>
                <div className="building-inspector-hero-text">
                  <h3>{draft.icon ? `${draft.icon} ` : ''}{draft.label || selected.label}</h3>
                  <p className="hint">{selected.id} · v{selected.version} · {t(BUILDING_KIND_LABEL[draft.kind])}</p>
                  {selected.imageProvider && <p className="hint">{t('图片')}：{selected.imageProvider}</p>}
                  <button type="button" className="small" data-testid="building-library-inspector-gen-image"
                    disabled={busy || Boolean(imageBusyId)}
                    onClick={() => void onGenerateImage(selected.id)}>
                    {imageBusyId === selected.id ? t('出图中…') : selected.imageUrl ? t('重新生成图') : t('生成图片')}
                  </button>
                </div>
              </div>
              <InspectorFields draft={draft} patchDraft={patchDraft} busy={busy} t={t}
                advancedOpen={advancedOpen} setAdvancedOpen={setAdvancedOpen} items={items}
                selectedId={selectedId} manualOpen={manualOpen}
                shelfAiPrompt={shelfAiPrompt} setShelfAiPrompt={setShelfAiPrompt}
                shelfProposing={shelfProposing} onProposeShelf={() => void onProposeShelf()}
                shelfWarnings={shelfWarnings} shelfPendingItems={shelfPendingItems}
                shelfProposal={shelfProposal} selectedShelfDraftIds={selectedShelfDraftIds}
                setSelectedShelfDraftIds={setSelectedShelfDraftIds}
                onAcceptShelfProposal={() => void onAcceptShelfProposal()}
                clearShelfProposal={clearShelfProposal}
                lootAiPrompt={lootAiPrompt} setLootAiPrompt={setLootAiPrompt}
                lootProposing={lootProposing} onProposeLoot={() => void onProposeLoot()}
                lootWarnings={lootWarnings} lootPendingItems={lootPendingItems}
                lootProposal={lootProposal} selectedLootDraftIds={selectedLootDraftIds}
                setSelectedLootDraftIds={setSelectedLootDraftIds}
                onAcceptLootProposal={() => void onAcceptLootProposal()}
                clearLootProposal={clearLootProposal} />
              <div className="building-library-form-footer">
                <button type="button" className="primary" data-testid="building-library-form-save"
                  disabled={busy || !draft.label.trim()} onClick={() => void onSave()}>{t('保存修改')}</button>
                <button type="button" className="small" data-testid="building-library-form-promote"
                  disabled={busy} onClick={() => void onPromote()}>{t('升格变体')}</button>
                <button type="button" className="quiet small danger" data-testid="building-library-form-delete"
                  disabled={busy} onClick={() => void onDelete()}>{t('删除')}</button>
                <p className="hint">{t('升格会新建资产，绝不覆盖原条目。图片仅展示，不改玩法。')}</p>
              </div>
            </div>
          )}

          {!manualOpen && !selected && (
            <div className="building-inspector-empty">
              <p className="building-library-empty-title">{t('检查器')}</p>
              <p className="hint">{t('点一张卡片查看详情与出图；或先用 AI 生成草案。')}</p>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}

function InspectorFields({
  draft, patchDraft, busy, t, advancedOpen, setAdvancedOpen, items,
  selectedId, manualOpen,
  shelfAiPrompt, setShelfAiPrompt, shelfProposing, onProposeShelf,
  shelfWarnings, shelfPendingItems, shelfProposal, selectedShelfDraftIds, setSelectedShelfDraftIds,
  onAcceptShelfProposal, clearShelfProposal,
  lootAiPrompt, setLootAiPrompt, lootProposing, onProposeLoot,
  lootWarnings, lootPendingItems, lootProposal, selectedLootDraftIds, setSelectedLootDraftIds,
  onAcceptLootProposal, clearLootProposal,
}: {
  draft: EditorDraft;
  patchDraft: <K extends keyof EditorDraft>(key: K, value: EditorDraft[K]) => void;
  busy: boolean;
  t: (s: string, vars?: Record<string, string | number>) => string;
  advancedOpen: boolean;
  setAdvancedOpen: (v: boolean) => void;
  items: ItemAsset[];
  selectedId: string | null;
  manualOpen: boolean;
  shelfAiPrompt: string;
  setShelfAiPrompt: (v: string) => void;
  shelfProposing: boolean;
  onProposeShelf: () => void;
  shelfWarnings: string[];
  shelfPendingItems: string[];
  shelfProposal: ShelfDraftRow[] | null;
  selectedShelfDraftIds: Set<string>;
  setSelectedShelfDraftIds: (v: Set<string> | ((prev: Set<string>) => Set<string>)) => void;
  onAcceptShelfProposal: () => void;
  clearShelfProposal: () => void;
  lootAiPrompt: string;
  setLootAiPrompt: (v: string) => void;
  lootProposing: boolean;
  onProposeLoot: () => void;
  lootWarnings: string[];
  lootPendingItems: string[];
  lootProposal: LootDraftRowCard[] | null;
  selectedLootDraftIds: Set<string>;
  setSelectedLootDraftIds: (v: Set<string> | ((prev: Set<string>) => Set<string>)) => void;
  onAcceptLootProposal: () => void;
  clearLootProposal: () => void;
}) {
  function patchShelf(i: number, patch: Partial<ShelfRowDraft>) {
    const next = draft.shelfRows.map((row, idx) => idx === i ? { ...row, ...patch } : row);
    patchDraft('shelfRows', next);
  }
  function patchRecipe(i: number, patch: Partial<RecipeRowDraft>) {
    const next = draft.recipeRows.map((row, idx) => idx === i ? { ...row, ...patch } : row);
    patchDraft('recipeRows', next);
  }
  function patchQuestSlot(i: number, patch: Partial<QuestSlotDraft>) {
    const next = draft.questSlots.map((row, idx) => idx === i ? { ...row, ...patch } : row);
    patchDraft('questSlots', next);
  }
  function patchLoot(i: number, patch: Partial<LootRowDraft>) {
    const next = draft.lootRows.map((row, idx) => idx === i ? { ...row, ...patch } : row);
    patchDraft('lootRows', next);
  }
  function toggleFilter(cat: ItemCategory) {
    const on = draft.shopCategoryFilters.includes(cat);
    patchDraft(
      'shopCategoryFilters',
      on ? draft.shopCategoryFilters.filter(c => c !== cat) : [...draft.shopCategoryFilters, cat],
    );
  }

  return (
    <div className="building-inspector-fields">
      <div className="building-inspector-primary">
        <label className="building-field-name">{t('名称')}
          <input data-testid="building-library-form-label" value={draft.label} maxLength={80}
            disabled={busy} placeholder={t('如：杂货铺')}
            onChange={e => patchDraft('label', e.target.value)} />
        </label>
        <div className="building-kind-row" role="group" aria-label={t('种类')}>
          {MAP_FILL_KINDS.map(k => (
            <button key={k} type="button" className={`chip small${draft.kind === k ? ' active' : ''}`}
              data-testid={`building-library-form-kind-${k}`} disabled={busy}
              aria-pressed={draft.kind === k} onClick={() => patchDraft('kind', k)}>
              {t(BUILDING_KIND_LABEL[k])}
            </button>
          ))}
          <select className="sr-only" data-testid="building-library-form-kind" value={draft.kind}
            disabled={busy} aria-hidden tabIndex={-1}
            onChange={e => patchDraft('kind', e.target.value as MapFillKind)}>
            {MAP_FILL_KINDS.map(k => <option key={k} value={k}>{t(BUILDING_KIND_LABEL[k])}</option>)}
          </select>
        </div>
        <label className="building-library-form-wide">{t('简介')}
          <textarea data-testid="building-library-form-blurb" value={draft.blurb} maxLength={500}
            disabled={busy} rows={2} placeholder={t('给作者看的说明，不直接进玩法')}
            onChange={e => patchDraft('blurb', e.target.value)} />
        </label>
      </div>

      {draft.kind === 'shop' && (
        <div className="building-kind-template" data-testid="building-shop-template">
          <div className="building-kind-template-head">
            <h4>{t('货架模板')}</h4>
            <p className="hint">{t('库内可空货架；真价与货币在世界放置时绑定。引用物品目录中的 itemId。')}</p>
          </div>
          {draft.shelfRows.length === 0 && (
            <p className="hint building-template-empty" data-testid="building-shop-shelf-empty">
              {t('空货架（模板-only，合法）')}
            </p>
          )}
          <ul className="building-shelf-list" data-testid="building-shop-shelf-list">
            {draft.shelfRows.map((row, i) => (
              <li key={`shelf-${i}`} className="building-shelf-row" data-testid={`building-shop-shelf-row-${i}`}>
                <label>{t('物品')}
                  <select data-testid={`building-shop-shelf-item-${i}`} value={row.itemId} disabled={busy}
                    onChange={e => patchShelf(i, { itemId: e.target.value })}>
                    <option value="">{t('— 从物品目录选择 —')}</option>
                    {items.map(it => (
                      <option key={it.id} value={it.id}>
                        {it.label}（{ITEM_CATEGORY_LABEL[it.category]} · {it.id}）
                      </option>
                    ))}
                    {row.itemId && !items.some(it => it.id === row.itemId) && (
                      <option value={row.itemId}>{row.itemId}（缺失）</option>
                    )}
                  </select>
                </label>
                <label>{t('提示价')}
                  <input data-testid={`building-shop-shelf-price-${i}`} value={row.priceAmount}
                    disabled={busy} inputMode="decimal" placeholder="—"
                    onChange={e => patchShelf(i, { priceAmount: e.target.value })} />
                </label>
                <label>{t('货币角色')}
                  <input data-testid={`building-shop-shelf-role-${i}`} value={row.priceRoleHint}
                    disabled={busy} maxLength={40} placeholder="primary_coin"
                    onChange={e => patchShelf(i, { priceRoleHint: e.target.value })} />
                </label>
                <label>{t('库存上限')}
                  <input data-testid={`building-shop-shelf-stock-${i}`} value={row.stockMax}
                    disabled={busy} inputMode="numeric" placeholder="—"
                    onChange={e => patchShelf(i, { stockMax: e.target.value })} />
                </label>
                <button type="button" className="quiet small danger" disabled={busy}
                  data-testid={`building-shop-shelf-remove-${i}`}
                  onClick={() => patchDraft('shelfRows', draft.shelfRows.filter((_, j) => j !== i))}>
                  {t('移除')}
                </button>
              </li>
            ))}
          </ul>
          <div className="building-template-ai" data-testid="building-shop-shelf-ai">
            <div className="building-ai-prompt-row">
              <input data-testid="building-shop-shelf-ai-prompt" value={shelfAiPrompt} maxLength={2000}
                disabled={shelfProposing || busy || !selectedId} placeholder={t('描述货架内容，例如：干粮与伤药')}
                onChange={e => setShelfAiPrompt(e.target.value)} />
              <button type="button" className="small" data-testid="building-shop-shelf-ai-generate"
                disabled={shelfProposing || busy || !selectedId || !shelfAiPrompt.trim() || manualOpen}
                onClick={() => void onProposeShelf()}>
                {shelfProposing ? t('生成中…') : t('AI 提议货架')}
              </button>
            </div>
            {shelfWarnings.length > 0 && (
              <ul className="building-ai-warnings">{shelfWarnings.map(w => <li key={w} className="hint">{w}</li>)}</ul>
            )}
            {shelfPendingItems.length > 0 && (
              <p className="hint" data-testid="building-shop-shelf-ai-pending">
                {t('待先入库：{names}', { names: shelfPendingItems.join('、') })}
              </p>
            )}
            {shelfProposal && shelfProposal.length > 0 && (
              <div className="building-ai-results" data-testid="building-shop-shelf-ai-results">
                <div className="building-ai-results-bar">
                  <span className="hint">{t('草案 {n} 项 · 已选 {m}', { n: shelfProposal.length, m: selectedShelfDraftIds.size })}</span>
                  <div className="building-ai-results-actions">
                    <button type="button" className="primary small" data-testid="building-shop-shelf-ai-accept"
                      disabled={busy || selectedShelfDraftIds.size === 0}
                      onClick={() => void onAcceptShelfProposal()}>{t('写入货架')}</button>
                    <button type="button" className="quiet small" data-testid="building-shop-shelf-ai-discard"
                      disabled={busy} onClick={() => clearShelfProposal()}>{t('丢弃')}</button>
                  </div>
                </div>
                <ul className="building-shelf-ai-list">
                  {shelfProposal.map(row => {
                    const on = selectedShelfDraftIds.has(row.draftId);
                    return (
                      <li key={row.draftId}>
                        <label className="building-inline-check">
                          <input type="checkbox" checked={on} disabled={busy}
                            data-testid={`building-shop-shelf-ai-row-${row.draftId}`}
                            onChange={() => setSelectedShelfDraftIds(prev => {
                              const next = new Set(prev);
                              if (next.has(row.draftId)) next.delete(row.draftId); else next.add(row.draftId);
                              return next;
                            })} />
                          <span>{row.itemLabel ?? row.itemId}
                            {row.price ? ` · ${t('提示价')} ${row.price.amount}` : ''}
                            {row.price?.roleHint ? ` · ${row.price.roleHint}` : ''}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
          <div className="building-kind-template-actions">
            <button type="button" className="small" data-testid="building-shop-shelf-add" disabled={busy}
              onClick={() => patchDraft('shelfRows', [...draft.shelfRows, emptyShelfRow()])}>
              {t('添加货架行')}
            </button>
            <label className="building-inline-check">
              <input type="checkbox" data-testid="building-shop-buyback" checked={draft.shopBuyback}
                disabled={busy} onChange={e => patchDraft('shopBuyback', e.target.checked)} />
              {t('回收（桩）')}
            </label>
          </div>
          <div className="building-filter-chips" role="group" aria-label={t('类别偏好')}>
            <span className="hint">{t('类别偏好')}</span>
            {ITEM_CATEGORIES.map(cat => (
              <button key={cat} type="button"
                className={`chip small${draft.shopCategoryFilters.includes(cat) ? ' active' : ''}`}
                data-testid={`building-shop-filter-${cat}`} disabled={busy}
                aria-pressed={draft.shopCategoryFilters.includes(cat)}
                onClick={() => toggleFilter(cat)}>
                {t(ITEM_CATEGORY_LABEL[cat])}
              </button>
            ))}
          </div>
        </div>
      )}

      {draft.kind === 'supply' && (
        <div className="building-kind-template" data-testid="building-supply-template">
          <div className="building-kind-template-head">
            <h4>{t('补给配方')}</h4>
            <p className="hint">{t('优先语义键（heal_light / rest…）；勿把题材变量名写成库必填。库内可空。')}</p>
          </div>
          {draft.recipeRows.length === 0 && (
            <p className="hint building-template-empty" data-testid="building-supply-recipes-empty">
              {t('空配方（模板-only，合法）')}
            </p>
          )}
          <ul className="building-recipe-list" data-testid="building-supply-recipe-list">
            {draft.recipeRows.map((row, i) => (
              <li key={row.id || `recipe-${i}`} className="building-recipe-row" data-testid={`building-supply-recipe-row-${i}`}>
                <label>{t('名称')}
                  <input data-testid={`building-supply-recipe-label-${i}`} value={row.label}
                    disabled={busy} maxLength={80} placeholder={t('如：打尖')}
                    onChange={e => patchRecipe(i, { label: e.target.value })} />
                </label>
                <label>{t('语义键')}
                  <input data-testid={`building-supply-recipe-role-${i}`} value={row.role}
                    disabled={busy} maxLength={40} placeholder="heal_light"
                    onChange={e => patchRecipe(i, { role: e.target.value })} />
                </label>
                <label>{t('目标角色')}
                  <input data-testid={`building-supply-recipe-target-role-${i}`} value={row.targetRoleHint}
                    disabled={busy} maxLength={40} placeholder="heal_light"
                    onChange={e => patchRecipe(i, { targetRoleHint: e.target.value })} />
                </label>
                <label>{t('恢复量')}
                  <input data-testid={`building-supply-recipe-amount-${i}`} value={row.amount}
                    disabled={busy} inputMode="decimal"
                    onChange={e => patchRecipe(i, { amount: e.target.value })} />
                </label>
                <label>{t('费用提示')}
                  <input data-testid={`building-supply-recipe-cost-${i}`} value={row.costAmount}
                    disabled={busy} inputMode="decimal" placeholder="—"
                    onChange={e => patchRecipe(i, { costAmount: e.target.value })} />
                </label>
                <details className="building-recipe-advanced">
                  <summary>{t('高级')}</summary>
                  <label>{t('目标类型')}
                    <select data-testid={`building-supply-recipe-target-kind-${i}`} value={row.targetKind}
                      disabled={busy} onChange={e => patchRecipe(i, { targetKind: e.target.value as 'variable' | 'resource' })}>
                      <option value="variable">{t('变量')}</option>
                      <option value="resource">{t('资源')}</option>
                    </select>
                  </label>
                  <label>{t('目标变量名（世界绑定）')}
                    <input data-testid={`building-supply-recipe-target-name-${i}`} value={row.targetName}
                      disabled={busy} maxLength={80} placeholder={t('可选；写入后入库会警告需世界绑定')}
                      onChange={e => patchRecipe(i, { targetName: e.target.value })} />
                  </label>
                  <label>{t('需要物品')}
                    <select data-testid={`building-supply-recipe-requires-${i}`} value={row.requiresItemId}
                      disabled={busy} onChange={e => patchRecipe(i, { requiresItemId: e.target.value })}>
                      <option value="">{t('— 无 —')}</option>
                      {items.map(it => (
                        <option key={it.id} value={it.id}>{it.label}（{it.id}）</option>
                      ))}
                    </select>
                  </label>
                </details>
                <button type="button" className="quiet small danger" disabled={busy}
                  data-testid={`building-supply-recipe-remove-${i}`}
                  onClick={() => patchDraft('recipeRows', draft.recipeRows.filter((_, j) => j !== i))}>
                  {t('移除')}
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="small" data-testid="building-supply-recipe-add" disabled={busy}
            onClick={() => patchDraft('recipeRows', [...draft.recipeRows, emptyRecipeRow()])}>
            {t('添加配方')}
          </button>
        </div>
      )}

      {draft.kind === 'quest' && (
        <div className="building-kind-template" data-testid="building-quest-template">
          <div className="building-kind-template-head">
            <h4>{t('任务槽')}</h4>
            <p className="hint">{t('库内用标签/占位即可；questId 真值在世界绑定。空槽合法。')}</p>
          </div>
          {draft.questSlots.length === 0 && (
            <p className="hint building-template-empty" data-testid="building-quest-slots-empty">
              {t('空任务槽（模板-only，合法）')}
            </p>
          )}
          <ul className="building-quest-list" data-testid="building-quest-slot-list">
            {draft.questSlots.map((row, i) => (
              <li key={`quest-${i}`} className="building-quest-row" data-testid={`building-quest-slot-row-${i}`}>
                <label>{t('展示名')}
                  <input data-testid={`building-quest-slot-label-${i}`} value={row.label}
                    disabled={busy} maxLength={80} placeholder={t('如：侧线狩猎')}
                    onChange={e => patchQuestSlot(i, { label: e.target.value })} />
                </label>
                <label>{t('语义标签')}
                  <input data-testid={`building-quest-slot-marker-tag-${i}`} value={row.markerTag}
                    disabled={busy} maxLength={80} placeholder="tag:side_hunt"
                    onChange={e => patchQuestSlot(i, { markerTag: e.target.value })} />
                </label>
                <label>{t('占位 questId')}
                  <input data-testid={`building-quest-slot-quest-id-${i}`} value={row.questId}
                    disabled={busy} maxLength={80} placeholder={t('可选占位，非本世界真 id')}
                    onChange={e => patchQuestSlot(i, { questId: e.target.value })} />
                </label>
                <label>{t('交付物品')}
                  <select data-testid={`building-quest-slot-give-${i}`}
                    value={row.giveItems[0]?.itemId ?? ''} disabled={busy}
                    onChange={e => {
                      const id = e.target.value;
                      patchQuestSlot(i, {
                        giveItems: id ? [{ itemId: id, qty: row.giveItems[0]?.qty || '1' }] : [],
                      });
                    }}>
                    <option value="">{t('— 无 —')}</option>
                    {items.map(it => (
                      <option key={it.id} value={it.id}>{it.label}（{it.id}）</option>
                    ))}
                  </select>
                </label>
                <label>{t('奖励物品')}
                  <select data-testid={`building-quest-slot-reward-${i}`}
                    value={row.rewardItems[0]?.itemId ?? ''} disabled={busy}
                    onChange={e => {
                      const id = e.target.value;
                      patchQuestSlot(i, {
                        rewardItems: id ? [{ itemId: id, qty: row.rewardItems[0]?.qty || '1' }] : [],
                      });
                    }}>
                    <option value="">{t('— 无 —')}</option>
                    {items.map(it => (
                      <option key={it.id} value={it.id}>{it.label}（{it.id}）</option>
                    ))}
                  </select>
                </label>
                <button type="button" className="quiet small danger" disabled={busy}
                  data-testid={`building-quest-slot-remove-${i}`}
                  onClick={() => patchDraft('questSlots', draft.questSlots.filter((_, j) => j !== i))}>
                  {t('移除')}
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="small" data-testid="building-quest-slot-add" disabled={busy}
            onClick={() => patchDraft('questSlots', [...draft.questSlots, emptyQuestSlot()])}>
            {t('添加任务槽')}
          </button>
        </div>
      )}

      {(draft.kind === 'encounter' || draft.kind === 'boss') && (
        <div className="building-kind-template" data-testid="building-encounter-template">
          <div className="building-kind-template-head">
            <h4>{draft.kind === 'boss' ? t('Boss 掉落模板') : t('遭遇掉落模板')}</h4>
            <p className="hint">{t('loot 引用物品目录；空掉落合法。击败旗不在库内必填。')}</p>
          </div>
          <div className="building-encounter-prefs" data-testid="building-encounter-prefs">
            <label>{t('包占位 id')}
              <input data-testid="building-encounter-pack-id" value={draft.encounterPackId}
                disabled={busy} maxLength={80} placeholder={t('可选；真 id 世界绑定')}
                onChange={e => patchDraft('encounterPackId', e.target.value)} />
            </label>
            <label>{t('包语义标签')}
              <input data-testid="building-encounter-pack-tag" value={draft.encounterPackTag}
                disabled={busy} maxLength={80} placeholder="tag:road_ambush"
                onChange={e => patchDraft('encounterPackTag', e.target.value)} />
            </label>
            <label>{t('触发偏好')}
              <select data-testid="building-encounter-trigger-pref" value={draft.encounterTriggerPref}
                disabled={busy}
                onChange={e => patchDraft('encounterTriggerPref', e.target.value as EncounterTriggerPref | '')}>
                <option value="">{t('— 未指定 —')}</option>
                {ENCOUNTER_TRIGGER_PREFS.map(p => (
                  <option key={p} value={p}>
                    {p === 'enter_location' ? t('进入地点') : p === 'interact' ? t('互动') : t('自定义')}
                  </option>
                ))}
              </select>
            </label>
            <label>{t('触发备注')}
              <input data-testid="building-encounter-trigger-note" value={draft.encounterTriggerNote}
                disabled={busy} maxLength={200} placeholder={t('可选说明')}
                onChange={e => patchDraft('encounterTriggerNote', e.target.value)} />
            </label>
            {draft.kind === 'encounter' && (
              <label className="building-inline-check">
                <input type="checkbox" data-testid="building-encounter-boss-flag"
                  checked={draft.encounterBoss} disabled={busy}
                  onChange={e => patchDraft('encounterBoss', e.target.checked)} />
                {t('标记为 Boss（可选）')}
              </label>
            )}
            {draft.kind === 'boss' && (
              <p className="hint" data-testid="building-boss-no-defeat-flag">
                {t('击败旗属本世界 facts，库内不要求填写。')}
              </p>
            )}
          </div>
          {draft.lootRows.length === 0 && (
            <p className="hint building-template-empty" data-testid="building-encounter-loot-empty">
              {t('空掉落（模板-only，合法）')}
            </p>
          )}
          <ul className="building-loot-list" data-testid="building-encounter-loot-list">
            {draft.lootRows.map((row, i) => (
              <li key={`loot-${i}`} className="building-loot-row" data-testid={`building-encounter-loot-row-${i}`}>
                <label>{t('物品')}
                  <select data-testid={`building-encounter-loot-item-${i}`} value={row.itemId} disabled={busy}
                    onChange={e => patchLoot(i, { itemId: e.target.value })}>
                    <option value="">{t('— 从物品目录选择 —')}</option>
                    {items.map(it => (
                      <option key={it.id} value={it.id}>
                        {it.label}（{ITEM_CATEGORY_LABEL[it.category]} · {it.id}）
                      </option>
                    ))}
                    {row.itemId && !items.some(it => it.id === row.itemId) && (
                      <option value={row.itemId}>{row.itemId}（缺失）</option>
                    )}
                  </select>
                </label>
                <label>{t('数量')}
                  <input data-testid={`building-encounter-loot-qty-${i}`} value={row.qty}
                    disabled={busy} inputMode="numeric" placeholder="1"
                    onChange={e => patchLoot(i, { qty: e.target.value })} />
                </label>
                <label>{t('上限（可选）')}
                  <input data-testid={`building-encounter-loot-qty-max-${i}`} value={row.qtyMax}
                    disabled={busy} inputMode="numeric" placeholder="—"
                    onChange={e => patchLoot(i, { qtyMax: e.target.value })} />
                </label>
                <label>{t('概率')}
                  <input data-testid={`building-encounter-loot-chance-${i}`} value={row.chance}
                    disabled={busy} inputMode="decimal" placeholder="0..1"
                    onChange={e => patchLoot(i, { chance: e.target.value })} />
                </label>
                <label>{t('资源提示')}
                  <input data-testid={`building-encounter-loot-resource-${i}`} value={row.resourceAmount}
                    disabled={busy} inputMode="decimal" placeholder="—"
                    onChange={e => patchLoot(i, { resourceAmount: e.target.value })} />
                </label>
                <button type="button" className="quiet small danger" disabled={busy}
                  data-testid={`building-encounter-loot-remove-${i}`}
                  onClick={() => patchDraft('lootRows', draft.lootRows.filter((_, j) => j !== i))}>
                  {t('移除')}
                </button>
              </li>
            ))}
          </ul>
          <div className="building-template-ai" data-testid="building-encounter-loot-ai">
            <div className="building-ai-prompt-row">
              <input data-testid="building-encounter-loot-ai-prompt" value={lootAiPrompt} maxLength={2000}
                disabled={lootProposing || busy || !selectedId} placeholder={t('描述掉落，例如：兽皮与兽骨')}
                onChange={e => setLootAiPrompt(e.target.value)} />
              <button type="button" className="small" data-testid="building-encounter-loot-ai-generate"
                disabled={lootProposing || busy || !selectedId || !lootAiPrompt.trim() || manualOpen}
                onClick={() => void onProposeLoot()}>
                {lootProposing ? t('生成中…') : t('AI 提议掉落')}
              </button>
            </div>
            {lootWarnings.length > 0 && (
              <ul className="building-ai-warnings">{lootWarnings.map(w => <li key={w} className="hint">{w}</li>)}</ul>
            )}
            {lootPendingItems.length > 0 && (
              <p className="hint" data-testid="building-encounter-loot-ai-pending">
                {t('待先入库：{names}', { names: lootPendingItems.join('、') })}
              </p>
            )}
            {lootProposal && lootProposal.length > 0 && (
              <div className="building-ai-results" data-testid="building-encounter-loot-ai-results">
                <div className="building-ai-results-bar">
                  <span className="hint">{t('草案 {n} 项 · 已选 {m}', { n: lootProposal.length, m: selectedLootDraftIds.size })}</span>
                  <div className="building-ai-results-actions">
                    <button type="button" className="primary small" data-testid="building-encounter-loot-ai-accept"
                      disabled={busy || selectedLootDraftIds.size === 0}
                      onClick={() => void onAcceptLootProposal()}>{t('写入掉落')}</button>
                    <button type="button" className="quiet small" data-testid="building-encounter-loot-ai-discard"
                      disabled={busy} onClick={() => clearLootProposal()}>{t('丢弃')}</button>
                  </div>
                </div>
                <ul className="building-shelf-ai-list">
                  {lootProposal.map(row => {
                    const on = selectedLootDraftIds.has(row.draftId);
                    return (
                      <li key={row.draftId}>
                        <label className="building-inline-check">
                          <input type="checkbox" checked={on} disabled={busy}
                            data-testid={`building-encounter-loot-ai-row-${row.draftId}`}
                            onChange={() => setSelectedLootDraftIds(prev => {
                              const next = new Set(prev);
                              if (next.has(row.draftId)) next.delete(row.draftId); else next.add(row.draftId);
                              return next;
                            })} />
                          <span>{row.itemLabel ?? row.itemId} · {t('概率')} {row.chance}</span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
          <button type="button" className="small" data-testid="building-encounter-loot-add" disabled={busy}
            onClick={() => patchDraft('lootRows', [...draft.lootRows, emptyLootRow()])}>
            {t('添加掉落行')}
          </button>
        </div>
      )}

      <button type="button" className="building-advanced-toggle quiet small"
        data-testid="building-library-advanced-toggle" aria-expanded={advancedOpen}
        onClick={() => setAdvancedOpen(!advancedOpen)}>
        {advancedOpen ? t('收起高级选项') : t('高级选项：图标 / 库存草稿 / 世界书')}
      </button>
      {advancedOpen && (
        <div className="building-inspector-advanced">
          <div className="building-library-form-grid">
            <label>{t('图标')}
              <input data-testid="building-library-form-icon" value={draft.icon} maxLength={40}
                disabled={busy} placeholder={t('emoji 或键名')}
                onChange={e => patchDraft('icon', e.target.value)} />
            </label>
            <label>{t('颜色')}
              <span className="building-library-color-row">
                <input type="color" data-testid="building-library-form-color"
                  value={/^#[0-9a-fA-F]{6}$/.test(draft.color) ? draft.color : BUILDING_KIND_COLOR[draft.kind]}
                  disabled={busy} onChange={e => patchDraft('color', e.target.value)} />
                <input value={draft.color} maxLength={7} disabled={busy}
                  onChange={e => patchDraft('color', e.target.value)} />
              </span>
            </label>
          </div>
          <label className="building-library-form-wide">{t('标签')}
            <input data-testid="building-library-form-tags" value={draft.tags} maxLength={200}
              disabled={busy} placeholder={t('逗号分隔，如：城镇, 商店')}
              onChange={e => patchDraft('tags', e.target.value)} />
          </label>
          <label className="building-library-form-wide">{t('默认互动名')}
            <input data-testid="building-library-form-interact" value={draft.interactLabel} maxLength={80}
              disabled={busy} placeholder={t('如：购物 / 补给 / 接任务')}
              onChange={e => patchDraft('interactLabel', e.target.value)} />
          </label>
          <div className="building-library-form-grid">
            <label>{t('库存草稿（过渡）')}
              <textarea data-testid="building-library-form-inventory" value={draft.inventory}
                disabled={busy} rows={3} placeholder={t('每行一项；硬货架见上方模板')}
                onChange={e => patchDraft('inventory', e.target.value)} />
            </label>
            <label>{t('掉落草稿（过渡）')}
              <textarea data-testid="building-library-form-loot" value={draft.loot}
                disabled={busy} rows={3} placeholder={t('每行一项；硬掉落见上方模板')}
                onChange={e => patchDraft('loot', e.target.value)} />
            </label>
          </div>
          <label className="building-library-form-wide">{t('世界书标签')}
            <input data-testid="building-library-form-wb-tags" value={draft.worldbookTags} maxLength={200}
              disabled={busy} placeholder={t('逗号分隔')}
              onChange={e => patchDraft('worldbookTags', e.target.value)} />
          </label>
        </div>
      )}
    </div>
  );
}
