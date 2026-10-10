import type { GameContent, Scene, SourceDocument, ValidationResult } from '@novel-game/contracts';

export function validateGame(content: GameContent, source: SourceDocument): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const variables = content.variables ?? {};
  for (const [name, value] of Object.entries(variables)) {
    if (!['string', 'number', 'boolean'].includes(typeof value) || (typeof value === 'number' && !Number.isFinite(value))) {
      errors.push(`变量 ${name} 的初始值必须是字符串、有限数字或布尔值`);
    }
  }
  const scenes = new Map<string, Scene>();
  const evidence = new Map(source.chapters.map(chapter => [chapter.id, new Set(chapter.paragraphs.map(paragraph => paragraph.id))]));
  for (const scene of content.scenes) {
    if (scenes.has(scene.id)) errors.push(`场景 ID 重复：${scene.id}`);
    scenes.set(scene.id, scene);
    const choiceIds = new Set<string>();
    for (const choice of scene.choices) {
      if (choiceIds.has(choice.id)) errors.push(`场景 ${scene.id} 的选择 ID 重复：${choice.id}`);
      choiceIds.add(choice.id);
      for (const operation of [...(choice.conditions ?? []), ...(choice.effects ?? [])]) {
        if (!Object.hasOwn(variables, operation.variable)) {
          errors.push(`选项 ${scene.id}/${choice.id} 引用了不存在的变量：${operation.variable}`);
          continue;
        }
        const initial = variables[operation.variable];
        if (operation.type === 'variable.gte' || operation.type === 'variable.increment') {
          if (typeof initial !== 'number' || !Number.isFinite(initial) || !Number.isFinite(operation.value)) {
            errors.push(`选项 ${scene.id}/${choice.id} 的 ${operation.type} 需要数字变量和有限数字值：${operation.variable}`);
          }
        } else if (typeof operation.value !== typeof initial || (typeof operation.value === 'number' && !Number.isFinite(operation.value))) {
          errors.push(`选项 ${scene.id}/${choice.id} 的变量值类型与初始类型不一致：${operation.variable}`);
        }
      }
    }
    if (scene.ending !== undefined && !scene.ending.trim()) errors.push(`场景 ${scene.id} 的结局不能为空`);
    if (scene.ending !== undefined && scene.choices.length) errors.push(`结局场景 ${scene.id} 不能有选择`);
    if (scene.ending === undefined && !scene.choices.length) errors.push(`非结局场景 ${scene.id} 必须有选择`);
    if (scene.origin === 'source' && !scene.evidence.length) errors.push(`原作场景 ${scene.id} 必须有来源证据`);
    for (const reference of scene.evidence) {
      if (!evidence.get(reference.chapterId)?.has(reference.paragraphId)) errors.push(`场景 ${scene.id} 的证据不存在：${reference.chapterId}/${reference.paragraphId}`);
    }
  }
  if (!scenes.has(content.startSceneId)) errors.push(`起始场景不存在：${content.startSceneId}`);
  const reverse = new Map<string, Set<string>>();
  for (const scene of content.scenes) {
    for (const choice of scene.choices) {
      if (!scenes.has(choice.targetSceneId)) errors.push(`场景 ${scene.id} 的选择目标不存在：${choice.targetSceneId}`);
      const parents = reverse.get(choice.targetSceneId) ?? new Set<string>();
      parents.add(scene.id); reverse.set(choice.targetSceneId, parents);
    }
  }
  const reachable = new Set<string>();
  const pending = [content.startSceneId];
  while (pending.length) {
    const id = pending.pop()!;
    if (reachable.has(id) || !scenes.has(id)) continue;
    reachable.add(id); pending.push(...scenes.get(id)!.choices.map(choice => choice.targetSceneId));
  }
  for (const scene of content.scenes) if (!reachable.has(scene.id)) errors.push(`场景不可达：${scene.id}`);
  const endingScenes = content.scenes.filter(scene => reachable.has(scene.id) && scene.ending !== undefined && scene.ending.trim());
  const canEnd = new Set<string>();
  const parents = endingScenes.map(scene => scene.id);
  while (parents.length) {
    const id = parents.pop()!;
    if (canEnd.has(id)) continue;
    canEnd.add(id); parents.push(...(reverse.get(id) ?? []));
  }
  for (const id of reachable) if (!canEnd.has(id)) errors.push(`场景 ${id} 无法到达任何结局`);
  if (new Set(endingScenes.map(scene => scene.ending!.trim())).size < 2) errors.push('至少需要两个不同的可达结局');
  if (!content.scenes.some(scene => reachable.has(scene.id) && new Set(scene.choices.map(choice => choice.targetSceneId)).size >= 2)) errors.push('至少需要一个具有不同去向的可达分支场景');
  if (content.scenes.some(scene => scene.choices.some(choice => choice.conditions?.length))) {
    warnings.push('场景连通性检查忽略变量条件，不能证明所有选项可解锁或所有策略可到达结局，请试玩验证。');
  }
  return { valid: errors.length === 0, errors, warnings };
}
