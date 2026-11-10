import {createHash} from 'node:crypto';
import type {WorldContent} from '@novel-game/contracts';
import {canonicalJson} from '../../../shared/canonical-json.js';
import {AppError} from '../../../shared/errors.js';
import type {WorldService} from './world-service.js';

export interface PreservationBaseline {
  /** Unmarked baselines use the legacy title-bearing storylet route signature. */
  formatVersion?: 2;
  draftId: string;
  version: number;
  hash: string;
  anchors: Record<string, string>;
  anchorLengths: Record<string, number>;
  entityIds: Record<string, string[]>;
  gameplay: Record<string, string>;
  capturedAt: string;
}

export function makePreservationBaseline(draftId: string, version: number, content: WorldContent): PreservationBaseline {
  const anchors: Record<string, string> = {};
  const anchorLengths: Record<string, number> = {};
  const entityIds: Record<string, string[]> = {};
  const gameplay: Record<string, string> = {};
  const add = (key: string, value: unknown) => { anchors[key] = hash(value); if (typeof value === 'string') anchorLengths[key] = value.length; };
  const locations = content.locations as Array<WorldContent['locations'][number] & {textVariants?: {text: string}[]}>;
  const groups: [string, Array<{id: string}>][] = [
    ['locations', locations], ['npcs', content.npcs], ['actions', content.actions],
    ['storylets', content.storylets ?? []], ['endings', content.endings], ['events', content.events ?? []],
  ];
  for (const [group, items] of groups) {
    entityIds[group] = items.map(item => item.id).sort();
    for (const item of items) {
      if (group === 'actions') gameplay[`actions:${item.id}`] = JSON.stringify(gameplayShape('actions', item as WorldContent['actions'][number]));
      if (group === 'storylets') gameplay[`storylets:${item.id}`] = JSON.stringify(gameplayShape('storylets', item as NonNullable<WorldContent['storylets']>[number]));
      const bodyValue: unknown = (item as {text?: unknown}).text;
      const body = typeof bodyValue === 'string' ? bodyValue : undefined;
      if (body !== undefined && (group === 'locations' || group === 'actions' || group === 'storylets' || group === 'endings')) add(`${group}:${item.id}:text`, body);
      if (group === 'locations') for (const [index, body] of ((item as typeof locations[number]).textVariants ?? []).entries()) add(`locations:${item.id}:variant:${index}`, body.text);
      if (group === 'storylets') {
        const card = item as NonNullable<WorldContent['storylets']>[number];
        for (const [index, body] of (card.textVariants ?? []).entries()) add(`storylets:${card.id}:variant:${index}`, body);
        for (const [index, body] of (card.textCases ?? []).entries()) add(`storylets:${card.id}:case:${body.id ?? index}`, body.text);
        for (const choice of card.choices) add(`storylets:${card.id}:choice:${choice.id}`, choice.text);
      }
      if (group === 'endings') {
        const ending = item as WorldContent['endings'][number];
        for (const [index, body] of (ending.textVariants ?? []).entries()) add(`endings:${ending.id}:variant:${index}`, body.text);
        for (const passage of ending.passages ?? []) add(`endings:${ending.id}:passage:${passage.id}`, passage.text);
      }
    }
  }
  if (content.endConditions) {
    entityIds.endConditions = [...content.endConditions.win, ...content.endConditions.lose].map(item => item.id).sort();
    for (const item of [...content.endConditions.win, ...content.endConditions.lose]) add(`endConditions:${item.id}`, item.when);
  }
  return {formatVersion: 2, draftId, version, hash: hash(content), anchors, anchorLengths, entityIds, gameplay, capturedAt: new Date().toISOString()};
}

