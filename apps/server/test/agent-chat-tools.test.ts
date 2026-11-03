import assert from 'node:assert/strict';
import { test } from 'node:test';
import { z } from 'zod';
import { agentChatCommandMetadata, createAgentChatTools, type AgentChatCommandState } from '../src/app/agent-chat-tools.js';
import type { Command } from '../src/app/commands/definition.js';
import { AgentChatService, SqliteChatRepository } from '../src/modules/agent/index.js';
import { openDatabase } from '../src/platform/database.js';

const automaticCommands = [
  'runtime_info', 'list_sources', 'read_source', 'list_jobs', 'read_job', 'check_job_plan',
  'list_world_drafts', 'read_world_draft', 'get_world_preflight', 'validate_world_draft',
  'lint_world_draft', 'playtest_world_draft', 'propose_map_fill', 'propose_clock_patch', 'propose_storylet_patch',
  'propose_end_conditions', 'propose_fun_profile', 'recommend_blocks_for_profile',
  'agent_status', 'list_agent_decisions', 'list_agent_repairs', 'create_agent_repair', 'list_drafts', 'get_draft',
  'validate_draft', 'lint_draft', 'list_world_revisions', 'list_games', 'list_blocks', 'list_fun_profiles',
  'list_genre_recipes',
];

const confirmationCases: Array<{
  name: string;
  args: Record<string, unknown>;
  summary: string;
  versionCheck: 'none' | 'version' | 'updatedAt';
  guard?: string;
}> = [
  {name: 'create_generation_job', args: {sourceId: 'source-1', requestId: 'request-1', mode: 'story',
    direction: '尊重原作世界规则，设计一次有明确选择后果的短篇冒险', playerRole: '守灯人', chapterIds: ['chapter-1', 'chapter-2']}, versionCheck: 'none',
    summary: '创建改编任务：模式：分支故事；方向：尊重原作世界规则，设计一次有明确选择后果的短篇冒险；身份：守灯人；章节：2章'},
  {name: 'create_production_job', args: {requestId: 'request-2', brief: {
    title: '雾港·三门之夜', playerRole: '守灯人', goal: '在天亮前找出失踪的守夜人', tone: '潮湿压抑的悬疑', tier: 'S',
    setting: '雾港的灯塔在午夜熄灭，港务局封锁了所有出口，只有巡夜人知道三扇门通向哪里。',
  }}, versionCheck: 'none',
    summary: '创建角色扮演制作任务：「雾港·三门之夜」；身份：守灯人；目标：在天亮前找出失踪的守夜人；基调：潮湿压抑的悬疑；体量：S；设定：雾港的灯塔在午夜熄灭，港务局封锁了所有出口，只有巡夜人知道三扇门通向哪里。'},
  {name: 'retry_job', args: {id: 'job-1'}, versionCheck: 'updatedAt', guard: '2026-10-30T00:00:00.000Z',
    summary: '恢复生成任务：任务 job-1（awaiting_review，production）'},
  {name: 'cancel_job', args: {id: 'job-1'}, versionCheck: 'updatedAt', guard: '2026-10-30T00:00:00.000Z',
    summary: '取消生成任务：任务 job-1（awaiting_review，production）'},
  {name: 'rewrite_production_unit', args: {id: 'job-1', unit: 'location:harbor', instruction: '加强冲突'}, versionCheck: 'updatedAt', guard: '2026-10-30T00:00:00.000Z',
    summary: '重写指定正文：任务 job-1（awaiting_review，production）'},
  {name: 'approve_saved_production_plan', args: {id: 'job-1', expectedUpdatedAt: '2026-10-30T00:00:00.000Z'}, versionCheck: 'updatedAt', guard: '2026-10-30T00:00:00.000Z',
    summary: '确认「雾港」当前玩法并开始正文生成：扮演守灯人；2张剧情卡、1个行动；路线：灯塔线、港湾区。将使用配置的模型产生费用，不发布游戏。'},
  {name: 'apply_agent_repair', args: {id: 'repair-1'}, versionCheck: 'none',
    summary: '应用修复候选：repair-1'},
  {name: 'reject_agent_repair', args: {id: 'repair-1'}, versionCheck: 'none',
    summary: '驳回修复候选：repair-1'},
  {name: 'publish_world_draft', args: {id: 'world-1', version: 3}, versionCheck: 'version', guard: '3',
    summary: '发布世界版本：「旧标题」v3'},
  {name: 'publish_draft', args: {id: 'game-1', version: 4}, versionCheck: 'version', guard: '4',
    summary: '发布「游戏草稿」v4'},
  {name: 'edit_world_summary', args: {id: 'world-1', version: 3, title: '新标题', premise: '新背景'}, versionCheck: 'version', guard: '3',
    summary: '修改世界摘要：「旧标题」v3；标题: "旧标题" → "新标题"；背景: "旧背景" → "新背景"'},
  {name: 'apply_world_patch', args: {worldDraftId: 'world-1', version: 3, changes: [
    {path: 'clock.unit', op: 'replace', after: 'day'},
    {path: 'storylets.card.title', op: 'replace', after: '新卡'},
    {path: 'storylets.card.text', op: 'replace', after: '新正文'},
    {path: 'clock.limitMonths', op: 'replace', after: 30},
  ]}, versionCheck: 'version', guard: '3',
    summary: '应用世界补丁：「旧标题」v3；4 项：replace clock.unit、replace storylets.card.title、replace storylets.card.text……'},
  {name: 'apply_end_conditions', args: {worldDraftId: 'world-1', version: 3, acknowledgeReshape: true,
    selection: {kind: 'package', packageId: 'standard', win: [{id: 'win_progress', label: '进度推满', when: [{kind: 'resource', resourceId: 'qi', atLeast: 10}]}],
      lose: [{id: 'lose_pressure', label: '压力见底', when: [{kind: 'resource', resourceId: 'qi', atMost: 0}]}]}}, versionCheck: 'version', guard: '3',
    summary: '应用终局条件：「旧标题」v3；条件包 standard：1 胜 / 1 负'},
];

