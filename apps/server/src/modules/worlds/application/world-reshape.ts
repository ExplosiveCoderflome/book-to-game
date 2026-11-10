import {createHash} from 'node:crypto';
import {z} from 'zod';
import {worldContentSchema, type WorldContent} from '@novel-game/contracts';
import {canonicalJson} from '../../../shared/canonical-json.js';
import {AppError} from '../../../shared/errors.js';
import {assertWorldPreservation, normalizePreservationBaseline, type PreservationBaseline} from './check-world-preservation.js';

export const proposeWorldReshapeSchema = z.object({worldId: z.string().min(1), expectedVersion: z.number().int().positive(), content: worldContentSchema}).strict();
export const confirmWorldReshapeSchema = proposeWorldReshapeSchema.extend({diffHash: z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export type WorldReshapeInput = z.infer<typeof proposeWorldReshapeSchema>;
export const reshapeHash = (value: unknown): string => createHash('sha256').update(canonicalJson(value)).digest('hex');

/** Every entry is losslessly displayed in the author pending action. Oversized reviews fail closed. */
function differences(before: unknown, after: unknown, path = ''): string[] {
  if (canonicalJson(before ?? null) === canonicalJson(after ?? null) && (before === undefined) === (after === undefined)) return [];
  if (before && after && typeof before === 'object' && typeof after === 'object' && Array.isArray(before) === Array.isArray(after)) {
    const a = before as Record<string, unknown>, b = after as Record<string, unknown>;
    return [...new Set([...Object.keys(a), ...Object.keys(b)])].sort().flatMap(key => differences(a[key], b[key], `${path}/${key}`));
  }
  const display = (value: unknown) => value === undefined ? '（不存在）' : JSON.stringify(value);
  return [`${path}：${display(before)} → ${display(after)}`];
}

export function describeWorldReshape(worldId: string, version: number, before: WorldContent, after: WorldContent, baseline: PreservationBaseline, baselinePresent: boolean) {
  const comparableBaseline = normalizePreservationBaseline(baseline, before);
  const changes = differences(before, after);
  if (!changes.length) throw new AppError('RESHAPE_NO_CHANGES', '候选与当前内容相同，无需重塑', 400);
  let losses: unknown = '未触发保留损失，但以下差异会成为新基线';
  try {assertWorldPreservation(comparableBaseline, after);}
  catch (error) {
    if (!(error instanceof AppError) || error.code !== 'WORLD_PRESERVATION_REQUIRED') throw error;
    losses = error.details;
  }
  const binding = {worldId, expectedVersion: version, beforeHash: reshapeHash(before), afterHash: reshapeHash(after), baselineHash: reshapeHash(baseline), baselinePresent};
  const diffHash = reshapeHash({...binding, changes});
  const summary = `专门确认世界重塑：${worldId}「${before.title}」v${version} → v${version + 1}；diffHash=${diffHash}；保留损失：${JSON.stringify(losses)}；精确差异：\n${changes.join('\n')}`;
  if (summary.length > 12000 || JSON.stringify({status: 'awaiting_author_confirmation', actionId: 'x'.repeat(36), summary}).length > 15000)
    throw new AppError('RESHAPE_REVIEW_TOO_LARGE', '精确差异超过作者确认展示上限，请拆分候选后重新提议', 400);
  return {...binding, diffHash, changes, losses, summary};
}
