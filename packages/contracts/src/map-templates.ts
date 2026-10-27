import { z } from 'zod';
import { WORLD_MAP_MAX_COLS, WORLD_MAP_MAX_ROWS } from './world-map.js';

/**
 * Genre map templates — mirror of stat templates (docs/stat-templates.md): pure data on the shared map substrate.
 * A template only seeds palettes/presets; the runtime and rules never read it. Optional, never auto-picked by genre,
 * apply-to-existing only ADDS missing ids (never renames/removes authored entries).
 */
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const entry = z.object({ id, label: z.string().min(1).max(60), color });

export const mapSizePresetSchema = z.object({
  id: z.enum(['small', 'medium', 'large']), label: z.string().min(1).max(20),
  cols: z.number().int().min(1).max(WORLD_MAP_MAX_COLS), rows: z.number().int().min(1).max(WORLD_MAP_MAX_ROWS),
});
export type MapSizePreset = z.infer<typeof mapSizePresetSchema>;
/** Generic size presets (templates pick one as default). */
export const MAP_SIZE_PRESETS: readonly MapSizePreset[] = [
  { id: 'small', label: '小', cols: 12, rows: 8 },
  { id: 'medium', label: '中', cols: 24, rows: 16 },
  { id: 'large', label: '大', cols: 48, rows: 32 },
].map(p => mapSizePresetSchema.parse(p));

/** Sample conditions are plain data using registered world condition kinds; authors copy them into actions. */
export const mapRuleSnippetSchema = z.object({
  label: z.string().min(1).max(80),
  condition: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('at_terrain'), terrainIds: z.array(id).min(1).max(20) }),
    z.object({ kind: z.literal('in_faction_territory'), factionIds: z.array(id).min(1).max(20) }),
    z.object({ kind: z.literal('in_region'), regionIds: z.array(id).min(1).max(20) }),
  ]),
});

export const mapTemplateSchema = z.object({
  id: z.string().min(1).max(40),
  version: z.number().int().positive(),
  label: z.string().min(1).max(80),
  blurb: z.string().min(1).max(400),
  terrain: z.array(entry).min(1).max(64),
  factions: z.array(entry).max(32),
  /** Region/district presets (city templates: 街区类型). */
  regions: z.array(entry).max(64),
  venueTypes: z.array(z.object({ id, label: z.string().min(1).max(60) })).max(64),
  defaultSize: mapSizePresetSchema.shape.id,
  /** Suggested map hierarchy, outermost first (advisory; sub-maps land later). */
  hierarchy: z.array(z.string().min(1).max(40)).min(1).max(6),
  ruleSnippets: z.array(mapRuleSnippetSchema).max(12),
}).superRefine((t, ctx) => {
  for (const key of ['terrain', 'factions', 'regions', 'venueTypes'] as const) {
    const seen = new Set<string>();
    t[key].forEach((e, i) => { if (seen.has(e.id)) ctx.addIssue({ code: 'custom', message: `duplicate ${key} id: ${e.id}`, path: [key, i, 'id'] }); seen.add(e.id); });
  }
  const has = { terrainIds: new Set(t.terrain.map(e => e.id)), factionIds: new Set(t.factions.map(e => e.id)), regionIds: new Set(t.regions.map(e => e.id)) };
  t.ruleSnippets.forEach((s, i) => {
    const c = s.condition; const [k, ids] = 'terrainIds' in c ? ['terrainIds', c.terrainIds] as const : 'factionIds' in c ? ['factionIds', c.factionIds] as const : ['regionIds', c.regionIds] as const;
    for (const x of ids) if (!has[k].has(x)) ctx.addIssue({ code: 'custom', message: `snippet references unknown ${k} ${x}`, path: ['ruleSnippets', i] });
  });
});
export type MapTemplate = z.infer<typeof mapTemplateSchema>;

