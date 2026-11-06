import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { build } from 'esbuild';
import { createCommands } from '../src/app/commands/index.js';
import { createAgentChatTools, agentChatCommandMetadata } from '../src/app/agent-chat-tools.js';
import { GAME_DEV_SKILLS, gameDevSkillPromptIndex, listGameDevSkills, loadGameDevSkill,
  type GameDevSkill } from '../src/modules/agent/index.js';
import type { AgentChatCommandState } from '../src/app/agent-chat-tools.js';

test('game dev skills: five stable versioned skills contain actionable boundaries', () => {
  assert.deepEqual(GAME_DEV_SKILLS.map(skill => skill.id), [
    'project-brief', 'world-building', 'pacing-balance', 'quality-review', 'standard-production',
  ]);
  assert.ok(GAME_DEV_SKILLS.every(skill => skill.version === '1.0.0' && skill.whenToUse.length > 0 && skill.body.length > 200));
  assert.equal(new Set(GAME_DEV_SKILLS.map(skill => skill.id)).size, 5);
  assert.match(loadGameDevSkill('standard-production')!.whenToUse, /可选|明确/);
  assert.match(GAME_DEV_SKILLS.find(skill => skill.id === 'quality-review')!.body, /关键选择\/承诺的成对后果仍不支持/);
  assert.match(GAME_DEV_SKILLS.find(skill => skill.id === 'world-building')!.body, /check_world_causality/);
  assert.match(GAME_DEV_SKILLS.find(skill => skill.id === 'world-building')!.body, /check_world_preservation/);
});

test('game dev skills: real commands are strict, read-only, allowlist-only and exposed as tools', async () => {
  const commands = createCommands({} as never);
  const realCommandNames = new Set(commands.map(command => command.name));
  const piCommandNames = new Set(Object.keys(agentChatCommandMetadata));
  for (const skill of GAME_DEV_SKILLS) {
    for (const name of skill.relatedToolNames) {
      assert.ok(realCommandNames.has(name), `${skill.id} references missing command ${name}`);
      assert.ok(piCommandNames.has(name), `${skill.id} references command ${name} not exposed to Pi`);
    }
    const mentionedTools = [...realCommandNames].filter(name => new RegExp(`\\b${name}\\b`).test(skill.body));
    for (const name of mentionedTools) assert.ok(skill.relatedToolNames.includes(name), `${skill.id} omits related command ${name}`);
    const prose = skill.body.replace(/\braw\/effective\b/g, 'raw-effective').replace(/\bunsupported\/inconclusive\b/g, 'unsupported-or-inconclusive');
    assert.doesNotMatch(prose, /\b[a-z][a-z0-9_]*\/[a-z][a-z0-9_]*\b/, `${skill.id} contains a synthetic slash tool name`);
  }
  const skillCommands = commands.filter(command => command.name.endsWith('_game_dev_skill') || command.name === 'list_game_dev_skills');
  assert.deepEqual(skillCommands.map(command => command.name), ['list_game_dev_skills', 'load_game_dev_skill']);
  assert.ok(skillCommands.every(command => command.readOnly && command.confirmation === 'auto' && command.risk === 'read'));
  assert.deepEqual(skillCommands[0]!.execute({}), listGameDevSkills());
  assert.throws(() => skillCommands[0]!.inputSchema.parse({extra: true}));
  for (const skillId of ['../../etc/passwd', '/etc/passwd', 'https://example.test', 'not-a-skill']) {
    assert.throws(() => skillCommands[1]!.inputSchema.parse({skillId}));
  }
  assert.throws(() => skillCommands[1]!.inputSchema.parse({skillId: 'project-brief', extra: true}));
  assert.throws(() => skillCommands[1]!.inputSchema.parse({skillId: 'x'.repeat(10000)}));
  assert.equal(loadGameDevSkill('../../etc/passwd'), undefined);
  const loaded = skillCommands[1]!.execute({skillId: 'world-building'}) as GameDevSkill;
  assert.ok(loaded.relatedToolNames.includes('add_world_location'));

  const tools = createAgentChatTools(skillCommands, {} as AgentChatCommandState);
  assert.deepEqual(tools.map(tool => tool.name), ['list_game_dev_skills', 'load_game_dev_skill']);
  assert.ok(tools.every(tool => !tool.requiresConfirmation));
  assert.deepEqual(Object.keys(agentChatCommandMetadata).filter(name => name.includes('game_dev_skill')).sort(),
    ['list_game_dev_skills', 'load_game_dev_skill']);
  assert.deepEqual(tools[0]!.validate({}), {});
  assert.throws(() => tools[0]!.validate({unexpected: 1}));
  assert.throws(() => tools[1]!.validate({skillId: 'project-brief', unexpected: 1}));
});

