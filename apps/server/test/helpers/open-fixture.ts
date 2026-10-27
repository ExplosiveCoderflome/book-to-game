import type { WorldContent, SourceDocument } from '@novel-game/contracts';
export const source: SourceDocument = {id: 'source', title: '渡口', filename: 'story.txt', encoding: 'utf8',
  chapterCount: 2, charCount: 10, createdAt: '2026-10-10T00:00:00Z', chapters: [
    {id: 'ch1', index: 0, title: '一', paragraphs: [{id: 'p1', index: 0, text: '渡口。'}]},
    {id: 'ch2', index: 1, title: '二', paragraphs: [{id: 'p2', index: 0, text: '秘密。'}]},
  ]};
const adapted = {origin: 'adapted' as const, evidence: []};
export function content(): WorldContent {
  return {schemaVersion: 1, mode: 'open', title: '渡口', premise: '渡河', playerRole: '旅人', goal: '取得通行许可',
    worldRules: ['期限到来前取得许可'], adaptationNotes: '', sourceChapterIds: ['ch1'],
    initialLocationId: 'dock', timeLimit: 6, timeoutEnding: '渡船已经离开。',
    locations: ['dock', 'market', 'gate'].map(id => ({id, title: id, text: `地点 ${id}`, ...adapted})),
    facts: [
      {id: 'permit', label: '许可', description: '渡河许可', kind: 'item', initialValue: false, playerKnown: true, ...adapted},
      {id: 'secret', label: '秘密不可见', description: '秘密真相不可见', kind: 'clue', initialValue: true, playerKnown: false, ...adapted},
      {id: 'bell', label: '钟响', description: '', kind: 'event', initialValue: false, playerKnown: true, ...adapted},
      {id: 'noticed', label: '观察过渡口', description: '', kind: 'event', initialValue: false, playerKnown: true, ...adapted},
    ],
    npcs: [{id: 'keeper', name: '守门人', description: '正在值守', goal: '私有目标不可见', initialLocationId: 'dock', knownFactIds: ['secret'], ...adapted}],
    actions: [
      {id: 'wait', label: '等待', description: '', locationId: 'dock', availableWhen: [], requires: [], blockedReason: '不能等待', risk: '', timeCost: 2, once: false, effects: [{kind: 'set', factId: 'bell', value: false}], text: '你等待片刻。', ...adapted},
      {id: 'ask', label: '请求许可', description: '', locationId: 'dock', npcId: 'keeper', availableWhen: [], requires: [{kind: 'known', factId: 'secret'}, {kind: 'npc_knows', npcId: 'keeper', factId: 'secret'}, {kind: 'fact', factId: 'secret', value: true}], blockedReason: '缺少线索', risk: '', timeCost: 2, once: true, effects: [{kind: 'set', factId: 'permit', value: true}], text: '守门人给予许可。', ...adapted},
      {id: 'search', label: '调查', description: '', locationId: 'dock', availableWhen: [], requires: [], blockedReason: '不能调查', risk: '', timeCost: 1, once: true, effects: [{kind: 'reveal', factId: 'secret'}], text: '你发现了线索。', ...adapted},
      {id: 'look', label: '观察渡口', description: '', locationId: 'dock', availableWhen: [], requires: [], blockedReason: '不能观察', risk: '', timeCost: 1, once: true, effects: [{kind: 'set', factId: 'noticed', value: true}, {kind: 'reveal', factId: 'noticed'}], text: '你看清了渡口的布置。', ...adapted},
      {id: 'to_market', label: '去集市打听', description: '', locationId: 'dock', availableWhen: [], requires: [], blockedReason: '不能离开', risk: '', timeCost: 1, once: false, effects: [{kind: 'move', locationId: 'market'}], text: '你走向集市。', ...adapted},
      {id: 'hidden', label: '隐藏行动不可见', description: '', locationId: 'dock', availableWhen: [{kind: 'fact', factId: 'permit', value: true}], requires: [], blockedReason: '不能操作', risk: '', timeCost: 1, once: false, effects: [{kind: 'move', locationId: 'gate'}], text: '进门。', ...adapted},
    ],
    events: [{id: 'time_bell', label: '钟响', when: [{kind: 'time', atLeast: 2}], effects: [{kind: 'set', factId: 'bell', value: true}], text: '钟声响起。', visibility: 'public'}],
    endings: [{id: 'success', title: '通行', text: '你顺利过河。', when: [{kind: 'fact', factId: 'permit', value: true}]}],
  };
}
