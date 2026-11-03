import { z } from 'zod';
import { BLOCKS, BLOCK_SHELVES, blockShelfIdSchema, type BlockShelfId, type BlockSpec } from './blocks.js';
import { FUN_PROFILES, funTagSchema } from './fun-profiles.js';

/**
 * 品类配方（GenreRecipe）：积木商店之上的声明式拼装菜单。
 *
 * 配方不引入新的运行时或平行状态机，只约定「某类玩法大致需要哪些积木」：
 * - required：拼出骨架必须的积木；
 * - recommended：强烈建议一起用、能补齐体验的积木；
 * - optional：按题材/篇幅再考虑的积木。
 *
 * 真正的编译约束仍在 BlockSpec 的 `requires` / `composesWith`；配方只是目录层的
 * 组合建议，可被多条配方共享同一块积木。货架（BlockSpec.shelves）仍是浏览分区，
 * `primaryShelves` 仅作配方落点提示。
 */

const blockRef = z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/);
const funProfileRef = z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/);

export const genreRecipeIdSchema = z.string().regex(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/, 'recipe id must be kebab-case');
export type GenreRecipeId = z.infer<typeof genreRecipeIdSchema>;

export const genreRecipeSchema = z.object({
  id: genreRecipeIdSchema,
  /** Bump on breaking changes to the composition menu. */
  version: z.number().int().positive(),
  /** 中文品类名，例如「模拟经营」。 */
  label: z.string().min(1).max(80),
  /** 中文拼装意图，并说明哪些仍是 stub / 由作者补全。 */
  blurb: z.string().min(1).max(600),
  /** 配方主要挂靠的货架，用于商店/观测页分组提示；不替代配方本身。 */
  primaryShelves: z.array(blockShelfIdSchema).min(1).max(5),
  requiredBlocks: z.array(blockRef).min(1).max(32),
  recommendedBlocks: z.array(blockRef).max(32).default([]),
  optionalBlocks: z.array(blockRef).max(32).default([]),
  funTags: z.array(funTagSchema).max(16).default([]),
  /** 关联的爽感画像 id（healing / grinding 等），仅作目录关联，不写回 FunProfile。 */
  relatedFunProfiles: z.array(funProfileRef).max(16).default([]),
  /** 与其他配方互斥（例如同一世界线不混用两套主循环），可留空。 */
  conflictsWithRecipes: z.array(genreRecipeIdSchema).max(16).default([]),
}).superRefine((recipe, ctx) => {
  for (const [field, values] of [
    ['requiredBlocks', recipe.requiredBlocks],
    ['recommendedBlocks', recipe.recommendedBlocks],
    ['optionalBlocks', recipe.optionalBlocks],
    ['primaryShelves', recipe.primaryShelves],
    ['funTags', recipe.funTags],
    ['relatedFunProfiles', recipe.relatedFunProfiles],
    ['conflictsWithRecipes', recipe.conflictsWithRecipes],
  ] as const) {
    if (new Set(values).size !== values.length) {
      ctx.addIssue({code: 'custom', message: `duplicate entry in ${field}`, path: [field]});
    }
  }
  if (recipe.conflictsWithRecipes.includes(recipe.id)) {
    ctx.addIssue({code: 'custom', message: 'recipe cannot conflict with itself', path: ['conflictsWithRecipes']});
  }
});
export type GenreRecipe = z.infer<typeof genreRecipeSchema>;