const mapFillConfirmationCases: typeof confirmationCases = [
  {name: 'place_map_fill', versionCheck: 'version', guard: '3',
    args: {id: 'world-1', version: 3, placement: {
      id: 'supply_dock', kind: 'supply', locationId: 'dock', buildingAssetId: 'supply-1', buildingAssetVersion: 2,
    }},
    summary: '放置地图填充：世界「旧标题」v3；supply_dock（supply）→ 地点 dock；资产 supply-1@2'},
  {name: 'update_map_fill_placement', versionCheck: 'version', guard: '3',
    args: {id: 'world-1', version: 3, placementId: 'shop_dock', patch: {label: '渡口商店', localOverrides: {color: '#abcdef'}}},
    summary: '修改地图填充：世界「旧标题」v3；shop_dock；名称: "旧商店" → "渡口商店"；本地覆盖: {"color":"#111111"} → {"color":"#abcdef"}'},
  {name: 'accept_map_fill', versionCheck: 'version', guard: '3',
    args: {id: 'world-1', version: 3, items: [
      {proposalId: 'quest_dock', kind: 'quest', locationId: 'dock'},
      {proposalId: 'encounter_market', kind: 'encounter', locationId: 'market'},
    ]},
    summary: '接受地图填充提案：世界「旧标题」v3；2 项：quest_dock（quest@dock）、encounter_market（encounter@market）；仅接受已审核项，新资产须先入库'},
];

