/** Pure story-graph playability checks shared by server gates and the canvas UI. */

import { analyzeReachability, type ReachabilityGraph } from './reachability.js';

export type PlayabilityMode = 'publish' | 'skeleton' | 'generated';

export interface PlayabilityIssue {
  code: string;
  message: string;
  severity: 'error' | 'warning';
  sceneIds?: string[];
  edgeKeys?: string[];
}

export interface PlayabilityResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface PlayabilityAnnotation {
  result: PlayabilityResult;
  issues: PlayabilityIssue[];
  flaggedSceneIds: string[];
  flaggedEdgeKeys: string[];
}

type GraphChoice = {
  id: string;
  label: string;
  targetSceneId: string;
  conditions?: unknown[];
  effects?: unknown[];
};
type GraphScene = { id: string; title?: string; choices: GraphChoice[]; ending?: string };
export type PlayabilityGraph = {
  startSceneId: string;
  scenes: GraphScene[];
  variables?: Record<string, unknown>;
};

const EMPTY_LABEL = /^(继续|往前走|向前走|随便看看|离开|下一步|继续前进|看看周围|无事发生|走吧|…|\.{2,}|—+|-+)$/;

export function assessPlayability(content: PlayabilityGraph, mode: PlayabilityMode = 'publish'): PlayabilityResult {
  return annotatePlayability(content, mode).result;
}

export function annotatePlayability(content: PlayabilityGraph, mode: PlayabilityMode = 'publish'): PlayabilityAnnotation {
  const issues = collectPlayabilityIssues(content, mode);
  const errors = issues.filter(i => i.severity === 'error').map(i => i.message);
  const warnings = issues.filter(i => i.severity === 'warning').map(i => i.message);
  const flaggedSceneIds = [...new Set(issues.filter(i => i.severity === 'error' || i.code === 'CORRIDOR' || i.code === 'CHURN' || i.code === 'OPENING_FANOUT' || i.code === 'OPENING_DENSITY' || i.code === 'FAKE_BRANCH' || i.code === 'TOO_SHALLOW' || i.code === 'EMPTY_LABELS' || i.code === 'CONDITION_BLOCKED_ENDING' || i.code === 'FEW_STATE_ENDINGS' || i.code === 'DEAD_CONDITIONAL_EDGE' || i.code === 'LOW_OUT_DEGREE' || i.code === 'LOW_EFFECTS').flatMap(i => i.sceneIds ?? []))];
  const flaggedEdgeKeys = [...new Set(issues.filter(i => i.severity === 'error' || i.code === 'CORRIDOR' || i.code === 'CHURN' || i.code === 'FAKE_BRANCH' || i.code === 'EMPTY_LABELS' || i.code === 'OPENING_FANOUT' || i.code === 'CONDITION_BLOCKED_ENDING' || i.code === 'DEAD_CONDITIONAL_EDGE' || i.code === 'FEW_STATE_ENDINGS' || i.code === 'LOW_OUT_DEGREE' || i.code === 'LOW_EFFECTS').flatMap(i => i.edgeKeys ?? []))];
  return { result: { valid: errors.length === 0, errors, warnings }, issues, flaggedSceneIds, flaggedEdgeKeys };
}

