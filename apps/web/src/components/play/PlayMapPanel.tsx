import type { AdventureView, WorldContent } from '@novel-game/contracts';
import { applyTerritoryOverlay, findMap, STANCE_LABEL, worldFactions } from '@novel-game/rules';
import { useI18n } from '../../lib/i18n';
import { WorldMapViewer } from '../WorldMapViewer';

/** Play-time map: player marker, reachable destinations, fog. Session-derived; authored content untouched. */
export function PlayMapPanel({ content, session, overlayMap }: { content: WorldContent; session: AdventureView; overlayMap?: (map: NonNullable<WorldContent['map']>) => NonNullable<WorldContent['map']> }) {
  const { t } = useI18n();
  const mv = session.map; if (!mv) return null;
  const authored = findMap(content, mv.mapId); if (!authored) return null;
  const withTerritory = applyTerritoryOverlay(authored, mv.territory);
  const map = overlayMap ? overlayMap(withTerritory) : withTerritory;
  const fname = new Map(worldFactions(content).map(f => [f.id, f]));
  const changed = Object.keys(mv.territory ?? {}).length;
  const reachable = mv.reachable.filter(r => r.enabled).map(r => r.locationId);
  const titles = new Map(content.locations.map(l => [l.id, l.title]));
  const explored = mv.fog ? mv.explored ?? [] : undefined;
  const total = map.geometry.kind === 'hex' ? map.geometry.cols * map.geometry.rows : 0;
  return <section className="play-map-panel panel" data-testid="play-map-panel">
    <div className="panel-heading"><h3>{map.name ?? t('世界地图')}</h3>{mv.fog && <span className="hint">{t('迷雾 · 已探索 {n}/{total} 格', { n: explored?.length ?? 0, total })}</span>}</div>
    <dl className="play-map-hud" data-testid="play-map-hud">
      <div><dt>{t('位置')}</dt><dd>{session.location.title}{mv.cell ? <small> · {mv.cell}</small> : null}</dd></div>
      <div><dt>{t('区域')}</dt><dd>{mv.regions.length ? mv.regions.map(r => r.name).join('、') : '—'}</dd></div>
      <div><dt>{t('地形')}</dt><dd>{mv.terrain?.label ?? '—'}</dd></div>
      <div><dt>{t('势力')}</dt><dd>{mv.faction ? <span className="faction-chip" style={{ ['--chip' as string]: map.layers?.factions?.factions.find(f => f.id === mv.faction!.id)?.color }}>{mv.faction.name}</span> : '—'}</dd></div>
    </dl>
    <WorldMapViewer map={map} content={content} playerLocationId={session.location.id} reachableLocationIds={reachable} exploredCells={explored} height={420}
      npcMarkers={mv.npcs?.map(n => ({ locationId: n.locationId, label: n.name, ...(n.factionId && fname.get(n.factionId) ? { color: fname.get(n.factionId)!.color } : {}) }))} />
    <div className="play-map-legend">
      <span><i className="lg-player" />{t('你在这里')}</span><span><i className="lg-reach" />{t('可前往')}</span>{mv.fog && <span><i className="lg-fog" />{t('未探索')}</span>}
    </div>
    {mv.npcs && mv.npcs.length > 0 && <div className="play-npcs" data-testid="play-npcs"><span className="hint">{t('图上人物')}</span>{mv.npcs.map(n => <span key={n.id} className="faction-chip" style={{ ['--chip' as string]: n.factionId ? fname.get(n.factionId)?.color : '#8a8378' }}>{n.name}<small> · {titles.get(n.locationId) ?? n.locationId}</small></span>)}</div>}
    {changed > 0 && <p className="hint" data-testid="play-territory-changed">{t('本局领土变化 {n} 格（只影响本存档）', { n: changed })}</p>}
    {mv.relations && mv.relations.length > 0 && <div className="play-relations" data-testid="play-relations">{mv.relations.map(r => <span key={`${r.a}|${r.b}`} className={`rel-pill st-${r.stance}`}>
      {fname.get(r.a)?.name ?? r.a} ↔ {fname.get(r.b)?.name ?? r.b} · {t(STANCE_LABEL[r.stance])} {r.standing > 0 ? '+' : ''}{r.standing}</span>)}</div>}
    {mv.reachable.length > 0 && <ul className="play-map-dests">{mv.reachable.map(r => <li key={r.actionId} className={r.enabled ? '' : 'disabled'}>→ {titles.get(r.locationId) ?? r.locationId}{!r.enabled && <small> · {t('暂不可行')}</small>}</li>)}</ul>}
  </section>;
}
