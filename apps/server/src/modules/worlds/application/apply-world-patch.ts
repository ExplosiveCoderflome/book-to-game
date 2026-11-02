import {
  applyWorldPatchInputSchema,
  type ApplyWorldPatchInput,
  type Storylet,
  type WorldContent,
  type WorldDraft,
  type WorldPatchChange,
} from '@novel-game/contracts';
import { AppError } from '../../../shared/errors.js';
import type { WorldService } from './world-service.js';

const MAX_AFTER_CHARS = 4000;

const invalid = (message: string): never => {
  throw new AppError('WORLD_PATCH_INVALID', message, 422);
};

const assertAfter = (change: WorldPatchChange): unknown => {
  if (change.after === undefined) invalid(`补丁 ${change.path} 缺少 after`);
  if ((JSON.stringify(change.after)?.length ?? 0) > MAX_AFTER_CHARS) invalid(`补丁 ${change.path} 的 after 过大`);
  return change.after;
};

function applyClock(content: WorldContent, change: WorldPatchChange, segments: string[]): void {
  if (segments.length === 1) {
    if (change.op === 'remove') {
      delete content.clock;
      return;
    }
    if (!change.after || typeof change.after !== 'object' || Array.isArray(change.after)) invalid('clock 必须是对象');
    content.clock = change.after as WorldContent['clock'];
    return;
  }
  if (segments.length > 2) invalid(`不支持的时钟路径：${change.path}`);
  const clock = content.clock;
  if (!clock) invalid('草稿还没有时钟，请先新增 clock');
  const field = segments[1]!;
  const target = clock as unknown as Record<string, unknown>;
  if (change.op === 'remove') {
    delete target[field];
    return;
  }
  target[field] = assertAfter(change);
}

function applyStorylets(content: WorldContent, change: WorldPatchChange, segments: string[]): void {
  const storylets = content.storylets ?? [];
  if (segments.length === 1) {
    if (change.op !== 'add') invalid('批量替换 storylets 不被允许，请按卡片字段修改');
    const storylet = assertAfter(change) as Storylet;
    if (!storylet || typeof storylet !== 'object' || Array.isArray(storylet)) invalid('storylets 新增项必须是剧情卡对象');
    if (storylets.some(item => item.id === storylet.id)) invalid(`剧情卡已存在：${storylet.id}`);
    content.storylets = [...storylets, storylet];
    return;
  }
  const id = segments[1]!;
  const index = storylets.findIndex(item => item.id === id);
  if (index < 0) invalid(`剧情卡不存在：${id}`);
  if (segments.length === 2) {
    if (change.op === 'remove') {
      content.storylets = storylets.filter(item => item.id !== id);
      return;
    }
    if (change.op !== 'replace') invalid('整张剧情卡只支持 replace 或 remove');
    const storylet = assertAfter(change) as Storylet;
    if (!storylet || typeof storylet !== 'object' || Array.isArray(storylet) || storylet.id !== id) {
      invalid(`整张剧情卡替换必须保持 id ${id}`);
    }
    content.storylets = storylets.map(item => item.id === id ? storylet : item);
    return;
  }
  if (segments.length > 3) invalid(`不支持的剧情卡路径：${change.path}`);
  const target = storylets[index] as unknown as Record<string, unknown>;
  const field = segments[2]!;
  if (change.op === 'remove') {
    delete target[field];
    return;
  }
  target[field] = assertAfter(change);
}

export function applyWorldPatch(worlds: WorldService, id: string, input: ApplyWorldPatchInput): {draft: WorldDraft; applied: number} {
  const parsed = applyWorldPatchInputSchema.parse(input);
  const current = worlds.get(id);
  if (current.version !== parsed.version) {
    throw new AppError('DRAFT_VERSION_CONFLICT', '草稿已更新，请重新生成或审阅提案', 409);
  }
  const content = structuredClone(current.content);
  for (const change of parsed.changes) {
    const segments = change.path.split('.');
    if (!change.path || segments.some(segment => !segment)) invalid(`非法补丁路径：${change.path}`);
    if (segments[0] === 'clock') applyClock(content, change, segments);
    else if (segments[0] === 'storylets') applyStorylets(content, change, segments);
    else invalid(`补丁不支持写入该路径：${change.path}`);
  }
  return {draft: worlds.applyContent(id, {version: parsed.version, content}), applied: parsed.changes.length};
}
