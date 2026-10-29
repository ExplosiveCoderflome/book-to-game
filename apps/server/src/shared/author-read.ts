import type { AuthorReadInput } from '@novel-game/contracts';
import { AppError } from './errors.js';

const VALUE_LIMIT = 8000;
const ENTRY_LIMIT = 600;
const TEXT_PAGE = 6000;

/** Exact small values, paged collections, and explicit references for large children.
 * A reference is never a partial replacement document. Every child can be read by its path.
 */
export function readAuthorValue(root: unknown, input: AuthorReadInput) {
  const path = input.path ?? [];
  let value = root;
  for (const key of path) {
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, key)
      || (Array.isArray(value) && !/^(0|[1-9]\d*)$/.test(key))) {
      throw new AppError('READ_PATH_NOT_FOUND', '数据路径不存在，请先读取上级目录确认字段或数组下标', 404);
    }
    value = (value as Record<string, unknown>)[key];
  }
  const {offset, limit} = input;
  if (typeof value === 'string') {
    const text = value.slice(offset, offset + TEXT_PAGE);
    return {path, type: 'text', offset, total: value.length, nextOffset: offset + text.length < value.length ? offset + text.length : null, value: text};
  }
  if (value === null || typeof value !== 'object') return {path, type: 'value', value};
  // Single cards, rules and units normally fit whole, preserving their exact structure.
  if (!Array.isArray(value) && offset === 0 && JSON.stringify(value).length <= VALUE_LIMIT) return {path, type: 'value', value};
  const entries = Object.entries(value);
  const page: Record<string, unknown>[] = [];
  for (const [key, child] of entries.slice(offset, offset + limit)) {
    const childPath = [...path, key];
    const item = child as Record<string, unknown> | null;
    const entry = JSON.stringify(child).length <= ENTRY_LIMIT ? {key, path: childPath, value: child}
      : {key, path: childPath, reference: true, type: Array.isArray(child) ? 'array' : typeof child,
      ...(typeof child === 'string' ? {length: child.length} : {count: Object.keys(child as object).length}),
      ...(item && typeof child === 'object' && !Array.isArray(child) ? {id: item.id, title: item.title ?? item.name ?? item.label} : {})};
    if (page.length && JSON.stringify({path, entries: [...page, entry]}).length > 12000) break;
    page.push(entry);
  }
  return {path, type: Array.isArray(value) ? 'array' : 'object', offset, total: entries.length,
    nextOffset: offset + page.length < entries.length ? offset + page.length : null, entries: page};
}