/** Pure conversion: persistence happens only with the content CAS transaction. */
export function normalizePreservationBaseline(baseline: PreservationBaseline, previous: WorldContent): PreservationBaseline {
  if (!isSupportedBaseline(baseline)) throw unsupportedBaseline(baseline);
  if (baseline.formatVersion === 2) return baseline;
  const gameplay = {...baseline.gameplay};
  for (const [key, value] of Object.entries(gameplay)) {
    if (!key.startsWith('storylets:')) continue;
    const cards = (previous.storylets ?? []).filter(card => `storylets:${card.id}` === key);
    if (cards.length !== 1) throw unsupportedBaseline(baseline);
    const card = cards[0]!;
    const signatures = parseGameplaySignatures(value)!;
    const legacy = gameplayShape('storylets', card, true);
    // Every historical item must still correspond; never discard unmatched history.
    if (!signatures.every(item => legacy.includes(item)) || !legacy.every(item => signatures.includes(item))) throw unsupportedBaseline(baseline);
    const oldRoute = storyletRouteSignature(card, true), newRoute = storyletRouteSignature(card, false);
    if (signatures.filter(item => item === oldRoute).length !== 1) throw unsupportedBaseline(baseline);
    gameplay[key] = JSON.stringify(signatures.map(item => item === oldRoute ? newRoute : item).sort());
  }
  const converted: PreservationBaseline = {...baseline, formatVersion: 2, gameplay};
  assertWorldPreservation(converted, previous);
  return {...converted, hash: hash({entityIds: converted.entityIds, anchors: converted.anchors, anchorLengths: converted.anchorLengths, gameplay})};
}

/** Only one top-level action move leaf may change; all other content stays exact. */
export function repairDanglingMoveBaseline(baseline: PreservationBaseline, previous: WorldContent, content: WorldContent): PreservationBaseline | undefined {
  const locations = new Set(previous.locations.map(item => item.id));
  if (locations.size !== previous.locations.length || new Set(previous.actions.map(item => item.id)).size !== previous.actions.length) return undefined;
  if (previous.actions.length !== content.actions.length) return undefined;
  const restored = structuredClone(content);
  let repaired: {key: string; before: string; after: string} | undefined;
  for (let index = 0; index < previous.actions.length; index++) {
    const oldAction = previous.actions[index]!, action = restored.actions[index]!;
    if (oldAction.id !== action.id || oldAction.effects.length !== action.effects.length) return undefined;
    for (let effectIndex = 0; effectIndex < oldAction.effects.length; effectIndex++) {
      const before = oldAction.effects[effectIndex]!, after = action.effects[effectIndex]!;
      if (canonicalJson(before) === canonicalJson(after)) continue;
      if (repaired || before.kind !== 'move' || after.kind !== 'move' || locations.has(before.locationId) || !locations.has(after.locationId)
        || canonicalJson({...after, locationId: before.locationId}) !== canonicalJson(before)) return undefined;
      repaired = {key: `actions:${oldAction.id}`, before: hash(normalizeGameplayStructure(effectShape(before))), after: hash(normalizeGameplayStructure(effectShape(after)))};
      action.effects[effectIndex] = structuredClone(before);
    }
  }
  if (!repaired || canonicalJson(restored) !== canonicalJson(previous)) return undefined;
  const signatures = parseGameplaySignatures(baseline.gameplay[repaired.key] ?? '');
  const oldAction = previous.actions.find(item => `actions:${item.id}` === repaired.key)!;
  const currentSignatures = gameplayShape('actions', oldAction);
  if (!signatures || signatures.filter(item => item === repaired.before).length !== 1
    || currentSignatures.filter(item => item === repaired.before).length !== 1
    || !signatures.every(item => currentSignatures.includes(item)) || !currentSignatures.every(item => signatures.includes(item))) return undefined;
  const gameplay = {...baseline.gameplay, [repaired.key]: JSON.stringify(signatures.map(item => item === repaired.before ? repaired.after : item).sort())};
  return {...baseline, gameplay};
}

