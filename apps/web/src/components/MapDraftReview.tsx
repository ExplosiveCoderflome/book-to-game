import { useMemo, useState } from 'react';
import type { MapDraftDiff, MapDraftItem, WorldContent } from '@novel-game/contracts';
import { applyMapDraft, mapDraftDependencies } from '@novel-game/rules';
import { useI18n } from '../lib/i18n';
import { WorldMapViewer } from './WorldMapViewer';

const KIND_LABEL: Record<MapDraftItem['kind'], string> = { faction: '势力', location: '地点', npc: '人物', route: '通路' };
const ORDER: MapDraftItem['kind'][] = ['location', 'faction', 'npc', 'route'];

/**
 * Review panel for an AI map draft. Nothing is written until the author accepts; accepted items are applied
 * through the normal draft change path, and the last import can be undone in one click.
 */
export function MapDraftReview({ content, diff, onApply, onClose, onUndo }: {
  content: WorldContent; diff: MapDraftDiff; onApply: (next: WorldContent, applied: number) => void; onClose: () => void; onUndo?: () => void;
}) {
  const { t } = useI18n();
  const [accepted, setAccepted] = useState<Set<string>>(() => new Set(diff.items.map(i => i.id)));
  const preview = useMemo(() => applyMapDraft(content, diff, accepted), [content, diff, accepted]);
  const inDiff = new Set(diff.items.map(i => i.id));
  const toggle = (id: string, on: boolean) => setAccepted(prev => {
    const next = new Set(prev);
    if (on) { next.add(id); for (const d of mapDraftDependencies(diff.items.find(i => i.id === id)!)) if (inDiff.has(d)) next.add(d); }
    else { next.delete(id); for (const i of diff.items) if (mapDraftDependencies(i).includes(id)) next.delete(i.id); }
    return next;
  });
  const titles = new Map(preview.content.locations.map(l => [l.id, l.title]));
  const detail = (i: MapDraftItem) => i.kind === 'location' ? `${i.cell}${i.anchor ? ` · ${t('参照')} ${titles.get(i.anchor) ?? i.anchor}` : ''}${i.existing ? ` · ${t('已有地点，仅落位')}` : ''}`
    : i.kind === 'npc' ? `@ ${titles.get(i.npc.locationId) ?? i.npc.locationId}${i.npc.factionId ? ` · ${i.npc.factionId}` : ''}`
    : i.kind === 'faction' ? i.faction.description ?? '' : '';
  const n = accepted.size;
  return <section className="map-draft-review panel" data-testid="map-draft-review">
    <header className="mdr-head">
      <div><h3>{t('AI 地图草案')}</h3><span className="hint">{t('{n} 项提议', { n: diff.items.length })}{diff.model ? ` · ${diff.model}` : ''} · {t('逐项接受/拒绝；接受后按常规编辑写入草稿，可撤销')}</span></div>
      <div className="mdr-actions">
        <button type="button" className="small quiet" onClick={() => setAccepted(new Set(diff.items.map(i => i.id)))}>{t('全选')}</button>
        <button type="button" className="small quiet" onClick={() => setAccepted(new Set())}>{t('全不选')}</button>
        {onUndo && <button type="button" className="small" data-testid="map-draft-undo" onClick={onUndo}>↶ {t('撤销上次导入')}</button>}
        <button type="button" className="small primary" data-testid="map-draft-apply" disabled={n === 0} onClick={() => onApply(preview.content, preview.applied.length)}>{t('接受 {n} 项', { n })}</button>
        <button type="button" className="small quiet" onClick={onClose}>{t('关闭')}</button>
      </div>
    </header>
    {diff.warnings.length > 0 && <ul className="wl-issues">{diff.warnings.map((w, i) => <li key={i} className="warning">{w}</li>)}</ul>}
    <div className="mdr-body">
      <div className="mdr-list">{ORDER.map(kind => {
        const items = diff.items.filter(i => i.kind === kind); if (!items.length) return null;
        return <div key={kind} className="mdr-group"><p className="world-map-tray-label">{t(KIND_LABEL[kind])} · {items.filter(i => accepted.has(i.id)).length}/{items.length}</p>
          {items.map(i => <label key={i.id} className={`mdr-item${accepted.has(i.id) ? ' on' : ''}`} data-testid={`mdr-${i.id}`}>
            <input type="checkbox" checked={accepted.has(i.id)} onChange={e => toggle(i.id, e.target.checked)} />
            {i.kind === 'faction' && <i className="mdr-swatch" style={{ background: i.faction.color }} />}
            <span className="mdr-label">{i.label}</span><small>{detail(i)}</small>
            {i.kind === 'location' && <span className="mdr-text">{i.location.text}</span>}
            {i.kind === 'npc' && <span className="mdr-text">{i.npc.description}</span>}
          </label>)}</div>;
      })}</div>
      <div className="mdr-preview"><p className="world-map-tray-label">{t('预览（未写入）')}</p>
        {preview.content.map && <WorldMapViewer map={preview.content.map} content={preview.content} height={460}
          npcMarkers={preview.content.npcs.filter(x => accepted.has(`npc:${x.id}`)).map(x => ({ locationId: x.initialLocationId, label: x.name }))} />}
      </div>
    </div>
  </section>;
}
