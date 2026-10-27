import { useState } from 'react';
import type { WorldContent, WorldMap } from '@novel-game/contracts';
import { useI18n } from '../lib/i18n';
import { addPaletteEntry, countUsage, deletePaletteEntry, layerPalette, updatePaletteEntry, type MapLayerKind } from '../lib/world-map-edit';

interface Props {
  map: WorldMap;
  kind: MapLayerKind;
  actions: WorldContent['actions'];
  activeId: string | null;
  readOnly?: boolean;
  onActive: (id: string) => void;
  /** `record=false` coalesces keystrokes in label inputs into the pending undo step. */
  onChange: (next: WorldMap, coalesceKey?: string) => void;
}

/** Palette editor shared by terrain and faction layers. Ids are stable; delete always asks how to reassign. */
export function MapLayerPalette({ map, kind, actions, activeId, readOnly, onActive, onChange }: Props) {
  const { t } = useI18n();
  const [pending, setPending] = useState<{ id: string; to: string } | null>(null);
  const entries = layerPalette(map, kind);
  const noun = t(kind === 'terrain' ? '地形' : '势力');
  const refsTo = (id: string) => actions.filter(a => [...a.availableWhen, ...a.requires].some(c =>
    (c.kind === 'at_terrain' && kind === 'terrain' && c.terrainIds.includes(id))
    || (c.kind === 'in_faction_territory' && kind === 'faction' && c.factionIds.includes(id)))).length;

  function requestDelete(id: string) {
    if (countUsage(map, kind, id) === 0 && refsTo(id) === 0) { onChange(deletePaletteEntry(map, kind, id, null)); return; }
    setPending({ id, to: entries.find(e => e.id !== id)?.id ?? '' });
  }

  return <div className="map-palette" data-testid={`map-palette-${kind}`}>
    <div className="map-palette-head">
      <span className="world-map-tray-label">{t('{noun}调色板', { noun })} · {entries.length}</span>
      <button type="button" className="small quiet" disabled={readOnly} data-testid={`map-palette-add-${kind}`}
        onClick={() => { const r = addPaletteEntry(map, kind, kind === 'terrain' ? t('新地形') : t('新势力')); onChange(r.map); onActive(r.id); }}>+ {t('新增')}</button>
    </div>
    <ul>
      {entries.map(e => {
        const used = countUsage(map, kind, e.id);
        return <li key={e.id} className={e.id === activeId ? 'active' : ''} onClick={() => onActive(e.id)} data-testid={`map-palette-${kind}-${e.id}`}>
          <input type="color" aria-label={t('颜色')} value={e.color} disabled={readOnly}
            onClick={ev => ev.stopPropagation()} onChange={ev => onChange(updatePaletteEntry(map, kind, e.id, { color: ev.target.value }), `color:${e.id}`)} />
          <input className="map-palette-label" value={e.label} maxLength={kind === 'terrain' ? 60 : 80} disabled={readOnly} title={e.id}
            onChange={ev => onChange(updatePaletteEntry(map, kind, e.id, { label: ev.target.value }), `label:${e.id}`)} />
          <span className="map-palette-count" title={t('使用格数')}>{used}</span>
          <button type="button" className="quiet tiny" disabled={readOnly} title={t('删除')} onClick={ev => { ev.stopPropagation(); requestDelete(e.id); }}>×</button>
        </li>;
      })}
      {!entries.length && <li className="empty">{t('还没有{noun}，先新增一个。', { noun })}</li>}
    </ul>
    {pending && (() => {
      const victim = entries.find(e => e.id === pending.id);
      const used = countUsage(map, kind, pending.id); const refs = refsTo(pending.id);
      return <div className="map-palette-confirm" role="alertdialog" data-testid="map-palette-confirm">
        <strong>{t('删除「{label}」？', { label: victim?.label ?? pending.id })}</strong>
        <p>{t('{n} 个格子正在使用它。', { n: used })}{refs > 0 ? t('另有 {n} 个行动条件引用此 id，删除后校验会报错。', { n: refs }) : ''}</p>
        {used > 0 && <label>{t('这些格子改为')}
          <select value={pending.to} onChange={e => setPending({ ...pending, to: e.target.value })}>
            {entries.filter(e => e.id !== pending.id).map(e => <option key={e.id} value={e.id}>{e.label}</option>)}
            <option value="">{t('清空（不设{noun}）', { noun })}</option>
          </select>
        </label>}
        <div className="row">
          <button type="button" className="small danger" data-testid="map-palette-confirm-delete"
            onClick={() => { onChange(deletePaletteEntry(map, kind, pending.id, pending.to || null)); setPending(null); }}>{t('确认删除')}</button>
          <button type="button" className="small quiet" onClick={() => setPending(null)}>{t('取消')}</button>
        </div>
      </div>;
    })()}
  </div>;
}