const fineGrainedConfirmationCases: typeof confirmationCases = [
  {name: 'add_world_location', versionCheck: 'version', guard: '3',
    args: {id: 'world-1', version: 3, location: {id: 'harbor', title: '雾港', text: '雾气笼罩。'}},
    summary: '新增地点：世界「旧标题」v3；harbor「雾港」；正文："雾气笼罩。"'},
  {name: 'update_world_location', versionCheck: 'version', guard: '3',
    args: {id: 'world-1', version: 3, location: {id: 'dock', title: '新渡口', text: '新正文'}},
    summary: '修改地点：世界「旧标题」v3；dock；标题: "旧渡口" → "新渡口"；正文: "旧正文" → "新正文"'},
  {name: 'add_world_storylet', versionCheck: 'version', guard: '3',
    args: {id: 'world-1', version: 3, storylet: {id: 'rain', title: '雨夜', text: '雨声。', locationIds: ['dock'], choices: [{id: 'choice', effects: []}]}},
    summary: '新增剧情卡：世界「旧标题」v3；rain「雨夜」；地点：dock；1 个选项'},
  {name: 'update_world_storylet', versionCheck: 'version', guard: '3',
    args: {id: 'world-1', version: 3, storylet: {id: 'card', title: '新卡', text: '新卡正文', locationIds: ['dock'],
      when: [{kind: 'known', factId: 'secret'}], choices: [{id: 'choice', effects: [{kind: 'set', factId: 'bell', value: true}]}]}},
    summary: '修改剧情卡：世界「旧标题」v3；card；标题: "旧卡" → "新卡"；正文: "旧卡正文" → "新卡正文"'},
  {name: 'add_storylet_condition', versionCheck: 'version', guard: '3',
    args: {id: 'world-1', version: 3, storyletId: 'card', target: 'when', condition: {kind: 'fact', factId: 'permit', value: true}},
    summary: '新增剧情卡条件：世界「旧标题」v3；card 的出现条件[1]：{"kind":"fact","factId":"permit","value":true}'},
  {name: 'remove_storylet_condition', versionCheck: 'version', guard: '3',
    args: {id: 'world-1', version: 3, storyletId: 'card', target: 'when', conditionIndex: 0},
    summary: '删除剧情卡条件：世界「旧标题」v3；card 的出现条件[0]：{"kind":"known","factId":"secret"}'},
  {name: 'add_storylet_effect', versionCheck: 'version', guard: '3',
    args: {id: 'world-1', version: 3, storyletId: 'card', choiceId: 'choice', effect: {kind: 'reveal', factId: 'noticed'}},
    summary: '新增剧情卡效果：世界「旧标题」v3；card/choice 的选项效果[1]：{"kind":"reveal","factId":"noticed"}'},
  {name: 'remove_storylet_effect', versionCheck: 'version', guard: '3',
    args: {id: 'world-1', version: 3, storyletId: 'card', choiceId: 'choice', effectIndex: 0},
    summary: '删除剧情卡效果：世界「旧标题」v3；card/choice 的选项效果[0]：{"kind":"set","factId":"bell","value":true}'},
  {name: 'add_world_resource_def', versionCheck: 'version', guard: '3',
    args: {id: 'world-1', version: 3, resourceId: 'spirit', definition: {label: '灵力', min: 0, max: 20, initial: 2}},
    summary: '新增资源定义：世界「旧标题」v3；spirit「灵力」；范围 0–20，初始 2'},
  {name: 'update_world_resource_def', versionCheck: 'version', guard: '3',
    args: {id: 'world-1', version: 3, resourceId: 'qi', definition: {label: '真气', min: 0, max: 20, initial: 1}},
    summary: '修改资源定义：世界「旧标题」v3；qi；名称: "修为" → "真气"；最大值: 10 → 20'},
];

function metadataFor(name: string) {
  return agentChatCommandMetadata[name as keyof typeof agentChatCommandMetadata];
}

function commandsFor(names: string[], execute: Command['execute'] = () => ({})): Command[] {
  return names.map(name => {
    const readOnly = automaticCommands.includes(name);
    return {name, description: name, inputSchema: z.object({}).passthrough(), readOnly,
      confirmation: readOnly ? 'auto' as const : 'confirm' as const, risk: readOnly ? 'read' as const : 'write' as const, execute};
  });
}

const state = {
  jobs: {get: () => ({
    id: 'job-1', status: 'awaiting_review', stage: 'production', updatedAt: '2026-10-30T00:00:00.000Z',
    productionState: {approved: false, plan: {
      world: {title: '雾港', playerRole: '守灯人', storylets: [{}, {}], actions: [{}]},
      routes: [{name: '灯塔线'}, {name: '港湾区'}],
    }},
  })},
  worlds: {get: () => ({id: 'world-1', version: 3, content: {
    title: '旧标题', premise: '旧背景', goal: '旧目标', adaptationNotes: '旧说明',
    locations: [{id: 'dock', title: '旧渡口', text: '旧正文'}],
    storylets: [{id: 'card', title: '旧卡', text: '旧卡正文', locationIds: ['dock'],
      when: [{kind: 'known', factId: 'secret'}], choices: [{id: 'choice', effects: [{kind: 'set', factId: 'bell', value: true}]}]}],
    resourceDefs: {qi: {label: '修为', min: 0, max: 10, initial: 1}},
    map: {mapSchemaVersion: 1, geometry: {kind: 'hex', orientation: 'pointy', cols: 4, rows: 4, size: 28}, layers: {},
      pois: [{locationId: 'dock', anchor: {cell: '1,1'}}], structureLocked: true,
      fill: {placements: [{id: 'shop_dock', kind: 'shop', locationId: 'dock', label: '旧商店', localOverrides: {color: '#111111'}}]}},
  }})},
  games: {get: () => ({id: 'game-1', version: 4, content: {title: '游戏草稿'}})},
} as unknown as AgentChatCommandState;

