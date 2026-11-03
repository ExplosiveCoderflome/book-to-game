import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  getBlock, getGenreRecipe, lintGenreRecipes, worldContentSchema,
  type WorldCondition, type WorldContent, type WorldRevision,
} from '@novel-game/contracts';
import { advanceAdventure, createAdventureState, projectAdventure } from '@novel-game/play-runtime';
import { checkPlanWorld } from '@novel-game/play-runtime/sim';
import { lintWorld } from '@novel-game/rules/preflight';
import { worldCommands } from '../src/app/commands/worlds.js';
import type { Workbench } from '../src/app/workbench.js';
import { WorldService, SqliteWorldRepository } from '../src/modules/worlds/index.js';
import { openDatabase } from '../src/platform/database.js';
import { content, source } from './helpers/open-fixture.js';

/** A small S1 world with one ordinary and one failure ending, plus a progress resource. */
function baseWorld(overrides: Partial<WorldContent> = {}): WorldContent {
  const world = content();
  return worldContentSchema.parse({
    ...world,
    resourceDefs: {
      progress: {label: '进度', min: 0, max: 3, initial: 0},
      pressure: {label: '压力', min: 0, max: 3, initial: 1},
    },
    actions: [
      ...world.actions,
      {id: 'push', label: '推进进度', description: '', locationId: 'dock', availableWhen: [], requires: [],
        blockedReason: '不能推进', risk: '', timeCost: 1, once: false,
        effects: [{kind: 'resource', resourceId: 'progress', delta: 1}], text: '你推进了一步。', origin: 'adapted', evidence: []},
      {id: 'bump', label: '承受压力', description: '', locationId: 'dock', availableWhen: [], requires: [],
        blockedReason: '不能承受', risk: '', timeCost: 1, once: false,
        effects: [{kind: 'resource', resourceId: 'pressure', delta: 3}], text: '压力骤增。', origin: 'adapted', evidence: []},
    ],
    endings: [
      {id: 'success', title: '通行', text: '你顺利过河。', when: [], kind: 'ending'},
      {id: 'sink', title: '沉没', text: '渡船沉没。', when: [], kind: 'failure'},
    ],
    ...overrides,
  } as WorldContent);
}

function setup(world: WorldContent = baseWorld()) {
  const db = openDatabase(':memory:');
  const worlds = new WorldService(new SqliteWorldRepository(db), {get: () => structuredClone(source)});
  const draft = worlds.create({sourceId: source.id, content: world});
  const commands = worldCommands({worlds} as unknown as Workbench);
  const command = (name: string) => {
    const found = commands.find(item => item.name === name);
    assert.ok(found, `missing command ${name}`);
    return found;
  };
  return {db, worlds, draft, command};
}

const winCondition: WorldCondition = {kind: 'resource', resourceId: 'progress', atLeast: 3};
const loseCondition: WorldCondition = {kind: 'resource', resourceId: 'pressure', atMost: 3};

test('end-conditions catalog: block is on foundation/world-content, recipes require it, lint catches omission', () => {
  const block = getBlock('end-conditions');
  assert.ok(block, 'end-conditions block registered');
  assert.equal(block!.version, 1);
  assert.ok(block!.shelves.includes('foundation'));
  assert.ok(block!.shelves.includes('world-content'));
  assert.ok(block!.provides.includes('endings'));
  assert.deepEqual(block!.composesWith.dependsOn, ['endings-recap', 'stat-templates']);
  assert.ok(block!.params.some(param => param.key === 'win_slots'));
  assert.ok(block!.params.some(param => param.key === 'lose_slots'));
  assert.deepEqual(lintGenreRecipes(), [], 'shipped recipes lint clean with end-conditions');

  for (const id of ['sim-commerce', 'combat-growth']) {
    assert.ok(getGenreRecipe(id)!.requiredBlocks.includes('end-conditions'), `${id} must require end-conditions`);
  }

  const commerce = getGenreRecipe('sim-commerce')!;
  const without = { ...commerce, requiredBlocks: commerce.requiredBlocks.filter(id => id !== 'end-conditions') };
  const issues = lintGenreRecipes([without]);
  assert.ok(issues.some(issue => issue.ruleId === 'recipes.missing-end-conditions' && issue.severity === 'error'));
});