export function collectPlayabilityIssues(content: PlayabilityGraph, mode: PlayabilityMode = 'publish'): PlayabilityIssue[] {
  const issues: PlayabilityIssue[] = [];
  const scenes = content.scenes;
  const byId = new Map(scenes.map(scene => [scene.id, scene]));

  if (!byId.has(content.startSceneId)) {
    issues.push({
      code: 'MISSING_START',
      message: `起始场景不存在：${content.startSceneId}`,
      severity: 'error',
      sceneIds: [content.startSceneId],
    });
    return issues;
  }

  const start = byId.get(content.startSceneId)!;
  const opening = start.choices.length;
  const openingTargets = [...new Set(start.choices.map(c => c.targetSceneId))];
  if (opening < 2) {
    issues.push({
      code: 'OPENING_DENSITY',
      message: `开局可选行动不足：起始场景仅有 ${opening} 个选项，至少需要 2 个`,
      severity: mode === 'publish' ? 'warning' : 'error',
      sceneIds: [start.id],
      edgeKeys: start.choices.map(c => `${start.id}:${c.id}`),
    });
  } else if (openingTargets.length < 2) {
    issues.push({
      code: 'OPENING_FANOUT',
      message: `开局缺少真实分叉：起始场景有 ${opening} 个选项，但只通向 ${openingTargets.length} 个不同目标`,
      severity: mode === 'publish' ? 'warning' : 'error',
      sceneIds: [start.id, ...openingTargets],
      edgeKeys: start.choices.map(c => `${start.id}:${c.id}`),
    });
  }

  const nonEnding = scenes.filter(scene => !scene.ending?.trim());
  const endings = scenes.filter(scene => scene.ending?.trim());
  if (mode !== 'publish' && nonEnding.length < 3) {
    issues.push({
      code: 'TOO_FEW_SCENES',
      message: `非结局场景过少：当前 ${nonEnding.length} 个，生成阶段至少需要 3 个以支撑短游戏体感`,
      severity: 'error',
      sceneIds: nonEnding.map(s => s.id),
    });
  }

  const emptyEdges: string[] = [];
  const emptyScenes = new Set<string>();
  let labelCount = 0;
  for (const scene of scenes) {
    for (const choice of scene.choices) {
      labelCount++;
      const label = choice.label.trim();
      if (!label || EMPTY_LABEL.test(label)) {
        emptyEdges.push(`${scene.id}:${choice.id}`);
        emptyScenes.add(scene.id);
      }
    }
  }
  if (labelCount && emptyEdges.length / labelCount >= 0.5) {
    issues.push({
      code: 'EMPTY_LABELS',
      message: `空洞选项过多：${emptyEdges.length}/${labelCount} 个选项像「继续/随便看看」式空转，请改成有代价或冲突的选择`,
      severity: 'error',
      sceneIds: [...emptyScenes],
      edgeKeys: emptyEdges,
    });
  }

  const churnEdges: string[] = [];
  const churnScenes = new Set<string>();
  for (const scene of nonEnding) {
    for (const choice of scene.choices) {
      if (choice.targetSceneId === scene.id) continue;
      const target = byId.get(choice.targetSceneId);
      if (!target || target.ending?.trim()) continue;
      const back = target.choices.some(c => c.targetSceneId === scene.id);
      const sceneOuts = new Set(scene.choices.map(c => c.targetSceneId));
      const targetOuts = new Set(target.choices.map(c => c.targetSceneId));
      if (back && sceneOuts.size <= 2 && targetOuts.size <= 2) {
        churnEdges.push(`${scene.id}:${choice.id}`);
        churnScenes.add(scene.id);
        churnScenes.add(target.id);
      }
    }
  }
  const forwardEdges = scenes.flatMap(s => s.choices.filter(c => c.targetSceneId !== s.id));
  const uniqueChurn = [...new Set(churnEdges)];
  if (forwardEdges.length >= 4 && uniqueChurn.length / forwardEdges.length >= 0.5) {
    issues.push({
      code: 'CHURN',
      message: `空转来回过多：约 ${uniqueChurn.length} 条边在场景间来回摆荡，缺少通向不同结局的前进分支`,
      severity: mode === 'publish' ? 'warning' : 'error',
      sceneIds: [...churnScenes],
      edgeKeys: uniqueChurn,
    });
  }

  let selfLoopHubs = 0;
  for (const scene of nonEnding) {
    const targets = [...new Set(scene.choices.map(choice => choice.targetSceneId))];
    if (scene.choices.length >= 2 && targets.length === 1 && targets[0] === scene.id) selfLoopHubs++;
  }
  if (selfLoopHubs === nonEnding.length && nonEnding.length > 0) {
    issues.push({
      code: 'SELF_LOOP_ONLY',
      message: '所有非结局场景的选项都只回到自身，缺少通向不同结局的前进分支',
      severity: 'error',
      sceneIds: nonEnding.map(s => s.id),
    });
  }

  const metrics = graphMetrics(content.startSceneId, byId);
  if (metrics.branchScenes === 0 && mode !== 'publish') {
    issues.push({
      code: 'NO_BRANCH',
      message: '缺少真正分支：至少需要一个可达场景含有两个不同去向',
      severity: 'error',
      sceneIds: [content.startSceneId],
    });
  }

  if (metrics.reachableEndingCount < 2 && mode !== 'publish') {
    issues.push({
      code: 'FEW_ENDINGS',
      message: `可达结局过少：当前 ${metrics.reachableEndingCount} 个，至少需要 2 个不同结局`,
      severity: 'error',
      sceneIds: endings.map(s => s.id),
    });
  } else if (metrics.distinctRouteCount < 2 && metrics.reachableEndingCount >= 1) {
    issues.push({
      code: 'CORRIDOR',
      message: `图呈走廊形态：从入口到结局缺少通向不同结局的独立路线（实质路线 ${metrics.distinctRouteCount} 条）`,
      severity: mode === 'publish' ? 'warning' : 'error',
      sceneIds: metrics.spineSceneIds,
      edgeKeys: metrics.spineEdgeKeys,
    });
  } else if (metrics.immediateRejoinBranches > 0 && metrics.branchScenes > 0 && metrics.distinctRouteCount < 2) {
    issues.push({
      code: 'FAKE_BRANCH',
      message: '存在假分支：分叉后立即汇合，未能形成通向不同结局的独立路线',
      severity: mode === 'publish' ? 'warning' : 'error',
      sceneIds: metrics.fakeBranchSceneIds,
      edgeKeys: metrics.fakeBranchEdgeKeys,
    });
  }

  if (metrics.shortestEnding < 0) {
    issues.push({
      code: 'NO_ENDING_REACHABLE',
      message: '无法从入口到达任何结局',
      severity: 'error',
      sceneIds: [content.startSceneId],
    });
  } else if (metrics.shortestEnding < 2) {
    issues.push({
      code: 'TOO_SHORT',
      message: mode === 'publish'
        ? `最短通关仅 ${metrics.shortestEnding} 步，体感偏短；建议增加中间场景或有后果的自我循环选择`
        : `路径过短：最短通关仅 ${metrics.shortestEnding} 步，生成阶段至少需要 2 步（避免三下结束）`,
      severity: mode === 'publish' ? 'warning' : 'error',
      sceneIds: [content.startSceneId],
    });
  }

  if (metrics.longestPath < 3) {
    issues.push({
      code: 'TOO_SHALLOW',
      message: mode === 'publish'
        ? `最长简单路径仅 ${metrics.longestPath} 步，可玩深度偏浅`
        : `最长简单路径仅 ${metrics.longestPath} 步，生成阶段建议 ≥ 3 以形成可探索分支`,
      severity: mode === 'publish' ? 'warning' : 'error',
      sceneIds: metrics.spineSceneIds.length ? metrics.spineSceneIds : [content.startSceneId],
    });
  }

  const withEffects = scenes.flatMap(scene => scene.choices).filter(choice => (choice.effects?.length ?? 0) > 0).length;
  const totalChoices = scenes.flatMap(scene => scene.choices).length;
  const effectRatio = totalChoices ? withEffects / totalChoices : 0;
  if (mode !== 'publish' && totalChoices >= 4 && effectRatio < 0.25) {
    issues.push({
      code: 'FEW_EFFECTS',
      message: `带状态后果的选项过少：${withEffects}/${totalChoices}，生成阶段至少约 25% 选项应带 effects`,
      severity: 'error',
    });
  } else if (mode === 'publish' && totalChoices >= 4 && effectRatio < 0.15) {
    const lowScenes = nonEnding.filter(scene => scene.choices.some(choice => !(choice.effects?.length))).map(s => s.id);
    issues.push({
      code: 'LOW_EFFECTS',
      message: `带状态后果的选项偏少：${withEffects}/${totalChoices}（${Math.round(effectRatio * 100)}%），发布前建议至少约 15% 选项带 effects，否则选择缺少可见代价`,
      severity: 'warning',
      sceneIds: lowScenes.length ? lowScenes : nonEnding.map(s => s.id),
    });
  } else if (mode === 'publish' && totalChoices >= 4 && withEffects === 0 && Object.keys(content.variables ?? {}).length === 0) {
    issues.push({
      code: 'NO_STATE',
      message: '没有任何 variables/effects，选择可能缺少可见后果',
      severity: 'warning',
    });
  }

  if (nonEnding.length >= 2) {
    const outDegrees = nonEnding.map(scene => scene.choices.length);
    const avgOut = outDegrees.reduce((a, b) => a + b, 0) / outDegrees.length;
    if (avgOut < 1.5) {
      const sparse = nonEnding.filter(scene => scene.choices.length <= 1).map(s => s.id);
      issues.push({
        code: 'LOW_OUT_DEGREE',
        message: `非结局平均出度偏低：${avgOut.toFixed(2)}（阈值 1.5）。图偏走廊/同质，请在画布上增删改边提高分叉，勿依赖隐含连线`,
        severity: 'warning',
        sceneIds: sparse.length ? sparse : nonEnding.map(s => s.id),
        edgeKeys: nonEnding.flatMap(scene => scene.choices.map(c => `${scene.id}:${c.id}`)),
      });
    }
  }

  const hasConditions = scenes.some(scene => scene.choices.some(choice => (choice.conditions?.length ?? 0) > 0));
  if (hasConditions) {
    const reach = analyzeReachability(content as ReachabilityGraph);
    if (reach.conditionBlockedEndingIds.length) {
      issues.push({
        code: 'CONDITION_BLOCKED_ENDING',
        message: `有 ${reach.conditionBlockedEndingIds.length} 个结局仅拓扑可达、变量条件实际不可达：${reach.conditionBlockedEndingIds.join('、')}`,
        severity: mode === 'publish' ? 'warning' : 'error',
        sceneIds: reach.conditionBlockedEndingIds,
        edgeKeys: reach.deadConditionalEdgeKeys,
      });
    }
    if (!reach.truncated && reach.stateEndingTexts.length < 2) {
      issues.push({
        code: 'FEW_STATE_ENDINGS',
        message: `变量可达结局不足：当前 ${reach.stateEndingTexts.length} 个，至少需要 2 个不同结局（在合法选择序列下）`,
        severity: 'error',
        sceneIds: reach.conditionBlockedEndingIds.length
          ? [...reach.stateEndingIds, ...reach.conditionBlockedEndingIds]
          : endings.map(s => s.id),
        edgeKeys: reach.deadConditionalEdgeKeys,
      });
    }
    if (reach.deadConditionalEdgeKeys.length && reach.conditionBlockedEndingIds.length === 0) {
      const dead = reach.deadConditionalEdgeKeys;
      const sceneIds = [...new Set(dead.map(key => key.split(':')[0]!).filter(Boolean))];
      issues.push({
        code: 'DEAD_CONDITIONAL_EDGE',
        message: `有 ${dead.length} 条条件边从未可解锁：${dead.slice(0, 4).join('、')}${dead.length > 4 ? '…' : ''}`,
        severity: 'warning',
        sceneIds,
        edgeKeys: dead,
      });
    }
    if (reach.truncated) {
      issues.push({
        code: 'REACHABILITY_TRUNCATED',
        message: `变量可达分析因状态空间过大被截断（已探索 ${reach.stateCount} 个状态），结果可能不完整`,
        severity: 'warning',
      });
    }
  }

  if (endings.length >= 2) {
    const distinct = new Set(endings.map(scene => scene.ending!.trim()));
    if (distinct.size < 2) {
      issues.push({
        code: 'SAME_ENDING_TEXT',
        message: '结局文案需要至少两个不同文本',
        severity: mode === 'publish' ? 'warning' : 'error',
        sceneIds: endings.map(s => s.id),
      });
    }
  }

  return issues;
}

