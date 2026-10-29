# DESIGN_SYSTEM.md

> Official design reference for **故事工坊 / Story Workshop**. Future UI work must follow this file.

### Specialist surfaces (2026-10-30 · current author tools)

App/Product UI + Redesign. **Concept:** follow a manuscript through source evidence, production, editing and playtesting, with the Agent always one discussion away. Extends the conversation studio to all nine author tools: sources, production, worlds, stories, buildings, items, both playtests and model settings. The standalone reader remains a reading surface.

`WorkspaceHeader` supplies one page h1, a concrete description and right-aligned actions. `workspace-surfaces.css` uses existing tokens: surface-muted page, white working surfaces, restrained green actions, 24px headings, 18px section headings, 16px prose, 14px controls, 12–13px metadata. Dense control labels retain the established workbench scale. Neutral surface hierarchy replaces old numbered/marketing introductions and decorative selection stripes. Reuse `StudioIcon`; no new dependency, raster asset, font download or animation.

The specialist stage scrolls inside the viewport below the 56px header (52px phone); the navigation stays available. Pages mount on first visit and retain local forms/editor state when hidden. Production/adaptation forms also stay mounted across workflow switches. Sources use a 280px shelf and reading area above1100px, one column below. Production records precede the collapsible creation brief; actual status totals, keyword/status filters and selected task highlights come from saved data. Model connection facts are saved-state facts, with a separate test result; advanced timeout controls are disclosed. Mobile editor toolbars retain edit/play and view selectors; `EditorTools` reveals advanced tools inline, so it cannot run offscreen. Canvas inspectors stack below the graph under1101px.

`WorkspaceSearch` is a native modal, available by button or Ctrl/Cmd+K. It searches page names and actual sources/drafts/tasks, shows up to30 matches, supports arrows/Enter/Escape and restores focus. `#play` is the author playtest; `#/play` is the standalone reader. Search/recent-work/task links share the same draft-switch checks as editor selection, including unfinished new drafts and in-flight operations. Completing a background job never steals the current page.

Every specialist header can prepare an Agent discussion. A visible handoff strip lets the author load and edit it; sending invokes the model. It preserves existing composer input and attaches only the selected saved draft/version or source. Local unsaved graph changes are not passed as saved content. This entry does not grant new model tools or replace existing write/publish confirmations.

Adversarial pass found a cramped tablet reading column, a phone toolbar that pushed the actual canvas offscreen, the author/player play-route collision, and a cross-page draft-switch bypass. Fixed by stacking the reading layout, disclosing advanced tools, separating the hashes and sharing one navigation check. No fake assets or fabricated task progress. Computed contrast: muted/paper5.67:1, muted/surface-muted5.28:1, muted/accent-soft4.79:1, primary/paper6.29:1, ink/surface-muted15.91:1. See [workspace UI acceptance](docs/workspace-surfaces-2026-10-30.md) for actual browser and build evidence. Prior reference choices below remain: Linear hierarchy, Notion wayfinding, adjacent Claude artifacts, adapted to this manuscript workflow.

### Agent workspace redesign (2026-10-29 · current author shell)

App/Product UI + Redesign. **Concept:** a story production studio where the conversation, the agent's actual work, and the playable manuscript are adjacent. This overrides the old numbered top-tab shell below for author pages; the player shell remains separate. `#agent` is the default, with deep links for every author surface and browser back/forward support.

One persistent left rail (232px / 248px at ≥1680px) combines navigation and conversation history. It exposes Agent, sources, production, and world drafts; auxiliary tools sit in a native disclosure and model settings stay at the foot. A 56px workspace header preserves orientation. The central conversation owns remaining space; the right 300px / 340px pane shows actual draft context and activity. The message measure (840px) and composer measure (940px including gutters) are reading exceptions inside the full-width stage, never a centered app shell. Below1101px context becomes a modal panel; below761px navigation and history become native dialogs. The composer remains in the viewport, including375px phones and720px-height laptops.

Use `studio.css` and `agent-workspace.css` for this surface. Existing green (`#2f6b4f` / hover `#24553e`) and neutral paper remain. New semantic roles: `--studio-side:#f1f3f0`, `--studio-side-hover:#e7ebe5`, `--studio-accent-soft:#e6eee8`, `--studio-muted:#62695f`. Use background contrast for hierarchy, hairline dividers for navigation/data, one subtle shadow for the input surface. No gradients, sparkle marks, imaginary thumbnails, or invented progress. The custom outline icon family is `StudioIcon` (1.6 stroke), with a branching-story mark. Existing system UI fonts stay offline-safe. Reading text is16px; UI labels14px, metadata10–13px under the existing dense-workbench convention; welcome heading28px (24px phone), not a marketing hero.