test('end-conditions: proposal returns at least two complete win/lose packages, read-only', async () => {
  const ctx = setup();
  try {
    const before = ctx.worlds.get(ctx.draft.id);
    const command = ctx.command('propose_end_conditions');
    assert.equal(command.readOnly, true);
    assert.equal(command.confirmation, 'auto');
    const proposal = await command.execute({worldDraftId: ctx.draft.id}) as {
      worldDraftId: string; baseVersion: number; packages: {id: string; win: {when: WorldCondition[]}[]; lose: {when: WorldCondition[]}[]}[];
      severity: string; severityNote: string; warnings: string[]; model: string;
    };
    assert.equal(proposal.worldDraftId, ctx.draft.id);
    assert.equal(proposal.baseVersion, before.version);
    assert.ok(proposal.packages.length >= 2, 'must offer multiple packages');
    for (const pkg of proposal.packages) {
      assert.ok(pkg.win.length >= 1, `${pkg.id} needs a win condition`);
      assert.ok(pkg.lose.length >= 1, `${pkg.id} needs a lose condition`);
      for (const condition of [...pkg.win, ...pkg.lose]) assert.ok(condition.when.length >= 1);
    }
    assert.equal(proposal.severity, 'reshapes-game');
    assert.match(proposal.severityNote, /重塑整局/);
    assert.equal(proposal.model, 'mock-end-conditions');
    assert.deepEqual(ctx.worlds.get(ctx.draft.id).content, before.content, 'proposal writes nothing');
  } finally { ctx.db.close(); }
});

test('end-conditions: applying a chosen package writes resolved win/lose conditions and pins endings', () => {
  const ctx = setup();
  try {
    const before = ctx.worlds.get(ctx.draft.id);
    const command = ctx.command('apply_end_conditions');
    assert.equal(command.readOnly, false);
    assert.equal(command.confirmation, 'confirm');
    const result = command.execute({
      worldDraftId: ctx.draft.id,
      version: before.version,
      selection: {
        kind: 'package', packageId: 'standard', packageLabel: '标准胜负',
        win: [{id: 'win_progress', label: '进度推满', when: [winCondition]}],
        lose: [{id: 'lose_pressure', label: '压力见顶', when: [loseCondition]}],
      },
    }) as {draftId: string; version: number; endConditions: {source: string; win: {endingId: string}[]; lose: {endingId: string}[]}; severity: string};
    assert.equal(result.version, before.version + 1);
    assert.equal(result.severity, 'reshapes-game');
    assert.equal(result.endConditions.source, 'agent-proposed');
    assert.equal(result.endConditions.win[0]!.endingId, 'success');
    assert.equal(result.endConditions.lose[0]!.endingId, 'sink');
    const saved = ctx.worlds.get(ctx.draft.id).content.endConditions!;
    assert.equal(saved.win.length, 1);
    assert.equal(saved.lose.length, 1);
    assert.equal(saved.severity, 'reshapes-game');
  } finally { ctx.db.close(); }
});

test('end-conditions: custom free text is parsed into the same shape', () => {
  const ctx = setup();
  try {
    const before = ctx.worlds.get(ctx.draft.id);
    const result = ctx.command('apply_end_conditions').execute({
      worldDraftId: ctx.draft.id,
      version: before.version,
      selection: {kind: 'custom', text: '胜利：进度达到 3\n失败：压力见底 0'},
    }) as {endConditions: {source: string; win: {when: WorldCondition[]}[]; lose: {when: WorldCondition[]}[]}};
    assert.equal(result.endConditions.source, 'author-custom');
    assert.deepEqual(result.endConditions.win[0]!.when, [{kind: 'resource', resourceId: 'progress', atLeast: 3}]);
    assert.deepEqual(result.endConditions.lose[0]!.when, [{kind: 'resource', resourceId: 'pressure', atMost: 0}]);
  } finally { ctx.db.close(); }
});

