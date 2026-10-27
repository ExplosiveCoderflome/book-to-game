import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react';
import { annotatePlayability, type CanvasLayout, type GameContent, type PlayabilityAnnotation } from '@novel-game/contracts';
import { useI18n } from '../lib/i18n';

interface Props {
  content: GameContent;
  selectedSceneId?: string;
  onSelectScene: (sceneId: string) => void;
  onAddScene?: () => void;
  onLayoutChange?: (layout: CanvasLayout) => void;
  onConnectScenes?: (fromId: string, toId: string) => void;
  primary?: boolean;
  playabilityMode?: 'publish' | 'skeleton';
}

interface LayoutNode {
  id: string; title: string; x: number; y: number; ending?: string; isStart: boolean; choiceCount: number;
}

const NODE_W = 168;
const NODE_H = 64;

export function BranchGraphCanvas({
  content, selectedSceneId, onSelectScene, onAddScene, onLayoutChange, onConnectScenes,
  primary = false, playabilityMode = 'publish',
}: Props) {
  const { t } = useI18n();
  const viewportRef = useRef<HTMLDivElement>(null);
  const [pan, setPan] = useState({ x: 48, y: 48 });
  const [zoom, setZoom] = useState(1);
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const panDrag = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const nodeDrag = useRef<{ id: string; startX: number; startY: number; origX: number; origY: number; moved: boolean } | null>(null);
  const [dragPos, setDragPos] = useState<{ id: string; x: number; y: number } | null>(null);

  const autoLayout = useMemo(() => layoutNodes(content), [content]);
  const nodes = useMemo(() => {
    const layout = content.canvasLayout ?? {};
    return autoLayout.map(node => {
      const saved = layout[node.id];
      const pos = dragPos?.id === node.id ? dragPos : saved ? { x: saved.x, y: saved.y } : { x: node.x, y: node.y };
      return { ...node, x: pos.x, y: pos.y };
    });
  }, [autoLayout, content.canvasLayout, dragPos]);

  const annotation: PlayabilityAnnotation = useMemo(
    () => annotatePlayability(content, content.scenes.length >= 3 ? playabilityMode : 'publish'),
    [content, playabilityMode],
  );
  const flaggedScenes = useMemo(() => new Set(annotation.flaggedSceneIds), [annotation]);
  const flaggedEdges = useMemo(() => new Set(annotation.flaggedEdgeKeys), [annotation]);
  const bannerIssues = annotation.issues.filter(i => i.severity === 'error' || i.code === 'CORRIDOR' || i.code === 'CHURN' || i.code === 'OPENING_FANOUT' || i.code === 'OPENING_DENSITY' || i.code === 'TOO_SHALLOW');

  const edges = useMemo(() => {
    const byId = new Map(nodes.map(node => [node.id, node]));
    const list: { key: string; x1: number; y1: number; x2: number; y2: number; label: string; flagged: boolean }[] = [];
    for (const scene of content.scenes) {
      const from = byId.get(scene.id);
      if (!from) continue;
      for (const choice of scene.choices) {
        const to = byId.get(choice.targetSceneId);
        if (!to) continue;
        const key = `${scene.id}:${choice.id}`;
        list.push({
          key,
          x1: from.x + NODE_W / 2, y1: from.y + NODE_H,
          x2: to.x + NODE_W / 2, y2: to.y,
          label: choice.label.slice(0, 16),
          flagged: flaggedEdges.has(key),
        });
      }
    }
    return list;
  }, [content, nodes, flaggedEdges]);

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
      maxX = Math.max(maxX, node.x + NODE_W);
      maxY = Math.max(maxY, node.y + NODE_H);
    }
    const width = Math.max(1, maxX - minX);
    const height = Math.max(1, maxY - minY);
    const vw = el.clientWidth;
    const vh = el.clientHeight;
    const nextZoom = Math.min(1.6, Math.max(0.45, Math.min((vw - pad * 2) / width, (vh - pad * 2) / height)));
    setZoom(nextZoom);
    setPan({
      x: (vw - width * nextZoom) / 2 - minX * nextZoom,
      y: (vh - height * nextZoom) / 2 - minY * nextZoom,
    });
  }

  useEffect(() => {
    if (!primary) return;
    const timer = window.setTimeout(fitView, 40);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [primary, content.scenes.map(s => s.id).join('|'), content.startSceneId]);

  function onWheel(event: ReactWheelEvent<HTMLDivElement>) {
    event.preventDefault();
    const next = Math.min(2.2, Math.max(0.45, zoom * (event.deltaY > 0 ? 0.92 : 1.08)));
    setZoom(next);
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest('[data-canvas-ui]')) return;
    const nodeEl = (event.target as HTMLElement).closest('[data-node]') as HTMLElement | null;
    if (nodeEl) {
      const id = nodeEl.dataset.nodeId;
      if (!id) return;
      const node = nodes.find(n => n.id === id);
      if (!node) return;
      if (connectFrom) {
        if (connectFrom !== id && onConnectScenes) onConnectScenes(connectFrom, id);
        setConnectFrom(null);
        onSelectScene(id);
        return;
      }
      nodeDrag.current = { id, startX: event.clientX, startY: event.clientY, origX: node.x, origY: node.y, moved: false };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (connectFrom) { setConnectFrom(null); return; }
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
        onSelectScene(drag.id);
      }
      setDragPos(null);
    }
    panDrag.current = null;
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* ignore */ }
  }

  return <div className={`branch-canvas${primary ? ' primary' : ''}`}>
    <div className="branch-canvas-chrome" data-canvas-ui>
      <div>
        <h4>{t('分支画布')}</h4>
        <small className="hint">{t('主编辑面：拖节点排版，拖空白平移，滚轮缩放；点选打开侧栏。')}</small>
      </div>
      <div className="branch-canvas-toolbar">
        <span className="hint">{t('{count} 个场景', { count: content.scenes.length })}</span>
        {onAddScene && <button type="button" className="small" disabled={content.scenes.length >= 100} onClick={onAddScene}>{t('＋ 场景')}</button>}
        {onConnectScenes && (
          <button type="button" className={`small${connectFrom ? ' active' : ''}`} onClick={() => setConnectFrom(v => v ? null : (selectedSceneId ?? (content.startSceneId || null)))}>
            {t(connectFrom ? '连线中…点目标' : '连线')}
          </button>
        )}
        <button type="button" className="small" onClick={() => setZoom(z => Math.min(2.2, z * 1.12))} aria-label={t('放大')}>＋</button>
        <button type="button" className="small" onClick={() => setZoom(z => Math.max(0.45, z * 0.88))} aria-label={t('缩小')}>－</button>
        <button type="button" className="small" onClick={fitView}>{t('适应画布')}</button>
      </div>
    </div>
    {bannerIssues.length > 0 && (
      <div className="branch-canvas-banner" data-canvas-ui role="status">
        <strong>{t('可玩性提醒')}</strong>
        <ul>
          {bannerIssues.slice(0, 5).map((issue, index) => (
            <li key={`${issue.code}-${index}`}>{issue.message}</li>
          ))}
        </ul>
      </div>
    )}
    <div
      ref={viewportRef}
      className={`branch-canvas-viewport${connectFrom ? ' connecting' : ''}`}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      role="application"
      aria-label={t('分支画布')}
    >
      <svg className="branch-canvas-svg" width="100%" height="100%">
        <defs>
          <marker id="branch-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill="currentColor" />
          </marker>
          <marker id="branch-arrow-bad" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill="#c44" />
          </marker>
        </defs>
        <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
          {edges.map(edge => (
            <g key={edge.key} className={`branch-edge${edge.flagged ? ' flagged' : ''}`}>
              <line
                x1={edge.x1} y1={edge.y1} x2={edge.x2} y2={edge.y2}
                markerEnd={edge.flagged ? 'url(#branch-arrow-bad)' : 'url(#branch-arrow)'}
              />
              <text x={(edge.x1 + edge.x2) / 2} y={(edge.y1 + edge.y2) / 2 - 4} textAnchor="middle">{edge.label}</text>
            </g>
          ))}
          {nodes.map(node => {
            const selected = node.id === selectedSceneId;
            const flagged = flaggedScenes.has(node.id);
            const connecting = connectFrom === node.id;
            return <g
              key={node.id}
              data-node
              data-node-id={node.id}
              transform={`translate(${node.x} ${node.y})`}
              className={`branch-node${selected ? ' selected' : ''}${node.ending ? ' ending' : ''}${node.isStart ? ' start' : ''}${flagged ? ' flagged' : ''}${connecting ? ' connecting' : ''}`}
              style={{ cursor: 'grab' }}
            >
              <rect width={NODE_W} height={NODE_H} rx="10" ry="10" />
              <text x={12} y={24} className="branch-node-title">{truncate(node.title || node.id, 14)}</text>
              <text x={12} y={44} className="branch-node-meta">
                {flagged ? t('需关注') : node.isStart ? t('入口') : node.ending ? t('结局') : t('{count} 个选择', { count: node.choiceCount })}
              </text>
            </g>;
          })}
        </g>
      </svg>
      {!content.scenes.length && (
        <div className="branch-canvas-empty">
          <div className="branch-canvas-empty-card">
            <strong>{t('从分支图画故事')}</strong>
            <p>{t('先添加场景节点，再点选打开侧栏编写正文与选项。画布是主操作面。')}</p>
            {onAddScene && <button type="button" className="primary small" onClick={onAddScene}>{t('＋ 添加第一个场景')}</button>}
          </div>
        </div>
      )}
    </div>
  </div>;
}

