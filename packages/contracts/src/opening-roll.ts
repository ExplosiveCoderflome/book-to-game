import { z } from 'zod';

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
const numericRange = z.union([
  z.number().finite(),
  z.object({min: z.number().finite(), max: z.number().finite()}).refine(v => v.max >= v.min),
]);
const condition = z.discriminatedUnion('kind', [
  z.object({kind: z.literal('atLeast'), resourceId: id, value: z.number().finite()}),
  z.object({kind: z.literal('atMost'), resourceId: id, value: z.number().finite()}),
  z.object({kind: z.literal('range'), resourceId: id, min: z.number().finite(), max: z.number().finite()}).refine(v => v.max >= v.min),
  z.object({kind: z.literal('anyOf'), conditions: z.array(z.object({resourceId: id, atLeast: z.number().finite().optional(), atMost: z.number().finite().optional()})).min(1).max(10)}),
]);
const tagGrantSchema = z.object({facts: z.array(id).max(40).optional(), resources: z.record(id, z.number().finite()).optional(), storylets: z.array(id).max(40).optional(), events: z.array(id).max(40).optional()});
export const openingRollTagSchema = z.object({id, when: condition, grant: tagGrantSchema, label: z.string().min(1).max(120), effect: z.string().min(1).max(300), exclusive: z.string().max(80).optional(), rare: z.boolean().optional()});
const valuesSchema = z.record(id, z.number().finite());
const rollSetSchema = z.object({values: valuesSchema, tags: z.array(id).max(40).optional(), presetId: id.optional(), tierId:id.optional(), tierLabel:z.string().optional(), verdict:z.string().optional()});
const presetSchema = z.object({id, weight: z.number().positive().default(1), values: valuesSchema, tags: z.array(id).max(40).optional()});
const tierSchema = z.object({id, minScore: z.number().finite(), label: z.string().min(1).max(80), verdict: z.string().max(300)});
export const openingRollSchema = z.object({
  enabled: z.boolean().default(false), mode: z.enum(['perStat', 'pointBuy', 'preset']).default('perStat'),
  stats: z.array(z.object({resourceId: id, min: z.number().finite(), max: z.number().finite(), dist: z.enum(['uniform', 'bell', 'skewLow', 'skewHigh']).default('bell'), step: z.number().positive().default(1)})).min(1).max(20),
  pointBuy: z.object({total: numericRange, perStatMin: z.number().finite().optional(), perStatMax: z.number().finite().optional()}).optional(),
  presets: z.array(presetSchema).max(40).optional(), rerolls: z.number().int().min(0).max(20).default(2),
  choice: z.discriminatedUnion('kind', [z.object({kind: z.literal('single')}), z.object({kind: z.literal('pickOf'), n: z.number().int().min(2).max(5)})]).default({kind: 'single'}),
  keepBest: z.boolean().default(true), floor: z.object({minScore: z.number().finite().optional(), minAny: z.number().finite().optional()}).optional(),
  score: z.record(id, z.number().finite()).optional(), tiers: z.array(tierSchema).max(20).default([]), tags: z.array(openingRollTagSchema).max(80).default([]),
  seedPolicy: z.enum(['run', 'fixed']).default('run'), fixedSeed: z.number().int().optional(), lockAfterStart: z.literal(true).default(true),
  standard: rollSetSchema.optional(),
}).superRefine((config, ctx) => {
  if (!config.lockAfterStart) ctx.addIssue({code:'custom',path:['lockAfterStart'],message:'K16 仅支持 lockAfterStart=true'});
  if (config.mode === 'preset' && !config.presets?.length) ctx.addIssue({code:'custom', path:['presets'], message:'preset 模式需要预设套组'});
  if (config.mode === 'pointBuy' && !config.pointBuy) ctx.addIssue({code:'custom', path:['pointBuy'], message:'pointBuy 模式需要点数配置'});
  if (config.seedPolicy === 'fixed' && config.fixedSeed === undefined) ctx.addIssue({code:'custom', path:['fixedSeed'], message:'fixed 种子策略需要 fixedSeed'});
  if (config.mode === 'pointBuy' && config.pointBuy) {
    const total=config.pointBuy.total; const maxTotal=typeof total==='number'?total:total.max;
    const minTotal=typeof total==='number'?total:total.min;
    const minValues=config.stats.reduce((sum,s)=>sum+Math.max(s.min,config.pointBuy!.perStatMin??s.min),0);
    const maxValues=config.stats.reduce((sum,s)=>sum+Math.min(s.max,config.pointBuy!.perStatMax??s.max),0);
    if (maxTotal < minValues || minTotal > maxValues) ctx.addIssue({code:'custom',path:['pointBuy','total'],message:'点数范围与各项上下限不兼容'});
  }
});
export type OpeningRollConfig = z.infer<typeof openingRollSchema>;
export type OpeningRollTag = z.infer<typeof openingRollTagSchema>;
export type OpeningRollSet = z.infer<typeof rollSetSchema>;
export const openingRollCommandSchema = z.discriminatedUnion('command', [
  z.object({command:z.literal('roll')}), z.object({command:z.literal('reroll')}),
  z.object({command:z.literal('select'), index:z.number().int().nonnegative()}),
  z.object({command:z.literal('confirm')}), z.object({command:z.literal('useStandard')}),
]);
export const openingRollCommandWithIdSchema = z.discriminatedUnion('command', [
  z.object({id:z.string(),command:z.literal('roll')}), z.object({id:z.string(),command:z.literal('reroll')}),
  z.object({id:z.string(),command:z.literal('select'),index:z.number().int().nonnegative()}),
  z.object({id:z.string(),command:z.literal('confirm')}), z.object({id:z.string(),command:z.literal('useStandard')}),
]);
export const openingRollCommandInputSchema = z.object({id:z.string(),command:z.enum(['roll','reroll','select','confirm','useStandard']),index:z.number().int().nonnegative().optional()});
export type OpeningRollCommand = z.infer<typeof openingRollCommandSchema>;
export interface OpeningRollSession {seed:number; seedCursor:number; history:OpeningRollSet[]; selectedIndex:number|null; rerollsLeft:number; status:'rolling'|'confirmed'; phase:'opening'|'play'; initialResources?: Record<string,number>}
