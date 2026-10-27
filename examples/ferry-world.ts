import type { SourceDocument, WorldContent, WorldCondition, WorldEffect } from '@novel-game/contracts';

/** Original hand-authored example; never used as a fallback for model generation. */
export function ferryWorld(source: SourceDocument): WorldContent {
  const chapter = source.chapters[0];
  const adapted = {origin: 'adapted' as const, evidence: []};
  const fact = (id: string, label: string, kind: 'item' | 'clue' | 'relationship' | 'event', initialValue = false, playerKnown = false) =>
    ({id, label, description: label, kind, initialValue, playerKnown, ...adapted});
  const is = (factId: string, value = true): WorldCondition => ({kind: 'fact', factId, value});
  const set = (factId: string, value = true): WorldEffect => ({kind: 'set', factId, value});
  const reveal = (factId: string): WorldEffect => ({kind: 'reveal', factId});
  const move = (locationId: string): WorldEffect => ({kind: 'move', locationId});
  const action = (id: string, label: string, locationId: string, text: string, effects: WorldEffect[],
    requires: WorldCondition[] = [], extras: Partial<WorldContent['actions'][number]> = {}): WorldContent['actions'][number] =>
    ({id, label, locationId, text, effects, requires, availableWhen: [], description: label, timeCost: 1,
      blockedReason: '还没有准备好所需条件。', risk: '', once: true, ...adapted, ...extras});
  return {
    schemaVersion: 1, mode: 'open', title: '封港前的渡口', playerRole: '护送证人的抄写员',
    premise: '天黑前港口将封锁。你必须带着证人抵达对岸，渡口上的人各有所求。', goal: '封港前带证人过河，并决定愿意付出什么代价。',
    worldRules: ['每次行动消耗标明的时间；查看记录不消耗时间。', '修船需要材料；谈判需要可核对的证据；商队只帮助愿意偿还人情的人。'],
    adaptationNotes: '原创教学样例。三种过河策略分别留下信任、暴露身份或人情债；地点可往返。',
    sourceChapterIds: source.chapters.map(c => c.id), initialLocationId: 'dock', timeLimit: 12,
    timeoutEnding: '封港钟响，船只停航。证人藏进沿岸村落，你们暂时失去了过河的机会。',
    locations: [
      {id: 'dock', title: '渡口', text: '小船系在栈桥旁，证人站在你的身边。北边是仓库，东边是关卡。', origin: 'source', evidence: [{chapterId: chapter.id, paragraphId: chapter.paragraphs[0].id}]},
      {id: 'warehouse', title: '旧仓库', text: '屋檐下放着废木板，商队正在整理货物。门后堆着渡口旧账册。', ...adapted},
      {id: 'gate', title: '关卡', text: '守卫检查通行证。告示上写着天黑封港，脚步声越来越密。', ...adapted},
      {id: 'shore', title: '对岸', text: '水声渐远，证人终于摘下斗篷。你们怎样过河，会决定之后的处境。', ...adapted},
    ],
    facts: [fact('timber', '修船材料', 'item'), fact('ledger', '能核对的账册证据', 'clue'), fact('trusted', '船夫愿意信任你', 'relationship'),
      fact('exposed', '身份已被守卫登记', 'event'), fact('debt', '欠商队一次人情', 'relationship'), fact('arrived', '证人已到对岸', 'event'),
      fact('secret', '幕后联系人是北城管事', 'clue', true), fact('warning', '封港将近', 'event'), fact('surveyed', '已观察渡口', 'event', false, true)],
    npcs: [
      {id: 'boatman', name: '船夫', description: '他珍惜自己的旧船，也记得帮助过他的人。', goal: '修好船并避开追查', initialLocationId: 'dock', knownFactIds: [], ...adapted},
      {id: 'merchant', name: '商队领队', description: '她的船有空位，但她会记住每一笔人情。', goal: '为下次运输找到可靠帮手', initialLocationId: 'warehouse', knownFactIds: [], ...adapted},
      {id: 'guard', name: '守卫', description: '他不断核对名单，十分在意自己的差事。', goal: '掩盖自己与北城管事的来往', initialLocationId: 'gate', knownFactIds: ['secret'], ...adapted},
    ],
    actions: [
      action('visit-warehouse', '前往旧仓库', 'dock', '你沿屋檐走进旧仓库。', [move('warehouse')], [], {once: false}),
      action('visit-gate', '前往关卡', 'dock', '你带着证人走向关卡。', [move('gate')], [], {once: false}),
      action('survey-dock', '观察渡口局势', 'dock', '你记下栈桥、仓库与关卡的方位，证人稍稍安心。', [set('surveyed'), reveal('surveyed')], [], {once: true}),
      action('return-dock', '返回渡口', 'warehouse', '你回到漏水的小船旁。', [move('dock')], [], {once: false}),
      action('leave-gate', '退回渡口', 'gate', '你暂时离开守卫的视线。', [move('dock')], [], {once: false}),
      action('collect-timber', '收集废木板', 'warehouse', '你挑出几块能用的木板，正好够修补船底。', [set('timber'), reveal('timber')]),
      action('read-ledger', '调查旧账册', 'warehouse', '账册记着关卡的不明收费。这是可以与守卫谈判的证据。', [set('ledger'), reveal('ledger')]),
      action('repair-boat', '帮船夫修船', 'dock', '船夫接过材料，一起补好了漏口。他愿意秘密送你们过河。',
        [set('timber', false), set('trusted'), reveal('trusted')], [is('timber')], {npcId: 'boatman', blockedReason: '需要先找到修船材料。'}),
      action('boat-cross', '请船夫送你们过河', 'dock', '船夫划进薄雾，你和证人没有留下姓名。',
        [move('shore'), set('arrived'), reveal('arrived')], [is('trusted')], {npcId: 'boatman', blockedReason: '船还没有修好，船夫也尚未答应帮助。'}),
      action('negotiate', '出示账册，与守卫谈判', 'gate', '守卫终于放行，但坚持登记你和证人的姓名。你们乘公船抵达对岸。',
        [set('exposed'), reveal('exposed'), {kind: 'npc_learn', npcId: 'guard', factId: 'ledger'}, move('shore'), set('arrived'), reveal('arrived')],
        [is('ledger')], {npcId: 'guard', risk: '这条路会暴露你和证人的身份。', blockedReason: '需要先找到能够核对的账册证据。'}),
      action('promise-help', '答应下次替商队护送货物', 'warehouse', '领队记下约定，指了指船上的空位。',
        [set('debt'), reveal('debt')], [], {npcId: 'merchant', risk: '你将欠下商队一次人情。'}),
      action('caravan-cross', '随商队过河', 'warehouse', '你和证人坐进货船。领队提醒你不要忘记约定。',
        [move('shore'), set('arrived'), reveal('arrived')], [is('debt')], {npcId: 'merchant', blockedReason: '商队需要你先作出互助承诺。'}),
    ],
    events: [{id: 'closing-warning', label: '封港预警', when: [{kind: 'time', atLeast: 5}], effects: [set('warning'), reveal('warning')],
      text: '关卡传来第一次钟声。封港的时刻快到了。', visibility: 'public'},
      {id: 'guard-patrol', label: '守卫巡视', when: [{kind: 'time', atLeast: 8}, is('arrived', false)], effects: [{kind: 'npc_move', npcId: 'guard', locationId: 'dock'}],
        text: '守卫离开关卡，走到渡口巡视。关卡暂时无人处理通行申请。', visibility: 'public'}],
    endings: [
      {id: 'quiet-crossing', title: '薄雾中的盟友', text: '证人安全抵岸，船夫成为你们可信赖的盟友。', when: [is('arrived'), is('trusted')]},
      {id: 'named-crossing', title: '留下姓名的通行', text: '你们完成了护送，但追查者可能沿着登记找到你们。', when: [is('arrived'), is('exposed')]},
      {id: 'promised-crossing', title: '有待偿还的约定', text: '证人渡过了河，你的人生多了一笔尚未偿还的人情。', when: [is('arrived'), is('debt')]},
    ],
  };
}
