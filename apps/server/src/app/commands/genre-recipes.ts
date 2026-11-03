import { getBlock, getGenreRecipes, lintGenreRecipes } from '@novel-game/contracts';
import { command, emptySchema } from './definition.js';

const summarizeBlocks = (ids: readonly string[]) => ids.map(id => {
  const block = getBlock(id);
  return block
    ? {id: block.id, label: block.label, blurb: block.blurb, shelves: block.shelves, registered: true}
    : {id, label: id, blurb: '', shelves: [], registered: false};
});

/** 品类配方（GenreRecipe）目录：只读，不写世界、不应用配方。 */
export function genreRecipeCommands() {
  return [
    command('list_genre_recipes', '目录当前品类配方（GenreRecipe，如模拟经营/打怪成长），只读；返回 required/recommended/optional 积木及展开摘要与 dependsOn 缺失提示，供作者挑选拼装菜单，人审。',
      emptySchema, true, () => ({
        recipes: getGenreRecipes().map(recipe => {
          const members = new Set([...recipe.requiredBlocks, ...recipe.recommendedBlocks, ...recipe.optionalBlocks]);
          const missingDependencies = recipe.requiredBlocks.flatMap(id => {
            const block = getBlock(id);
            if (!block) return [];
            return block.composesWith.dependsOn
              .filter(dep => !members.has(dep))
              .map(dep => ({blockId: id, missingBlockId: dep}));
          });
          return {
            ...recipe,
            resolved: {
              required: summarizeBlocks(recipe.requiredBlocks),
              recommended: summarizeBlocks(recipe.recommendedBlocks),
              optional: summarizeBlocks(recipe.optionalBlocks),
            },
            missingDependencies,
          };
        }),
        lint: lintGenreRecipes(),
      })),
  ];
}
