import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ITEM_CATEGORIES, ITEM_CATEGORY_COLOR, ITEM_CATEGORY_LABEL,
  type ItemAsset, type ItemCatalog, type ItemCategory, type ItemDraftCard,
} from '@novel-game/contracts';
import { useI18n } from '../../lib/i18n';
import {
  acceptItemDrafts, createItemAsset, deleteItemAsset, loadItemCatalog,
  proposeItemAssets, updateItemAsset,
} from '../../lib/item-catalog-api';
import { RequestError } from '../../lib/api';
import { filterItemAssets, type ItemCategoryFilter } from '../../lib/item-catalog-filter';

type EditorDraft = {
  label: string;
  category: ItemCategory;
  tags: string;
  blurb: string;
  generateHint: string;
  stackMax: string;
  stackUnique: boolean;
  priceAmount: string;
  priceRoleHint: string;
  priceResourceId: string;
};

const emptyDraft = (category: ItemCategory = 'consumable'): EditorDraft => ({
  label: '', category, tags: '', blurb: '', generateHint: '',
  stackMax: '', stackUnique: false, priceAmount: '', priceRoleHint: '', priceResourceId: '',
});

function csv(text: string): string[] | undefined {
  const parts = text.split(/[,，]/).map(s => s.trim()).filter(Boolean).slice(0, 16);
  return parts.length ? parts : undefined;
}

function assetToDraft(a: ItemAsset): EditorDraft {
  return {
    label: a.label,
    category: a.category,
    tags: (a.tags ?? []).join(', '),
    blurb: a.blurb ?? '',
    generateHint: a.generateHint ?? '',
    stackMax: a.stack?.max !== undefined ? String(a.stack.max) : '',
    stackUnique: a.stack?.unique === true,
    priceAmount: a.defaultPriceHint?.amount !== undefined ? String(a.defaultPriceHint.amount) : '',
    priceRoleHint: a.defaultPriceHint?.roleHint ?? '',
    priceResourceId: a.defaultPriceHint?.resourceId ?? '',
  };
}

type Props = { token: string };

/**
 * Item Catalog studio (M-item-1 + M-item-4 AI propose).
 * Soft fields + AI draft cards → accept. No session / map writes.
 */
