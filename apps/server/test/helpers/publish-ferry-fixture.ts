import type {SourceDocument, WorldCondition, WorldContent} from '@novel-game/contracts';
import {ferryWorld} from '../../../../examples/ferry-world.js';

/** Author a longer test adaptation; retain all three original routes and consequences. */
export function publishFerryWorld(source: SourceDocument): WorldContent {
  const world = ferryWorld(source);
  const adapted = {origin: 'adapted' as const, evidence: []};
  const preparation = ['witness-ready', 'cargo-secured', 'route-planned'];
  for (const [i, id] of preparation.entries()) {
    world.facts.push({id, label: ['证人准备完毕', '行李已经系牢', '撤离路线已核对'][i]!,
      description: '渡河前的实际准备', kind: 'event', initialValue: false, playerKnown: true, ...adapted});
    world.actions.push({id, label: ['安顿证人', '系牢行李', '核对撤离路线'][i]!, locationId: 'dock',
      description: '完成出发前的必要准备', availableWhen: [],
      requires: [],
      blockedReason: '先完成上一项准备。', risk: '', timeCost: 1, once: true,
      effects: [{kind: 'set', factId: id, value: true}, {kind: 'reveal', factId: id}],
      text: ['你让证人换上便于走动的鞋子，确认他能跟上脚步。', '你把证人的行李扎紧，防止上船时散落进水。', '你对照水道和关卡位置，给证人交代失散后的会合处。'][i]!, ...adapted});
  }
  const ready: WorldCondition[] = preparation.map(factId => ({kind: 'fact', factId, value: true}));
  for (const id of ['visit-warehouse', 'visit-gate']) world.actions.find(action => action.id === id)!.requires.push(...ready);
  world.timeLimit = 36;
  world.worldRules.push('潮水逐步打开仓库栈桥、关卡水道、小船、公船、商船航道，各航道开放后才能通行。');
  for (const [i, id] of ['visit-warehouse', 'visit-gate', 'boat-cross', 'negotiate', 'caravan-cross'].entries()) {
    const action = world.actions.find(action => action.id === id)!;
    const factId = `waterway-${id}`;
    world.facts.push({id: factId, label: `${action.label}航道已开放`, description: '涨潮后该航道可以通行',
      kind: 'event', initialValue: false, playerKnown: true, ...adapted});
    world.events.push({id: `tide-${i}`, label: `${action.label}通航`, when: [{kind: 'time', atLeast: i + 1}],
      effects: [{kind: 'set', factId, value: true}, {kind: 'reveal', factId}],
      text: `潮水越过第${i + 1}道水标，${action.label}所需的水道已经开放。`, visibility: 'public'});
    action.requires.push({kind: 'fact', factId, value: true});
    action.blockedReason += '还需等到水位足以通航。';
  }
  world.events.find(event => event.id === 'guard-patrol')!.when = [{kind: 'time', atLeast: 30}, {kind: 'fact', factId: 'arrived', value: false}];
  return world;
}
