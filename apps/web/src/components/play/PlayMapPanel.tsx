import type { AdventureView, WorldContent } from '@novel-game/contracts';
import { findMap } from '@novel-game/rules';
import { useI18n } from '../../lib/i18n';
import { WorldMapViewer } from '../WorldMapViewer';

/** Play-time map: player marker, reachable destinations, fog. Session-derived; authored content untouched. */
export function PlayMapPanel({ content, session, overlayMap }: { content: WorldContent; session: AdventureView; overlayMap?: (map: NonNullable<WorldContent['map']>) => NonNullable<WorldContent['map']> }) {
  const { t } = useI18n();
  const mv = session.map; if (!mv) return null;
  const authored = findMap(content, mv.mapId); if (!authored) return null;
  const map = overlayMap ? overlayMap(authored) : authored;
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
    <WorldMapViewer map={map} content={content} playerLocationId={session.location.id} reachableLocationIds={reachable} exploredCells={explored} height={420} />
    <div className="play-map-legend">
      <span><i className="lg-player" />{t('你在这里')}</span><span><i className="lg-reach" />{t('可前往')}</span>{mv.fog && <span><i className="lg-fog" />{t('未探索')}</span>}
    </div>
    {mv.reachable.length > 0 && <ul className="play-map-dests">{mv.reachable.map(r => <li key={r.actionId} className={r.enabled ? '' : 'disabled'}>→ {titles.get(r.locationId) ?? r.locationId}{!r.enabled && <small> · {t('暂不可行')}</small>}</li>)}</ul>}
  </section>;
}
