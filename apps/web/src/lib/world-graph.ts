import { assessOpeningActions, type CanvasLayout, type WorldContent, type WorldEffect } from '@novel-game/contracts';

export interface WorldGraphNode {
  id: string;
  title: string;
  x: number;
  y: number;
  isStart: boolean;
  actionCount: number;
  localActionCount: number;
  moveActionCount: number;
  npcCount: number;
}

export interface WorldGraphEdge {
  key: string;
  actionId: string;
  fromId: string;
  toId: string;
  label: string;
  shortLabel: string;
  summaryLines: string[];
  siblingIndex: number;
  siblingCount: number;
  x1: number; y1: number; x2: number; y2: number;
}

const NODE_W = 176;
const NODE_H = 72;
const COL_GAP = 260;
const ROW_GAP = 140;

function moveTarget(effects: WorldEffect[]): string | null {
  const move = effects.find(e => e.kind === 'move');
  return move && move.kind === 'move' ? move.locationId : null;
}

export function openingActionDensity(content: WorldContent): { count: number; warning: string | null; error: string | null } {
  if (!content.initialLocationId) return { count: 0, warning: null, error: null };
  const opening = assessOpeningActions(content);
  if (opening.ok) return { count: opening.count, warning: null, error: null };
  return {
    count: opening.count,
    warning: null,
    error: opening.message,
  };
}

/** Auto-layout locations by BFS from initial, then leftover in extra columns. */
export function layoutWorldNodes(content: WorldContent, saved?: CanvasLayout): WorldGraphNode[] {
  const depth = new Map<string, number>();
  const queue: string[] = [];
  if (content.initialLocationId && content.locations.some(l => l.id === content.initialLocationId)) {
    depth.set(content.initialLocationId, 0);
    queue.push(content.initialLocationId);
  }
  const outs = new Map<string, string[]>();
  for (const action of content.actions) {
    const to = moveTarget(action.effects);
    if (!to || to === action.locationId) continue;
    const list = outs.get(action.locationId) ?? [];
    if (!list.includes(to)) list.push(to);
    outs.set(action.locationId, list);
  }
  while (queue.length) {
    const id = queue.shift()!;
    for (const next of outs.get(id) ?? []) {
      if (depth.has(next)) continue;
      depth.set(next, (depth.get(id) ?? 0) + 1);
      queue.push(next);
    }
  }
  let extra = 0;
  for (const loc of content.locations) {
    if (!depth.has(loc.id)) {
      depth.set(loc.id, Math.max(0, ...depth.values(), -1) + 1 + Math.floor(extra / 2));
      extra += 1;
    }
  }
  const columns = new Map<number, string[]>();
  for (const loc of content.locations) {
    const d = depth.get(loc.id) ?? 0;
    const list = columns.get(d) ?? [];
    list.push(loc.id);
    columns.set(d, list);
  }
  const pos = new Map<string, { x: number; y: number }>();
  for (const [d, ids] of [...columns.entries()].sort((a, b) => a[0] - b[0])) {
    ids.forEach((id, index) => {
      pos.set(id, { x: 48 + d * COL_GAP, y: 48 + index * ROW_GAP });
    });
  }
  return content.locations.map(loc => {
    const actions = content.actions.filter(a => a.locationId === loc.id);
    const moveActionCount = actions.filter(a => moveTarget(a.effects)).length;
    const localActionCount = actions.length - moveActionCount;
    const npcCount = content.npcs.filter(n => n.initialLocationId === loc.id).length;
    const auto = pos.get(loc.id) ?? { x: 48, y: 48 };
    const fromSaved = saved?.[loc.id];
    return {
      id: loc.id,
      title: loc.title,
      x: fromSaved?.x ?? auto.x,
      y: fromSaved?.y ?? auto.y,
      isStart: loc.id === content.initialLocationId,
      actionCount: actions.length,
      localActionCount,
      moveActionCount,
      npcCount,
    };
  });
}

export function buildWorldEdges(content: WorldContent, nodes: WorldGraphNode[]): WorldGraphEdge[] {
  const byId = new Map(nodes.map(n => [n.id, n]));
  type Raw = Omit<WorldGraphEdge, 'siblingIndex' | 'siblingCount' | 'x1' | 'y1' | 'x2' | 'y2'> & {
    fromId: string; toId: string;
  };
  const raw: Raw[] = [];
  for (const action of content.actions) {
    const toId = moveTarget(action.effects);
    if (!toId || !byId.has(action.locationId) || !byId.has(toId)) continue;
    const full = action.label.trim() || action.id;
    const lines: string[] = [];
    if (action.timeCost) lines.push(`耗时 ${action.timeCost}`);
    if (action.availableWhen?.length) lines.push(`出现条件 ×${action.availableWhen.length}`);
    if (action.requires?.length) lines.push(`执行条件 ×${action.requires.length}`);
    if (action.risk) lines.push(`风险：${action.risk}`);
    raw.push({
      key: `${action.locationId}:${action.id}`,
      actionId: action.id,
      fromId: action.locationId,
      toId,
      label: full,
      shortLabel: full.length <= 12 ? full : `${full.slice(0, 11)}…`,
      summaryLines: lines,
    });
  }
  const buckets = new Map<string, Raw[]>();
  for (const edge of raw) {
    const k = `${edge.fromId}->${edge.toId}`;
    const list = buckets.get(k) ?? [];
    list.push(edge);
    buckets.set(k, list);
  }
  const NODE_W_LOCAL = NODE_W;
  const NODE_H_LOCAL = NODE_H;
  const out: WorldGraphEdge[] = [];
  for (const group of buckets.values()) {
    group.forEach((edge, index) => {
      const from = byId.get(edge.fromId)!;
      const to = byId.get(edge.toId)!;
      out.push({
        ...edge,
        siblingIndex: index,
        siblingCount: group.length,
        x1: from.x + NODE_W_LOCAL / 2,
        y1: from.y + NODE_H_LOCAL,
        x2: to.x + NODE_W_LOCAL / 2,
        y2: to.y,
      });
    });
  }
  return out;
}

export const WORLD_NODE_W = NODE_W;
export const WORLD_NODE_H = NODE_H;