function graphMetrics(startId: string, byId: Map<string, GraphScene>) {
  let shortestEnding = -1;
  let longestPath = 0;
  let branchScenes = 0;
  const endingPathKeys = new Set<string>();
  const endingsReached = new Set<string>();
  const spineSceneIds = new Set<string>();
  const spineEdgeKeys = new Set<string>();
  let immediateRejoinBranches = 0;
  const fakeBranchSceneIds = new Set<string>();
  const fakeBranchEdgeKeys = new Set<string>();

  const visit = (id: string, depth: number, stack: Set<string>, pathNodes: string[]) => {
    const scene = byId.get(id);
    if (!scene) return;
    longestPath = Math.max(longestPath, depth);
    spineSceneIds.add(id);
    if (scene.ending?.trim()) {
      shortestEnding = shortestEnding < 0 ? depth : Math.min(shortestEnding, depth);
      endingsReached.add(id);
      endingPathKeys.add([...pathNodes, id].join('>'));
      return;
    }
    const targets = [...new Set(scene.choices.map(choice => choice.targetSceneId))];
    if (targets.length >= 2) {
      branchScenes++;
      const nexts = new Set<string>();
      let allNonEnding = true;
      for (const tid of targets) {
        const t = byId.get(tid);
        if (!t) continue;
        if (t.ending?.trim()) {
          allNonEnding = false;
          nexts.add(`end:${t.id}`);
          continue;
        }
        const outs = [...new Set(t.choices.map(c => c.targetSceneId).filter(x => x !== tid))];
        if (outs.length === 1) nexts.add(outs[0]!);
        else nexts.add(`branch:${tid}`);
      }
      if (allNonEnding && nexts.size === 1) {
        immediateRejoinBranches++;
        fakeBranchSceneIds.add(id);
        for (const choice of scene.choices) fakeBranchEdgeKeys.add(`${id}:${choice.id}`);
      }
    }
    for (const choice of scene.choices) {
      spineEdgeKeys.add(`${id}:${choice.id}`);
      if (stack.has(choice.targetSceneId)) {
        longestPath = Math.max(longestPath, depth + 1);
        continue;
      }
      stack.add(choice.targetSceneId);
      visit(choice.targetSceneId, depth + 1, stack, [...pathNodes, id]);
      stack.delete(choice.targetSceneId);
    }
  };
  visit(startId, 0, new Set([startId]), []);

  // Compress paths: keep start, branch points, endings — count unique compressed routes
  const compressed = new Set<string>();
  for (const key of endingPathKeys) {
    const nodes = key.split('>').filter(Boolean);
    const kept: string[] = [];
    for (let i = 0; i < nodes.length; i++) {
      const nid = nodes[i]!;
      const sc = byId.get(nid);
      if (!sc) continue;
      if (sc.ending?.trim() || nid === startId) {
        kept.push(nid);
        continue;
      }
      const outs = new Set(sc.choices.map(c => c.targetSceneId));
      if (outs.size >= 2) kept.push(nid);
    }
    const end = nodes.at(-1);
    if (end) compressed.add(`${kept.filter(n => n !== end).join('>')}>${end}`);
  }

  const reachableEndingCount = endingsReached.size;
  // Distinct routes: different endings OR ≥2 compressed paths that actually diverge
  let distinctRouteCount = 0;
  if (reachableEndingCount >= 2) {
    distinctRouteCount = Math.max(reachableEndingCount, compressed.size);
  } else {
    distinctRouteCount = compressed.size >= 2 ? 1 : reachableEndingCount;
  }

  return {
    shortestEnding,
    longestPath,
    branchScenes,
    reachableEndingCount,
    distinctRouteCount,
    spineSceneIds: [...spineSceneIds],
    spineEdgeKeys: [...spineEdgeKeys],
    immediateRejoinBranches,
    fakeBranchSceneIds: [...fakeBranchSceneIds],
    fakeBranchEdgeKeys: [...fakeBranchEdgeKeys],
  };
}