test('game dev skills: old write confirmation metadata and standard production command remain registered', () => {
  const commands = createCommands({} as never);
  const selected = commands.filter(command => ['create_production_job', 'approve_saved_production_plan', 'apply_world_patch'].includes(command.name));
  assert.deepEqual(selected.map(command => command.name), ['create_production_job', 'approve_saved_production_plan', 'apply_world_patch']);
  assert.ok(selected.every(command => !command.readOnly && command.confirmation === 'confirm'));
  assert.equal(commands.find(command => command.name === 'create_world_from_idea')?.confirmation, 'confirm');
  assert.equal(commands.find(command => command.name === 'validate_world_composition')?.confirmation, 'auto');
  assert.equal(commands.find(command => command.name === 'apply_world_composition')?.confirmation, 'confirm');
  assert.equal(commands.find(command => command.name === 'check_world_preservation')?.readOnly, true);
  assert.equal(agentChatCommandMetadata.create_production_job!.versionCheck, 'none');
  assert.equal(agentChatCommandMetadata.approve_saved_production_plan!.versionCheck, 'updatedAt');
  assert.equal(agentChatCommandMetadata.apply_world_patch!.versionCheck, 'version');
});

test('game dev skills: default prompt is agent-led while standard production remains optional', async () => {
  const source = await readFile(new URL('../src/platform/model/agent-chat.ts', import.meta.url), 'utf8');
  assert.match(source, /用户的想法是一等输入/);
  assert.match(source, /不要求先创建 production job/);
  assert.match(source, /标准制作是显式可选流程/);
  assert.match(source, /list_game_dev_skills 查看技能目录/);
  assert.match(source, /load_game_dev_skill\(\{skillId\}\)/);
  for (const skill of GAME_DEV_SKILLS.slice(0, 4)) {
    assert.ok(gameDevSkillPromptIndex().includes(skill.id));
    assert.ok(gameDevSkillPromptIndex().includes(skill.whenToUse));
  }
  assert.equal(gameDevSkillPromptIndex().split('\n').length, 4);
  assert.doesNotMatch(source, /角色扮演制作：create_production_job后查询进度/);
});

test('game dev skills: bundled registry loads across working directories', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'game-dev-skills-'));
  try {
    const outfile = path.join(dir, 'skills.mjs');
    await build({entryPoints: [new URL('../src/modules/agent/skills/index.ts', import.meta.url).pathname], outfile, bundle: true,
      platform: 'node', format: 'esm', target: 'node24'});
    const original = process.cwd();
    process.chdir(tmpdir());
    try {
      const bundled = await import(`${new URL(`file://${outfile}`).href}?cwd-test=${Date.now()}`) as typeof import('../src/modules/agent/index.js');
      assert.equal(bundled.loadGameDevSkill('project-brief')!.id, 'project-brief');
      assert.match(bundled.loadGameDevSkill('quality-review')!.body, /validate_world_draft/);
    } finally { process.chdir(original); }
  } finally { await rm(dir, {recursive: true, force: true}); }
});
