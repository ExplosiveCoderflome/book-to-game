import {SYSTEM_WAIT_ACTION_ID, validateWorldbookContent, type WorldContent, type WorldCondition, type WorldEffect, type SourceDocument, type ValidationResult} from '@novel-game/contracts';
import {assessOpeningActions, mapIdOf, validateS1References, walkWorldLogic, validateSubMaps, validateWorldLayer, validateWorldMap, worldFactions, worldMaps} from '@novel-game/rules';
export type ValidateWorldOptions = {
  buildingAssetIds?: ReadonlySet<string> | readonly string[];
};
export function validateWorld(world: WorldContent, source: SourceDocument, opts?: ValidateWorldOptions): ValidationResult {
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
  const factionIds = new Set(worldFactions(world).map(f => f.id));
  const mapIds = new Set(worldMaps(world).map(mapIdOf));
  for (const r of world.factionRelations ?? []) {
    reference(factionIds, r.a, '势力关系', '势力'); reference(factionIds, r.b, '势力关系', '势力');
    if (r.a === r.b) errors.push(`势力关系不能指向自身：${r.a}`);
  }
  for (const f of worldFactions(world)) for (const st of f.stats ?? []) if (!(world.resources && st.resourceId in world.resources)) errors.push(`势力 ${f.name} 的数值「${st.label}」引用了不存在的资源：${st.resourceId}`);
  function conditions(items: WorldCondition[], owner: string): void {
    for (const item of items) {
      if (item.kind === 'fact' || item.kind === 'known' || item.kind === 'npc_knows') reference(facts, item.factId, owner, '事实');
      if (item.kind === 'npc_knows') reference(npcs, item.npcId, owner, 'NPC');
      if (item.kind === 'at_terrain') {
        const known = new Set(world.map?.layers?.terrain?.palette.map(p => p.id) ?? []);
        if (!world.map?.layers?.terrain) warnings.push(`${owner} 使用地形条件，但世界没有地形图层（条件恒不成立）`);
        else for (const tid of item.terrainIds) if (!known.has(tid)) errors.push(`${owner} 的地形不存在：${tid}`);
      }
      if (item.kind === 'in_region') {
        const known = new Set(world.map?.layers?.regions?.regions.map(r => r.id) ?? []);
        if (!world.map?.layers?.regions) warnings.push(`${owner} 使用区域条件，但世界没有区域图层（条件恒不成立）`);
        else for (const rid of item.regionIds) if (!known.has(rid)) errors.push(`${owner} 的区域不存在：${rid}`);
      }
      if (item.kind === 'in_faction_territory') {
        const known = new Set(world.map?.layers?.factions?.factions.map(f => f.id) ?? []);
        if (!world.map?.layers?.factions) warnings.push(`${owner} 使用势力领土条件，但世界没有势力图层（条件恒不成立）`);
        else for (const fid of item.factionIds) if (!known.has(fid)) errors.push(`${owner} 的势力不存在：${fid}`);
      }
      if (item.kind === 'faction_relation') { reference(factionIds, item.a, owner, '势力'); reference(factionIds, item.b, owner, '势力'); }
      if (item.kind === 'npc_at_location') { reference(npcs, item.npcId, owner, 'NPC'); reference(locations, item.locationId, owner, '地点'); }
      if (item.kind === 'time' && item.atLeast > world.timeLimit) warnings.push(`${owner} 的时间条件超过时限`);
    }
  }
  const resourceIds = new Set([...Object.keys(world.resources ?? {}), ...Object.keys(world.resourceDefs ?? {})]);
  function effects(items: WorldEffect[], owner: string): void {
    for (const item of items) {
      if (item.kind === 'set' || item.kind === 'reveal' || item.kind === 'npc_learn') reference(facts, item.factId, owner, '事实');
      if (item.kind === 'npc_move' || item.kind === 'npc_learn') reference(npcs, item.npcId, owner, 'NPC');
      if (item.kind === 'move' || item.kind === 'npc_move') reference(locations, item.locationId, owner, '地点');
      if (item.kind === 'set_territory') {
        if (item.factionId !== null) reference(factionIds, item.factionId, owner, '势力');
        if (item.mapId && !mapIds.has(item.mapId)) errors.push(`${owner} 的地图不存在：${item.mapId}`);
        if (!world.map) warnings.push(`${owner} 改变领土，但世界没有地图（效果无作用）`);
      }
      if (item.kind === 'set_faction_relation') { reference(factionIds, item.a, owner, '势力'); reference(factionIds, item.b, owner, '势力'); }
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
  if (world.resourceDefs || world.clock || world.storylets) {
    // S1: fact / NPC / location refs inside storylets, anyOf members, roll branches, thresholds and clock rules.
    walkWorldLogic(world, (c, owner) => { if (c.kind !== 'anyOf') conditions([c], owner); }, (e, owner) => { if (e.kind !== 'roll' && e.kind !== 'resource' && e.kind !== 'resource_max') effects([e], owner); });
    for (const issue of validateS1References(world)) (issue.level === 'error' ? errors : warnings).push(issue.message);
  }
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
    regionIds: new Set(world.map?.layers?.regions?.regions.map(r => r.id) ?? []),
    sceneIds: new Set(),
    variables: { ...(world.resources ?? {}) },
    choiceTags: actionTags,
    numericLabel: '资源',
  });
  errors.push(...wb.errors);
  warnings.push(...wb.warnings);
  for (const issue of validateSubMaps(world)) (issue.level === 'error' ? errors : warnings).push(issue.message);
  for (const issue of validateWorldLayer(world)) (issue.level === 'error' ? errors : warnings).push(issue.message);
  if (world.map) for (const issue of validateWorldMap(world.map, world.locations.map(l => l.id).filter(id => !(world.subMaps ?? []).some(m => m.pois.some(p => p.locationId === id))), opts?.buildingAssetIds ? { buildingAssetIds: opts.buildingAssetIds } : undefined)) (issue.level === 'error' ? errors : warnings).push(issue.message);
  return {valid: errors.length === 0, errors, warnings};
}
