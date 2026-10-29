import { readFileSync } from 'node:fs';
import { productionBriefSchema, worldContentSchema, type ProductionPlan } from '@novel-game/contracts';

export const testProductionBrief = productionBriefSchema.parse(JSON.parse(readFileSync(new URL('../../../../examples/wulin-waizhuan.production.json', import.meta.url), 'utf8')));

/** Existing engine fixture for workflow tests, not generated Wulin content. */
export function testProductionPlan(chapterIds: string[]): ProductionPlan {
  const world = worldContentSchema.parse(JSON.parse(readFileSync(new URL('../../../../fixtures/s1/shoudeng.batch3.content.json', import.meta.url), 'utf8')));
  world.sourceChapterIds = chapterIds;
  world.playerRole = testProductionBrief.playerRole;
  return {world, bible: {premise: '本规划仅用于验证Agent制作流程，复用已有引擎夹具，并非武林外传生成成果。',
    identityBoundaries: ['必须保持作者指定的玩家角色', '正文不能改变已审阅的玩法规则'],
    cast: ['甲', '乙', '丙'].map(name => ({name, role: '测试配角', relationshipToPlayer: '与玩家有独立关系的配角'})),
    styleGuide: '保持具体可行动的描写，正文与机制分开；测试结果仅证明流程，不证明文学质量。'},
    routes: world.endings.slice(0, 3).map((e, i) => ({id: `route-${i}`, name: `测试路线${i}`, strategy: '通过不同的关系和资源策略推进到已声明的普通结局。', endingIds: [e.id]}))};
}
