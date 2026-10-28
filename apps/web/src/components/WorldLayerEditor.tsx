import { useState } from 'react';
import type { WorldContent, WorldMap } from '@novel-game/contracts';
import { eraMap, mapIdOf, validateWorldLayer, worldFactions, worldMaps } from '@novel-game/rules';
import { useI18n } from '../lib/i18n';

type Npc = WorldContent['npcs'][number];

/** World layer: NPC roster (faction/home/tags/bio/worldbook), strongholds on POIs, eras with territory snapshots. All edits go through onChange (undoable draft path). */
export function WorldLayerEditor({ content: w, onChange }: { content: WorldContent; onChange: (next: WorldContent) => void }) {
  const { t } = useI18n();
  const factions = worldFactions(w); const fById = new Map(factions.map(f => [f.id, f]));
  const titles = new Map(w.locations.map(l => [l.id, l.title]));
  const entries = w.worldbook?.entries ?? [];
  const [open, setOpen] = useState<string | null>(w.npcs[0]?.id ?? null);
  const issues = validateWorldLayer(w);
  const setNpc = (id: string, patch: Partial<Npc>) => onChange({ ...w, npcs: w.npcs.map(n => {
    if (n.id !== id) return n; const next = { ...n, ...patch } as Record<string, unknown>;
    for (const k of Object.keys(patch)) { const v = next[k]; if (v === undefined || v === '' || (Array.isArray(v) && !v.length)) delete next[k]; }
    return next as Npc; }) });
  const patchPoi = (mapId: string, locationId: string, patch: Partial<WorldMap['pois'][number]>) => {
    const fix = (m: WorldMap) => mapIdOf(m) !== mapId ? m : { ...m, pois: m.pois.map(p => {
      if (p.locationId !== locationId) return p; const next = { ...p, ...patch } as Record<string, unknown>;
      for (const k of Object.keys(patch)) if (next[k] === undefined || next[k] === 'poi') delete next[k];
      return next as WorldMap['pois'][number]; }) };
    onChange({ ...w, ...(w.map ? { map: fix(w.map) } : {}), ...(w.subMaps ? { subMaps: w.subMaps.map(fix) } : {}) });
  };
  function snapshotEra() {
    const territory: Record<string, Record<string, string>> = {};
    for (const m of worldMaps(w)) { const cells = m.layers?.factions?.cells; if (cells && Object.keys(cells).length) territory[mapIdOf(m)] = { ...cells }; }
    const n = (w.eras?.length ?? 0) + 1; let id = `era_${n}`; while (w.eras?.some(e => e.id === id)) id += '_';
    onChange({ ...w, eras: [...(w.eras ?? []), { id, name: `${t('时代')} ${n}`, territory }] });
  }
  const pois = worldMaps(w).flatMap(m => m.pois.map(p => ({ mapId: mapIdOf(m), mapName: m.name ?? (mapIdOf(m) === 'root' ? '世界' : mapIdOf(m)), ...p })));
  return <div className="world-layer-editor" data-testid="world-layer-editor">
    {issues.length > 0 && <ul className="wl-issues">{issues.map((i, k) => <li key={k} className={i.level}>{i.message}</li>)}</ul>}
    <p className="world-map-tray-label">{t('人物')} · {w.npcs.length} · {t('势力、据点、标签、传记与世界书链接')}</p>
    <div className="npc-roster" data-testid="npc-panel">{w.npcs.map(n => {
      const f = n.factionId ? fById.get(n.factionId) : undefined; const expanded = open === n.id;
      return <article key={n.id} className={`npc-card${expanded ? ' open' : ''}`} data-testid={`npc-card-${n.id}`} style={{ ['--chip' as string]: f?.color ?? '#8a8378' }}>
        <header onClick={() => setOpen(expanded ? null : n.id)}>
          <span className="npc-avatar">{n.name.slice(0, 1)}</span>
          <div className="npc-head"><strong>{n.name}</strong><small>{f ? f.name : t('无势力')} · {titles.get(n.initialLocationId) ?? n.initialLocationId}{n.homeLocationId ? ` · ⌂ ${titles.get(n.homeLocationId) ?? n.homeLocationId}` : ''}</small></div>
          <div className="npc-tags">{(n.tags ?? []).map(tag => <span key={tag} className="tag">{tag}</span>)}</div>
        </header>
        {expanded && <div className="npc-body">
          <div className="npc-grid">
            <label>{t('势力')}<select value={n.factionId ?? ''} data-testid={`npc-faction-${n.id}`} onChange={e => setNpc(n.id, { factionId: e.target.value || undefined })}>
              <option value="">{t('（无）')}</option>{factions.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
            <label>{t('据点 / 家')}<select value={n.homeLocationId ?? ''} onChange={e => setNpc(n.id, { homeLocationId: e.target.value || undefined })}>
              <option value="">{t('（无）')}</option>{w.locations.map(l => <option key={l.id} value={l.id}>{l.title}</option>)}</select></label>
            <label>{t('初始位置')}<select value={n.initialLocationId} onChange={e => setNpc(n.id, { initialLocationId: e.target.value })}>
              {w.locations.map(l => <option key={l.id} value={l.id}>{l.title}</option>)}</select></label>
            <label>{t('标签')}<input value={(n.tags ?? []).join('，')} placeholder={t('逗号分隔')} onChange={e => setNpc(n.id, { tags: e.target.value.split(/[,，]/).map(s => s.trim()).filter(Boolean).slice(0, 10) })} /></label>
          </div>
          <label className="npc-bio">{t('传记')}<textarea rows={3} maxLength={4000} value={n.bio ?? ''} onChange={e => setNpc(n.id, { bio: e.target.value })} /></label>
          <div className="npc-links"><span className="hint">{t('世界书')}</span>{entries.length === 0 ? <span className="hint">{t('（暂无条目）')}</span> : entries.map(e => {
            const on = n.worldbookEntryIds?.includes(e.id) ?? false;
            return <button key={e.id} type="button" className={`tiny chip-toggle${on ? ' on' : ''}`} onClick={() => setNpc(n.id, { worldbookEntryIds: on ? n.worldbookEntryIds!.filter(x => x !== e.id) : [...(n.worldbookEntryIds ?? []), e.id] })}>{e.title}</button>; })}</div>
        </div>}
      </article>; })}</div>

    <p className="world-map-tray-label">{t('据点')} · {t('把地点标为势力据点，地图上以城堡图标显示')}</p>
    <table className="stronghold-table" data-testid="stronghold-table"><tbody>{pois.map(p => <tr key={`${p.mapId}:${p.locationId}`}>
      <td>{titles.get(p.locationId) ?? p.locationId}</td><td className="hint">{t(p.mapName)}</td>
      <td><label className="inline"><input type="checkbox" checked={p.feature === 'stronghold'} onChange={e => patchPoi(p.mapId, p.locationId, e.target.checked ? { feature: 'stronghold' } : { feature: undefined, factionId: undefined })} />{t('据点')}</label></td>
      <td>{p.feature === 'stronghold' && <select value={p.factionId ?? ''} onChange={e => patchPoi(p.mapId, p.locationId, { factionId: e.target.value || undefined })}>
        <option value="">{t('（未指定）')}</option>{factions.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select>}</td>
    </tr>)}</tbody></table>

    <p className="world-map-tray-label">{t('时代')} · {t('每个时代保存一份领土快照，可在地图预览中切换')}</p>
    <div className="era-list" data-testid="era-list">{(w.eras ?? []).map(e => {
      const cells = Object.values(e.territory).reduce((s, c) => s + Object.keys(c).length, 0);
      return <div key={e.id} className="era-row">
        <input value={e.name} maxLength={80} onChange={ev => onChange({ ...w, eras: w.eras!.map(x => x.id === e.id ? { ...x, name: ev.target.value || x.name } : x) })} />
        <span className="hint">{t('{n} 格领土', { n: cells })}</span>
        <button type="button" className="tiny" title={t('用当前地图势力覆盖此时代快照')} onClick={() => {
          const territory: Record<string, Record<string, string>> = {};
          for (const m of worldMaps(w)) { const c = m.layers?.factions?.cells; if (c && Object.keys(c).length) territory[mapIdOf(m)] = { ...c }; }
          onChange({ ...w, eras: w.eras!.map(x => x.id === e.id ? { ...x, territory } : x) }); }}>{t('取当前')}</button>
        <button type="button" className="tiny" title={t('把此时代领土写回地图势力层')} onClick={() => {
          const fix = (m: WorldMap) => eraMap(w, m, e.id);
          onChange({ ...w, ...(w.map ? { map: fix(w.map) } : {}), ...(w.subMaps ? { subMaps: w.subMaps.map(fix) } : {}) }); }}>{t('应用到地图')}</button>
        <button type="button" className="quiet tiny" onClick={() => { const rest = w.eras!.filter(x => x.id !== e.id); const { eras: _e, ...base } = w; onChange(rest.length ? { ...w, eras: rest } : base as WorldContent); }}>×</button>
      </div>; })}
      <button type="button" className="small" data-testid="era-add" onClick={snapshotEra}>＋ {t('以当前领土新建时代')}</button>
    </div>
  </div>;
}
