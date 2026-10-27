import { SYSTEM_WAIT_ACTION_ID, assessOpeningActions, validateWorldbookContent, type WorldContent, type WorldCondition, type WorldEffect, type SourceDocument, type ValidationResult } from '@novel-game/contracts';
export function validateWorld(world: WorldContent, source: SourceDocument): ValidationResult {
  const errors: string[] = []; const warnings: string[] = [];
  function ids(entries: {id: string}[], category: string): Set<string> {
    const result = new Set<string>();
    for (const entry of entries) {if (result.has(entry.id)) errors.push(`${category} ID 重复：${entry.id}`); result.add(entry.id);} return result;
  }
  const locations = ids(world.locations, '地点'); const facts = ids(world.facts, '事实'); const npcs = ids(world.npcs, 'NPC');
  ids(world.actions, '行动'); ids(world.events, '事件'); ids(world.endings, '结局');
  const chapters = new Map(source.chapters.map(ch => [ch.id, new Set(ch.paragraphs.map(p => p.id))]));
  const selected = new Set<string>();
  for (const chapterId of world.sourceChapterIds) {
    if (selected.has(chapterId)) errors.push(`章节选择重复：${chapterId}`);
    if (!chapters.has(chapterId)) errors.push(`选择的来源章节不存在：${chapterId}`); selected.add(chapterId);
  }
  function reference(set: Set<string>, id: string, owner: string, kind: string): void {
    if (!set.has(id)) errors.push(`${owner} 的${kind}不存在：${id}`);
  }
  function conditions(items: WorldCondition[], owner: string): void {
    for (const item of items) {
      if (item.kind === 'fact' || item.kind === 'known' || item.kind === 'npc_knows') reference(facts, item.factId, owner, '事实');
      if (item.kind === 'npc_knows') reference(npcs, item.npcId, owner, 'NPC');
      if (item.kind === 'time' && item.atLeast > world.timeLimit) warnings.push(`${owner} 的时间条件超过时限`);
    }
  }
  const resourceIds = new Set(Object.keys(world.resources ?? {}));
  function effects(items: WorldEffect[], owner: string): void {
    for (const item of items) {
      if (item.kind === 'set' || item.kind === 'reveal' || item.kind === 'npc_learn') reference(facts, item.factId, owner, '事实');
      if (item.kind === 'npc_move' || item.kind === 'npc_learn') reference(npcs, item.npcId, owner, 'NPC');
      if (item.kind === 'move' || item.kind === 'npc_move') reference(locations, item.locationId, owner, '地点');
      if (item.kind === 'resource' && !resourceIds.has(item.resourceId)) {
        errors.push(`${owner} 的资源不存在：${item.resourceId}`);
      }
    }
  }
  for (const entry of [...world.locations, ...world.facts, ...world.npcs, ...world.actions]) {
    if (entry.origin === 'source' && !entry.evidence.length) errors.push(`原作条目 ${entry.id} 必须有来源证据`);
    for (const evidence of entry.evidence) {
      if (!selected.has(evidence.chapterId)) errors.push(`条目 ${entry.id} 的证据超出所选章节：${evidence.chapterId}`);
      if (!chapters.get(evidence.chapterId)?.has(evidence.paragraphId)) errors.push(`条目 ${entry.id} 的证据不存在：${evidence.chapterId}/${evidence.paragraphId}`);
    }
  }
  reference(locations, world.initialLocationId, '玩家开局', '地点');
  for (const npc of world.npcs) {
    reference(locations, npc.initialLocationId, `NPC ${npc.id}`, '地点');
    const known = new Set<string>();
    for (const id of npc.knownFactIds) {reference(facts, id, `NPC ${npc.id}`, '已知事实'); if (known.has(id)) errors.push(`NPC ${npc.id} 已知事实重复：${id}`); known.add(id);}
  }
  for (const action of world.actions) {
    if (action.id === SYSTEM_WAIT_ACTION_ID) errors.push('行动 ID __wait__ 为系统等待行为保留');
    reference(locations, action.locationId, `行动 ${action.id}`, '地点');
    if (action.npcId) reference(npcs, action.npcId, `行动 ${action.id}`, 'NPC');
    conditions(action.availableWhen, `行动 ${action.id}`); conditions(action.requires, `行动 ${action.id}`); effects(action.effects, `行动 ${action.id}`);
  }
  for (const event of world.events) {conditions(event.when, `事件 ${event.id}`); effects(event.effects, `事件 ${event.id}`);}
  for (const ending of world.endings) conditions(ending.when, `结局 ${ending.id}`);
  // Hard gate: ≥3 immediately executable non-wait actions at start (availableWhen + requires).
  const opening = assessOpeningActions(world);
  if (!opening.ok) {
    errors.push(opening.message!);
  }
  // Visible-but-locked actions must carry a player-facing blockedReason (schema already requires non-empty;
  // also flag empty-looking placeholders that hide why requires failed).
  for (const action of world.actions) {
    if (opening.lockedVisibleIds.includes(action.id) && !action.blockedReason.trim()) {
      errors.push(`行动 ${action.id} 开局可见但不可执行，必须提供 blockedReason`);
    }
  }
  // Overapproximate connectivity: ignore conditions and permit event movement from any reachable location.
  // This can warn about disconnected geography; it cannot prove a winning strategy exists.
  const reachable = new Set<string>([world.initialLocationId]);
  let changed = true;
  while (changed) {
    changed = false;
    const possible = [...world.actions.filter(a => reachable.has(a.locationId)).flatMap(a => a.effects), ...world.events.flatMap(e => e.effects)];
    for (const effect of possible) if (effect.kind === 'move' && locations.has(effect.locationId) && !reachable.has(effect.locationId)) {reachable.add(effect.locationId); changed = true;}
  }
  for (const location of world.locations) if (!reachable.has(location.id)) warnings.push(`地点可能不可达：${location.id}（仅检查潜在连通性）`);
  warnings.push('潜在连通性检查不证明所有条件可满足或所有策略可到达结局，请试玩验证。');
  const actionTags = new Set<string>();
  for (const action of world.actions) for (const tag of action.tags ?? []) actionTags.add(tag);
  const wb = validateWorldbookContent({
    worldbook: world.worldbook,
    locationIds: locations,
    sceneIds: new Set(),
    variables: { ...(world.resources ?? {}) },
    choiceTags: actionTags,
    numericLabel: '资源',
  });
  errors.push(...wb.errors);
  warnings.push(...wb.warnings);
  return {valid: errors.length === 0, errors, warnings};
}
