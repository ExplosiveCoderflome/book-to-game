import {createHash} from 'node:crypto';
import {causalDependencyGraph} from '@novel-game/rules';
import {createAdventureState, advanceAdventure, projectAdventure, matches} from '@novel-game/play-runtime';
import type {CheckWorldCausalityInput, CausalityReport, WorldCondition, WorldContent, WorldEffect, WorldRevision} from '@novel-game/contracts';
import {canonicalJson} from '../../../shared/canonical-json.js';
import {AppError} from '../../../shared/errors.js';
import type {WorldService} from './world-service.js';

type Finding = CausalityReport['findings'][number];
interface Replay {state: ReturnType<typeof createAdventureState>; actionIds: string[]; seed: number}

export function checkWorldCausality(worlds: Pick<WorldService, 'get'>, input: CheckWorldCausalityInput): CausalityReport {
  const draft = worlds.get(input.worldId);
  if (draft.version !== input.expectedVersion) throw new AppError('DRAFT_VERSION_CONFLICT', '草稿已更新，请重新读取后检查因果', 409);
  const content = draft.content;
  if (!Number.isInteger(input.maxStates) || input.maxStates < 100 || input.maxStates > 10_000)
    throw new AppError('INVALID_CAUSALITY_BUDGET', 'maxStates 必须在 100..10000 范围内', 400);
  if (input.witnessReportId !== undefined)
    throw new AppError('UNSUPPORTED_WITNESS_REPORT', '因果检查不接受外部报告 ID；请基于当前内容重新生成报告', 400);
  const revision: WorldRevision = {id: `draft-${draft.id}`, draftId: draft.id, sourceId: draft.sourceId,
    version: draft.version, content, createdAt: draft.updatedAt};
  const contentHash = createHash('sha256').update(canonicalJson(content)).digest('hex');
  const graph = causalDependencyGraph(content);
  const findings: Finding[] = [];
  const finding = (code: string, entityIds: string[], message: string, witness?: Finding['witness']) => {
    if (!findings.some(item => item.code === code && item.entityIds.join('|') === entityIds.join('|')))
      findings.push({code, severity: code.endsWith('unobserved') || code === 'causality.ledger-requires-ledger-check' || code === 'causality.resource-witness' ? 'warning' : 'error', entityIds, message, ...(witness ? {witness} : {})});
  };
  let exploredStates = 0; let exhausted = false; let truncated = false;
  const budget = input.maxStates;
  const paths: Replay[] = [];
  let sawDepthLimit = false;
  for (let seed = 1; seed <= 8 && !exhausted; seed++) {
    let state = createAdventureState(revision, `causal-${seed}`, '2026-11-06T00:00:00.000Z', {}, seed);
    let frontier: Replay[] = [{state, actionIds: [], seed}];
    for (let turn = 0; turn < 200; turn++) {
      const nextFrontier: Replay[] = [];
      for (const current of frontier) {
        if (current.state.ending) { paths.push(current); continue; }
        if (exploredStates >= budget) { exhausted = true; break; }
        exploredStates++;
        const view = projectAdventure(current.state, revision);
        const options = [...view.actions, ...(view.hand ?? []).flatMap(card => card.choices)].filter(option => option.enabled)
          .filter(option => {
            const action = content.actions.find(item => item.id === option.id);
            if (action) return true;
            return (content.storylets ?? []).some(card => card.choices.some(choice => `sl__${card.id}__${choice.id}` === option.id
              && matches(choice.requires ?? [], current.state, content)));
          });
        const semanticSeen = new Set<string>();
        for (const option of options) {
          if (exploredStates >= budget) { exhausted = true; break; }
          exploredStates++;
          const next = advanceAdventure({...current.state, history: []}, {actionId: option.id, expectedTurn: current.state.turn,
            requestId: '00000000-0000-4000-8000-000000000002'}, content, '2026-11-06T00:00:00.000Z');
          const path = {state: next, actionIds: [...current.actionIds, option.id], seed};
          const viewAfter = projectAdventure(next, revision);
          const key = JSON.stringify([next.locationId, next.facts, next.knownFactIds, next.resources,
            next.ledger?.heldFactIds, next.ledger?.consumedFactIds, next.ledger?.committedFactIds,
            viewAfter.actions.filter(item => item.enabled).map(item => item.id), next.ending?.id]);
          if (!semanticSeen.has(key)) { semanticSeen.add(key); nextFrontier.push(path); }
          paths.push(path);
        }
        if (exhausted) break;
      }
      if (exhausted) break;
      if (nextFrontier.length > 24) truncated = true;
      frontier = nextFrontier.slice(0, 24);
      if (turn === 199 && frontier.some(item => !item.state.ending)) sawDepthLimit = true;
      if (!frontier.length) break;
      state = frontier.find(item => !item.state.ending)?.state ?? frontier[0]!.state;
    }
  }

  for (const resourceId of content.causalClaims?.keyResourceIds ?? []) {
    const known = Object.hasOwn(content.resourceDefs ?? {}, resourceId) || Object.hasOwn(content.resources ?? {}, resourceId);
    if (!known) { finding('causality.unknown-resource', [resourceId], `关键资源声明引用未知 ID ${resourceId}`); continue; }
    const writes = content.actions.filter(action => containsResourceEffect(action.effects, resourceId));
    const reads = graph.resourceThresholds.has(resourceId);
    if (writes.length && !reads) finding('causality.resource-unread', [resourceId, ...writes.map(item => item.id)], `资源 ${resourceId} 有变化动作但没有结构化规则读取`);
    else if (writes.length && reads) {
      const paired = findResourcePairedWitness(paths, resourceId, content, revision);
      if (!paired) finding('causality.resource-no-witness', [resourceId], `资源 ${resourceId} 虽被条件引用，但未找到共同前缀后的合法分歧及实际后果`);
      else finding('causality.resource-witness', [resourceId, paired.targetId], `资源 ${resourceId} 在阈值 ${paired.threshold} 改变了后续行动 ${paired.targetId} 的可用性`, paired.witness);
    } else finding('causality.resource-no-witness', [resourceId], `资源 ${resourceId} 未观察到由资源门控造成的实际后果`);
  }
  for (const choiceId of content.causalClaims?.keyChoiceIds ?? []) {
    const choice = (content.storylets ?? []).flatMap(card => card.choices).find(item => item.id === choiceId);
    if (!choice) { finding('causality.unknown-choice', [choiceId], `关键选择声明引用未知 ID ${choiceId}`); continue; }
    const actionId = `sl__${(content.storylets ?? []).find(card => card.choices.some(item => item.id === choiceId))?.id}__${choiceId}`;
    if (paths.some(path => path.actionIds.includes(actionId)))
      finding('causality.choice-unsupported', [choiceId], `关键选择 ${choiceId} 虽被观察到，但当前检查器不验证选择分支的成对后果`);
    else finding('causality.choice-unobserved', [choiceId], `关键选择 ${choiceId} 未在合法路径中观察到`);
  }
  for (const commitment of content.causalClaims?.commitments ?? []) {
    const action = content.actions.find(item => item.id === commitment.actionId);
    const fact = content.facts.find(item => item.id === commitment.factId);
    if (!action || !fact) { finding('causality.unknown-commitment', [commitment.id, commitment.actionId, commitment.factId], '承诺声明引用未知行动或事实'); continue; }
    const witness = paths.find(path => path.actionIds.includes(action.id));
    if (!witness) { finding('causality.commitment-unobserved', [commitment.id], `承诺 ${commitment.id} 未在合法路径发生`); continue; }
    finding('causality.commitment-unsupported', [commitment.id, fact.id], `承诺 ${fact.id} 虽在合法路径发生，但当前检查器不验证承诺的成对后果`, {seed: witness.seed, actionIds: witness.actionIds});
  }
  for (const fact of content.facts) {
    const assertions = [...content.actions, ...content.events, ...content.endings].flatMap(entity => entity.ledgerAssertions ?? []).filter(item => item.factId === fact.id);
    if (!assertions.length) continue;
    for (const assertion of assertions) {
      const path = paths.find(candidate => candidate.actionIds.some(id => {
        const action = content.actions.find(item => item.id === id);
        const choice = (content.storylets ?? []).flatMap(card => card.choices).find(item => item.id === id);
        return [...(action?.ledgerAssertions ?? []), ...(choice?.ledgerAssertions ?? [])].some(item => item.id === assertion.id);
      }));
      if (!path) finding('causality.assertion-unobserved', [fact.id, assertion.id], `账本断言 ${assertion.id} 未被有界合法重放观察到`);
      else finding('causality.ledger-requires-ledger-check', [fact.id, assertion.id], `已观察到断言 ${assertion.id}；账本真实性以 check_world_ledger 的实际状态报告为准`, {seed: path.seed, actionIds: path.actionIds});
    }
  }
  for (const action of content.actions) for (const assertion of action.ledgerAssertions ?? []) {
    const witness = paths.find(path => path.actionIds.includes(action.id));
    if (!witness) finding('causality.assertion-unobserved', [action.id, assertion.id], `断言 ${assertion.id} 未在合法动作路径中观察到`);
  }

  const terminalMenu = [...content.actions.filter(action => action.effects.some(effect => effect.kind === 'ending')).map(action => ({id: action.id, conditions: action.requires, effects: action.effects})),
    ...(content.storylets ?? []).flatMap(card => card.choices.filter(choice => choice.effects.some(effect => effect.kind === 'ending'))
      .map(choice => ({id: choice.id, conditions: choice.requires ?? [], effects: choice.effects})))];
  const endingIds = new Set(terminalMenu.flatMap(action => action.effects.flatMap(endingEffects)));
  if (terminalMenu.length > 1 && endingIds.size >= content.endings.length && content.endings.length > 1
    && terminalMenu.every(action => !(action.conditions?.length))) {
    finding('causality.ending-menu', terminalMenu.map(action => action.id), '多个无条件行动直接分发全部结局，关键结局缺少前置因果依赖');
  }

  if (exhausted) findings.push({code: 'causality.search-budget-exhausted', severity: 'warning', entityIds: [], message: '合法重放达到状态预算；未覆盖空间保持未判定'});
  const unsupported = !content.causalClaims || findings.some(item => item.code.endsWith('-unsupported') || item.code === 'causality.resource-no-witness')
    || (content.causalClaims.keyChoiceIds ?? []).length > 0
    || (content.causalClaims.commitments ?? []).length > 0
    || content.actions.some(action => action.ledgerAssertions?.some(assertion => !content.facts.some(fact => fact.id === assertion.factId)));
  const status = findings.some(item => item.severity === 'error') ? 'fail'
      : exhausted || sawDepthLimit || truncated ? 'inconclusive' : unsupported ? 'unsupported' : 'pass';
  if (sawDepthLimit) findings.push({code: 'causality.depth-limit', severity: 'warning', entityIds: [], message: '有路径达到200步深度上限，未覆盖空间保持未判定'});
  return {worldId: draft.id, expectedVersion: draft.version, contentHash,
    reportId: createHash('sha256').update(`${contentHash}:${input.maxStates}`).digest('hex'), checkVersion: 'causality-1',
      status: findings.some(item => item.severity === 'error') ? 'fail' : exhausted || sawDepthLimit || truncated ? 'inconclusive' : unsupported ? 'unsupported' : 'pass',
     exploredStates, maxStates: budget, findings,
    limitations: ['只检查声明式结构规则、账本断言和实际动作轨迹；自由文本语义及未声明范围不作判断。',
      '对照分支由当前状态的真实可用动作调用正式引擎生成，不直接改写状态。', '预算、深度或宽度截断及未观察到路径均不构成数学不可达证明。']};
}

