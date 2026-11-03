import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BLOCKS, BLOCK_SHELVES, FUN_PROFILES, GENRE_RECIPES, genreRecipeSchema, getBlock,
  getGenreRecipe, getGenreRecipes, lintGenreRecipes,
} from '@novel-game/contracts';
import { openDatabase } from '../src/platform/database.js';
import { createWorkbench } from '../src/app/workbench.js';
import { createCommands } from '../src/app/commands/index.js';
import { createModelSettings } from '../src/platform/create-model-settings.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('V0b recipes: two genre recipes parse, keep commerce/combat skeletons, and lint clean', () => {
  assert.deepEqual(GENRE_RECIPES.map(recipe => recipe.id), ['sim-commerce', 'combat-growth']);
  assert.deepEqual(getGenreRecipes().map(recipe => recipe.id), GENRE_RECIPES.map(recipe => recipe.id));

  for (const recipe of GENRE_RECIPES) {
    assert.deepEqual(genreRecipeSchema.parse(recipe), recipe);
    assert.ok(recipe.version >= 1);
    assert.ok(recipe.label.length > 0 && recipe.blurb.length > 0);
    assert.ok(recipe.requiredBlocks.length >= 1);
    assert.ok(recipe.primaryShelves.length >= 1);
  }
  assert.equal(getGenreRecipe('sim-commerce')?.label, '模拟经营');
  assert.equal(getGenreRecipe('combat-growth')?.label, '打怪成长');
  assert.equal(getGenreRecipe('missing'), undefined);
  assert.deepEqual(lintGenreRecipes(), []);
});

test('V0b recipes: every referenced block/shelf/profile id is registered', () => {
  const blockIds = new Set(BLOCKS.map(block => block.id));
  const shelfIds = new Set(BLOCK_SHELVES.map(shelf => shelf.id));
  const profileIds = new Set(FUN_PROFILES.map(profile => profile.id));
  for (const recipe of GENRE_RECIPES) {
    for (const id of [...recipe.requiredBlocks, ...recipe.recommendedBlocks, ...recipe.optionalBlocks]) {
      assert.ok(blockIds.has(id), `${recipe.id} references unknown block ${id}`);
    }
    for (const shelf of recipe.primaryShelves) assert.ok(shelfIds.has(shelf), `${recipe.id} unknown shelf ${shelf}`);
    for (const profile of recipe.relatedFunProfiles) assert.ok(profileIds.has(profile), `${recipe.id} unknown profile ${profile}`);
  }
});

test('V0b recipes: commerce keeps the three shop-cycle bones, combat keeps growth loop', () => {
  const commerce = getGenreRecipe('sim-commerce')!;
  const required = new Set(commerce.requiredBlocks);
  for (const id of ['shop-cycle', 'customer-flow', 'ledger', 'stat-templates', 'clock', 'item-catalog', 'storylet-pool', 'endings-recap']) {
    assert.ok(required.has(id), `sim-commerce must require ${id}`);
  }
  assert.ok(commerce.primaryShelves.includes('commerce'));
  assert.ok(commerce.relatedFunProfiles.includes('healing'));

  const combat = getGenreRecipe('combat-growth')!;
  const combatRequired = new Set(combat.requiredBlocks);
  for (const id of ['encounters', 'growth-curve', 'loot-table', 'combat-stake', 'stat-templates', 'item-catalog', 'storylet-pool']) {
    assert.ok(combatRequired.has(id), `combat-growth must require ${id}`);
  }
  assert.ok(combat.primaryShelves.includes('combat-growth'));
  assert.ok(combat.relatedFunProfiles.includes('grinding'));
});

test('V0b recipes: healing/grinding FunProfiles stay aligned with their recipes', () => {
  const profile = (id: string) => FUN_PROFILES.find(item => item.id === id)!;
  const recipe = (id: string) => new Set([...getGenreRecipe(id)!.requiredBlocks, ...getGenreRecipe(id)!.recommendedBlocks]);
  for (const id of ['shop-cycle', 'customer-flow', 'ledger']) {
    assert.ok(profile('healing').suggestedBlocks.includes(id), `healing missing ${id}`);
    assert.ok(recipe('sim-commerce').has(id), `sim-commerce missing ${id}`);
  }
  for (const id of ['growth-curve', 'loot-table', 'combat-stake']) {
    assert.ok(profile('grinding').suggestedBlocks.includes(id), `grinding missing ${id}`);
    assert.ok(recipe('combat-growth').has(id), `combat-growth missing ${id}`);
  }
});

