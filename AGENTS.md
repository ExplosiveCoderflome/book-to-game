<!-- biz-project:start -->
## Biz Project

Use the biz-project skill when developing, fixing, reviewing or handing off project
work, synchronizing features between branches, or checking release status.
In Codex invoke $biz-project; in Cursor invoke /biz-project.
Pass --host codex or --host cursor to the bundled helper to match the active tool.
Other tools use --host generic with their explicitly selected active --rules-file.
Before work, inspect the central records using the helper bundled with the skill.
If no records center exists, ask the user to confirm its path before any writes.
Do not initialize from a suggested path or silently reuse a legacy center.
Initialize missing registration or invocation guidance before continuing.
Project records ID: 5fcb94d3-0817-4b69-895a-f0c06f67853f
Read the registered project profile and existing feature record. Keep changes,
verification evidence and handoff updates in that central record. Follow existing
project-specific branch, release and delegation rules. Existing local notes are
migrated only within the authorized task scope.
<!-- biz-project:end -->

## Project agreements

- Independent novel-to-text-game workbench. Novel-to-game is the first priority.
- Node.js, TypeScript, Express, React, SQLite. Do not introduce NestJS.
- Modules expose a small public `index.ts`; other modules may not import internals.
- Domain/application code depends on ports, never Express, MCP, SQL or provider SDKs.
- HTTP and MCP call the same application use cases. Never duplicate game rules in adapters.
- Published game revisions are immutable. Sessions pin a revision; actions are idempotent.
- Write meaningful behavior tests for state, recovery, permissions and module boundaries.
- Existing novel project D:/code/ai is an integration source; do not modify it here.
- For the open-adventure slice on 2026-10-10, the user explicitly approved two gpt-6.1-sol subagents for frontend and runtime work. That assignment is complete; it is not standing approval for future delegations. Follow the latest user delegation instructions for each new assignment.
- Never commit secrets, local novels, SQLite files or generated runtime data.

## Block catalog (积木商店)

- `packages/contracts/src/blocks.ts` is the **积木商店** shelf: a BlockSpec catalog. Genres are *recipes* (`packages/contracts/src/genre-recipes.ts`) over the same WorldContent substrate; never add a parallel per-genre state machine.
- New blocks compile down through existing `provides` / `requires`. Stubs (e.g. `encounters`, `combat-stake`, `shop-cycle`) declare params + composition + acceptance and say in the blurb what runtime already does vs what authors/AI fill via actions/storylets.
- Catalog ops stay `list_blocks` / `list_fun_profiles` / `list_genre_recipes` / `recommend_blocks_for_profile`; ids such as `building-library` and `item-catalog` are stable.
- `ai-overlay` is a `provides` value, not WorldContent: it marks ephemeral play-time text (narration / NPC bubble / suggestion) that never persists into a revision or save.
- 积木商店按**货架**（`BLOCK_SHELVES`：foundation / world-content / commerce / combat-growth / ops / ai-live）分类浏览；`BlockSpec.shelves` 可多选，货架只是浏览分区，不绑死玩法。**品类配方**（`GENRE_RECIPES`：`sim-commerce` 模拟经营 / `combat-growth` 打怪成长）是独立目录的声明式拼装菜单（required / recommended / optional），通过 `list_genre_recipes` 只读暴露；FunProfile `suggestedBlocks` 表达爽感推荐，GenreRecipe 表达品类拼装，两者不互相冒充。观测页 `book-to-game-block-shop.html` 由 `scripts/gen-block-shop.ts` 从 `getBlockCatalog()` + `getGenreRecipes()` 生成。

## UI layout

- Prefer **content-first horizontal fill**: App shell and primary work surfaces (especially the infinite canvas) use nearly full viewport width with small consistent gutters (`--shell-gutter*`). Avoid large bilateral whitespace from `max-width` + `margin: auto` shells.
- Prefer **density over stretch**: on wide viewports, use extra width to show more modules side-by-side (dual inspector panes, multi-column strips), not empty stretch.
- Full rules: [docs/design-layout.md](docs/design-layout.md).

## AI fusion layers

- **Shared play-time AI helper:** `apps/server/src/modules/play-ai` (`runPlayAi({kind, budget, context, signal})` → `{status:'ok'|'unavailable', text, reason, cached?}`). `narrateSession` / `narrateAdventure` / `npcDialogAdventure` all route through it; it owns soft-fail, per-save call budgets and an in-memory text cache (explicitly non-durable). Model access still comes from `createPlayProvider()`; never add a second HTTP client.
- **AI 积木（shelf `ai-live`「临场 AI」）:** `ai-narration` (wraps the existing narrator), `ai-npc-dialog` (1–2 line NPC bubble from currently visible NPCs only; next slice extends story mode), `ai-slot-template` (declarative by-recipe AI slot: trigger / context_pack / writeback / recipe_hint; catalog + lint only, no codegen executor yet). All AI blocks default OFF, are optional in genre recipes (never required), emit only `ai-overlay`, and must never mutate graph/state, variables/facts, or invent choices/actions.
- **L1 narrate (play-time, optional, default OFF):** flavor旁白 via `POST /api/sessions/:id/narrate` (story) and `POST /api/adventures/:id/narrate` (open adventure). Same NarrateInput/Result; adventure `sceneId` = location id. Must not mutate graph/state, variables/facts, or invent choices/actions.
- **L1 NPC bubble (adventure, optional, default OFF):** `POST /api/adventures/:id/npc-dialog` with `{npcId}` from the current view; unknown/hidden NPC ids are 404, never invented. Story-mode NPC dialog is a documented next slice (block ships as catalog-only there).
- **L2 propose-act (play-time):** free text mapped only onto currently visible/worldbook-filtered edges; rule engine still advances state.
- **天道修正 (play-time, optional, default OFF):** when ON, narrate / propose-act (story + adventure) append a soft system-prompt block so the model stays in worldbook/graph scope and replies with in-world「天道修正」tone if the player tries to rewrite rules via language. Phase 1 is prompt-only (no classifier); never mutates engine state.
- **L3 author-time:** graph growth (generate / extend). Node/graph + variables remain the hard source of truth; worldbook constrains agency.
- **Fill scene text (author-time):** `POST /api/drafts/:id/fill-scene-text` deepens one scene body only; client applies as dirty local edit (no topology change).

## Design skill

For UI design/redesign/polish, follow `.cursor/ui-ux-kit/SKILL.md` (from [arham777/ui-ux-kit](https://github.com/arham777/ui-ux-kit)). Also see `docs/design-layout.md` and `docs/design-ui.md`.