function findResourcePairedWitness(paths: Replay[], resourceId: string, content: WorldContent, revision: WorldRevision):
  {witness: NonNullable<Finding['witness']>; targetId: string; threshold: number} | undefined {
  const thresholdValues = new Set([...(content.resourceDefs?.[resourceId] ? [content.resourceDefs[resourceId]!.min] : []),
    ...(content.resourceDefs?.[resourceId]?.max !== undefined ? [content.resourceDefs[resourceId]!.max!] : []),
    ...content.actions.flatMap(action => [...action.requires, ...action.availableWhen]
      .filter((condition): condition is Extract<WorldContent['actions'][number]['requires'][number], {kind: 'resource'}> => condition.kind === 'resource' && condition.resourceId === resourceId)
      .flatMap(condition => [condition.atLeast, condition.atMost].filter((value): value is number => value !== undefined)))]);
  const views = paths.map(path => {
    const view = projectAdventure(path.state, revision);
    return {path, state: path.state, available: new Set([...view.actions.filter(item => item.enabled).map(item => item.id),
      ...(view.hand ?? []).flatMap(card => card.choices.filter(item => item.enabled).map(item => item.id))])};
  });
  for (const left of views) for (const right of views) {
    if (left.path.seed !== right.path.seed || left.path.actionIds.length !== right.path.actionIds.length || !left.path.actionIds.length) continue;
    const divergeAt = left.path.actionIds.findIndex((id, index) => id !== right.path.actionIds[index]);
    if (divergeAt < 0 || !left.path.actionIds.slice(0, divergeAt).every((id, index) => id === right.path.actionIds[index])) continue;
    const prefix = left.path.actionIds.slice(0, divergeAt);
    if (!prefix.length || !prefix.some(id => content.actions.some(action => action.id === id && containsResourceEffect(action.effects, resourceId)))) continue;
    const leftBranch = left.path.actionIds[divergeAt]; const rightBranch = right.path.actionIds[divergeAt];
    if (!leftBranch || !rightBranch || leftBranch === rightBranch) continue;
    const leftAction = content.actions.find(action => action.id === leftBranch);
    const rightAction = content.actions.find(action => action.id === rightBranch);
    if (!leftAction || !rightAction || !containsResourceEffect(leftAction.effects, resourceId) || !containsResourceEffect(rightAction.effects, resourceId)) continue;
    const priorConditions = [...prefix.flatMap(id => content.actions.find(action => action.id === id)?.requires ?? []), ...leftAction.requires, ...rightAction.requires];
    if (priorConditions.some(condition => condition.kind === 'resource' && condition.resourceId !== resourceId)) continue;
    const resourceDiff = left.state.resources[resourceId] !== right.state.resources[resourceId]
      && [...thresholdValues].some(value => (left.state.resources[resourceId] ?? 0) >= value !== ((right.state.resources[resourceId] ?? 0) >= value));
    const target = content.actions.find(action => {
      if (left.path.actionIds.includes(action.id) || right.path.actionIds.includes(action.id)) return false;
      if (action.locationId !== left.state.locationId || action.locationId !== right.state.locationId) return false;
      if (action.npcId && (left.state.npcs[action.npcId]?.locationId !== action.locationId
        || right.state.npcs[action.npcId]?.locationId !== action.locationId)) return false;
      const direct = [...action.requires, ...action.availableWhen].filter(condition => condition.kind === 'resource' && condition.resourceId === resourceId);
      if (!direct.length || [...action.requires, ...action.availableWhen].some(condition => condition.kind === 'anyOf')) return false;
      const leftGate = direct.every(condition => matches([condition], left.state, content));
      const rightGate = direct.every(condition => matches([condition], right.state, content));
      if (leftGate === rightGate) return false;
      const other = [...action.requires, ...action.availableWhen].filter(condition => !(condition.kind === 'resource' && condition.resourceId === resourceId));
      if (!other.every(condition => matches([condition], left.state, content)
        && matches([condition], right.state, content))) return false;
      if (left.available.has(action.id) !== leftGate || right.available.has(action.id) !== rightGate) return false;
      return hasMeaningfulTargetEffect(action.effects, content, action.locationId, action.id);
    });
    if (resourceDiff && target && left.state.locationId === right.state.locationId
      && left.state.ending?.id === right.state.ending?.id) return {witness: {seed: left.path.seed,
      actionIds: left.path.actionIds, alternateActionIds: right.path.actionIds}, targetId: target.id,
      threshold: [...thresholdValues].find(value => (left.state.resources[resourceId] ?? 0) >= value !== ((right.state.resources[resourceId] ?? 0) >= value))!};
  }
  return undefined;
}