const RAW_RECIPES: z.input<typeof genreRecipeSchema>[] = [
  {
    id: 'sim-commerce', version: 2,
    label: '模拟经营',
    blurb: '一间小店 / 一座客栈的营业骨架：数值模板 + 时钟 + 物品库 + 营业日循环 + 客流 + 账本，再用剧情卡池、结局回顾与终局条件收束。营业日、排队、翻台与日结仍由作者通过行动/剧情卡补全，本配方不自建营业引擎；终局条件只提供胜负判定能力，具体谓词按局填写。',
    primaryShelves: ['commerce'],
    requiredBlocks: [
      'stat-templates', 'world-map', 'building-library', 'item-catalog',
      'clock', 'shop-cycle', 'customer-flow', 'ledger',
      'storylet-pool', 'endings-recap', 'end-conditions',
    ],
    recommendedBlocks: ['preflight-sim'],
    optionalBlocks: ['ai-narration', 'ai-npc-dialog'],
    funTags: ['healing-routine', 'warmth', 'collection'],
    relatedFunProfiles: ['healing', 'collection'],
    conflictsWithRecipes: [],
  },
  {
    id: 'combat-growth', version: 2,
    label: '打怪成长',
    blurb: '一条以遭遇驱动成长的骨架：数值模板 + 遭遇 + 成长曲线 + 掉落表 + 遭遇代价 + 物品库 + 剧情卡池 + 终局条件。战斗结算与升级仍由现有行动/事实/变量表达，本配方只是把积木拼成一条可验收的成长线，不新增战斗引擎；终局条件只提供胜负判定能力，具体谓词按局填写。',
    primaryShelves: ['combat-growth'],
    requiredBlocks: [
      'stat-templates', 'world-map', 'building-library', 'item-catalog',
      'encounters', 'growth-curve', 'loot-table', 'combat-stake', 'storylet-pool',
      'end-conditions',
    ],
    recommendedBlocks: ['endings-recap', 'preflight-sim'],
    optionalBlocks: ['clock', 'ai-narration', 'ai-npc-dialog'],
    funTags: ['growth', 'grinding', 'collection'],
    relatedFunProfiles: ['grinding', 'collection'],
    conflictsWithRecipes: [],
  },
];

/** Shipped recipes are validated at module load so catalog drift fails fast. */
export const GENRE_RECIPES: readonly GenreRecipe[] = RAW_RECIPES.map(recipe => genreRecipeSchema.parse(recipe));

export function getGenreRecipe(id: string | undefined | null): GenreRecipe | undefined {
  if (!id) return undefined;
  return GENRE_RECIPES.find(recipe => recipe.id === id);
}

/** Read-only catalog projection for `list_genre_recipes`. */
export function getGenreRecipes(): GenreRecipe[] {
  return [...GENRE_RECIPES];
}

export interface GenreRecipeLintIssue {
  severity: 'error' | 'warning';
  recipeId?: string;
  blockId?: string;
  shelfId?: BlockShelfId;
  ruleId:
    | 'recipes.duplicate-id'
    | 'recipes.unknown-block'
    | 'recipes.unknown-shelf'
    | 'recipes.unknown-fun-profile'
    | 'recipes.unknown-recipe'
    | 'recipes.self-conflict'
    | 'recipes.conflict'
    | 'recipes.missing-dependency'
    | 'recipes.duplicate-across-lists'
    | 'recipes.empty-required'
    | 'recipes.missing-end-conditions';
  message: string;
}

const blockById = (id: string): BlockSpec | undefined => BLOCKS.find(block => block.id === id);

/**
 * Registry-level lint for genre recipes.
 *
 * Errors: duplicate recipe ids, unknown block/shelf/fun-profile ids, unknown or self
 * recipe conflicts, blocks that conflict within one recipe, required blocks whose
 * `dependsOn` is missing from every recipe list, and empty required lists.
 *
 * Warnings: the same block appears in more than one of required/recommended/optional.
 */
