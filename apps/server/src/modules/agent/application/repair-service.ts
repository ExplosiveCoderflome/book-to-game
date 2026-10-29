import { randomUUID } from 'node:crypto';
import { worldContentSchema, type AgentRepairCandidate, type AgentRepairChange, type GuidanceEdit, type WorldContent, type WorldDraft } from '@novel-game/contracts';
import { applyGuidance } from '@novel-game/play-runtime/sim';
import { AppError } from '../../../shared/errors.js';
import type { RepairDeps } from './repair-ports.js';
import { compareRepair, REPAIR_SEEDS } from './repair-verification.js';

/** Explicit author-time candidates. The polling supervisor has no authority to apply these. */
export class AgentRepairService {
  constructor(private readonly deps: RepairDeps) {}
  list(draftId: string): AgentRepairCandidate[] {this.deps.worlds.get(draftId); return this.deps.repository.list(draftId);}

  async create(input: {draftId: string; version: number; endingId: string}): Promise<AgentRepairCandidate> {
    const draft = this.current(input.draftId, input.version);
    const existing = this.deps.repository.find(draft.id, draft.version, input.endingId);
    if (existing) return existing;
    const report = this.deps.preflight.getWorldPreflight(draft.id).playtest;
    if (!report || report.draftVersion !== draft.version) throw new AppError('AGENT_REPAIR_REPORT_STALE', '请先对当前草稿运行模拟试玩，再生成候选', 409);
    const hint = report.routeCoverage?.guidance?.find(h => h.endingId === input.endingId);
    const edits = hint?.edits.filter(e => e.kind === 'gate-trap' || e.kind === 'weight') ?? [];
    if (!hint || !edits.length) throw new AppError('AGENT_REPAIR_UNSUPPORTED', '这条路线需要补写内容或手动修改，暂不能生成规则修复候选', 422);
    const content = worldContentSchema.parse(applyGuidance(draft.content, edits));
    const preview = await this.inspect(draft, content, input.endingId);
    const now = new Date().toISOString();
    return this.deps.atomic(() => {
      this.current(draft.id, draft.version);
      return this.deps.repository.insert({id: randomUUID(), draftId: draft.id, baseVersion: draft.version,
        endingId: input.endingId, endingTitle: hint.title, sourceReportAt: report.createdAt,
        status: 'pending', edits, changes: changesOf(draft.content, content, edits), preview: preview.verification, createdAt: now, updatedAt: now});
    });
  }

  async apply(id: string): Promise<{candidate: AgentRepairCandidate; draft: WorldDraft}> {
    const candidate = this.get(id);
    if (candidate.status === 'applied') return {candidate, draft: this.deps.worlds.get(candidate.draftId)};
    this.pending(candidate);
    const draft = this.current(candidate.draftId, candidate.baseVersion);
    const content = worldContentSchema.parse(applyGuidance(draft.content, candidate.edits));
    const checked = await this.inspect(draft, content, candidate.endingId);
    if (!checked.verification.allowed) throw new AppError('AGENT_REPAIR_BLOCKED', '复验未通过，草稿未修改', 422, checked.verification);
    return this.deps.atomic(() => {
      const latest = this.get(id);
      if (latest.status === 'applied') return {candidate: latest, draft: this.deps.worlds.get(latest.draftId)};
      this.pending(latest); this.current(draft.id, candidate.baseVersion);
      const saved = this.deps.worlds.update(draft.id, {version: candidate.baseVersion, content});
      this.deps.preflight.saveWorldInspection(saved.id, checked.after);
      const applied: AgentRepairCandidate = {...latest, status: 'applied', verification: checked.verification,
        appliedVersion: saved.version, updatedAt: new Date().toISOString()};
      this.deps.repository.update(applied);
      return {candidate: applied, draft: saved};
    });
  }

  reject(id: string): AgentRepairCandidate {
    return this.deps.atomic(() => {
      const candidate = this.get(id);
      if (candidate.status === 'rejected') return candidate;
      this.pending(candidate);
      const rejected: AgentRepairCandidate = {...candidate, status: 'rejected', updatedAt: new Date().toISOString()};
      this.deps.repository.update(rejected); return rejected;
    });
  }

  private async inspect(draft: WorldDraft, content: WorldContent, endingId: string) {
    const options = {seeds: REPAIR_SEEDS, guidance: false};
    const before = await this.deps.preflight.inspectWorldDraft(draft, options);
    const after = await this.deps.preflight.inspectWorldDraft({...draft, version: draft.version + 1, content}, options);
    return {after, verification: compareRepair(before, after, endingId)};
  }
  private get(id: string) {
    const candidate = this.deps.repository.get(id);
    if (!candidate) throw new AppError('AGENT_REPAIR_NOT_FOUND', '修复候选不存在', 404);
    return candidate;
  }
  private current(id: string, version: number) {
    const draft = this.deps.worlds.get(id);
    if (draft.version !== version) throw new AppError('DRAFT_VERSION_CONFLICT', '草稿已更新，请重新体检并生成候选', 409);
    return draft;
  }
  private pending(candidate: AgentRepairCandidate) {
    if (candidate.status !== 'pending') throw new AppError('AGENT_REPAIR_STATE_CONFLICT', '候选已处理，请刷新列表', 409);
  }
}

function changesOf(before: WorldContent, after: WorldContent, edits: GuidanceEdit[]): AgentRepairChange[] {
  return edits.flatMap(edit => {
    if (edit.kind === 'weight') return [{target: `storylets.${edit.storyletId}.weight.base`, label: edit.label, before: String(edit.from), after: String(edit.to)}];
    if (edit.kind !== 'gate-trap') return [];
    const {actionId, storyletId, choiceId} = edit.target;
    const find = (w: WorldContent) => actionId ? w.actions.find(a => a.id === actionId) : w.storylets?.find(s => s.id === storyletId)?.choices.find(c => c.id === choiceId);
    return [{target: actionId ? `actions.${actionId}.requires` : `storylets.${storyletId}.choices.${choiceId}.requires`,
      label: `${edit.label}：须先满足${edit.addLabels.join('、')}`, before: JSON.stringify(find(before)?.requires ?? []), after: JSON.stringify(find(after)?.requires ?? [])}];
  });
}