function hasMeaningfulTargetEffect(effects: readonly WorldEffect[], content: WorldContent, locationId: string, actionId: string): boolean {
  const consumedFacts = new Set<string>();
  const collect = (conditions: readonly WorldCondition[] | undefined): void => {
    for (const condition of conditions ?? []) {
      if (condition.kind === 'fact' || condition.kind === 'known' || condition.kind === 'npc_knows') consumedFacts.add(condition.factId);
      else if (condition.kind === 'anyOf') collect(condition.conditions);
    }
  };
  for (const action of content.actions) if (action.id !== actionId) collect([...action.requires, ...action.availableWhen]);
  for (const event of content.events) collect(event.when);
  for (const condition of [...(content.endConditions?.win ?? []), ...(content.endConditions?.lose ?? [])]) collect(condition.when);
  for (const storylet of content.storylets ?? []) {
    collect(storylet.when);
    for (const choice of storylet.choices) collect([...(choice.requires ?? []), ...(choice.availableWhen ?? [])]);
  }
  const visit = (items: readonly WorldEffect[]): boolean => items.some(effect => {
    if (effect.kind === 'move') return effect.locationId !== locationId;
    if (effect.kind === 'set' || effect.kind === 'reveal' || effect.kind === 'ledger') return consumedFacts.has(effect.factId);
    return effect.kind === 'roll' && (visit(effect.success) || visit(effect.failure));
  });
  return visit(effects);
}

function containsResourceEffect(effects: readonly WorldEffect[], id: string): boolean {
  return effects.some(effect => effect.kind === 'resource' && effect.resourceId === id
    || effect.kind === 'roll' && (containsResourceEffect(effect.success, id) || containsResourceEffect(effect.failure, id)));
}
function endingEffects(effect: WorldEffect): string[] {
  return effect.kind === 'ending' ? [effect.endingId] : effect.kind === 'roll' ? [...effect.success, ...effect.failure].flatMap(endingEffects) : [];
}
