import {type BranchSkeleton, type Choice, type GameContent, type ValidationResult} from '@novel-game/contracts';
import {annotatePlayability, assessPlayability} from '@novel-game/rules';
import type {PlayabilityMode} from '@novel-game/rules';
import { AppError } from '../../../shared/errors.js';

export type { PlayabilityMode };
export { assessPlayability, annotatePlayability };

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
  if (message.includes('走廊') || message.includes('假分支')) return 'content';
  return 'content';
}
