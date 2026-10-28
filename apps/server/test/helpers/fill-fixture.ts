import type { LocalPlacementOverrides, WorldContent } from '@novel-game/contracts';

const adapted = { origin: 'adapted' as const, evidence: [] };

/**
 * P1/P2 demo world: market with shop (≥1 true-price + 1 expensive lock) + supply (bound target)
 * + quest (accept + optional deliver). Starting coin=5 buys dry_ration (2) once; spirit_sand (9) locked.
 */
export function fillDemoWorld(): WorldContent {
  return {
    schemaVersion: 1,
    mode: 'open',
    title: '盐沼集市·填充试玩',
    premise: '在已确认地图上买、补、接，并处理遭遇',
    playerRole: '行脚商',
    goal: '备好干粮并接下码头悬赏',
    worldRules: ['通货不足则买不起', '补给恢复体力'],
    adaptationNotes: 'P1 fill fixture',
    sourceChapterIds: ['ch1'],
    initialLocationId: 'market',
    timeLimit: 20,
    timeoutEnding: '天色已晚，集市打烊。',
    resources: { coin: 5, hp: 3 },
    locations: [
      { id: 'market', title: '盐沼集市', text: '摊贩支起布棚，盐腥与炊烟混在一起。杂货铺、打尖棚和告示柱都在附近。', ...adapted },
      { id: 'dock', title: '码头', text: '木桩浸在浑水里，缆绳吱呀作响。沼岸有伏击的痕迹。', ...adapted },
      { id: 'gate', title: '镇口', text: '石牌坊投下窄影。', ...adapted },
      { id: 'marsh', title: '潮汐浅滩', text: '退潮露出黑泥与残骸，远处水雾里有巨影。', ...adapted },
    ],
    facts: [
      { id: 'own_dry_ration', label: '干粮', description: '一袋够吃一日的干粮', kind: 'item', initialValue: false, playerKnown: true, ...adapted },
      { id: 'own_spirit_sand', label: '灵砂', description: '细亮的砂粒', kind: 'item', initialValue: false, playerKnown: true, ...adapted },
      { id: 'quest_dock_accepted', label: '码头悬赏', description: '已接取码头悬赏', kind: 'event', initialValue: false, playerKnown: true, ...adapted },
      { id: 'has_wolf_ear', label: '狼耳证物', description: '交付悬赏所需', kind: 'item', initialValue: false, playerKnown: true, ...adapted },
      { id: 'quest_dock_done', label: '悬赏已结', description: '码头悬赏已交付', kind: 'event', initialValue: false, playerKnown: true, ...adapted },
      { id: 'noticed_market', label: '打量过集市', description: '', kind: 'event', initialValue: false, playerKnown: true, ...adapted },
      { id: 'own_salt_shard', label: '盐袋碎片', description: '遭遇掉落的盐晶碎片', kind: 'item', initialValue: false, playerKnown: true, ...adapted },
      { id: 'own_tide_pearl', label: '潮汐珠', description: 'Boss 掉落的潮珠', kind: 'item', initialValue: false, playerKnown: true, ...adapted },
      { id: 'enc_engaged_pl_enc_marsh', label: '沼岸开战', description: '', kind: 'event', initialValue: false, playerKnown: true, ...adapted },
      { id: 'enc_resolved_pl_enc_marsh', label: '沼岸了结', description: '', kind: 'event', initialValue: false, playerKnown: true, ...adapted },
      { id: 'enc_fled_pl_enc_marsh', label: '沼岸撤离', description: '', kind: 'event', initialValue: false, playerKnown: true, ...adapted },
      { id: 'enc_engaged_pl_enc_empty', label: '空遭遇开战', description: '', kind: 'event', initialValue: false, playerKnown: true, ...adapted },
      { id: 'enc_resolved_pl_enc_empty', label: '空遭遇了结', description: '', kind: 'event', initialValue: false, playerKnown: true, ...adapted },
      { id: 'enc_fled_pl_enc_empty', label: '空遭遇撤离', description: '', kind: 'event', initialValue: false, playerKnown: true, ...adapted },
      { id: 'enc_engaged_pl_boss_tide', label: '潮汐开战', description: '', kind: 'event', initialValue: false, playerKnown: true, ...adapted },
      { id: 'enc_resolved_pl_boss_tide', label: '潮汐了结', description: '', kind: 'event', initialValue: false, playerKnown: true, ...adapted },
      { id: 'enc_fled_pl_boss_tide', label: '潮汐撤离', description: '', kind: 'event', initialValue: false, playerKnown: true, ...adapted },
      { id: 'enc_defeated_pl_boss_tide', label: '击败潮汐巨兽', description: '', kind: 'event', initialValue: false, playerKnown: true, ...adapted },
    ],
    npcs: [
      { id: 'keeper', name: '摊主', description: '正在记账', goal: '多卖一件', initialLocationId: 'market', knownFactIds: [], ...adapted },
    ],
    actions: [
      {
        id: 'look_market', label: '打量集市', description: '', locationId: 'market',
        availableWhen: [], requires: [], blockedReason: '不能观察', risk: '', timeCost: 1, once: true,
        effects: [{ kind: 'set', factId: 'noticed_market', value: true }, { kind: 'reveal', factId: 'noticed_market' }],
        text: '你看清了摊位布局。', ...adapted,
      },
      {
        id: 'to_dock', label: '前往码头', description: '', locationId: 'market',
        availableWhen: [], requires: [], blockedReason: '不能离开', risk: '', timeCost: 1, once: false,
        effects: [{ kind: 'move', locationId: 'dock' }], text: '你走向码头。', ...adapted,
      },
      {
        id: 'to_market', label: '返回集市', description: '', locationId: 'dock',
        availableWhen: [], requires: [], blockedReason: '不能返回', risk: '', timeCost: 1, once: false,
        effects: [{ kind: 'move', locationId: 'market' }], text: '你回到集市。', ...adapted,
      },
      {
        id: 'to_gate', label: '前往镇口', description: '', locationId: 'market',
        availableWhen: [], requires: [], blockedReason: '不能离开', risk: '', timeCost: 1, once: false,
        effects: [{ kind: 'move', locationId: 'gate' }], text: '你走向镇口。', ...adapted,
      },
      {
        id: 'from_gate', label: '返回集市', description: '', locationId: 'gate',
        availableWhen: [], requires: [], blockedReason: '不能返回', risk: '', timeCost: 1, once: false,
        effects: [{ kind: 'move', locationId: 'market' }], text: '你回到集市。', ...adapted,
      },
      {
        id: 'find_ear', label: '搜寻证物', description: '', locationId: 'dock',
        availableWhen: [{ kind: 'fact', factId: 'quest_dock_accepted', value: true }],
        requires: [], blockedReason: '没有线索', risk: '', timeCost: 1, once: true,
        effects: [
          { kind: 'set', factId: 'has_wolf_ear', value: true },
          { kind: 'reveal', factId: 'has_wolf_ear' },
        ],
        text: '你在缆桩旁捡到一只狼耳证物。', ...adapted,
      },
      {
        id: 'to_marsh', label: '前往潮汐浅滩', description: '', locationId: 'dock',
        availableWhen: [], requires: [], blockedReason: '不能离开', risk: '', timeCost: 1, once: false,
        effects: [{ kind: 'move', locationId: 'marsh' }], text: '你走向潮汐浅滩。', ...adapted,
      },
      {
        id: 'from_marsh', label: '返回码头', description: '', locationId: 'marsh',
        availableWhen: [], requires: [], blockedReason: '不能返回', risk: '', timeCost: 1, once: false,
        effects: [{ kind: 'move', locationId: 'dock' }], text: '你回到码头。', ...adapted,
      },
    ],
    events: [],
    endings: [
      {
        id: 'ready', title: '备妥启程', text: '干粮在袋，悬赏了结，你可以上路了。',
        when: [
          { kind: 'fact', factId: 'own_dry_ration', value: true },
          { kind: 'fact', factId: 'quest_dock_done', value: true },
        ],
      },
    ],
    map: {
      mapSchemaVersion: 1,
      geometry: { kind: 'hex', orientation: 'pointy', cols: 6, rows: 4, size: 28 },
      layers: {},
      pois: [
        { locationId: 'market', anchor: { cell: '2,2' } },
        { locationId: 'dock', anchor: { cell: '3,2' } },
        { locationId: 'gate', anchor: { cell: '1,2' } },
        { locationId: 'marsh', anchor: { cell: '4,2' } },
      ],
      structureLocked: true,
      structureLockedAt: '2026-10-28T00:00:00.000Z',
      fill: {
        placements: [
          {
            id: 'pl_shop',
            kind: 'shop',
            locationId: 'market',
            label: '盐沼杂货铺',
            localOverrides: {
              label: '盐沼杂货铺',
              shop: {
                shelf: [
                  { itemId: 'dry_ration', labelOverride: '干粮', price: { resourceId: 'coin', amount: 2 }, stockMax: 2 },
                  { itemId: 'spirit_sand', labelOverride: '灵砂', price: { resourceId: 'coin', amount: 9 }, stockMax: 1 },
                ],
              },
            },
          },
          {
            id: 'pl_shop_empty',
            kind: 'shop',
            locationId: 'gate',
            label: '歇业铺面',
            localOverrides: {
              label: '歇业铺面',
              shop: { shelf: [] },
            },
          },
          {
            id: 'pl_supply',
            kind: 'supply',
            locationId: 'market',
            label: '打尖棚',
            localOverrides: {
              label: '打尖棚',
              supply: {
                recipes: [
                  {
                    id: 'rest_meal',
                    label: '打尖',
                    target: { kind: 'resource', name: 'hp', roleHint: 'heal_light' },
                    amount: 2,
                    cost: { resourceId: 'coin', amount: 1 },
                    uses: { perVisit: 2 },
                  },
                ],
              },
            },
          },
          {
            id: 'pl_quest',
            kind: 'quest',
            locationId: 'market',
            label: '告示柱',
            localOverrides: {
              label: '告示柱',
              quest: {
                slots: [
                  {
                    label: '码头悬赏',
                    marker: 'quest_dock_accepted',
                    acceptFactId: 'quest_dock_accepted',
                    turnInRequiresFactId: 'has_wolf_ear',
                    rewards: {
                      resources: [{ resourceId: 'coin', amount: 4 }],
                      flags: ['quest_dock_done'],
                    },
                  },
                ],
              },
            } as unknown as LocalPlacementOverrides,
          },
          {
            id: 'pl_quest_empty',
            kind: 'quest',
            locationId: 'dock',
            label: '空告示',
            localOverrides: {
              label: '空告示',
              quest: { slots: [] },
            },
          },
          {
            id: 'pl_enc_marsh',
            kind: 'encounter',
            locationId: 'dock',
            label: '沼岸伏击',
            localOverrides: {
              label: '沼岸伏击',
              encounter: {
                loot: [
                  {
                    itemId: 'salt_shard',
                    qty: 1,
                    chance: 1,
                    resourceDrops: [{ resourceId: 'coin', amount: 1 }],
                  },
                ],
                fleeCost: { resourceId: 'hp', amount: 1 },
                riskFight: '中',
              },
            } as unknown as LocalPlacementOverrides,
          },
          {
            id: 'pl_enc_empty',
            kind: 'encounter',
            locationId: 'gate',
            label: '荒径异响',
            localOverrides: {
              label: '荒径异响',
              encounter: {
                loot: [],
                fleeCost: { resourceId: 'hp', amount: 1 },
                riskFight: '低',
              },
            } as unknown as LocalPlacementOverrides,
          },
          {
            id: 'pl_boss_tide',
            kind: 'boss',
            locationId: 'marsh',
            label: '潮汐巨兽',
            localOverrides: {
              label: '潮汐巨兽',
              encounter: {
                boss: true,
                loot: [
                  {
                    itemId: 'tide_pearl',
                    qty: 1,
                    chance: 1,
                    resourceDrops: [{ resourceId: 'coin', amount: 3 }],
                  },
                ],
                fleeCost: { resourceId: 'hp', amount: 2 },
                riskFight: '高',
                defeatFactId: 'enc_defeated_pl_boss_tide',
              },
            } as unknown as LocalPlacementOverrides,
          },
        ],
      },
    },
  };
}