export function lintGenreRecipes(recipes: readonly GenreRecipe[] = GENRE_RECIPES, blocks: readonly BlockSpec[] = BLOCKS): GenreRecipeLintIssue[] {
  const issues: GenreRecipeLintIssue[] = [];
  const recipeIds = new Set<string>();
  const funProfileIds = new Set(FUN_PROFILES.map(profile => profile.id));
  const shelfIds = new Set<string>(BLOCK_SHELVES.map(shelf => shelf.id));
  const knownBlocks = new Map(blocks.map(block => [block.id, block]));

  for (const recipe of recipes) {
    if (recipeIds.has(recipe.id)) {
      issues.push({severity: 'error', recipeId: recipe.id, ruleId: 'recipes.duplicate-id',
        message: `duplicate recipe id: ${recipe.id}`});
    }
    recipeIds.add(recipe.id);
  }

  for (const recipe of recipes) {
    if (recipe.requiredBlocks.length === 0) {
      issues.push({severity: 'error', recipeId: recipe.id, ruleId: 'recipes.empty-required',
        message: `recipe ${recipe.id} has no required blocks`});
    }
    for (const shelf of recipe.primaryShelves) {
      if (!shelfIds.has(shelf)) {
        issues.push({severity: 'error', recipeId: recipe.id, shelfId: shelf, ruleId: 'recipes.unknown-shelf',
          message: `recipe ${recipe.id} references unknown shelf: ${shelf}`});
      }
    }
    for (const profileId of recipe.relatedFunProfiles) {
      if (!funProfileIds.has(profileId)) {
        issues.push({severity: 'error', recipeId: recipe.id, ruleId: 'recipes.unknown-fun-profile',
          message: `recipe ${recipe.id} references unknown fun profile: ${profileId}`});
      }
    }
    for (const other of recipe.conflictsWithRecipes) {
      if (other === recipe.id) {
        issues.push({severity: 'error', recipeId: recipe.id, ruleId: 'recipes.self-conflict',
          message: `recipe ${recipe.id} conflicts with itself`});
      } else if (!recipes.some(candidate => candidate.id === other)) {
        issues.push({severity: 'error', recipeId: recipe.id, ruleId: 'recipes.unknown-recipe',
          message: `recipe ${recipe.id} conflicts with unknown recipe: ${other}`});
      }
    }

    const lists = {
      required: recipe.requiredBlocks,
      recommended: recipe.recommendedBlocks,
      optional: recipe.optionalBlocks,
    };
    const allBlocks: string[] = [];
    for (const [listName, ids] of Object.entries(lists) as [keyof typeof lists, string[]][]) {
      for (const id of ids) {
        const block = knownBlocks.get(id);
        if (!block) {
          issues.push({severity: 'error', recipeId: recipe.id, blockId: id, ruleId: 'recipes.unknown-block',
            message: `recipe ${recipe.id} ${listName} references unknown block: ${id}`});
        }
        allBlocks.push(id);
      }
    }

    const counts = new Map<string, number>();
    for (const id of allBlocks) counts.set(id, (counts.get(id) ?? 0) + 1);
    for (const [id, count] of counts) {
      if (count > 1) {
        issues.push({severity: 'warning', recipeId: recipe.id, blockId: id, ruleId: 'recipes.duplicate-across-lists',
          message: `recipe ${recipe.id} lists block ${id} in more than one bucket`});
      }
    }

    const members = new Set(allBlocks);
    const reportedConflicts = new Set<string>();
    for (const id of allBlocks) {
      const block = knownBlocks.get(id);
      if (!block) continue;
      for (const conflict of block.composesWith.conflictsWith) {
        if (!members.has(conflict)) continue;
        const key = [id, conflict].sort().join('|');
        if (reportedConflicts.has(key)) continue;
        reportedConflicts.add(key);
        issues.push({severity: 'error', recipeId: recipe.id, blockId: id, ruleId: 'recipes.conflict',
          message: `recipe ${recipe.id} includes conflicting blocks: ${id} ↔ ${conflict}`});
      }
    }

    for (const id of recipe.requiredBlocks) {
      const block = knownBlocks.get(id);
      if (!block) continue;
      for (const dep of block.composesWith.dependsOn) {
        if (!members.has(dep)) {
          issues.push({severity: 'error', recipeId: recipe.id, blockId: id, ruleId: 'recipes.missing-dependency',
            message: `recipe ${recipe.id} requires ${id} but omits its dependency ${dep}`});
        }
      }
    }

    // 终局条件能力：任何收束到结局的配方都必须包含 end-conditions（具体胜负谓词仍按局填写）。
    if (members.has('endings-recap') && !members.has('end-conditions')) {
      issues.push({severity: 'error', recipeId: recipe.id, blockId: 'end-conditions', ruleId: 'recipes.missing-end-conditions',
        message: `recipe ${recipe.id} 收束到结局，但缺少终局条件积木 end-conditions`});
    }
  }

  return issues;
}
