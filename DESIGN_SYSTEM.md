# DESIGN_SYSTEM.md

> Official design reference for **故事工坊 / Story Workshop**. Future UI work must follow this file.

## 1. Project overview

- **Website / product name:** 故事工坊 (Story Workshop)
- **Website type:** Authoring workbench (novel → branching text game)
- **Surface profile:** App/Product UI · Redesign
- **Platform:** web (Vite + React + CSS tokens)
- **Target users:** Novel adapters / interactive-fiction authors editing graphs, worldbooks, and playtests locally
- **Main design goal:** Make the workbench feel like a normal modern productivity app — calm, dense, precise — not a literary brochure or pastel prototype

## 2. Brand direction

- **Visual style:** Restrained modern productivity (Linear-adjacent density)
- **Mood & tone:** Calm, technical-authoring, low theater
- **Design personality:** Minimal / swiss-rational grotesque UI; serif only for long reading prose
- **Design concept (one sentence):** A story-graph workbench that feels like a precision instrument for branching narrative — calm neutral field, one signal accent, canvas dominates the viewport, chrome stays quiet and dense like Linear; status/generation/playability are compact tool signals, not posters.
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
- **Body text:** UI ≥13px; reading prose ≥16px
- **Line-height / line-length:** UI ~1.5; prose measure `--prose-max: 72ch`
- **Button text:** 12–13px, weight 500–600
- **Responsive rules:** Collapse dual inspector below 980px; wide density ≥1440px

## 5. Layout system

- **Container widths:** App shell full-bleed (`max-width: none`); gutters `--shell-gutter` 16px / `--shell-gutter-lg` 20px. Prose exception: reading/connect may use measure.
- **Section spacing:** Compact work-section padding (~10–20px); canvas height `calc(100vh - 168px)`.
- **Grid rules:** Canvas primary column + inspector column(s); ≥1440 dual inspector side-by-side.
- **Page anatomy:** site header → workspace tabs (01–07) → work section (toolbar / canvas / inspectors). Not a marketing funnel.
- **Conversion / CTA flow:** N/A for workbench; primary action per screen (e.g. Save, Start new save).
- **App/Product flows:** Nav placement constant; edit↔play mode toggle on canvas; deep-link via draft/revision selection.
- **Hero composition:** N/A (no marketing hero on workbench). Connect page is utilitarian, not a landing hero.
- **Breakpoints:** stack ~980; density-wide 1440; ultra 1680.
- **Alignment rules:** Full-bleed primary surfaces; density-over-stretch (see `docs/design-layout.md`).

## 6. Component system

- **Component base / library:** Native CSS + React components (no shadcn defaults).
- **Buttons:** default / `primary` / `quiet` / `danger` / `small`; hover, disabled, `:focus-visible`.
- **Cards / panels:** `.panel` — white, 1px line, radius 8, shadow-xs sparingly.
- **Badges / chips:** pill radius 999; muted by default; green only for active/done.
- **Navbar:** `.site-header` + `.workspace-bar` underline tabs with quiet tabular numbers.
- **Forms / inputs:** shared radius-sm; focus ring only on `:focus-visible`.
- **Status strips:** `.branch-canvas-gen`, `.branch-canvas-banner`, skeleton/extend guides — compact left-accent strips.
- **Play stats HUD:** `.play-stats` — ChoiceScript-inspired always-visible chart (role-ordered meters / flag pills; optional collapse, default open) between scene prose and choices; `.play-stats-delta` uses template `displayLabel` when stamped; `.reader-choice-cost` from real effects only. Patterns: `docs/if-editor-patterns.md`.
- **Stat Editor:** `.stat-editor` — universal inspector for `content.variables` (template-seeded or hand-added). Dense property-list rows (display label + mono name, role chip from catalog, type select, initial value, delete); compact template-apply strip; footer add bar. No fieldset stack, no card-in-card. Roles are display metadata only.
- **Choice rules:** `.choice-rules` — same dense instrument language as Stat Editor; conditions labeled gate, effects labeled cost; logic stays `conditions`/`effects` only.
- **Inspectors:** flat hierarchy; no card-in-card elevation; dual panes ≥1440.
- **Reader choices:** muted list actions, not brochure cards.

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

If tokens or chrome patterns change, update this file, `docs/design-ui.md`, and `docs/design-layout.md` in the same change.
