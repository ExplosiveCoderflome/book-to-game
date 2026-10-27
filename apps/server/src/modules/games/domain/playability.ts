import type { BranchSkeleton, Choice, GameContent, SkeletonScene, ValidationResult } from '@novel-game/contracts';
import { AppError } from '../../../shared/errors.js';

export type PlayabilityMode = 'publish' | 'skeleton' | 'generated';

const EMPTY_LABEL = /^(继续|往前走|向前走|随便看看|离开|下一步|继续前进|看看周围|无事发生|走吧|…|\.{2,}|—+|-+)$/;

type GraphScene = Pick<SkeletonScene, 'id' | 'title' | 'choices' | 'ending'>;

export function assessPlayability(content: GameContent | BranchSkeleton, mode: PlayabilityMode = 'publish'): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const scenes = content.scenes as GraphScene[];
  const byId = new Map(scenes.map(scene => [scene.id, scene]));
  if (!byId.has(content.startSceneId)) {
    errors.push(`起始场景不存在：${content.startSceneId}`);
    return {valid: false, errors, warnings};
  }

  const start = byId.get(content.startSceneId)!;
  const opening = start.choices.length;
  if (opening < 2) {
    const message = `开局可选行动不足：起始场景仅有 ${opening} 个选项，至少需要 2 个`;
    if (mode === 'publish') warnings.push(message);
    else errors.push(message);
  }

  const nonEnding = scenes.filter(scene => !scene.ending?.trim());
  const endings = scenes.filter(scene => scene.ending?.trim());
  if (mode !== 'publish' && nonEnding.length < 3) {
    errors.push(`非结局场景过少：当前 ${nonEnding.length} 个，生成阶段至少需要 3 个以支撑短游戏体感`);
  }

  const labels = scenes.flatMap(scene => scene.choices.map(choice => choice.label.trim()));
  if (labels.length) {
    const empty = labels.filter(label => !label || EMPTY_LABEL.test(label)).length;
    if (empty / labels.length >= 0.5) {
      errors.push(`空洞选项过多：${empty}/${labels.length} 个选项像「继续/随便看看」式空转，请改成有代价或冲突的选择`);
    }
  }

  let convergingHubs = 0;
  for (const scene of nonEnding) {
    const targets = [...new Set(scene.choices.map(choice => choice.targetSceneId))];
    if (scene.choices.length >= 2 && targets.length === 1 && targets[0] === scene.id) convergingHubs++;
  }
  if (convergingHubs === nonEnding.length && nonEnding.length > 0) {
    errors.push('所有非结局场景的选项都只回到自身，缺少通向不同结局的前进分支');
  }

  const {shortestEnding, longestPath, branchScenes} = graphMetrics(content.startSceneId, byId);
  if (branchScenes === 0) {
    // validate-game already errors; keep a playability note for generation feedback
    if (mode !== 'publish') errors.push('缺少真正分支：至少需要一个可达场景含有两个不同去向');
  }
  if (shortestEnding < 0) {
    errors.push('无法从入口到达任何结局');
  } else if (mode !== 'publish' && shortestEnding < 2) {
    errors.push(`路径过短：最短通关仅 ${shortestEnding} 步，生成阶段至少需要 2 步（避免三下结束）`);
  } else if (mode === 'publish' && shortestEnding < 2) {
    warnings.push(`最短通关仅 ${shortestEnding} 步，体感偏短；建议增加中间场景或有后果的自我循环选择`);
  }
  if (mode !== 'publish' && longestPath < 3) {
    errors.push(`最长简单路径仅 ${longestPath} 步，生成阶段建议 ≥ 3 以形成可探索分支`);
  } else if (mode === 'publish' && longestPath < 3) {
    warnings.push(`最长简单路径仅 ${longestPath} 步，可玩深度偏浅`);
  }

  const withEffects = scenes.flatMap(scene => scene.choices).filter(choice => (choice.effects?.length ?? 0) > 0).length;
  const totalChoices = scenes.flatMap(scene => scene.choices).length;
  if (mode !== 'publish' && totalChoices >= 4 && withEffects / totalChoices < 0.25) {
    errors.push(`带状态后果的选项过少：${withEffects}/${totalChoices}，生成阶段至少约 25% 选项应带 effects`);
  } else if (mode === 'publish' && totalChoices >= 4 && withEffects === 0 && Object.keys(content.variables ?? {}).length === 0) {
    warnings.push('没有任何 variables/effects，选择可能缺少可见后果');
  }

  // TODO(M2): variable-aware reachability — current graph metrics ignore conditions/effects.
  if (scenes.some(scene => scene.choices.some(choice => choice.conditions?.length))) {
    warnings.push('可玩性路径统计忽略变量条件（TODO: games/domain/reachability.ts），请试玩验证条件分支。');
  }

  if (endings.length >= 2) {
    const distinct = new Set(endings.map(scene => scene.ending!.trim()));
    if (distinct.size < 2 && mode !== 'publish') errors.push('结局文案需要至少两个不同文本');
  }

  return {valid: errors.length === 0, errors, warnings};
}