export function checkWorldPreservation(worlds: WorldService, input: {worldId: string; expectedVersion: number}) {
  const draft = worlds.get(input.worldId);
  if (draft.version !== input.expectedVersion) throw new AppError('DRAFT_VERSION_CONFLICT', '草稿已更新，请刷新后检查', 409);
  let baseline = worlds.getPreservationBaseline(draft.id);
  if (!baseline) return {worldId: draft.id, expectedVersion: draft.version, baselineEstablished: false as const,
    currentHash: hash(draft.content), differences: {removed: [], removedGameplay: [], removedAnchors: [], changedAnchors: []},
    status: 'unsupported' as const, findings: [{code: 'baseline-unavailable', severity: 'unsupported' as const,
      message: '没有服务端历史基线，无法判断既有内容是否被破坏。'}],
    note: '旧草稿将在首次有效编辑事务中由服务器安全捕获基线；当前版本尚无历史锚点，不能作历史保留判断。'};
  let supported = isSupportedBaseline(baseline);
  if (supported) {
    try { baseline = normalizePreservationBaseline(baseline, draft.content); }
    catch { supported = false; }
  }
  const differences = supported ? comparePreservation(baseline, makePreservationBaseline(draft.id, draft.version, draft.content))
    : {removed: [], removedGameplay: [], removedGameplayItems: [], removedAnchors: [], changedAnchors: [], textComparison: 'unsupported', structuralComparison: 'unsupported'};
  const unsupportedBaseline = !supported;
  const findings: Array<{code: string; severity: 'destructive' | 'review' | 'unsupported'; message: string; entity?: string; anchor?: string}> = preservationFindings(differences, supported ? compareDestructiveText(baseline, draft.content) : {reduced: [], repetitive: []});
  if (unsupportedBaseline) findings.push({code: 'baseline-unsupported', severity: 'unsupported', message: '历史基线格式不完整或不受支持，无法判断玩法与正文是否完整保留。'});
  return {worldId: draft.id, expectedVersion: draft.version, baselineVersion: baseline.version, baselineHash: baseline.hash,
    currentHash: hash(draft.content), differences, baselineEstablished: true as const,
    status: findings.some(finding => finding.severity === 'destructive') ? 'fail' as const : unsupportedBaseline ? 'unsupported' as const : 'pass' as const, findings,
    note: '结构化实体与正文锚点只报告可机械比较的变化，不证明自然语言剧情语义。'};
}

export function assertWorldPreservation(baseline: PreservationBaseline, content: WorldContent): void {
  if (!isSupportedBaseline(baseline)) throw new AppError('WORLD_PRESERVATION_REQUIRED', '历史保留基线格式不受支持，已拒绝编辑。', 409, {baselineVersion: baseline.version, unsupported: true});
  const candidate = makePreservationBaseline(baseline.draftId, baseline.version, content);
  const removed = Object.entries(baseline.entityIds).flatMap(([group, ids]) => ids.filter(id => !candidate.entityIds[group]?.includes(id)).map(id => `${group}:${id}`));
  const removedGameplay = Object.entries(baseline.gameplay).filter(([key, signature]) => !preservesGameplay(signature, candidate.gameplay[key])).map(([key]) => key);
  const removedAnchors = Object.keys(baseline.anchors).filter(key => candidate.anchors[key] === undefined);
  const {reduced, repetitive} = compareDestructiveText(baseline, content);
  if (removed.length || removedGameplay.length || removedAnchors.length || reduced.length || repetitive.length) {
    throw new AppError('WORLD_PRESERVATION_REQUIRED', '检测到会损失既有玩法或正文的编辑，已原子拒绝；需要作者对具体差异作专门确认（后续 reshape 流程）。', 409,
      {baselineVersion: baseline.version, baselineHash: baseline.hash, removed, removedGameplay, removedAnchors, reduced, repetitive});
  }
}

export function extendPreservationBaseline(baseline: PreservationBaseline, draft: PreservationBaseline): PreservationBaseline {
  const entityIds = {...baseline.entityIds};
  for (const [group, ids] of Object.entries(draft.entityIds)) entityIds[group] = [...new Set([...(entityIds[group] ?? []), ...ids])].sort();
  const anchors = {...draft.anchors, ...baseline.anchors};
  const anchorLengths = {...draft.anchorLengths, ...baseline.anchorLengths};
  const gameplay = {...baseline.gameplay};
  for (const [key, signature] of Object.entries(draft.gameplay)) {
    const previous = gameplay[key];
    gameplay[key] = previous ? extendGameplaySignatures(previous, signature) : signature;
  }
  const snapshot = {...baseline, entityIds, anchors, anchorLengths, gameplay};
  return {...snapshot, hash: hash({entityIds, anchors, anchorLengths, gameplay})};
}

