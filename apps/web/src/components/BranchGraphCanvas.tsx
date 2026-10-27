import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react';
import type { GameContent } from '@novel-game/contracts';
import { useI18n } from '../lib/i18n';

interface Props {
  content: GameContent;
  selectedSceneId?: string;
  onSelectScene: (sceneId: string) => void;
}

interface LayoutNode {
  id: string; title: string; x: number; y: number; ending?: string; isStart: boolean; choiceCount: number;
}

const NODE_W = 168;
const NODE_H = 64;

export function BranchGraphCanvas({ content, selectedSceneId, onSelectScene }: Props) {
  const { t } = useI18n();
  const [pan, setPan] = useState({ x: 40, y: 40 });
  const [zoom, setZoom] = useState(1);
  const drag = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const nodes = useMemo(() => layoutNodes(content), [content]);
  const edges = useMemo(() => {
    const byId = new Map(nodes.map(node => [node.id, node]));
    const list: { key: string; x1: number; y1: number; x2: number; y2: number; label: string }[] = [];
    for (const scene of content.scenes) {
      const from = byId.get(scene.id);
      if (!from) continue;
      for (const choice of scene.choices) {
        const to = byId.get(choice.targetSceneId);
        if (!to) continue;
        list.push({
          key: `${scene.id}:${choice.id}`,
          x1: from.x + NODE_W / 2, y1: from.y + NODE_H,
          x2: to.x + NODE_W / 2, y2: to.y,
          label: choice.label.slice(0, 16),
        });
      }
    }
    return list;
  }, [content, nodes]);

  function onWheel(event: ReactWheelEvent<HTMLDivElement>) {
    event.preventDefault();
    const next = Math.min(2.2, Math.max(0.45, zoom * (event.deltaY > 0 ? 0.92 : 1.08)));
    setZoom(next);
  }
  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest('[data-node]')) return;
    drag.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    setPan({
      x: drag.current.panX + (event.clientX - drag.current.x),
      y: drag.current.panY + (event.clientY - drag.current.y),
    });
  }
  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    drag.current = null;
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* ignore */ }
  }

  return <div className="branch-canvas panel">
    <div className="panel-heading">
      <h4>{t('分支画布')}</h4>
      <small className="hint">{t('无限画布：拖动画布平移，滚轮缩放；点击节点编辑场景。拓扑是故事真相源。')}</small>
    </div>
    <div
      className="branch-canvas-viewport"
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
        </defs>
        <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
          {edges.map(edge => (
            <g key={edge.key} className="branch-edge">
              <line x1={edge.x1} y1={edge.y1} x2={edge.x2} y2={edge.y2} markerEnd="url(#branch-arrow)" />
              <text x={(edge.x1 + edge.x2) / 2} y={(edge.y1 + edge.y2) / 2 - 4} textAnchor="middle">{edge.label}</text>
            </g>
          ))}
          {nodes.map(node => {
            const selected = node.id === selectedSceneId;
            return <g key={node.id} data-node transform={`translate(${node.x} ${node.y})`} className={`branch-node${selected ? ' selected' : ''}${node.ending ? ' ending' : ''}${node.isStart ? ' start' : ''}`}
              onClick={event => { event.stopPropagation(); onSelectScene(node.id); }} style={{ cursor: 'pointer' }}>
              <rect width={NODE_W} height={NODE_H} rx="10" ry="10" />
              <text x={12} y={24} className="branch-node-title">{truncate(node.title || node.id, 14)}</text>
              <text x={12} y={44} className="branch-node-meta">
                {node.isStart ? t('入口') : node.ending ? t('结局') : t('{count} 个选择', { count: node.choiceCount })}
              </text>
            </g>;
          })}
        </g>
      </svg>
      {!content.scenes.length && <div className="branch-canvas-empty">{t('添加场景后，这里会显示可平移缩放的分支图。')}</div>}
    </div>
  </div>;
}

function layoutNodes(content: GameContent): LayoutNode[] {
  const depth = new Map<string, number>();
  const queue: string[] = [content.startSceneId];
  depth.set(content.startSceneId, 0);
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