test('end-conditions: custom text without both a win and a lose is rejected', () => {
  const ctx = setup();
  try {
    const before = ctx.worlds.get(ctx.draft.id);
    assert.throws(() => ctx.command('apply_end_conditions').execute({
      worldDraftId: ctx.draft.id, version: before.version,
      selection: {kind: 'custom', text: '胜利：进度达到 3'},
    }), {code: 'END_CONDITIONS_INCOMPLETE'});
    assert.throws(() => ctx.command('apply_end_conditions').execute({
      worldDraftId: ctx.draft.id, version: before.version,
      selection: {kind: 'custom', text: '把渡船开走'},
    }), {code: 'END_CONDITIONS_PARSE_FAILED'});
  } finally { ctx.db.close(); }
});

test('end-conditions: editing an existing set requires the explicit reshape acknowledgement', () => {
  const ctx = setup();
  try {
    const first = ctx.worlds.get(ctx.draft.id);
    ctx.command('apply_end_conditions').execute({
      worldDraftId: ctx.draft.id, version: first.version,
      selection: {kind: 'custom', text: '胜利：进度达到 3\n失败：压力见底 0'},
    });
    const edited = ctx.worlds.get(ctx.draft.id);
    assert.throws(() => ctx.command('apply_end_conditions').execute({
      worldDraftId: ctx.draft.id, version: edited.version,
      selection: {kind: 'custom', text: '胜利：进度达到 2\n失败：压力见底 0'},
    }), {code: 'END_CONDITIONS_RESHAPE_UNCONFIRMED'});
    const applied = ctx.command('apply_end_conditions').execute({
      worldDraftId: ctx.draft.id, version: edited.version, acknowledgeReshape: true,
      selection: {kind: 'custom', text: '胜利：进度达到 2\n失败：压力见底 0'},
    }) as {endConditions: {source: string; win: {when: WorldCondition[]}[]}};
    assert.equal(applied.endConditions.source, 'author-edited');
    assert.deepEqual(applied.endConditions.win[0]!.when, [{kind: 'resource', resourceId: 'progress', atLeast: 2}]);
  } finally { ctx.db.close(); }
});

test('end-conditions: schema rejects unknown endings and win/lose pointed at the wrong ending kind', () => {
  const ctx = setup();
  try {
    const before = ctx.worlds.get(ctx.draft.id);
    const contentWith = (winEnding: string, loseEnding: string): WorldContent => ({
      ...before.content,
      endConditions: {
        source: 'author-custom', severity: 'reshapes-game',
        win: [{id: 'win', kind: 'win', label: '胜', when: [winCondition], endingId: winEnding}],
        lose: [{id: 'lose', kind: 'lose', label: '负', when: [loseCondition], endingId: loseEnding}],
      },
    });
    assert.doesNotThrow(() => worldContentSchema.parse(contentWith('success', 'sink')));
    assert.throws(() => worldContentSchema.parse(contentWith('missing', 'sink')), /终局条件引用了不存在的结局/);
    assert.throws(() => worldContentSchema.parse(contentWith('sink', 'sink')), /胜利条件不能指向失败结局/);
    assert.throws(() => worldContentSchema.parse(contentWith('success', 'success')), /失败条件不能指向普通或超时结局/);
  } finally { ctx.db.close(); }
});