function comparePreservation(base: PreservationBaseline, current: PreservationBaseline) {
  const removed = Object.entries(base.entityIds).flatMap(([group, ids]) => ids.filter(id => !current.entityIds[group]?.includes(id)).map(id => `${group}:${id}`));
  const changedAnchors = Object.keys(base.anchors).filter(key => current.anchors[key] !== base.anchors[key]);
  const missingAnchors = Object.keys(base.anchors).filter(key => current.anchors[key] === undefined);
  const removedGameplay = Object.entries(base.gameplay).filter(([key, signature]) => !preservesGameplay(signature, current.gameplay[key])).map(([key]) => key);
  const removedGameplayItems = removedGameplay.filter(key => current.gameplay[key] !== undefined);
  return {removed, removedGameplay, removedGameplayItems, removedAnchors: missingAnchors, changedAnchors,
    textComparison: 'sha256 anchors; detailed text semantic comparison is unsupported',
    structuralComparison: 'existing typed signatures only; preserving structure does not prove semantic equivalence'};
}

function preservationFindings(differences: ReturnType<typeof comparePreservation>, text: ReturnType<typeof compareDestructiveText>) {
  const findings = [
    ...differences.removed.map(entity => ({code: 'entity-removed', severity: 'destructive' as const, entity, message: `删除既有实体 ${entity}`})),
    ...differences.removedGameplay.map(entity => ({code: 'gameplay-removed', severity: 'destructive' as const, entity, message: `删除或改写既有玩法结构 ${entity}`})),
    ...differences.removedAnchors.map(anchor => ({code: 'anchor-removed', severity: 'destructive' as const, anchor, message: `删除既有正文片段 ${anchor}`})),
    ...differences.changedAnchors.filter(anchor => !differences.removedAnchors.includes(anchor)).map(anchor => ({code: 'anchor-changed', severity: 'review' as const, anchor, message: `既有正文片段发生变化 ${anchor}`})),
    ...text.reduced.map(item => ({code: 'anchor-compressed', severity: 'destructive' as const, anchor: item.key, message: `既有正文被显著压缩 ${item.key} (${item.before} -> ${item.after})`})),
    ...text.repetitive.map(anchor => ({code: 'repeated-frames', severity: 'destructive' as const, anchor, message: `剧情卡正文帧被重复覆盖 ${anchor}`})),
  ];
  return findings;
}
function getAnchorTextLength(key: string, baseline: PreservationBaseline): number {
  return baseline.anchorLengths[key] ?? 0;
}
function findText(content: WorldContent, key: string): string | undefined {
  const [group, id, kind, sub] = key.split(':');
  if (group === 'locations') {
    const item = content.locations.find(value => value.id === id);
    return kind === 'variant' ? item?.textVariants?.[Number(sub)]?.text : item?.text;
  }
  if (group === 'actions') return content.actions.find(item => item.id === id)?.text;
  if (group === 'storylets') { const item = content.storylets?.find(value => value.id === id); if (!item) return undefined;
    if (kind === 'text') return item.text; if (kind === 'variant') return item.textVariants?.[Number(sub)];
    if (kind === 'case') return item.textCases?.find(value => (value.id ?? String(item.textCases?.indexOf(value))) === sub)?.text;
    if (kind === 'choice') return item.choices.find(value => value.id === sub)?.text; }
  if (group === 'endings') { const item = content.endings.find(value => value.id === id); if (!item) return undefined;
    if (kind === 'text') return item.text; if (kind === 'variant') return item.textVariants?.[Number(sub)]?.text;
    if (kind === 'passage') return item.passages?.find(value => value.id === sub)?.text; }
  return undefined;
}
function gameplayShape(group: 'actions' | 'storylets', item: WorldContent['actions'][number] | NonNullable<WorldContent['storylets']>[number], legacyTitle = false): string[] {
  const signature = (value: unknown): string => hash(normalizeGameplayStructure(value));
  if (group === 'actions') {
    const action = item as WorldContent['actions'][number];
    const {text: _text, description: _description, effects, ...rules} = action;
    return [signature(rules), ...effects.map(effect => signature(effectShape(effect)))].sort();
  }
  const card = item as NonNullable<WorldContent['storylets']>[number];
  return [storyletRouteSignature(card, legacyTitle), ...(card.when ?? []).map(signature), ...card.choices.flatMap(choice => [
    signature({choiceId: choice.id, requires: choice.requires, availableWhen: choice.availableWhen}),
    ...choice.effects.map(effect => signature({choiceId: choice.id, effect: effectShape(effect)})),
  ])].sort();
}
function storyletRouteSignature(card: NonNullable<WorldContent['storylets']>[number], legacyTitle: boolean): string {
  const {weight: _weight, choices: _choices, text: _text, textVariants: _variants, textCases: _cases, when: _when, title, ...route} = card;
  return hash(normalizeGameplayStructure(legacyTitle ? {...route, title} : route));
}
function preservesGameplay(before: string, after: string | undefined): boolean {
  if (!after) return false;
  const previous = parseGameplaySignatures(before), next = parseGameplaySignatures(after);
  return previous !== undefined && next !== undefined && previous.every(signature => next.includes(signature));
}
function parseGameplaySignatures(value: string): string[] | undefined { try { const result = JSON.parse(value) as unknown; return Array.isArray(result) && result.every(item => typeof item === 'string') ? result : undefined; } catch { return undefined; } }
function isSupportedBaseline(value: PreservationBaseline): boolean {
  if (!value || !value.gameplay || !value.anchorLengths || !value.entityIds || !value.anchors) return false;
  if (value.formatVersion !== undefined && value.formatVersion !== 2) return false;
  return Object.values(value.gameplay).every(signature => parseGameplaySignatures(signature) !== undefined);
}
function unsupportedBaseline(baseline: PreservationBaseline): AppError {
  return new AppError('WORLD_PRESERVATION_REQUIRED', '历史基线无法与当前旧实体精确对应，已拒绝编辑。', 409, {baselineVersion: baseline.version, unsupported: true});
}
function extendGameplaySignatures(previous: string, current: string): string {
  const oldItems = parseGameplaySignatures(previous) ?? [], newItems = parseGameplaySignatures(current) ?? [];
  const remaining = [...oldItems];
  const additions: string[] = [];
  for (const signature of newItems) { const index = remaining.indexOf(signature); if (index >= 0) remaining.splice(index, 1); else additions.push(signature); }
  return JSON.stringify([...new Set([...oldItems, ...additions])].sort());
}
function normalizeGameplayStructure(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeGameplayStructure);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !['delta', 'amount', 'value', 'atLeast', 'atMost', 'min', 'max', 'timeCost', 'weight'].includes(key))
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, normalizeGameplayStructure(child)]));
}
function effectShape(effect: WorldContent['actions'][number]['effects'][number]): unknown {
  const record = effect as unknown as Record<string, unknown>;
  const {delta: _delta, amount: _amount, value: _value, ...shape} = record;
  return shape;
}
function repeatedFrameRegression(content: WorldContent): string[] {
  return (content.storylets ?? []).flatMap(card => {
    const frames = [card.text, ...(card.textVariants ?? []), ...(card.textCases ?? []).map(item => item.text)].filter((x): x is string => !!x);
    return frames.length >= 3 && new Set(frames.map(text => text.trim())).size === 1 ? [`storylets:${card.id}:identical-frames`] : [];
  });
}
function compareDestructiveText(baseline: PreservationBaseline, content: WorldContent) {
  const reduced = Object.keys(baseline.anchors ?? {}).filter(key => /^(locations|actions|storylets|endings):/.test(key)).flatMap(key => {
    const before = baseline.anchorLengths?.[key] ?? 0, after = findText(content, key);
    return before > 0 && (after === undefined || after.trim().length === 0 || (before >= 200 && after.length < before * 0.55 && before - after.length >= 120))
      ? [{key, before, after: after?.length ?? 0}] : [];
  });
  return {reduced, repetitive: repeatedFrameRegression(content)};
}
function hash(value: unknown): string {return createHash('sha256').update(canonicalJson(value)).digest('hex');}