test('V0b recipes: lint reports unknown ids, conflicts and missing dependsOn', () => {
  const base = getGenreRecipe('combat-growth')!;

  const unknownBlock = getGenreRecipe('sim-commerce')!;
  const issues = lintGenreRecipes([{...unknownBlock, requiredBlocks: [...unknownBlock.requiredBlocks, 'not-a-block']}]);
  assert.ok(issues.some(issue => issue.ruleId === 'recipes.unknown-block' && issue.severity === 'error'));

  const unknownShelf = lintGenreRecipes([{...unknownBlock, primaryShelves: ['not-a-shelf' as never]}]);
  assert.ok(unknownShelf.some(issue => issue.ruleId === 'recipes.unknown-shelf'));

  const unknownProfile = lintGenreRecipes([{...unknownBlock, relatedFunProfiles: ['not-a-profile']}]);
  assert.ok(unknownProfile.some(issue => issue.ruleId === 'recipes.unknown-fun-profile'));

  const [, withMissingDependency] = GENRE_RECIPES;
  const missingDep = lintGenreRecipes([{
    ...withMissingDependency!,
    requiredBlocks: withMissingDependency!.requiredBlocks.filter(id => id !== 'item-catalog'),
    recommendedBlocks: withMissingDependency!.recommendedBlocks.filter(id => id !== 'item-catalog'),
    optionalBlocks: withMissingDependency!.optionalBlocks.filter(id => id !== 'item-catalog'),
  }]);
  assert.ok(missingDep.some(issue => issue.ruleId === 'recipes.missing-dependency' && issue.severity === 'error'));

  const syntheticBlocks = [
    {...getBlock('clock')!, id: 'a', composesWith: {dependsOn: [], conflictsWith: ['b']}, provides: ['facts' as const]},
    {...getBlock('clock')!, id: 'b', composesWith: {dependsOn: [], conflictsWith: ['a']}, provides: ['facts' as const]},
  ];
  const conflicting = lintGenreRecipes([{
    id: 'x', version: 1, label: 'x', blurb: 'x', primaryShelves: ['foundation'],
    requiredBlocks: ['a'], recommendedBlocks: ['b'], optionalBlocks: [], funTags: [],
    relatedFunProfiles: [], conflictsWithRecipes: [],
  }], syntheticBlocks);
  assert.ok(conflicting.some(issue => issue.ruleId === 'recipes.conflict' && issue.severity === 'error'));

  const selfConflict = lintGenreRecipes([{...base, conflictsWithRecipes: [base.id]}]);
  assert.ok(selfConflict.some(issue => issue.ruleId === 'recipes.self-conflict'));

  const unknownRecipe = lintGenreRecipes([{...base, conflictsWithRecipes: ['not-a-recipe']}]);
  assert.ok(unknownRecipe.some(issue => issue.ruleId === 'recipes.unknown-recipe'));

  const duplicate = lintGenreRecipes([base, base]);
  assert.ok(duplicate.some(issue => issue.ruleId === 'recipes.duplicate-id'));

  const duplicateBucket = lintGenreRecipes([{...base,
    optionalBlocks: [...base.optionalBlocks, base.requiredBlocks[0]!]}]);
  assert.ok(duplicateBucket.some(issue => issue.ruleId === 'recipes.duplicate-across-lists' && issue.severity === 'warning'));
});

test('V0b recipes: list_genre_recipes is a read-only command with resolved blocks', () => {
  const db = openDatabase(':memory:');
  const dir = mkdtempSync(path.join(tmpdir(), 'v0b-recipes-'));
  const workbench = createWorkbench(db, createModelSettings(db, dir, {baseUrl: 'https://api.example.test/v1', model: '', apiKey: '', timeoutMs: 90000}));
  try {
    const command = createCommands(workbench).find(candidate => candidate.name === 'list_genre_recipes')!;
    assert.ok(command, 'list_genre_recipes command registered');
    assert.equal(command.readOnly, true);
    const result = command.execute({}) as {
      recipes: {id: string; resolved: {required: {id: string; label: string; shelves: string[]}[]}; missingDependencies: unknown[]}[];
      lint: unknown[];
    };
    assert.deepEqual(result.recipes.map(recipe => recipe.id), ['sim-commerce', 'combat-growth']);
    assert.deepEqual(result.lint, []);
    for (const recipe of result.recipes) {
      assert.ok(recipe.resolved.required.length >= 1);
      for (const block of recipe.resolved.required) {
        const spec = getBlock(block.id);
        assert.ok(spec, `${block.id} must be a registered block`);
        assert.equal(block.label, spec!.label);
        assert.deepEqual(block.shelves, spec!.shelves);
      }
      assert.deepEqual(recipe.missingDependencies, []);
    }
  } finally {
    db.close();
    rmSync(dir, {recursive: true, force: true});
  }
});

test('V0b recipes: GET /api/genre-recipes exposes the same read-only catalog', async () => {
  const { createApp } = await import('../src/adapters/http/app.js');
  const db = openDatabase(':memory:');
  const dir = mkdtempSync(path.join(tmpdir(), 'v0b-recipes-http-'));
  const workbench = createWorkbench(db, createModelSettings(db, dir, {baseUrl: 'https://api.example.test/v1', model: '', apiKey: '', timeoutMs: 90000}));
  const server = createApp(workbench, {token: 'test-token', allowedOrigins: ['http://127.0.0.1:5173']}).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${(server.address() as {port: number}).port}`;
  try {
    const response = await fetch(`${url}/api/genre-recipes`);
    assert.equal(response.status, 200);
    const body = await response.json() as {recipes: {id: string}[]; lint: unknown[]};
    assert.deepEqual(body.recipes.map(recipe => recipe.id), ['sim-commerce', 'combat-growth']);
    assert.deepEqual(body.lint, []);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    db.close();
    rmSync(dir, {recursive: true, force: true});
  }
});

test('V0b recipes: AI live blocks are optional, never required', () => {
  for (const recipe of GENRE_RECIPES) {
    for (const id of ['ai-narration', 'ai-npc-dialog', 'ai-slot-template']) {
      assert.ok(!recipe.requiredBlocks.includes(id), `${recipe.id} must not require ${id}`);
    }
    assert.ok(recipe.optionalBlocks.includes('ai-narration'), `${recipe.id} should offer ai-narration as optional`);
    assert.ok(recipe.optionalBlocks.includes('ai-npc-dialog'), `${recipe.id} should offer ai-npc-dialog as optional`);
  }
  assert.deepEqual(lintGenreRecipes(), []);
});
