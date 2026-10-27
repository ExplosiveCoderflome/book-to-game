import { useEffect, useId, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react';
import type { CanvasLayout, WorldContent } from '@novel-game/contracts';
import { useI18n } from '../lib/i18n';
import { edgeCurve } from '../lib/graph-curve';
import {
  WORLD_NODE_H, WORLD_NODE_W, buildWorldEdges, layoutWorldNodes, openingActionDensity,
} from '../lib/world-graph';
import type { WorldPlayOverlayState } from '../lib/world-play-overlay';

interface Props {
  content: WorldContent;
  selectedLocationId?: string;
  onSelectLocation: (locationId: string) => void;
  onLayoutChange?: (layout: CanvasLayout) => void;
  primary?: boolean;
  warnings?: string[];
  playOverlay?: WorldPlayOverlayState | null;
  readOnly?: boolean;
}

export function WorldGraphCanvas({
  content, selectedLocationId, onSelectLocation, onLayoutChange, primary = false, warnings = [],
  playOverlay = null, readOnly = false,
}: Props) {
  const { t } = useI18n();
  const markerPrefix = useId().replace(/:/g, '');
  const viewportRef = useRef<HTMLDivElement>(null);
  const [pan, setPan] = useState({ x: 48, y: 48 });
  const [zoom, setZoom] = useState(1);
  const panDrag = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const nodeDrag = useRef<{ id: string; startX: number; startY: number; origX: number; origY: number; moved: boolean } | null>(null);
  const [dragPos, setDragPos] = useState<{ id: string; x: number; y: number } | null>(null);
  const [hoveredEdgeKey, setHoveredEdgeKey] = useState<string | null>(null);
  const [hoverScreen, setHoverScreen] = useState<{ x: number; y: number } | null>(null);

  const autoLayout = useMemo(() => layoutWorldNodes(content), [content]);
  const nodes = useMemo(() => {
    const layout = content.canvasLayout ?? {};
    return autoLayout.map(node => {
      const saved = layout[node.id];
      const drag = dragPos?.id === node.id ? dragPos : null;
      return {
        ...node,
        x: drag?.x ?? saved?.x ?? node.x,
        y: drag?.y ?? saved?.y ?? node.y,
      };
    });
  }, [autoLayout, content.canvasLayout, dragPos]);

  const edges = useMemo(() => buildWorldEdges(content, nodes), [content, nodes]);
  const trailEdges = useMemo(() => new Set(playOverlay?.trailEdgeKeys ?? []), [playOverlay]);
  const blockedEdges = useMemo(() => new Set(playOverlay?.blockedEdgeKeys ?? []), [playOverlay]);
  const visitedLocations = useMemo(() => new Set(playOverlay?.visitedLocationIds ?? []), [playOverlay]);
  const currentPlayLocationId = playOverlay?.currentLocationId ?? null;
  const hoveredEdge = useMemo(
    () => edges.find(edge => edge.key === hoveredEdgeKey) ?? null,
    [edges, hoveredEdgeKey],
  );
  const density = useMemo(() => openingActionDensity(content), [content]);
  const bannerWarnings = useMemo(() => {
    const list = [...warnings];
    const note = density.error ?? density.warning;
    if (note && !list.includes(note)) list.unshift(note);
    return list;
  }, [warnings, density]);

  function fitView() {
    const el = viewportRef.current;
    if (!el || nodes.length === 0) {
      setPan({ x: 48, y: 48 });
      setZoom(1);
      return;
    }
    const pad = 56;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const node of nodes) {
      minX = Math.min(minX, node.x);
      minY = Math.min(minY, node.y);
      maxX = Math.max(maxX, node.x + WORLD_NODE_W);
      maxY = Math.max(maxY, node.y + WORLD_NODE_H);
    }
    const width = Math.max(1, maxX - minX);
    const height = Math.max(1, maxY - minY);
    const nextZoom = Math.min(1.6, Math.max(0.45, Math.min((el.clientWidth - pad * 2) / width, (el.clientHeight - pad * 2) / height)));
    setZoom(nextZoom);
    setPan({
      x: (el.clientWidth - width * nextZoom) / 2 - minX * nextZoom,
      y: (el.clientHeight - height * nextZoom) / 2 - minY * nextZoom,
    });
  }

  useEffect(() => {
    if (!primary) return;
    const timer = window.setTimeout(fitView, 40);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [primary, content.locations.map(l => l.id).join('|'), content.initialLocationId]);

  function onWheel(event: ReactWheelEvent<HTMLDivElement>) {
    event.preventDefault();
    setZoom(z => Math.min(2.2, Math.max(0.45, z * (event.deltaY > 0 ? 0.92 : 1.08))));
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest('[data-canvas-ui]')) return;
    const nodeEl = (event.target as HTMLElement).closest('[data-node]') as HTMLElement | null;
    if (nodeEl) {
      const id = nodeEl.dataset.nodeId;
      if (!id) return;
      const node = nodes.find(n => n.id === id);
      if (!node) return;
      if (readOnly) {
        onSelectLocation(id);
        return;
      }
      nodeDrag.current = { id, startX: event.clientX, startY: event.clientY, origX: node.x, origY: node.y, moved: false };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    panDrag.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (nodeDrag.current) {
      const dx = (event.clientX - nodeDrag.current.startX) / zoom;
      const dy = (event.clientY - nodeDrag.current.startY) / zoom;
      if (Math.abs(dx) + Math.abs(dy) > 3) nodeDrag.current.moved = true;
      setDragPos({ id: nodeDrag.current.id, x: nodeDrag.current.origX + dx, y: nodeDrag.current.origY + dy });
      return;
    }
    if (!panDrag.current) return;
    setPan({
      x: panDrag.current.panX + (event.clientX - panDrag.current.x),
      y: panDrag.current.panY + (event.clientY - panDrag.current.y),
    });
  }

  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (nodeDrag.current) {
      const drag = nodeDrag.current;
      nodeDrag.current = null;
      if (drag.moved && onLayoutChange) {
        const nextX = dragPos?.id === drag.id ? dragPos.x : drag.origX;
        const nextY = dragPos?.id === drag.id ? dragPos.y : drag.origY;
        const base: CanvasLayout = { ...(content.canvasLayout ?? {}) };
        for (const node of autoLayout) {
          if (!base[node.id]) {
            const saved = content.canvasLayout?.[node.id];
            base[node.id] = saved ?? { x: node.x, y: node.y };
          }
        }
        base[drag.id] = { x: nextX, y: nextY };
        onLayoutChange(base);
      } else if (!drag.moved) {
        onSelectLocation(drag.id);
      }
      setDragPos(null);
    }
    panDrag.current = null;
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* ignore */ }
  }

  return <div className={`branch-canvas world-canvas${primary ? ' primary' : ''}`} data-testid="world-graph-canvas">
    <div className="branch-canvas-chrome" data-canvas-ui>
      <div>
        <h4>{t('世界画布')}</h4>
        <small className="hint">{t(playOverlay ? '试玩叠层：高亮当前位置与移动足迹；未解锁移动边会变淡。' : '主编辑面：地点为节点，移动行动为曲边；拖节点排版，点选打开侧栏。')}</small>
      </div>
      <div className="branch-canvas-toolbar">
        <span className="hint">{t('{count} 个地点', { count: content.locations.length })}</span>
        <span className="hint">{t('{count} 条移动', { count: edges.length })}</span>
        {playOverlay && <span className="play-overlay-badge" data-testid="world-play-overlay-badge">{t('试玩路径')}</span>}
        <button type="button" className="small" onClick={() => setZoom(z => Math.min(2.2, z * 1.12))} aria-label={t('放大')}>＋</button>
        <button type="button" className="small" onClick={() => setZoom(z => Math.max(0.45, z * 0.88))} aria-label={t('缩小')}>－</button>
        <button type="button" className="small" onClick={fitView}>{t('适应画布')}</button>
      </div>
    </div>
    {!playOverlay && bannerWarnings.length > 0 && (
      <div
        className={`branch-canvas-banner world-opening-banner${density.error ? ' is-error' : ''}`}
        data-canvas-ui
        data-testid="world-opening-banner"
        role={density.error ? 'alert' : 'status'}
      >
        <strong>{t(density.error ? '开局行动门禁' : '开局行动提醒')}</strong>
        <ul>{bannerWarnings.slice(0, 5).map((message, index) => <li key={`${index}-${message.slice(0, 24)}`}>{message}</li>)}</ul>
      </div>
    )}
    <div
      ref={viewportRef}
      className="branch-canvas-viewport"
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      role="application"
      aria-label={t('世界画布')}
    >
      <svg className="branch-canvas-svg" width="100%" height="100%">
        <defs>
          <marker id={`${markerPrefix}-arrow`} markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill="currentColor" />
          </marker>
          <marker id={`${markerPrefix}-arrow-trail`} markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill="#1a7a4c" />
          </marker>
        </defs>
        <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
          {edges.map(edge => {
            const curve = edgeCurve(edge.x1, edge.y1, edge.x2, edge.y2, edge.siblingIndex, edge.siblingCount);
            const active = hoveredEdgeKey === edge.key;
            const trail = trailEdges.has(edge.key);
            const blocked = blockedEdges.has(edge.key);
            const marker = trail ? `url(#${markerPrefix}-arrow-trail)` : `url(#${markerPrefix}-arrow)`;
            return (
              <g
                key={edge.key}
                className={`branch-edge${trail ? ' trail' : ''}${blocked ? ' blocked' : ''}${active ? ' hovered' : ''}`}
                data-edge-key={edge.key}
                data-testid={active ? 'world-edge-hover-active' : undefined}
              >
                <path
                  className="branch-edge-hit"
                  d={curve.d}
                  fill="none"
                  onPointerEnter={event => {
                    setHoveredEdgeKey(edge.key);
                    const rect = viewportRef.current?.getBoundingClientRect();
                    if (rect) setHoverScreen({ x: event.clientX - rect.left, y: event.clientY - rect.top });
                  }}
                  onPointerMove={event => {
                    const rect = viewportRef.current?.getBoundingClientRect();
                    if (rect) setHoverScreen({ x: event.clientX - rect.left, y: event.clientY - rect.top });
                  }}
                  onPointerLeave={() => { setHoveredEdgeKey(null); setHoverScreen(null); }}
                />
                <path className="branch-edge-stroke" d={curve.d} fill="none" markerEnd={marker} />
                <text x={curve.labelX} y={curve.labelY} textAnchor="middle" className="branch-edge-label">
                  {edge.shortLabel}{blocked ? ` · ${t('未解锁')}` : ''}
                </text>
              </g>
            );
          })}
          {nodes.map(node => {
            const selected = node.id === selectedLocationId;
            const isCurrent = currentPlayLocationId === node.id;
            const visited = visitedLocations.has(node.id);
            return (
              <g
                key={node.id}
                data-node
                data-node-id={node.id}
                data-play-current={isCurrent ? 'true' : undefined}
                data-play-visited={visited ? 'true' : undefined}
                data-testid={`world-node-${node.id}`}
                transform={`translate(${node.x} ${node.y})`}
                className={`branch-node world-node${selected ? ' selected' : ''}${node.isStart ? ' start' : ''}${isCurrent ? ' play-current' : ''}${visited && !isCurrent ? ' play-visited' : ''}`}
                style={{ cursor: readOnly ? 'pointer' : 'grab' }}
              >
                <rect width={WORLD_NODE_W} height={WORLD_NODE_H} rx="10" ry="10" />
                <text x={12} y={24} className="branch-node-title">{truncate(node.title || node.id, 14)}</text>
                <text x={12} y={44} className="branch-node-meta">
                  {isCurrent ? t('当前位置') : node.isStart ? t('开局地点') : t('{count} 个行动', { count: node.actionCount })}
                </text>
                <text x={12} y={60} className="branch-node-meta world-node-sub">
                  {t('本地 {local} · 移动 {move}', { local: node.localActionCount, move: node.moveActionCount })}
                  {node.npcCount > 0 ? ` · ${t('{count} 名人物', { count: node.npcCount })}` : ''}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
      {hoveredEdge && hoverScreen && (
        <div
          className="branch-edge-tooltip"
          data-canvas-ui
          data-testid="world-edge-tooltip"
          style={{
            left: Math.min((viewportRef.current?.clientWidth ?? 400) - 16, Math.max(16, hoverScreen.x + 14)),
            top: Math.min((viewportRef.current?.clientHeight ?? 300) - 16, Math.max(16, hoverScreen.y + 14)),
          }}
          role="tooltip"
        >
          <strong>{hoveredEdge.label}</strong>
          {hoveredEdge.summaryLines.length === 0
            ? <p className="hint">{t('移动至另一地点')}</p>
            : hoveredEdge.summaryLines.map(line => <p key={line}>{line}</p>)}
          {blockedEdges.has(hoveredEdge.key) && <p className="edge-tooltip-blocked">{t('当前条件未解锁')}</p>}
        </div>
      )}
      {!content.locations.length && (
        <div className="branch-canvas-empty">
          <div className="branch-canvas-empty-card">
            <strong>{t('从世界图画开放冒险')}</strong>
            <p>{t('地点是节点，带移动后果的行动是曲边。点选地点打开侧栏审阅行动与知识。')}</p>
          </div>
        </div>
      )}
    </div>
  </div>;
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}