test('end-conditions: lint fails when a judgement side is missing', () => {
  const ctx = setup();
  try {
    const result = ctx.command('apply_end_conditions').execute({
      worldDraftId: ctx.draft.id,
      version: ctx.worlds.get(ctx.draft.id).version,
      selection: {
        kind: 'package', packageId: 'standard',
        win: [{id: 'win_progress', label: '进度推满', when: [winCondition]}],
        lose: [{id: 'lose_pressure', label: '压力见顶', when: [loseCondition]}],
      },
    });
    assert.ok(result);
    const saved = ctx.worlds.get(ctx.draft.id).content;
    const ok = lintWorld(saved);
    assert.equal(ok.issues.filter(issue => issue.ruleId.startsWith('end-conditions.')).length, 0);

    const brokenWin = {...saved, endConditions: {...saved.endConditions!, win: []}};
    const brokenLose = {...saved, endConditions: {...saved.endConditions!, lose: []}};
    assert.ok(lintWorld(brokenWin).issues.some(issue => issue.ruleId === 'end-conditions.no-win'));
    assert.ok(lintWorld(brokenLose).issues.some(issue => issue.ruleId === 'end-conditions.no-lose'));
  } finally { ctx.db.close(); }
});

test('end-conditions runtime: hitting a win or lose condition ends the run with the bound ending', () => {
  const world = baseWorld();
  const withConditions = worldContentSchema.parse({
    ...world,
    endConditions: {
      source: 'author-custom', severity: 'reshapes-game',
      win: [{id: 'win', kind: 'win', label: '进度推满', when: [winCondition], endingId: 'success'}],
      lose: [{id: 'lose', kind: 'lose', label: '压力见顶', when: [{kind: 'resource', resourceId: 'pressure', atLeast: 3}], endingId: 'sink'}],
    },
  });
  const revision: WorldRevision = {id: 'rev-end', draftId: 'd', sourceId: 's', content: withConditions, version: 1, createdAt: '2026-11-03T00:00:00Z'};

  let state = createAdventureState(revision, 'save-win', '2026-11-03T00:00:00Z', {}, 7);
  state = advanceAdventure(state, {actionId: 'push', expectedTurn: state.turn, requestId: crypto.randomUUID()}, withConditions, '2026-11-03T00:00:00Z');
  let view = projectAdventure(state, revision);
  assert.equal(view.ended, false, 'one step is not enough');
  state = advanceAdventure(state, {actionId: 'push', expectedTurn: state.turn, requestId: crypto.randomUUID()}, withConditions, '2026-11-03T00:00:00Z');
  state = advanceAdventure(state, {actionId: 'push', expectedTurn: state.turn, requestId: crypto.randomUUID()}, withConditions, '2026-11-03T00:00:00Z');
  view = projectAdventure(state, revision);
  assert.equal(view.ended, true);
  assert.equal(view.ending?.id, 'success');
  assert.equal(view.ending?.kind, 'ending');

  let losing = createAdventureState(revision, 'save-lose', '2026-11-03T00:00:00Z', {}, 7);
  losing = advanceAdventure(losing, {actionId: 'bump', expectedTurn: losing.turn, requestId: crypto.randomUUID()}, withConditions, '2026-11-03T00:00:00Z');
  const loseView = projectAdventure(losing, revision);
  assert.equal(loseView.ended, true);
  assert.equal(loseView.ending?.id, 'sink');
  assert.equal(loseView.ending?.kind, 'failure');
});

test('end-conditions: plan check treats win/lose predicates as ending triggers, not dead endings', () => {
  const world = baseWorld();
  const withConditions = worldContentSchema.parse({
    ...world,
    endConditions: {
      source: 'author-custom', severity: 'reshapes-game',
      win: [{id: 'win', kind: 'win', label: '进度推满', when: [winCondition], endingId: 'success'}],
      lose: [{id: 'lose', kind: 'lose', label: '压力见顶', when: [{kind: 'resource', resourceId: 'pressure', atLeast: 3}], endingId: 'sink'}],
    },
  });
  const report = checkPlanWorld(withConditions, [{id: 'r1', name: '胜线', endingIds: ['success']}], {probe: false});
  assert.ok(!report.issues.some(issue => issue.ruleId === 'plan.ending-no-trigger'), JSON.stringify(report.issues));
});