test('agent chat tools: confirmation levels and metadata registry cover all 57 commands', () => {
  const allNames = [
    ...automaticCommands, ...confirmationCases.map(item => item.name),
    ...fineGrainedConfirmationCases.map(item => item.name), ...mapFillConfirmationCases.map(item => item.name),
  ];
  const tools = createAgentChatTools(commandsFor(allNames), state);
  const expected = Object.fromEntries([
    ...automaticCommands.map(name => [name, false]),
    ...confirmationCases.map(item => [item.name, true]),
    ...fineGrainedConfirmationCases.map(item => [item.name, true]),
    ...mapFillConfirmationCases.map(item => [item.name, true]),
  ]);

  assert.equal(automaticCommands.length, 31);
  assert.equal(confirmationCases.length, 13);
  assert.equal(allNames.length, 57);
  assert.deepEqual(Object.keys(agentChatCommandMetadata).sort(), allNames.slice().sort());
  assert.deepEqual(Object.fromEntries(tools.map(tool => [tool.name, tool.requiresConfirmation])), expected);
  for (const name of automaticCommands) {
    assert.equal(metadataFor(name).versionCheck, 'none', `${name} must not gain a version guard`);
    assert.equal(typeof metadataFor(name).summarize, 'function', `${name} is missing summarize metadata`);
  }
});

test('agent chat tools: every confirmed command retains its Chinese summary and version guard', () => {
  const tools = createAgentChatTools(commandsFor(confirmationCases.map(item => item.name)), state);
  for (const item of confirmationCases) {
    const metadata = metadataFor(item.name);
    assert.equal(metadata.versionCheck, item.versionCheck, `${item.name} version check changed`);
    assert.equal(typeof metadata.summarize, 'function', `${item.name} is missing summarize metadata`);
    if (item.versionCheck !== 'none') assert.ok('readVersion' in metadata && typeof metadata.readVersion === 'function', `${item.name} is missing readVersion metadata`);
    const preview = tools.find(tool => tool.name === item.name)!.prepare(item.args);
    assert.deepEqual(preview, {summary: item.summary, ...(item.guard === undefined ? {} : {guard: item.guard})}, item.name);
  }
});