export function ItemCatalogPage({ token }: Props) {
  const { t } = useI18n();
  const [catalog, setCatalog] = useState<ItemCatalog | null>(null);
  const [revision, setRevision] = useState(0);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<ItemCategoryFilter>('all');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [draft, setDraft] = useState<EditorDraft>(emptyDraft());

  // AI propose state (client-only; reject/discard clears — zero residual)
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiGenre, setAiGenre] = useState('');
  const [aiContext, setAiContext] = useState('');
  const [aiCategories, setAiCategories] = useState<ItemCategory[]>([]);
  const [generating, setGenerating] = useState(false);
  const [proposal, setProposal] = useState<ItemDraftCard[] | null>(null);
  const [proposalModel, setProposalModel] = useState<string | undefined>();
  const [proposalWarnings, setProposalWarnings] = useState<string[]>([]);
  const [selectedDraftIds, setSelectedDraftIds] = useState<Set<string>>(new Set());

  const accept = useCallback((view: { catalog: ItemCatalog; revision: number; warnings?: string[] }) => {
    setCatalog(view.catalog);
    setRevision(view.revision);
    setWarnings(view.warnings ?? []);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      accept(await loadItemCatalog(token));
      setError(null);
    } catch (e) {
      setError(e instanceof RequestError ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [token, accept]);

  useEffect(() => { void refresh(); }, [refresh]);

  const items = useMemo(
    () => filterItemAssets(catalog?.items ?? [], categoryFilter, query),
    [catalog, categoryFilter, query],
  );
  const selected = catalog?.items.find(a => a.id === selectedId) ?? null;

  function startCreate(category: ItemCategory = 'consumable') {
    setManualOpen(true); setSelectedId(null);
    setDraft(emptyDraft(category)); setAdvancedOpen(false); setNote(null); setError(null);
  }
  function selectItem(a: ItemAsset) {
    setManualOpen(false); setSelectedId(a.id);
    setDraft(assetToDraft(a)); setAdvancedOpen(false); setNote(null); setError(null);
  }
  function patchDraft<K extends keyof EditorDraft>(key: K, value: EditorDraft[K]) {
    setDraft(prev => ({ ...prev, [key]: value }));
  }

  function clearProposal() {
    setProposal(null);
    setSelectedDraftIds(new Set());
    setProposalWarnings([]);
    setProposalModel(undefined);
  }

  function buildPatch() {
    const tags = csv(draft.tags);
    const patch: {
      label: string; category: ItemCategory; tags?: string[];
      blurb?: string; generateHint?: string;
      stack?: { max?: number; unique?: boolean };
      defaultPriceHint?: { amount: number; resourceId?: string; roleHint?: string };
    } = {
      label: draft.label.trim(),
      category: draft.category,
    };
    if (tags) patch.tags = tags;
    const blurb = draft.blurb.trim();
    if (blurb) patch.blurb = blurb;
    const generateHint = draft.generateHint.trim();
    if (generateHint) patch.generateHint = generateHint;

    const stack: { max?: number; unique?: boolean } = {};
    if (draft.stackUnique) stack.unique = true;
    const maxRaw = draft.stackMax.trim();
    if (maxRaw) {
      const max = Number(maxRaw);
      if (Number.isFinite(max) && max >= 1) stack.max = Math.floor(max);
    }
    if (stack.unique || stack.max !== undefined) patch.stack = stack;

    const amountRaw = draft.priceAmount.trim();
    if (amountRaw) {
      const amount = Number(amountRaw);
      if (Number.isFinite(amount)) {
        const hint: { amount: number; resourceId?: string; roleHint?: string } = { amount };
        const role = draft.priceRoleHint.trim();
        if (role) hint.roleHint = role.slice(0, 40);
        const rid = draft.priceResourceId.trim();
        if (rid) hint.resourceId = rid.slice(0, 80);
        patch.defaultPriceHint = hint;
      }
    }
    return patch;
  }

  async function onCreate() {
    if (busy || !draft.label.trim()) return;
    setBusy(true); setError(null); setNote(null);
    try {
      const view = await createItemAsset(token, {
        ...buildPatch(), expectedRevision: revision,
        provenance: { source: 'item-catalog-page', createdAt: new Date().toISOString() },
      });
      accept(view); selectItem(view.asset);
      setNote(t('已创建：{name}', { name: view.asset.label }));
      setManualOpen(false);
    } catch (e) {
      setError(e instanceof RequestError ? e.message : String(e));
      if (e instanceof RequestError && e.code === 'ITEM_CATALOG_CONFLICT') await refresh();
    } finally { setBusy(false); }
  }

  async function onSave() {
    if (busy || !selectedId || !draft.label.trim()) return;
    setBusy(true); setError(null); setNote(null);
    try {
      const patch = buildPatch();
      const view = await updateItemAsset(token, selectedId, {
        ...patch, version: (selected?.version ?? 1) + 1,
      }, revision);
      accept(view);
      const updated = view.catalog.items.find(a => a.id === selectedId);
      if (updated) selectItem(updated);
      setNote(t('已保存：{name}', { name: patch.label }));
    } catch (e) {
      setError(e instanceof RequestError ? e.message : String(e));
      if (e instanceof RequestError && e.code === 'ITEM_CATALOG_CONFLICT') await refresh();
    } finally { setBusy(false); }
  }

  async function onDelete() {
    if (busy || !selectedId) return;
    if (!window.confirm(t('从物品目录删除此条目？若建筑硬行仍引用它将被拒绝。'))) return;
    setBusy(true); setError(null); setNote(null);
    try {
      accept(await deleteItemAsset(token, selectedId, revision));
      setSelectedId(null); setDraft(emptyDraft()); setNote(t('已删除'));
    } catch (e) {
      setError(e instanceof RequestError ? e.message : String(e));
      if (e instanceof RequestError && (e.code === 'ITEM_CATALOG_CONFLICT' || e.code === 'ITEM_REFERENCED')) {
        if (e.code === 'ITEM_CATALOG_CONFLICT') await refresh();
      }
    } finally { setBusy(false); }
  }

  function toggleAiCategory(c: ItemCategory) {
    setAiCategories(prev => prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c]);
  }

  async function onGenerate() {
    if (generating || busy || !aiPrompt.trim()) return;
    setGenerating(true); setError(null); setNote(null);
    try {
      const result = await proposeItemAssets(token, {
        prompt: aiPrompt.trim(),
        categories: aiCategories.length ? aiCategories : undefined,
        genre: aiGenre.trim() || undefined,
        context: aiContext.trim() || undefined,
        count: 6,
      });
      setProposal(result.drafts);
      setProposalModel(result.model);
      setProposalWarnings(result.warnings ?? []);
      setSelectedDraftIds(new Set(result.drafts.map(d => d.draftId)));
      if (!result.drafts.length) setNote(t('没有生成到物品草案，试试换个提示'));
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
      const view = await acceptItemDrafts(token, { expectedRevision: revision, drafts });
      accept(view);
      clearProposal();
      const first = view.catalog.items.find(a => view.assets.some(x => x.id === a.id));
      if (first) {
        setManualOpen(false); setSelectedId(first.id);
        setDraft(assetToDraft(first)); setAdvancedOpen(false); setError(null);
      }
      setNote(t('已入库 {n} 项', { n: view.assets.length }));
    } catch (e) {
      setError(e instanceof RequestError ? e.message : String(e));
      if (e instanceof RequestError && e.code === 'ITEM_CATALOG_CONFLICT') await refresh();
    } finally { setBusy(false); }
  }

  const total = catalog?.items.length ?? 0;
  const inspectorOpen = Boolean(selected) || manualOpen;
  const selectedCount = selectedDraftIds.size;

  return (
    <section className="work-section building-library-page item-catalog-page" data-testid="item-catalog-page">
      <header className="building-library-page-header">
        <div className="building-library-page-heading">
          <p className="eyebrow">{t('工作区目录')}</p>
          <h2>{t('物品目录')}</h2>
          <p className="hint">{t('跨世界可复用的物品编目。AI 出草案后勾选入库；价格提示不绑死某世界货币。')}</p>
        </div>
        <div className="building-library-page-actions">
          <span className="building-library-stat" data-testid="item-catalog-page-count">{t('{n} 项', { n: total })}</span>
          <button type="button" className="quiet small" disabled={busy || generating || loading} onClick={() => void refresh()}>{t('刷新')}</button>
          <button type="button" className="primary small" disabled={busy || loading}
            data-testid="item-catalog-page-new"
            aria-expanded={manualOpen}
            onClick={() => {
              if (!manualOpen) startCreate(categoryFilter === 'all' ? 'consumable' : categoryFilter);
              else { setManualOpen(false); }
            }}>
            {manualOpen ? t('取消新建') : t('新建物品')}
          </button>
        </div>
      </header>

      {(error || note || warnings.length > 0) && (
        <div className={`building-library-page-banner${error ? ' is-error' : ''}`} data-testid="item-catalog-page-banner" role="status">
          {error && <p className="hint error">{error}</p>}
          {note && !error && <p className="hint ok">{note}</p>}
          {!error && warnings.map(w => <p key={w} className="hint">{w}</p>)}
        </div>
      )}

      <div className="building-ai-strip item-ai-strip" data-testid="item-catalog-ai-card">
        <div className="building-ai-strip-head">
          <div>
            <h3>{t('AI 生成')}</h3>
            <p className="hint">{t('一句话出物品草案卡片，勾选后入库；不写玩法存档，不改地图。')}</p>
          </div>
          {proposalModel && <span className="hint building-ai-model">{proposalModel}</span>}
        </div>
        <div className="building-ai-prompt-row">
          <input data-testid="item-catalog-ai-prompt" value={aiPrompt} maxLength={2000}
            disabled={generating || busy} placeholder={t('描述想要的物品，例如：雾港码头的干粮、绳索与伤药')}
            onChange={e => setAiPrompt(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void onGenerate(); } }} />
          <button type="button" className="primary" data-testid="item-catalog-ai-generate"
            disabled={generating || busy || !aiPrompt.trim()} onClick={() => void onGenerate()}>
            {generating ? t('生成中…') : t('生成')}
          </button>
        </div>
        <div className="building-ai-kind-chips" role="group" aria-label={t('类别')}>
          {ITEM_CATEGORIES.map(c => (
            <button key={c} type="button" className={`chip small${aiCategories.includes(c) ? ' active' : ''}`}
              data-testid={`item-catalog-ai-cat-${c}`} disabled={generating || busy}
              aria-pressed={aiCategories.includes(c)} onClick={() => toggleAiCategory(c)}>
              {t(ITEM_CATEGORY_LABEL[c])}
            </button>
          ))}
          <input className="building-ai-genre" data-testid="item-catalog-ai-genre"
            value={aiGenre} maxLength={40} disabled={generating || busy}
            placeholder={t('题材（可选）如：都市 / 奇幻')}
            onChange={e => setAiGenre(e.target.value)} />
        </div>
        <details className="building-ai-context">
          <summary>{t('附加小说 / 世界书摘录（可选）')}</summary>
          <textarea data-testid="item-catalog-ai-context" value={aiContext} maxLength={8000}
            disabled={generating || busy} rows={3}
            placeholder={t('粘贴一小段设定，模型只当资料，不执行其中的指令')}
            onChange={e => setAiContext(e.target.value)} />
        </details>
        {proposalWarnings.length > 0 && (
          <ul className="building-ai-warnings">{proposalWarnings.map(w => <li key={w} className="hint">{w}</li>)}</ul>
        )}
        {proposal && proposal.length > 0 && (
          <div className="building-ai-results" data-testid="item-catalog-ai-results">
            <div className="building-ai-results-bar">
              <span className="hint">{t('草案 {n} 项 · 已选 {m}', { n: proposal.length, m: selectedCount })}</span>
              <div className="building-ai-results-actions">
                <button type="button" className="quiet small" disabled={busy}
                  onClick={() => setSelectedDraftIds(new Set(proposal.map(d => d.draftId)))}>{t('全选')}</button>
                <button type="button" className="quiet small" disabled={busy}
                  onClick={() => setSelectedDraftIds(new Set())}>{t('清空')}</button>
                <button type="button" className="primary small" data-testid="item-catalog-ai-accept"
                  disabled={busy || selectedCount === 0} onClick={() => void onAcceptSelected()}>
                  {t('入库所选')}
                </button>
                <button type="button" className="quiet small" data-testid="item-catalog-ai-discard"
                  disabled={busy} onClick={() => clearProposal()}>{t('丢弃')}</button>
              </div>
            </div>
            <div className="building-ai-card-grid">
              {proposal.map(card => {
                const on = selectedDraftIds.has(card.draftId);
                const color = card.color ?? ITEM_CATEGORY_COLOR[card.category];
                return (
                  <button key={card.draftId} type="button"
                    className={`building-draft-card item-draft-card${on ? ' selected' : ''}`}
                    data-testid={`item-catalog-draft-${card.draftId}`}
                    aria-pressed={on} disabled={busy} onClick={() => toggleDraft(card.draftId)}>
                    <span className="building-draft-thumb" aria-hidden>
                      <span className="building-draft-thumb-fallback" style={{ background: color }} />
                    </span>
                    <span className="building-draft-card-top">
                      <span className={`item-category-chip ${card.category}`}>{t(ITEM_CATEGORY_LABEL[card.category])}</span>
                      <span className="building-draft-check" aria-hidden>{on ? '✓' : ''}</span>
                    </span>
                    <strong className="building-draft-title">{card.label}</strong>
                    {card.blurb && <p className="building-draft-blurb">{card.blurb}</p>}
                    {card.defaultPriceHint && (
                      <p className="hint item-price-hint">
                        {t('提示价')} {card.defaultPriceHint.amount}
                        {card.defaultPriceHint.roleHint ? ` · ${card.defaultPriceHint.roleHint}` : ''}
                      </p>
                    )}
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

      <div className="building-library-page-toolbar">
        <label className="building-library-search">
          <span className="sr-only">{t('搜索')}</span>
          <input data-testid="item-catalog-search" value={query} maxLength={80}
            placeholder={t('搜索名称、标签或 id…')}
            onChange={e => setQuery(e.target.value)} />
        </label>
        <div className="building-library-kind-chips" role="group" aria-label={t('类别')}>
          <button type="button" className={`chip small${categoryFilter === 'all' ? ' active' : ''}`}
            data-testid="item-catalog-filter-all"
            aria-pressed={categoryFilter === 'all'} onClick={() => setCategoryFilter('all')}>{t('全部')}</button>
          {ITEM_CATEGORIES.map(c => (
            <button key={c} type="button" className={`chip small${categoryFilter === c ? ' active' : ''}`}
              data-testid={`item-catalog-filter-${c}`}
              aria-pressed={categoryFilter === c} onClick={() => setCategoryFilter(c)}>
              {t(ITEM_CATEGORY_LABEL[c])}
            </button>
          ))}
        </div>
      </div>

      <div className={`building-library-studio${inspectorOpen ? ' has-inspector' : ''}`}>
        <div className="building-library-catalog" data-testid="item-catalog-grid">
          {loading && (
            <div className="building-library-skeleton-grid" aria-hidden>
              {Array.from({ length: 6 }).map((_, i) => <div key={i} className="building-library-skeleton-card" />)}
            </div>
          )}
          {!loading && items.length === 0 && (
            <div className="building-library-state" data-testid="item-catalog-empty">
              <p className="building-library-empty-title">{t('目录里还没有物品')}</p>
              <p className="hint">{t('用上方 AI 生成草案，或手动新建一条消耗品 / 材料。')}</p>
              <button type="button" className="primary small" onClick={() => startCreate('consumable')}>{t('新建物品')}</button>
            </div>
          )}
          {!loading && items.length > 0 && (
            <div className="building-asset-grid item-catalog-grid">
              {items.map(item => {
                const on = selectedId === item.id && !manualOpen;
                return (
                  <button key={item.id} type="button"
                    className={`building-asset-card item-asset-card${on ? ' selected' : ''}`}
                    data-testid={`item-catalog-page-item-${item.id}`}
                    aria-pressed={on} onClick={() => selectItem(item)}>
                    <span className="building-asset-card-top">
                      <span className={`item-category-chip ${item.category}`}>{t(ITEM_CATEGORY_LABEL[item.category])}</span>
                      <span className="hint">v{item.version}</span>
                    </span>
                    <strong className="building-asset-card-title">{item.label}</strong>
                    <span className="hint building-asset-card-id">{item.id}</span>
                    {item.blurb && <p className="building-asset-card-blurb">{item.blurb}</p>}
                    {item.tags && item.tags.length > 0 && (
                      <span className="building-asset-card-tags">{item.tags.slice(0, 4).join(' · ')}</span>
                    )}
                    {item.defaultPriceHint && (
                      <span className="hint item-price-hint">
                        {t('提示价')} {item.defaultPriceHint.amount}
                        {item.defaultPriceHint.roleHint ? ` · ${item.defaultPriceHint.roleHint}` : ''}
                      </span>
                    )}
                    {item.provenance?.source === 'ai-propose' && (
                      <span className="hint item-provenance-ai">{t('AI 入库')}</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {inspectorOpen && (
          <aside className="building-library-page-editor" data-testid="item-catalog-inspector">
            <header className="building-inspector-head">
              <div>
                <p className="eyebrow">{manualOpen ? t('新建') : t('编辑')}</p>
                <h3>{manualOpen ? t('新建物品') : (selected?.label ?? t('物品'))}</h3>
              </div>
              <button type="button" className="quiet small" onClick={() => {
                setManualOpen(false); setSelectedId(null); setDraft(emptyDraft());
              }}>{t('关闭')}</button>
            </header>

            <div className="building-library-form-grid" data-testid="item-catalog-create-form">
              <label className="building-library-form-wide">
                <span>{t('名称')}</span>
                <input data-testid="item-catalog-form-label" value={draft.label} maxLength={80}
                  disabled={busy} onChange={e => patchDraft('label', e.target.value)} />
              </label>
              <label>
                <span>{t('类别')}</span>
                <select data-testid="item-catalog-form-category" value={draft.category} disabled={busy}
                  onChange={e => patchDraft('category', e.target.value as ItemCategory)}>
                  {ITEM_CATEGORIES.map(c => (
                    <option key={c} value={c}>{t(ITEM_CATEGORY_LABEL[c])}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>{t('标签')}</span>
                <input data-testid="item-catalog-form-tags" value={draft.tags} maxLength={200}
                  disabled={busy} placeholder={t('逗号分隔')}
                  onChange={e => patchDraft('tags', e.target.value)} />
              </label>
              <label className="building-library-form-wide">
                <span>{t('简介')}</span>
                <textarea data-testid="item-catalog-form-blurb" value={draft.blurb} maxLength={500}
                  disabled={busy} rows={2} onChange={e => patchDraft('blurb', e.target.value)} />
              </label>
            </div>

            <details className="building-inspector-advanced" open={advancedOpen}
              onToggle={e => setAdvancedOpen((e.target as HTMLDetailsElement).open)}>
              <summary>{t('堆叠 · 价格提示 · 生成提示')}</summary>
              <div className="building-library-form-grid">
                <label>
                  <span>{t('堆叠上限')}</span>
                  <input data-testid="item-catalog-form-stack-max" value={draft.stackMax} maxLength={6}
                    disabled={busy || draft.stackUnique} placeholder={t('可选')}
                    onChange={e => patchDraft('stackMax', e.target.value)} />
                </label>
                <label className="inline small">
                  <input type="checkbox" data-testid="item-catalog-form-stack-unique"
                    checked={draft.stackUnique} disabled={busy}
                    onChange={e => {
                      patchDraft('stackUnique', e.target.checked);
                      if (e.target.checked) patchDraft('stackMax', '');
                    }} />
                  <span>{t('唯一（不堆叠）')}</span>
                </label>
                <label>
                  <span>{t('提示价数量')}</span>
                  <input data-testid="item-catalog-form-price-amount" value={draft.priceAmount} maxLength={16}
                    disabled={busy} placeholder={t('可选，相对价')}
                    onChange={e => patchDraft('priceAmount', e.target.value)} />
                </label>
                <label>
                  <span>{t('货币角色提示')}</span>
                  <input data-testid="item-catalog-form-price-role" value={draft.priceRoleHint} maxLength={40}
                    disabled={busy} placeholder="primary_coin"
                    onChange={e => patchDraft('priceRoleHint', e.target.value)} />
                </label>
                <label className="building-library-form-wide">
                  <span>{t('resourceId（可选，不绑死世界）')}</span>
                  <input data-testid="item-catalog-form-price-resource" value={draft.priceResourceId} maxLength={80}
                    disabled={busy} placeholder={t('留空即可；有则仅做格式警告')}
                    onChange={e => patchDraft('priceResourceId', e.target.value)} />
                </label>
                <label className="building-library-form-wide">
                  <span>{t('生成提示（软）')}</span>
                  <textarea data-testid="item-catalog-form-generate-hint" value={draft.generateHint} maxLength={2000}
                    disabled={busy} rows={3} placeholder={t('给 AI 的产物 / 用途提示，不是玩法真值')}
                    onChange={e => patchDraft('generateHint', e.target.value)} />
                </label>
              </div>
            </details>

            <div className="building-inspector-actions">
              {manualOpen ? (
                <button type="button" className="primary" data-testid="item-catalog-form-submit"
                  disabled={busy || !draft.label.trim()} onClick={() => void onCreate()}>
                  {busy ? t('创建中…') : t('创建并入库')}
                </button>
              ) : (
                <>
                  <button type="button" className="primary" data-testid="item-catalog-form-save"
                    disabled={busy || !draft.label.trim()} onClick={() => void onSave()}>
                    {busy ? t('保存中…') : t('保存')}
                  </button>
                  <button type="button" className="danger quiet" data-testid="item-catalog-form-delete"
                    disabled={busy} onClick={() => void onDelete()}>{t('删除')}</button>
                </>
              )}
            </div>
            {!manualOpen && selected && (
              <p className="hint item-catalog-meta">
                id · {selected.id} · v{selected.version}
                {selected.provenance?.source ? ` · ${selected.provenance.source}` : ''}
              </p>
            )}
          </aside>
        )}
      </div>
    </section>
  );
}