Verified contrast: muted on paper5.67:1, rail5.08:1, accent-soft4.79:1; active green on soft7.27:1; white on primary6.29:1. Keyboard rings use existing focus blue. Reduced motion disables the working opacity pulse and control transitions. Native modal focus/escape behavior, named icon controls and skip-to-content are required.

Tool calls render as compact, readable steps; full JSON is disclosed only on demand. Model text is safe React text with paragraphs, headings, lists, emphasis and code; model HTML never executes. Approval cards stay beside the matching proposal and show actual status, exact arguments and confirm/reject controls. Failed, skipped, rejected and uncertain states are never labeled executed. Context chips disclose the selected draft and version; the actual metadata goes to the configured model with the message, without exposing internal IDs in conversation titles.

Adversarial review: the previous screen was a form embedded in administrative tabs. The first redesign still inherited20px shell gutters, auto-scrolled the empty page, and inherited12px margins around each tool disclosure; these were removed. Phone title wrapping and unnamed icon controls were fixed. A live read-only DeepSeek conversation exposed raw context IDs in titles; legacy titles now display the project name and new messages place context after the author's text. No new UI package, raster asset, decorative motion, or dark theme was introduced.

References translated into this product (not cloned): [Linear's hierarchy reset](https://linear.app/changelog/2024-03-20-new-linear-ui) → quiet navigation and compact actions; [Notion sidebar navigation](https://www.notion.com/help/guides/navigating-with-the-sidebar) → one navigation/history rail; [Claude artifacts](https://support.claude.com/en/articles/17153992-what-are-artifacts-and-how-do-i-use-them) → a persistent work product beside the conversation. The manuscript, source evidence and production states are specific to Story Workshop.

### Agent repair review (2026-10-29)

App/Product UI; extends the existing author preflight surface. Candidates use compact bordered rows (`--line`), plain status text, native `details` for exact diffs, wrapped technical values, and explicit apply/reject actions. No new palette or navigation surface. Empty/loading/error/stale/blocked/applied/rejected states stay inline. Dirty drafts cannot be applied to; author controls are locked during verification. Existing lint errors remain visible and are not represented as a publication pass. Adversarial review found that a single “verification passed” message could hide pre-existing errors; the panel now shows before/after error counts and explicitly retains the need to fix them. Use this file as the design guide for future pages, sections, and components so the website remains consistent.

## 1. Project overview

- **Website / product name:** 故事工坊 (Story Workshop)
- **Website type:** Authoring workbench (novel → branching text game)
- **Surface profile:** App/Product UI · Redesign
- **Platform:** web (Vite + React + CSS tokens)
- **Target users:** Novel adapters / interactive-fiction authors editing graphs, worldbooks, and playtests locally
- **Main design goal:** A conversation-led creation workspace with visible execution and adjacent artifacts; keep specialized graph editors available without making their controls the app's navigation.

## 2. Brand direction

- **Visual style:** Restrained modern productivity (Linear-adjacent density)
- **Mood & tone:** Calm, technical-authoring, low theater
- **Design personality:** Minimal / swiss-rational grotesque UI; serif only for long reading prose
- **Design concept (one sentence):** A story production studio: the author's conversation, the agent's work, and the playable manuscript sit together on a quiet neutral field with green marking actions and approved progress; graph canvases remain primary inside their dedicated editors.
- **Adversarial-review verdict:** Covering the brand name, the UI still reads as a graph authoring instrument (canvas primacy + quiet chrome + single green signal). Weakness found+fixed: “天道修正 / L2 自由输入” callouts used AI-purple and soft-blue pastel fills — replaced with neutral muted surfaces and the shared green accent language.
- **Reference style used:** Named exemplars (no live web scrape this pass): Linear (quiet tabs, density), Notion (calm panels), Figma (canvas-as-primary). Adapted: underline tabs + compact status strips; not cloned marketing layouts.
- **Voice & UX copy:** Plain Chinese-first (`t()`); CTAs are verbs (“开始新存档”, “保存”); empty/error/loading use specific next actions, not filler (“Elevate / Seamless”).

## 3. Color system

| Role | Color | Hex | Usage |
|---|---|---|---|
| 60% — Dominant | App canvas | `#f4f4f2` (`--bg`) | Page field behind panels |
| 30% — Secondary | Surfaces | `#ffffff` (`--surface` / `--paper`), `#f7f7f5` (`--surface-muted`) | Cards, inspectors, tool strips |
| 10% — Accent | Forest green | `#2f6b4f` (`--green` / `--accent`), hover `#24553e` | Primary buttons, active tab, success signal |

Supporting tokens:

| Token | Hex | Usage |
|---|---|---|
| `--ink` | `#1c1c1a` | Primary text |
| `--muted` | `#6b6b67` | Secondary text |
| `--line` | `#e4e4e0` | Quiet borders |
| `--line-strong` | `#d0d0cb` | Control borders |
| `--rust` | `#b42318` | Danger / playability / failed only |
| `--focus` | `#3b82f6` | Keyboard focus ring only |
| `--warn-bg` / `--warn-ink` / `--warn-line` | `#fffaeb` / `#93370d` / `#f1d39b` | Amber — **only** 「会丢进度」 save warnings (`.storage-banner`, `.save-slot-unsaved`, `.save-slot-fallback`). Never export reports (X15) |

**Usage rules:**
- Backgrounds: `--bg` field; raised work on `--surface`.
- Text: `--ink` / `--muted` only for chrome; no light-gray-on-white body.
- Buttons: default surface+line; primary = green fill + white label; danger = rust text.
- Cards/panels: 1px `--line`, optional `--shadow-xs` — no deep drop shadows, no cream paper.
- Highlights / focus: green for brand active; `--focus` ring on `:focus-visible` only.
- Separation: prefer border + muted fill over multi-pastel posters. Status strips use left 3px accent + `--surface-muted`.
- **Dark mode:** not shipped.

Anti-slop: no purple gradients, no AI lavender fills, no cream-literary chrome.

## 4. Typography system

- **Brand personality:** Corporate-clean / modern SaaS (workbench), with serif reserved for reading
- **Font family / pairing:**
  - UI: `--font-ui` = `"Segoe UI", "PingFang SC", "Microsoft YaHei", system-ui, -apple-system, sans-serif`
  - Reading prose only: `--serif` = `"Noto Serif SC", "Songti SC", "SimSun", Georgia, serif`
- **Why these fonts fit:** System UI grotesque keeps chrome product-like; Songti/Noto Serif keeps long narrative readable without turning the shell literary.
- **Type scale (workbench):**
  - Shell title / brand strong: 15px / 650
  - Section h2 (non-canvas pages): 17px
  - Canvas workbench h2: 15px
  - Panel h3 / chrome h4: 14–16px / 12px
  - Body UI: 13–14px (root 14px)
  - Caption / eyebrow / tab numbers: 10–12px
  - Reader title: 18px sans; reader body: ~17px serif, line-height ~2.1
- **Body text:** UI ≥13px; reading prose ≥16px. 手机端玩家壳：正文与可点文字 ≥14px，纯元信息 ≥12px，见 §6 移动端
- **Line-height / line-length:** UI ~1.5; prose measure `--prose-max: 72ch`
- **Button text:** 12–13px, weight 500–600
- **Responsive rules:** Collapse dual inspector below 980px; wide density ≥1440px

## 5. Layout system

- **Container widths:** App shell full-bleed (`max-width: none`); gutters `--shell-gutter` 16px / `--shell-gutter-lg` 20px. Prose exception: reading/connect may use measure.
- **Section spacing:** Compact work-section padding (~10–20px); canvas height `calc(100vh - 168px)`.
- **Grid rules:** Canvas primary column + inspector column(s); ≥1440 dual inspector side-by-side.
- **Page anatomy:** persistent author sidebar → workspace breadcrumb → active creation surface. Agent: conversation + adjacent context/activity + persistent composer. Specialized editors retain their own toolbars/canvases/inspectors. Player chrome remains separate.
- **Conversion / CTA flow:** N/A for workbench; primary action per screen (e.g. Save, Start new save).
- **App/Product flows:** Nav placement constant; edit↔play mode toggle on canvas; deep-link via draft/revision selection.
- **Hero composition:** N/A (no marketing hero on workbench). Connect page is utilitarian, not a landing hero.
- **Breakpoints:** stack ~980; **phone 760（CSS 与 `COMPACT_QUERY` 共用）**; density-wide 1440; ultra 1680. 断点顺序与优先级见 §6「移动端（≤760px）」.
- **Alignment rules:** Full-bleed primary surfaces; density-over-stretch (see `docs/design-layout.md`).

## 6. Component system

- **Component base / library:** Native CSS + React components (no shadcn defaults).
- **Buttons:** default / `primary` / `quiet` / `danger` / `small`; hover, disabled, `:focus-visible`.
- **Cards / panels:** `.panel` — white, 1px line, radius 8, shadow-xs sparingly.
- **Badges / chips:** pill radius 999; muted by default; green only for active/done.
- **Navbar:** `.site-header` + `.workspace-bar` underline tabs with quiet tabular numbers.
- **Forms / inputs:** shared radius-sm; focus ring only on `:focus-visible`.
- **Status strips:** `.branch-canvas-gen`, `.branch-canvas-banner`, skeleton/extend guides — compact left-accent strips.
- **Play stats HUD:** `.play-stats` — ChoiceScript-inspired always-visible chart (role-ordered meters / flag pills; optional collapse, default open) between scene prose and choices. Outer shell keeps left green accent + muted fill; **inner rows are dense property-list dividers (no per-row card chrome)**. Supports optional `resources` with soft display labels. `.play-stats-delta` chips: `tone-gain` (green), `tone-loss` (muted), `tone-pressure` (rust). Option open/close lines under delta. Empty session HUD copy when no vars/resources. Patterns: `docs/if-editor-patterns.md`.
- **Play feedback concept:** 试玩反馈是精密仪器的读数面板：正文是信号，HUD 是刻度，代价是预告，delta 是回弹指针；辅区（天道/旁白）保持静音。
- **Play ending:** `.play-ending` — shared story/open shell: eyebrow · body · final-state chips ·「再开一局」primary +「回编辑改结局文案」quiet.
- **Adventure goal / result:** `.adventure-goal` / `.adventure-result` use `--surface-muted` + left 3px `--green` (no cream `#f1f2e7` / `#e9eddf`).
- **Stat Editor:** `.stat-editor` — universal inspector for `content.variables` (template-seeded or hand-added). Dense property-list rows (display label + mono name, role chip from catalog, type select, initial value, delete); compact template-apply strip; footer add bar. No fieldset stack, no card-in-card. Roles are display metadata only.
- **Choice rules:** `.choice-rules` — same dense instrument language as Stat Editor; conditions labeled gate, effects labeled cost; logic stays `conditions`/`effects` only.
- **Inspectors:** flat hierarchy; no card-in-card elevation; dual panes ≥1440.
- **Reader choices / adventure actions:** muted list actions with cost subline (11px muted tabular); locked rows grey + rust reason text — never color alone. No brochure cards.

### Player shell (M1)

| Token / class | Rule |
|---|---|
| `.player-shell` | Full-bleed; same `--bg` field; **no** `.workspace-bar` |
| `.player-shell .site-header` | Reuse header density; subtitle「故事工坊 · 游玩」; quiet「返回工作台」allowed |
| `.player-shell main` / `.play-landing-grid` | Single work-section; landing two columns ≥980, stack narrow |
| `.play-landing-row` | Dense `.list-button` rows — **no** store-poster cards / hero covers |
| `.player-shell .play-layout` | In-session: optional save aside + single reading column (+ open map column); no author catalog chrome |
| Ending CTA | Author: 再开一局 + 回编辑… · Player: 再开一局 + **返回书目** |
| Save list | Shared author-hosted/offline list: eight rows per page; playable rows before blocked rows; selecting/resuming a save reveals its page; list shrink clamps the page. Pagination is a labelled `nav`, with disabled bounds and busy state, plus a live page count |
| `.save-slot-pagination` | Reuse quiet buttons, `--muted` text and existing spacing; 44px touch targets at ≤760px; wrap controls instead of overflowing. No new colours, fonts or imagery |
| Save privacy | Automatic-save text contains no internal session UUID; routing and storage keep their existing IDs |
| Resource names | HUD, delta and fill costs share resource labels: explicit `resourceDefs` label → faction label → common default (`coin` = 银两). Insufficient-funds text uses the same currency name |
| Save-list review (2026-10-28) | Existing density, fonts and palette retained. Weakness fixed: a resumed save could be on a hidden page; selecting it now reveals that page. Edge checks at 375/768/1280px cover page controls, list shrink and ID privacy; no overflow. Pagination `--muted` on `--surface` contrast: 5.35:1 |
| Anti-slop | No splash poster, discount bar, star ratings, account wall, export-zip button, neon game kit |

### Export package (M1b-1)

| Token / class | Rule |
|---|---|
| Author entry | One `button.quiet`「导出可玩包（网页版）」in the editor footer after「复制玩家链接」; unpublished → disabled + hint「先发布再导出」; dirty → hint「导出的是已发布 v{n}」. Never a primary/hero button, never a zip/store-style CTA |
| `.export-report` | One compact left-accent strip directly under the footer: `.ok` green / `.failed` rust / `.busy` muted. Main line = facts (size · mode · freeze); degraded items in a muted `<details>`; failures say what happened + no file created + next step. Never echoes a secret value |
| Package player | Same `.player-shell` chrome minus workbench links: no 返回工作台 / 返回书目 / 复制链接 / AI aux; eyebrow「{mode} · v{version}」; saves list is `.list-button` rows「存档 {n}」 |
| `.list-button.blocked` | Old-version / damaged saves: greyed, disabled, kept after continuable rows, rust `.save-slot-reason` text (never color alone) |
| `.save-slot-unsaved` | Small amber pill「未保存」on the current row when storage is unavailable |
| `.storage-banner` | Full-width amber status strip above `<main>` (role=status) when saving is impossible; play continues |
| `.package-error` | Single centered work-section for damaged / newer-format files: title + one sentence + `<details>` 技术信息 + 重新打开 |

### Export package · Windows (M1b-2)

| Token / class | Rule |
|---|---|
| Author entry | Two adjacent `button.quiet` in the editor footer:「导出可玩包（网页版）」then「导出 Windows 版」, wrapped in `.export-actions` (no wrap between them). One shared hint span. One in-flight export per panel — the other button is disabled while either runs. No platform logos, no dropdown/segmented picker |
| Player missing | Windows button disabled + hint「Windows 播放器未就绪，网页版可正常导出」. If learned on click: `.export-report.unavailable` = muted strip (left 3px `--line-strong`), **not** rust — it is an environment fact, not an author error |
| `.export-report.ok` (exe) | Same strip; main line adds「· Windows 版」; optional mono player line (`.export-player`); one 13px ink SmartScreen sentence (`.export-smartscreen`). No shield icon, no amber fill — known behaviour, not an error |
| Native dialogs | Player-side OS TaskDialog/MessageBox only (system icon + title + one main sentence + body + system buttons). Never a custom-drawn window, splash, or poster |
| Window | Title = game title only; min 980×640; no menu bar; no splash |
| `.storage-banner` variants | Same strip, same colors; copy varies by `where` (browser / host-file / host-fallback); only one banner at a time (unsaved > fallback) |
| `.save-slot-location` | 「存档位置」`<details>` under the saves list: mono 11px env-var path + `button.quiet.small`「复制路径」; package id only here, never as primary text |
| `.save-slot-fallback` | Same pill shape as `.save-slot-unsaved`, text「临时位置」 |

### 移动端（≤760px）· Player phone

适用：`.player-shell`（/play 玩家壳、作者试玩、HTML 包、exe 窗口缩到 ≤760 时）。桌面与 exe 默认窗口（≥980）不变。
唯一断点 `760px`；JS 端用 `COMPACT_QUERY = '(max-width: 760px)'`，CSS 写 `@media (width <= 760px)`，两边同值，不另起 720 / 768。

| 规则 | 要求 | 验证 |
|---|---|---|
| 单栏 | 进局后只有一列：阅读栏在上，存档侧栏 `order: 2` 放到下方，且默认收起 | 390 宽：`grid-template-columns` 只有一个轨道；正文顶边 < 视口高 |
| 正文在第一屏 | 开局 / 读档后第一屏能看到地点标题和至少 2 行正文；世界简介最多 1 行（clamp-1） | 390×844：`.reader-text` 顶边 < 844 |
| 紧凑状态行 | `PlayStatsCompact` 放在目标块之后、地点标题之前；`position: sticky; top: 0`，白底 + 1px 线；完整 `PlayStatsBar` 留在正文之后；结局时取消 sticky | 状态行在第一屏；结局时 `position: static` |
| 行动后滚到结果 | 回合数增加 → 把「刚刚发生」滚到顶部（`scroll-margin-top` 要让开 sticky 行）；到达结局按结局规则滚（结局页 §2） | 点完行动后结果在视口内 |
| 字号下限 | 正文、选项、锁定原因、掷骰结果、资源名和数值、按钮、清单 ≥ 14px；只有纯元信息（版本号、行动计数、eyebrow）可以 ≥ 12px | 计算样式检查 |
| 点击区 | 一切可点元素（按钮、`summary`、行动行、存档行）≥ 44×44px；相邻点击区间距 ≥ 8px | 外框高度检查 |
| 寿元封顶 | 倒计时类资源（`countdownResourceId`，如寿元）永不显示「已封顶」；到上限时只显示数值 | 文本检查 |
| 不横向滚动 | 任何状态下 `scrollWidth ≤ innerWidth`；长 id、路径用 `overflow-wrap: anywhere` | 每个截图点检查 |
| 数值不拆行 | 一个「名 值/上限」是一个 `nowrap` 单元，只在单元之间换行 | 不出现「1 /」换行后接「5」 |
| 触屏 hover | `:hover` 底色只写在 `@media (hover: hover)` 里；触屏上点过的行不能留着绿底，看起来像被选中 | 点完行动后截图里没有残留的着色 |
| 少套层 | 手机端不叠三层表面（白面板 → 灰块 → 带框卡 → 灰选项）；剧情卡在手机上去掉外框，只保留标题行和选项行 | 目测截图 |
| 空态只说一次 | 同一屏同一件事只出一个空态（例如「还没有存档」） | 开始页截图 |

**断点顺序与优先级（2026-10-28 根因：桌面 `.player-shell .play-layout.player-play-layout:not(.with-map)` 的两栏规则特异性高于通用的 ≤760 单栏回退，把正文挤到约 70px）**
1. 覆盖某条桌面规则的手机规则，必须用**同一个选择器**（或更高特异性），写在那条桌面规则**之后、同一个文件里**，紧挨着它。
2. 同一组件的媒体查询按 基础 → `≥1440` / `≥1680` → `≤1100` / `≤980` → `≤760` 排列，**最窄的放最后**。
3. 不用 `!important` 去赢特异性；赢不了，就说明选择器写错了地方。
4. 新增任何 `grid-template-columns` 或 `display: grid` 的桌面规则，都要在 390 宽的手机 e2e 里断言它只剩单轨。


## 7. Card & section style

- **Chosen style:** Flat / soft border; light shadow only where elevation is real
- **Radius:** `--radius-sm` 6 / `--radius` 8 / `--radius-lg` 12 (canvas stage uses 8 after redesign)
- **Shadow / elevation:** `--shadow-xs`, `--shadow-sm`
- **Gradients:** none for chrome (canvas viewport may keep subtle dot grid)
- **Glassmorphism:** none
- **Rule:** no nested card-heavy layouts; one elevation hierarchy

## 8. Icon system

- **Icon library:** Text/emoji-sparingly in chrome; structural controls use text labels (icon+text when icons appear)
- **Icon size / color:** inherit muted/ink; never color-alone meaning
- **Usage rules:** icon-only controls need accessible labels

## 9. Image & asset rules

- **Logo:** text wordmark + small green seal “叙” (CSS square, not seal theater)
- **User / AI / stock images:** not primary; screenshots live under `/workspace/btg-e2e/screenshots/`
- **Crop / radius / treatment:** N/A for core chrome

## 10. Animation & interaction system

- **Animation library:** CSS-only transitions (~120ms) on controls
- **Hover / pressed / disabled:** defined on buttons and list rows
- **Focus:** `:focus-visible` outline 2px `--focus` (buttons/links); fields get border + soft glow
- **Async feedback:** Notice strips; button disabled + status text; skeletons for mid-job canvas
- **Data view states:** Empty (`.empty`), loading (`role="status"` copy), error (`.notice`)
- **Reduced-motion:** no decorative motion loops; respect browser defaults
- **Performance:** CSS-first chrome; canvas SVG; avoid layout thrash from posters

## 11. Accessibility rules

- Contrast: ink on bg/surface targets AA; muted used for secondary only
- Focus: visible `:focus-visible`; no mouse-focus flash on fields
- Keyboard: native controls; workspace tabs are buttons with `aria-current`
- Semantics: `nav`, `main`, `aside`, `role="status"` on strips
- Never color alone for playability — text issues listed in banner

## 12. Anti-AI-slop rules

- **Approved palette:** only tokens in §3
- **Pure `#000`/`#fff`:** white surfaces yes (`#fff`); pure black no — ink is `#1c1c1a`
- **Concept-test verdict:** still distinctive as graph workbench after covering brand; fixed purple/blue pastel AI callouts
- **Exceptions:** Reader body may use serif; connect page may keep short marketing line but must stay product-toned

## 13. Future page instructions

Reuse tokens, quiet chrome, canvas primacy, and compact status strips. Do not reintroduce brochure wizards, cream paper, or multi-pastel posters.

## 14. Update policy

### RPG production (白展堂验收入口)

- Profile: App/Product UI. The production desk makes the author review a character and its consequences before prose is written; existing neutral/green tokens, system UI fonts and dense form/list patterns remain in use.
- The existing generation page has two workflow buttons: role-playing production and quick adaptation. Production uses a brief form plus saved job records; a plain numbered row names the stages.
- A review job shows identity boundaries, a compact relationship definition list and strategy/ending summaries. JSON editing stays in optional advanced details. Confirming the plan is the primary action; publishing remains in the existing draft flow.
- Completed/failed writing jobs offer a collapsed single-unit revision form: native target select, author feedback and one action. Copy explains that mechanics and other text are reused and the previous draft is kept.
- Empty, model-unconfigured, busy, unknown-request, failed/resumable, review and completed-with-quality-issues states are explicit. A body-writing counter reports persisted units, never fabricated progress.
- No cover imagery, new palette, animation library or style family. At narrow widths the form/records and relationship columns stack; controls keep 44px touch targets.
- Review found the records panel was stretching to match the long brief form; it now aligns to its own content height. The heading describes production instead of requiring a novel. Existing muted/white text contrast remains 5.35:1; no new colour pairs.

If tokens or chrome patterns change, update this file, `docs/design-ui.md`, and `docs/design-layout.md` in the same change.

### Building library (建筑库)
- **Surface:** App/Product catalog studio (not a CRUD form farm).
- **Lead:** AI generate strip — one prompt, kind chips, 「生成」; selectable draft cards; optional 「为所选草案生成图」; 「入库所选」 via catalog accept (never silent overwrite).
- **Catalog:** Full-width **card grid** with portrait thumbnails (16:10), kind chip, blurb clamp; empty / skeleton loading / error states required.
- **Inspector:** Portrait hero + 「生成图片」/「重新生成图」; primary fields; advanced options collapsed.
- **Images:** Display-only (`imageUrl` / `imagePath` / `imageProvider`). Prefer real `BuildingImageProvider` (OpenAI-compat `/images/generations` when `IMAGE_MODEL` set); deterministic SVG illustrator is the always-on fallback. Never mutates play/session/rules.
- **Concept:** Prompt-first cataloging with portrait cards — review before write; chrome stays dense and quiet like the rest of the workbench.

### Item Catalog AI propose (M-item-4)
- Same AI strip pattern as Building Library: prompt → draft card grid → multi-select → accept / discard.
- Draft cards reuse `.building-draft-card` + `.item-category-chip`; soft price hint line only (no world currency lock).
- Building inspector shelf/loot AI sits in `.building-template-ai` under kind templates; unknown nouns show as pending (must go Item Catalog first).
- Discard clears client proposal state only — never writes session or map.

### Building kind templates (M-item-2/3)
- **Shop / supply / quest / encounter·boss inspectors:** compact `.building-kind-template` strip inside building inspector — shelf/recipe/slot/loot rows as dense property grids, not card-in-card.
- Empty shelf/recipes/slots/loot show a quiet left-accent empty hint (合法模板-only).
- Item pickers are native `<select>` against Item Catalog; price / resourceDrops / rewards.resources are soft hints (roleHint), never world-currency or genre flags required.
- Quest slots: label + markerTag (+ optional placeholder questId); encounter/boss: loot + pack/trigger prefs; Boss defeat flag is **not** a Catalog field.