const RAW: z.input<typeof mapTemplateSchema>[] = [
  {
    id: 'fantasy_xianxia', version: 1, label: '奇幻 / 仙侠', blurb: '大陆尺度：山川灵脉、秘境与宗门/王国地盘。',
    terrain: [
      { id: 'plains', label: '平原', color: '#c9d58a' }, { id: 'forest', label: '森林', color: '#5f8f4e' },
      { id: 'mountain', label: '山脉', color: '#8c7b6b' }, { id: 'water', label: '江海', color: '#6fa3c9' },
      { id: 'swamp', label: '沼泽', color: '#6f7d55' }, { id: 'desert', label: '荒漠', color: '#e0c27a' },
      { id: 'spirit_vein', label: '灵脉', color: '#9b8bd6' }, { id: 'secret_realm', label: '秘境', color: '#c77fb5' },
    ],
    factions: [
      { id: 'righteous_sect', label: '正道宗门', color: '#3b6fb6' }, { id: 'demonic_sect', label: '魔道', color: '#a8323e' },
      { id: 'mortal_kingdom', label: '凡俗王朝', color: '#c08a2d' },
    ],
    regions: [{ id: 'province', label: '州域', color: '#7a6a4f' }, { id: 'sect_ground', label: '宗门山门', color: '#4f7a6a' }],
    venueTypes: [{ id: 'sect_hall', label: '宗门大殿' }, { id: 'market', label: '坊市' }, { id: 'inn', label: '客栈' }, { id: 'cave_abode', label: '洞府' }, { id: 'ruin', label: '遗迹' }],
    defaultSize: 'medium', hierarchy: ['大陆', '州域', '宗门/城池'],
    ruleSnippets: [
      { label: '只能在灵脉上修炼突破', condition: { kind: 'at_terrain', terrainIds: ['spirit_vein'] } },
      { label: '魔道地盘内正道弟子受限', condition: { kind: 'in_faction_territory', factionIds: ['demonic_sect'] } },
    ],
  },
  {
    id: 'urban_modern', version: 1, label: '都市 / 现代', blurb: '城市尺度：街区功能分区、帮派/公司/警方辖区、场所类型。',
    terrain: [
      { id: 'residential', label: '住宅区', color: '#e3c9a4' }, { id: 'commercial', label: '商业区', color: '#e89a6b' },
      { id: 'industrial', label: '工业区', color: '#9a9488' }, { id: 'docks', label: '码头', color: '#7b8fa3' },
      { id: 'park', label: '公园', color: '#8dbb72' }, { id: 'water', label: '水域', color: '#7fb2d9' },
      { id: 'slum', label: '贫民窟', color: '#a68a6d' },
    ],
    factions: [
      { id: 'gang', label: '帮派', color: '#b0353f' }, { id: 'corporation', label: '公司', color: '#2f6db3' },
      { id: 'police', label: '警方', color: '#2d8a7b' },
    ],
    regions: [
      { id: 'old_town', label: '老城区', color: '#8a5a3c' }, { id: 'cbd', label: '中心商务区', color: '#3c5a8a' },
      { id: 'harbor_district', label: '港区', color: '#3c7a8a' }, { id: 'outskirts', label: '城郊', color: '#6a8a3c' },
    ],
    venueTypes: [
      { id: 'hospital', label: '医院' }, { id: 'police_station', label: '警局' }, { id: 'bar', label: '酒吧' },
      { id: 'safehouse', label: '安全屋' }, { id: 'mall', label: '商场' }, { id: 'office', label: '写字楼' }, { id: 'metro', label: '地铁站' },
    ],
    defaultSize: 'small', hierarchy: ['城市', '街区', '建筑'],
    ruleSnippets: [
      { label: '码头才能接走私活', condition: { kind: 'at_terrain', terrainIds: ['docks'] } },
      { label: '帮派地盘内警方无法介入', condition: { kind: 'in_faction_territory', factionIds: ['gang'] } },
      { label: '老城区才打听得到旧案', condition: { kind: 'in_region', regionIds: ['old_town'] } },
    ],
  },
  {
    id: 'post_apocalyptic', version: 1, label: '末日 / 废土', blurb: '区域尺度：辐射与废墟、安全区与补给点、聚落势力。',
    terrain: [
      { id: 'wasteland', label: '荒原', color: '#c2a878' }, { id: 'ruins', label: '废墟', color: '#8f8579' },
      { id: 'radiation', label: '辐射区', color: '#9fbf3b' }, { id: 'safe_zone', label: '安全区', color: '#6fa58a' },
      { id: 'toxic_water', label: '污染水域', color: '#5f7f6f' }, { id: 'dead_forest', label: '枯林', color: '#6b5d4a' },
    ],
    factions: [
      { id: 'settlement', label: '聚落', color: '#3f78a8' }, { id: 'raiders', label: '掠夺者', color: '#b04030' },
      { id: 'remnant_army', label: '残军', color: '#6f6f3a' },
    ],
    regions: [{ id: 'danger_high', label: '高危区', color: '#a83a3a' }, { id: 'danger_low', label: '低危区', color: '#3aa86a' }],
    venueTypes: [{ id: 'supply_cache', label: '补给点' }, { id: 'shelter', label: '避难所' }, { id: 'outpost', label: '哨站' }, { id: 'trader', label: '商队' }],
    defaultSize: 'medium', hierarchy: ['废土', '区域', '据点'],
    ruleSnippets: [
      { label: '辐射区停留需防护', condition: { kind: 'at_terrain', terrainIds: ['radiation'] } },
      { label: '高危区才会遭遇变异体', condition: { kind: 'in_region', regionIds: ['danger_high'] } },
    ],
  },
];
export const MAP_TEMPLATES: readonly MapTemplate[] = RAW.map(t => mapTemplateSchema.parse(t));
export function getMapTemplate(templateId: string | undefined | null): MapTemplate | undefined { return MAP_TEMPLATES.find(t => t.id === templateId); }
export function mapSizePreset(presetId: MapSizePreset['id']): MapSizePreset { return MAP_SIZE_PRESETS.find(p => p.id === presetId)!; }