test('agent chat tools: job creation confirmations read as prose instead of raw argument JSON', () => {
  const tools = createAgentChatTools(commandsFor(['create_generation_job', 'create_production_job']), state);
  for (const item of confirmationCases.filter(candidate => candidate.name.startsWith('create_'))) {
    const {summary} = tools.find(tool => tool.name === item.name)!.prepare(item.args);
    assert.doesNotMatch(summary, /\{"|\["/, `${item.name} must not dump raw argument JSON`);
  }
  const production = tools.find(tool => tool.name === 'create_production_job')!.prepare(confirmationCases.find(item => item.name === 'create_production_job')!.args).summary;
  assert.match(production, /「雾港·三门之夜」/);
  assert.match(production, /身份：守灯人/);
  assert.match(production, /目标：在天亮前找出失踪的守夜人/);
  assert.match(production, /体量：S/);
  const generation = tools.find(tool => tool.name === 'create_generation_job')!.prepare(confirmationCases.find(item => item.name === 'create_generation_job')!.args).summary;
  assert.match(generation, /模式：分支故事/);
  assert.match(generation, /章节：2章/);
});

test('agent chat tools: all 10 fine-grained edits require confirmation with Chinese details and world version guards', () => {
  assert.equal(fineGrainedConfirmationCases.length, 10);
  const tools = createAgentChatTools(commandsFor(fineGrainedConfirmationCases.map(item => item.name)), state);
  for (const item of fineGrainedConfirmationCases) {
    const metadata = metadataFor(item.name);
    const tool = tools.find(candidate => candidate.name === item.name)!;
    assert.equal(tool.requiresConfirmation, true, item.name);
    assert.equal(metadata.versionCheck, 'version', item.name);
    assert.ok('readVersion' in metadata && typeof metadata.readVersion === 'function', item.name);
    assert.deepEqual(tool.prepare(item.args), {summary: item.summary, guard: '3'}, item.name);
  }
});

test('agent chat tools: map-fill proposals are automatic and all three writes require confirmed world versions', () => {
  assert.equal(mapFillConfirmationCases.length, 3);
  for (const name of ['propose_map_fill', 'propose_clock_patch', 'propose_storylet_patch']) {
    const tool = createAgentChatTools(commandsFor([name]), state)[0]!;
    assert.equal(tool.requiresConfirmation, false, name);
  }
  const proposal = createAgentChatTools(commandsFor(['propose_map_fill']), state)[0]!;
  assert.deepEqual(proposal.prepare({id: 'world-1', count: 2}), {
    summary: '生成 Mock 地图填充提案（只读）：{"id":"world-1","count":2}',
  });
  assert.deepEqual(createAgentChatTools(commandsFor(['propose_clock_patch']), state)[0]!.prepare({worldDraftId: 'world-1', unit: 'day'}), {
    summary: '生成 Mock 时钟补丁提案（只读）：{"worldDraftId":"world-1","unit":"day"}',
  });
  assert.deepEqual(createAgentChatTools(commandsFor(['propose_storylet_patch']), state)[0]!.prepare({worldDraftId: 'world-1', storyletId: 'card'}), {
    summary: '生成 Mock 剧情卡补丁提案（只读）：{"worldDraftId":"world-1","storyletId":"card"}',
  });

  const tools = createAgentChatTools(commandsFor(mapFillConfirmationCases.map(item => item.name)), state);
  for (const item of mapFillConfirmationCases) {
    const metadata = metadataFor(item.name);
    const tool = tools.find(candidate => candidate.name === item.name)!;
    assert.equal(tool.requiresConfirmation, true, item.name);
    assert.equal(metadata.versionCheck, 'version', item.name);
    assert.ok('readVersion' in metadata && typeof metadata.readVersion === 'function', item.name);
    assert.deepEqual(tool.prepare(item.args), {summary: item.summary, guard: '3'}, item.name);
  }
});

test('agent chat tools: a changed world version rejects confirmation before command execution', async () => {
  const db = openDatabase(':memory:');
  const draft = {id: 'world-1', version: 1, content: {title: '旧标题', premise: '背景', goal: '目标', adaptationNotes: ''}};
  let executions = 0;
  const liveState = {
    jobs: state.jobs,
    worlds: {get: () => draft},
    games: state.games,
  } as unknown as AgentChatCommandState;
  const tools = createAgentChatTools(commandsFor(['edit_world_summary'], () => {executions++; return draft;}), liveState);
  const replies = [{text: '', calls: [{id: 'edit-1', name: 'edit_world_summary', arguments: {id: 'world-1', version: 1, title: '新标题'}}]}];
  const service = new AgentChatService({
    repository: new SqliteChatRepository(db),
    model: () => ({respond: async () => replies.shift() ?? {text: '完成', calls: []}}),
    tools: () => tools,
  });
  const conversation = service.create();
  try {
    const pending = await service.send({id: conversation.id, requestId: 'edit-request', text: '修改标题'});
    assert.equal(pending.actions[0]!.guard, '1');
    draft.version = 2;
    const blocked = await service.decide({id: conversation.id, actionId: pending.actions[0]!.id, decision: 'confirm'});
    assert.equal(blocked.actions[0]!.status, 'failed');
    assert.match(blocked.actions[0]!.result ?? '', /CHAT_ACTION_STALE/);
    assert.ok(blocked.messages.some(message => /状态已变化/.test(message.content)));
    assert.equal(executions, 0);
  } finally {
    db.close();
  }
});
