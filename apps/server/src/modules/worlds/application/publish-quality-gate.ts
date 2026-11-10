import type {PlaytestReport, WorldDraft} from '@novel-game/contracts';
import {worldQualityContentHash} from '../../preflight/index.js';
import {AppError} from '../../../shared/errors.js';
import {checkWorldLedger} from './check-world-ledger.js';
import {checkWorldCausality} from './check-world-causality.js';
import {checkWorldPreservation} from './check-world-preservation.js';
import type {WorldService} from './world-service.js';

export function assertWorldPublishQuality(worlds: WorldService, draft: WorldDraft, report?: PlaytestReport): void {
  if (!report || report.draftId !== draft.id || report.draftVersion !== draft.version) {
    throw new AppError('PUBLISH_QUALITY_STALE', '缺少绑定当前草稿版本的服务端试玩报告', 400);
  }
  if (report.evidence?.contentHash !== worldQualityContentHash(draft.content)) {
    throw new AppError('PUBLISH_QUALITY_STALE', '试玩报告未绑定当前草稿内容', 400);
  }
  const evidence = report.evidence;
  if (!evidence || evidence.status !== 'observed') throw new AppError('PUBLISH_QUALITY_UNSUPPORTED', '试玩证据未能观察到作品正文', 422);
  const failed = report.checks.filter(check => !check.pass && check.id === 'minimum-run-length');
  if (failed.length || evidence.deadEnds.length || evidence.samples.some(sample => sample.outcome === 'capped')
    || evidence.distribution.effectiveSteps.minimum < 5
    || draft.content.endings.some(ending => !evidence.endingReachability.some(row => row.endingId === ending.id && row.status === 'observed'))) {
    throw new AppError('PLAYTEST_BLOCKED', '真实试玩未满足发布质量要求', 422, {failed, evidence});
  }
  const hasAssertions = [...draft.content.actions, ...draft.content.events, ...draft.content.endings].some(item => item.ledgerAssertions?.length);
  if (hasAssertions && checkWorldLedger(worlds, {worldId: draft.id, expectedVersion: draft.version}).status !== 'pass')
    throw new AppError('LEDGER_BLOCKED', '声明的账本范围未通过服务端重放', 422);
  const claims = draft.content.causalClaims;
  const hasClaims = !!claims && ((claims.keyResourceIds?.length ?? 0) + (claims.keyChoiceIds?.length ?? 0) + (claims.commitments?.length ?? 0) > 0);
  if (hasClaims && checkWorldCausality(worlds, {worldId: draft.id, expectedVersion: draft.version, maxStates: 1_000}).status !== 'pass')
    throw new AppError('CAUSALITY_BLOCKED', '声明的因果范围未通过服务端检查', 422);
  if (checkWorldPreservation(worlds, {worldId: draft.id, expectedVersion: draft.version}).status !== 'pass')
    throw new AppError('PRESERVATION_BLOCKED', '服务端内容保留基线不可证明或已失败', 422);
}
