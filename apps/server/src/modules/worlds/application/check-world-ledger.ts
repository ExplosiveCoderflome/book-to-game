import { createHash } from 'node:crypto';
import { checkLedgerAssertion, ledgerAssertionsFor } from '@novel-game/rules';
import { createAdventureState, advanceAdventure, projectAdventure } from '@novel-game/play-runtime';
import type { CheckWorldLedgerInput, WorldRevision } from '@novel-game/contracts';
import { canonicalJson } from '../../../shared/canonical-json.js';
import { AppError } from '../../../shared/errors.js';
import { matches, visible } from '@novel-game/play-runtime';
import type { WorldService } from './world-service.js';

export function checkWorldLedger(worlds: Pick<WorldService, 'get'>, input: CheckWorldLedgerInput) {
  const draft = worlds.get(input.worldId);
  if (draft.version !== input.expectedVersion) throw new AppError('DRAFT_VERSION_CONFLICT', '草稿已更新，请重新读取后检查账本', 409);
  const revision = {id: `draft-${draft.id}`, draftId: draft.id, sourceId: draft.sourceId, version: draft.version,
    content: draft.content, createdAt: draft.updatedAt} as WorldRevision;
  const contentHash = createHash('sha256').update(canonicalJson(revision.content)).digest('hex');
  const findings: NonNullable<ReturnType<typeof checkLedgerAssertion>>[] = [];
  const assertions = [
    ...revision.content.actions.flatMap(action => ledgerAssertionsFor(revision.content, action)),
    ...revision.content.events.flatMap(event => ledgerAssertionsFor(revision.content, event)),
    ...revision.content.endings.flatMap(ending => ledgerAssertionsFor(revision.content, ending)),
  ];
  const observed = new Set<string>();
  const entityCount = assertions.length;
  const steps = Math.min(input.maxStates ?? 1_000, 200, Math.max(20, entityCount * 4));
  let explored = 0;
  for (let seed = 1; seed <= 8; seed++) {
    const actionIds: string[] = [];
    const inspect = (kind: 'action' | 'event' | 'ending', id: string, snapshot: typeof state) => {
      const entity = kind === 'action' ? revision.content.actions.find(item => item.id === id)
        : kind === 'event' ? revision.content.events.find(item => item.id === id) : revision.content.endings.find(item => item.id === id);
      if (!entity) return;
      for (const {assertion, path} of ledgerAssertionsFor(revision.content, entity)) {
        observed.add(path);
        const issue = checkLedgerAssertion(revision.content, snapshot, assertion, path);
        if (issue && !findings.some(existing => existing.code === issue.code && existing.path === issue.path)) findings.push({...issue, witness: {seed, actionIds: [...actionIds]}});
      }
    };
    let openingObservations: {kind: 'action' | 'event' | 'ending'; id: string; state: ReturnType<typeof createAdventureState>}[] = [];
    let state = createAdventureState(revision, `ledger-${seed}`, '2026-01-01T00:00:00.000Z', {observer: item => openingObservations.push(item)}, seed);
    if (seed === 1) for (const item of openingObservations) inspect(item.kind, item.id, item.state);
    for (let step = 0; step <= steps; step++) {
      explored++;
      if (state.ending || step === steps) break;
      const view = projectAdventure(state, revision);
      const enabled = view.actions.filter(action => action.enabled).filter(action => {
        const source = revision.content.actions.find(candidate => candidate.id === action.id);
        return source && visible(source, state, revision.content) && matches(source.requires, state, revision.content);
      });
      if (!enabled.length) break;
      const action = enabled[0]!;
      actionIds.push(action.id);
      state = advanceAdventure(state, {actionId: action.id, expectedTurn: state.turn, requestId: '00000000-0000-4000-8000-000000000001'}, revision.content, '2026-01-01T00:00:00.000Z', {observer: item => inspect(item.kind, item.id, item.state)});
    }
  }
  const unseen = assertions.filter(item => !observed.has(item.path));
  const missing = unseen.map(item => ({code: 'ledger.assertion.unobserved', severity: 'warning' as const,
    entityIds: [item.assertion.id, item.assertion.factId], message: `有界重放未观察断言点：${item.assertion.id}`, path: item.path}));
  return {worldId: draft.id, expectedVersion: draft.version, contentHash, scope: {assertions: entityCount, observedAssertions: observed.size, exploredStates: explored, seeds: 8, maxSteps: steps},
    status: findings.some(item => item.severity === 'error') ? 'fail' as const : entityCount === 0 || unseen.length ? 'unsupported' as const : 'pass' as const,
    findings: [...findings, ...missing],
    limitations: ['仅验证结构化 ledgerAssertions 与确定性 runtime 重放状态；不理解自由文本语义。', '重放为 8 个固定种子、按可见行动首项选择的有界路径；未观察到反例不等于通过或不可达证明。', '当前 legacy action/event/ending 不带 assertion 时范围为零，返回 unsupported。']};
}
