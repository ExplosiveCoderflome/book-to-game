import {z} from 'zod';
import {funMetricIdSchema} from './fun-profiles.js';

export const K_FEATURE_IDS = ['K1','K2','K3','K4','K5','K6','K7','K8','K9','K10','K11','K12','K13','K14','K15','K16'] as const;
export const engineBlockContractSchema = z.object({
  features: z.array(z.enum(K_FEATURE_IDS)).min(1),
  category: z.enum(['stat','time','story','actor','space','economy','conflict','ending','present','ai']),
  reads: z.array(z.string().min(1)),
  writes: z.array(z.object({state: z.string().min(1), maxChange: z.union([z.number().nonnegative(), z.enum(['declared-resource-range','configured-clock-limit','configured-hand','one-choice','seeded-step','one-ending'])])}).strict()),
  hooks: z.array(z.enum(['onStart','onTurn','onTimeAdvance','onAction','onEnter','onEnding','onLoad'])).min(1),
  compileTo: z.array(z.string().min(1)).min(1),
  checks: z.array(funMetricIdSchema), playerUi: z.array(z.string().min(1)),
  example: z.string().min(1).max(2000), profiles: z.array(z.string()), pitfalls: z.array(z.string().min(1)).min(1),
}).strict().superRefine((value, ctx) => {
  if (value.hooks.includes('onLoad') && value.writes.length) ctx.addIssue({code: 'custom', message: 'onLoad is read-only'});
  if (new Set(value.features).size !== value.features.length) ctx.addIssue({code: 'custom', message: 'duplicate K feature'});
});
export type EngineBlockContract = z.infer<typeof engineBlockContractSchema>;
type Descriptor = Omit<EngineBlockContract, 'checks'>;
/** These are declarations of the EXISTING engine paths, never a second interpreter/state machine. */
export const K_BLOCK_CONTRACTS: Readonly<Record<string, Descriptor>> = {
  'stat-templates': {
    features: ['K1','K2','K5','K10'], category: 'stat', reads: ['resourceDefs','resources','facts'],
    writes: [{state: 'resources', maxChange: 'declared-resource-range'},{state: 'resourceMax', maxChange: 'declared-resource-range'}],
    hooks: ['onStart','onAction','onTurn'], compileTo: ['resourceDefs','resources','conditions.resource','conditions.anyOf','effects.resource_max'], playerUi: ['resource-display'],
    example: '{"resourceDefs":{"energy":{"label":"精力","min":0,"max":10,"initial":5,"display":"bar"}}}', profiles: ['default','pressure','grinding'],
    pitfalls: ['每个资源效果后按已声明边界钳制；onMin/onMax 只在跨越边界时触发；anyOf 不得嵌套。'],
  },
  clock: {
    features: ['K3','K11'], category: 'time', reads: ['clock','elapsed','resources'], writes: [{state: 'elapsed', maxChange: 'configured-clock-limit'},{state:'resources',maxChange:'declared-resource-range'}],
    hooks: ['onTimeAdvance'], compileTo: ['clock','conditions.clock'], playerUi: ['clock-display'],
    example: '{"clock":{"unit":"month","startYear":1,"startMonth":1,"display":"年月","limitMonths":24,"rules":[],"windows":[]}}', profiles: ['healing','pressure'],
    pitfalls: ['跨多个周期必须逐次结算；月条件使用已过月数；已有 clock 时不另建 timeLimit 状态机。'],
  },
  'storylet-pool': {
    features: ['K4','K6','K7','K8'], category: 'story', reads: ['storylets','storyletRules','storyletState','resources','facts'],
    writes: [{state:'hand',maxChange:'configured-hand'},{state:'storyletState',maxChange:'one-choice'},{state:'resources',maxChange:'declared-resource-range'},{state:'elapsed',maxChange:120}],
    hooks: ['onTurn','onAction','onEnter'], compileTo: ['storyletRules','storylets','conditions.storylet_seen'], playerUi: ['storylet-hand'],
    example: '{"storyletRules":{"handSize":3,"refreshOn":["move","clock"]}}', profiles: ['collection','default'],
    pitfalls: ['availableWhen 隐藏、requires 禁用；timeCost=0 仍进入冷却；重复计数是打出次数。'],
  },
  encounters: {
    features: ['K9'], category: 'conflict', reads: ['resources','facts','rng'], writes: [{state:'rng',maxChange:'seeded-step'},{state:'resources',maxChange:'declared-resource-range'},{state:'facts',maxChange:'one-choice'}],
    hooks: ['onAction'], compileTo: ['effects.roll'], playerUi: ['chance-display'],
    example: '{"kind":"roll","chance":{"base":0.5,"mods":[],"min":0,"max":1},"success":[],"failure":[],"successText":"通过","failureText":"未通过","showChance":true}', profiles: [],
    pitfalls: ['复用已有 seeded RNG 和 roll 分支；不声称新增独立战斗引擎；概率必须钳制。'],
  },
  'world-map': {
    features: ['K12'], category: 'space', reads: ['locations','resources','facts'], writes: [], hooks: ['onEnter'], compileTo: ['locations.textVariants'], playerUi: ['location-view'],
    example: '{"textVariants":[{"when":[{"kind":"resource","resourceId":"energy","atLeast":1}],"text":"暮色中的渡口。"}]}', profiles: ['collection','default'],
    pitfalls: ['取第一条命中的变体；未命中回退原 text，不修改地点或状态。'],
  },
  'endings-recap': {
    features: ['K10','K13','K15'], category: 'ending', reads: ['endings','recap','resources','facts','storyletState'], writes: [{state:'ending',maxChange:'one-ending'}],
    hooks: ['onEnding'], compileTo: ['endings','recap','effects.ending'], playerUi: ['ending-page'],
    example: '{"recap":[{"id":"journey","when":[],"text":"你记住了这段旅程。","order":1}]}', profiles: [],
    pitfalls: ['空 when 是效果触发式结局；附加段落和回顾写入既有结束快照，读档不得重新计算。'],
  },
  'state-snapshot': {
    features: ['K14'], category: 'present', reads: ['rng','hand','storyletState','resourceMax','clockFired'], writes: [], hooks: ['onLoad'], compileTo: ['AdventureState.rng','AdventureState.hand','AdventureState.storyletState','AdventureState.resourceMax','AdventureState.clockFired'], playerUi: [],
    example: '{"schemaVersion":1,"rng":{"seed":1,"cursor":0},"hand":[],"storyletState":{"seen":{},"lastTurn":{},"lastVariant":{}},"resourceMax":{},"clockFired":0}', profiles: [],
    pitfalls: ['仅登记现有存档契约，onLoad 只读；保留快照中的 RNG 游标和结局结果，不重掷或重算。'],
  },
  'opening-roll': {
    features: ['K16'], category: 'actor', reads: ['openingRoll','resourceDefs','facts'], writes: [{state:'resources',maxChange:'declared-resource-range'},{state:'rng',maxChange:'seeded-step'}],
    hooks: ['onStart'], compileTo: ['openingRoll'], playerUi: ['opening-roll-page'],
    example: '{"enabled":true,"mode":"perStat","rerolls":2,"stats":[{"resourceId":"energy","min":1,"max":6}]}', profiles: [],
    pitfalls: ['仅使用已声明资源；重掷次数受现有 schema 限制；确认后保存既有状态，不另建随机状态机。'],
  },
};