export function assertPlayableSkeleton(skeleton: BranchSkeleton): void {
  const topology = assessTopology(skeleton);
  if (!topology.valid) {
    throwPlayability('INVALID_GENERATED_GAME', '分支骨架未通过拓扑校验：', topology.errors);
  }
  const play = assessPlayability(skeleton, 'skeleton');
  if (!play.valid) {
    throwPlayability('INVALID_GENERATED_GAME', '分支骨架未通过可玩性门禁：', play.errors);
  }
}

export function assertExpandedHonorsSkeleton(skeleton: BranchSkeleton, content: GameContent): void {
  const issues: string[] = [];
  if (content.startSceneId !== skeleton.startSceneId) issues.push(`expand 改写了入口：${skeleton.startSceneId} → ${content.startSceneId}`);
  const skScenes = new Map(skeleton.scenes.map(scene => [scene.id, scene]));
  const exScenes = new Map(content.scenes.map(scene => [scene.id, scene]));
  for (const id of skScenes.keys()) if (!exScenes.has(id)) issues.push(`expand 删除了场景：${id}`);
  for (const id of exScenes.keys()) if (!skScenes.has(id)) issues.push(`expand 新增了场景：${id}`);
  for (const [id, sk] of skScenes) {
    const ex = exScenes.get(id);
    if (!ex) continue;
    const skEnding = sk.ending?.trim() ?? '';
    const exEnding = ex.ending?.trim() ?? '';
    if (Boolean(skEnding) !== Boolean(exEnding)) issues.push(`expand 改写了场景 ${id} 的结局标记`);
    if (skEnding && exEnding && skEnding !== exEnding) issues.push(`expand 改写了场景 ${id} 的结局文案`);
    const skChoices = new Map(sk.choices.map(choice => [choice.id, choice]));
    const exChoices = new Map(ex.choices.map(choice => [choice.id, choice]));
    for (const choiceId of skChoices.keys()) if (!exChoices.has(choiceId)) issues.push(`expand 删除了选项：${id}/${choiceId}`);
    for (const choiceId of exChoices.keys()) if (!skChoices.has(choiceId)) issues.push(`expand 新增了选项：${id}/${choiceId}`);
    for (const [choiceId, skChoice] of skChoices) {
      const exChoice = exChoices.get(choiceId);
      if (!exChoice) continue;
      if (exChoice.targetSceneId !== skChoice.targetSceneId) {
        issues.push(`expand 改写了连线：${id}/${choiceId} → ${skChoice.targetSceneId} 被改为 ${exChoice.targetSceneId}`);
      }
      if (stableRules(skChoice) !== stableRules(exChoice)) {
        issues.push(`expand 改写了选项规则：${id}/${choiceId}`);
      }
    }
  }
  const skVars = JSON.stringify(skeleton.variables ?? {});
  const exVars = JSON.stringify(content.variables ?? {});
  if (skVars !== exVars) issues.push('expand 改写了 variables 初值表');
  if (issues.length) throwPlayability('INVALID_GENERATED_GAME', '正文扩展改写了锁定的分支图：', issues);
}

