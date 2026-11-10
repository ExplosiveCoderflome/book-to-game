import {worldContentSchema, type WorldContent} from '@novel-game/contracts';
import {content} from './open-fixture.js';

/** A valid rule-only repair fixture: scarce departure card competes with repeat work. */
export function repairWeightWorld(): WorldContent {
  const world = content();
  world.title = '渡口发船权重修复';
  world.timeLimit = 30;
  world.npcs = [];
  world.events = [];
  world.facts = [];
  world.endings = [{id: 'coop', title: '合力渡河', text: '船工收妥货物，大家合力把船推离岸边。', when: []}];
  world.actions = ['work', 'tie', 'count'].map((id, i) => ({...world.actions[0]!, id,
    label: ['整理货物', '系紧缆绳', '核对货单'][i]!, timeCost: 1, once: false,
    effects: [{kind: 'resource' as const, resourceId: 'cargo', delta: 1}], text: `你完成第${i + 1}项装船准备。`}));
  world.resourceDefs = {cargo: {label: '备货', initial: 0, min: 0, max: 100, display: 'number'}};
  world.storyletRules = {handSize: 1};
  world.storylets = [{id: 'departure', title: '船工招呼', kind: 'repeat',
    when: [{kind: 'resource', resourceId: 'cargo', atLeast: 5}], weight: {base: 0.1},
    text: '船工终于腾出了船位，招呼你一起搬上最后一批货物。',
    choices: [{id: 'cross', label: '合力发船', timeCost: 1, effects: [{kind: 'ending', endingId: 'coop'}], text: '大家合力发船渡河。'}]},
    ...Array.from({length: 4}, (_, i) => ({id: `cargo_${i}`, title: `整理第${i + 1}批货物`, kind: 'repeat' as const,
      repeat: {cooldownTurns: 0}, weight: {base: 10}, text: `你核对第${i + 1}批货物的数目，把散开的绳结重新系紧。`,
      choices: [{id: 'work', label: '拆包复核', timeCost: 1,
        effects: [{kind: 'resource' as const, resourceId: 'cargo', delta: -1}], text: '你拆开一批货物重新复核，暂时减少了已备好的货物。'}]}))];
  return worldContentSchema.parse(world);
}
