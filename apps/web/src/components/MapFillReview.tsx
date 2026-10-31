import { useState } from 'react';
import { MAP_FILL_KIND_LABEL, type MapFillProposal, type MapFillProposalItem } from '@novel-game/contracts';
import { useI18n } from '../lib/i18n';

const TOWN = new Set(['shop', 'supply', 'quest']);

/** Review-only list. Closing or deselecting every row performs no world/catalog write. */
export function MapFillReview({proposal, busy, onAccept, onClose}: {
  proposal: MapFillProposal;
  busy: boolean;
  onAccept: (items: MapFillProposalItem[], addNewAssets: boolean) => void;
  onClose: () => void;
}) {
  const {t} = useI18n();
  const [accepted, setAccepted] = useState<Set<string>>(() => new Set(proposal.items.map(item => item.proposalId)));
  const [addNewAssets, setAddNewAssets] = useState(true);
  const hasNew = proposal.items.some(item => item.assetDraft);
  const groups = [
    {id: 'town', label: '城镇设施', items: proposal.items.filter(item => TOWN.has(item.kind))},
    {id: 'wild', label: '野外遭遇', items: proposal.items.filter(item => !TOWN.has(item.kind))},
  ];
  const toggle = (id: string, on: boolean) => setAccepted(current => {
    const next = new Set(current);
    if (on) next.add(id); else next.delete(id);
    return next;
  });
  const selected = proposal.items.filter(item => accepted.has(item.proposalId));
  return <section className="map-draft-review map-fill-review" data-testid="map-fill-review">
    <header className="mdr-head">
      <div><h3>{t('AI 填充提案')}</h3><span className="hint">{proposal.model ? `${proposal.model} · ` : ''}{t('逐项接受/拒绝；未接受不会写入')}</span></div>
      <div className="mdr-actions">
        <button type="button" className="small quiet" disabled={busy} onClick={() => setAccepted(new Set(proposal.items.map(item => item.proposalId)))}>{t('全选')}</button>
        <button type="button" className="small quiet" disabled={busy} onClick={() => setAccepted(new Set())}>{t('全不选')}</button>
        <button type="button" className="small primary" data-testid="map-fill-accept" disabled={busy || !selected.length}
          onClick={() => onAccept(selected, addNewAssets)}>{t('接受 {n} 项', {n: selected.length})}</button>
        <button type="button" className="small quiet" disabled={busy} onClick={onClose}>{t('关闭')}</button>
      </div>
    </header>
    {proposal.warnings.length > 0 && <ul className="wl-issues">{proposal.warnings.map((warning, index) => <li key={index} className="warning">{warning}</li>)}</ul>}
    {hasNew && <label className="inline small map-fill-import-new"><input type="checkbox" data-testid="map-fill-import-new-assets"
      checked={addNewAssets} disabled={busy} onChange={event => setAddNewAssets(event.target.checked)} />
      {t('新资产先加入建筑库（默认；同名自动 · N），再放置。取消则仅放置无库引用内容。')}</label>}
    <div className="mdr-list">
      {groups.map(group => group.items.length > 0 && <div key={group.id} className="mdr-group">
        <p className="world-map-tray-label">{t(group.label)} · {group.items.filter(item => accepted.has(item.proposalId)).length}/{group.items.length}</p>
        {group.items.map(item => <label key={item.proposalId} className={`mdr-item${accepted.has(item.proposalId) ? ' on' : ''}`} data-testid={`map-fill-proposal-${item.proposalId}`}>
          <input type="checkbox" checked={accepted.has(item.proposalId)} disabled={busy} onChange={event => toggle(item.proposalId, event.target.checked)} />
          <span className={`map-fill-kind ${item.kind}`}>{t(MAP_FILL_KIND_LABEL[item.kind])}</span>
          <span className="mdr-label">{item.label ?? item.assetDraft?.label ?? item.buildingAssetId ?? item.proposalId}</span>
          <small>{item.locationId} · {item.buildingAssetId ? t('引用库 {id}', {id: item.buildingAssetId}) : item.assetDraft ? t('新资产草案') : t('无库引用')}</small>
          {item.assetDraft?.blurb && <span className="mdr-text">{item.assetDraft.blurb}</span>}
        </label>)}
      </div>)}
    </div>
  </section>;
}