function layoutNodes(content: GameContent): LayoutNode[] {
  const depth = new Map<string, number>();
  const queue: string[] = content.startSceneId ? [content.startSceneId] : [];
  if (content.startSceneId) depth.set(content.startSceneId, 0);
  const byId = new Map(content.scenes.map(scene => [scene.id, scene]));
  while (queue.length) {
    const id = queue.shift()!;
    const scene = byId.get(id);
    if (!scene) continue;
    for (const choice of scene.choices) {
      if (depth.has(choice.targetSceneId)) continue;
      depth.set(choice.targetSceneId, (depth.get(id) ?? 0) + 1);
      queue.push(choice.targetSceneId);
    }
  }
  for (const scene of content.scenes) if (!depth.has(scene.id)) depth.set(scene.id, 99);
  const columns = new Map<number, string[]>();
  for (const [id, level] of depth) {
    const list = columns.get(level) ?? [];
    list.push(id);
    columns.set(level, list);
  }
  const nodes: LayoutNode[] = [];
  for (const [level, ids] of [...columns.entries()].sort((a, b) => a[0] - b[0])) {
    ids.forEach((id, index) => {
      const scene = byId.get(id);
      if (!scene) return;
      nodes.push({
        id, title: scene.title, ending: scene.ending, isStart: id === content.startSceneId,
        choiceCount: scene.choices.length,
        x: level * 220, y: index * 100,
      });
    });
  }
  return nodes;
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}