function assessTopology(content: BranchSkeleton | GameContent): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const scenes = new Map(content.scenes.map(scene => [scene.id, scene]));
  if (!scenes.has(content.startSceneId)) errors.push(`起始场景不存在：${content.startSceneId}`);
  for (const scene of content.scenes) {
    if (scene.ending !== undefined && !scene.ending.trim()) errors.push(`场景 ${scene.id} 的结局不能为空`);
    if (scene.ending !== undefined && scene.choices.length) errors.push(`结局场景 ${scene.id} 不能有选择`);
    if (scene.ending === undefined && !scene.choices.length) errors.push(`非结局场景 ${scene.id} 必须有选择`);
    for (const choice of scene.choices) {
      if (!scenes.has(choice.targetSceneId)) errors.push(`场景 ${scene.id} 的选择目标不存在：${choice.targetSceneId}`);
    }
  }
  const reachable = new Set<string>();
  const pending = [content.startSceneId];
  while (pending.length) {
    const id = pending.pop()!;
    if (reachable.has(id) || !scenes.has(id)) continue;
    reachable.add(id);
    pending.push(...scenes.get(id)!.choices.map(choice => choice.targetSceneId));
  }
  for (const scene of content.scenes) if (!reachable.has(scene.id)) errors.push(`场景不可达：${scene.id}`);
  const endingScenes = content.scenes.filter(scene => reachable.has(scene.id) && scene.ending?.trim());
  const reverse = new Map<string, Set<string>>();
  for (const scene of content.scenes) {
    for (const choice of scene.choices) {
      const parents = reverse.get(choice.targetSceneId) ?? new Set<string>();
      parents.add(scene.id); reverse.set(choice.targetSceneId, parents);
    }
  }
  const canEnd = new Set<string>();
  const queue = endingScenes.map(scene => scene.id);
  while (queue.length) {
    const id = queue.pop()!;
    if (canEnd.has(id)) continue;
    canEnd.add(id);
    queue.push(...(reverse.get(id) ?? []));
  }
  for (const id of reachable) if (!canEnd.has(id)) errors.push(`场景 ${id} 无法到达任何结局`);
  if (new Set(endingScenes.map(scene => scene.ending!.trim())).size < 2) errors.push('至少需要两个不同的可达结局');
  if (![...reachable].some(id => new Set(scenes.get(id)!.choices.map(choice => choice.targetSceneId)).size >= 2)) {
    errors.push('至少需要一个具有不同去向的可达分支场景');
  }
  return {valid: errors.length === 0, errors, warnings};
}

function graphMetrics(startId: string, byId: Map<string, GraphScene>): {shortestEnding: number; longestPath: number; branchScenes: number} {
  let shortestEnding = -1;
  let longestPath = 0;
  let branchScenes = 0;
  const visit = (id: string, depth: number, stack: Set<string>) => {
    const scene = byId.get(id);
    if (!scene) return;
    longestPath = Math.max(longestPath, depth);
    if (scene.ending?.trim()) {
      shortestEnding = shortestEnding < 0 ? depth : Math.min(shortestEnding, depth);
      return;
    }
    const targets = new Set(scene.choices.map(choice => choice.targetSceneId));
    if (targets.size >= 2) branchScenes++;
    for (const choice of scene.choices) {
      if (stack.has(choice.targetSceneId)) {
        longestPath = Math.max(longestPath, depth + 1);
        continue;
      }
      stack.add(choice.targetSceneId);
      visit(choice.targetSceneId, depth + 1, stack);
      stack.delete(choice.targetSceneId);
    }
  };
  visit(startId, 0, new Set([startId]));
  return {shortestEnding, longestPath, branchScenes};
}

function stableRules(choice: Choice): string {
  return JSON.stringify({conditions: choice.conditions ?? [], effects: choice.effects ?? []});
}

function throwPlayability(code: string, prefix: string, errors: string[]): never {
  const issues = errors.slice(0, 8).map(message => ({path: pathFrom(message), message}));
  throw new AppError(code, `${prefix}${errors.slice(0, 5).join('；')}。可重试设计步骤。`, 422, {path: issues[0]?.path, issues});
}

function pathFrom(message: string): string {
  const unreachable = message.match(/场景不可达：(\S+)/);
  if (unreachable) return `scenes.${unreachable[1]}`;
  const scene = message.match(/场景 ([^\s：/]+)/);
  if (scene) return `scenes.${scene[1]}`;
  if (message.includes('开局')) return 'startSceneId';
  if (message.includes('连线') || message.includes('选项')) return 'choices';
  return 'content';
}
