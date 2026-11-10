import {createHash} from 'node:crypto';
import type {WorldDraft, WorldRevision} from '@novel-game/contracts';
import {canonicalJson} from '../../shared/canonical-json.js';
import {AppError} from '../../shared/errors.js';
import {createExtensionReviewer, type ExtensionReviewResult} from './reviewer.js';
import type {SqliteExtensionReviewStore} from './sqlite-review-store.js';

// Version the acceptance policy in the fingerprint; no caller options/rewriteRound are accepted.
function fingerprint(candidate: WorldDraft | WorldRevision) {
  return createHash('sha256').update(canonicalJson({policy: 'extension-publish-v1', content: candidate.content})).digest('hex');
}
export class ExtensionPublishService {
  constructor(private readonly store: SqliteExtensionReviewStore) {}
  async review(draft: WorldDraft): Promise<void> {
    const candidate = structuredClone(draft); const hash = fingerprint(candidate);
    if (this.store.count(candidate.id) >= 3) throw rejection({status: 'hardfail', passed: false, rejections: 3, issues: []});
    if (this.store.evidence(candidate.id, candidate.version, hash)?.passed) return;
    const reviewer = createExtensionReviewer(this.store, result => this.store.record(candidate.id, candidate.version, hash, result));
    const result = await reviewer.review(candidate.id, {id: `extension-review:${candidate.id}:${candidate.version}`, draftId: candidate.id,
      sourceId: candidate.sourceId, version: candidate.version, content: candidate.content, createdAt: candidate.updatedAt});
    if (!result.passed) throw rejection(result);
  }
  assertAccepted(candidate: WorldDraft | WorldRevision): void {
    const scope = 'draftId' in candidate ? candidate.draftId : candidate.id;
    if (this.store.count(scope) >= 3) throw rejection({status: 'hardfail', passed: false, rejections: 3, issues: []});
    const evidence = this.store.evidence(scope, candidate.version, fingerprint(candidate));
    if (!evidence?.passed || evidence.status !== 'pass') throw new AppError('EXTENSION_REVIEW_REQUIRED', '缺少绑定当前草稿版本及内容的服务端扩展审查通过证据，请通过发布命令完成审查', 422);
  }
}
function rejection(result: ExtensionReviewResult) {
  return new AppError(result.status === 'hardfail' ? 'EXTENSION_REVIEW_REJECTED' : 'EXTENSION_REVIEW_FAILED',
    result.status === 'hardfail' ? '扩展审查已累计三轮驳回，最终拒绝发布，需要人工处理；更换扩展ID、代码或版本不能重置次数' : `扩展审查第${result.rejections}轮未通过，请修正测试与实现后重试（最多三轮）`, 422, result);
}
