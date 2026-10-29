# Design layout rules

Content-first horizontal layout for the author workbench.

## Principles

1. **Horizontal fill** — Primary surfaces (App shell, draft/world workspaces, infinite canvas, main work area) use nearly the full viewport width. Do not center them in a fixed `max-width` column with large left/right gutters on desktop.
2. **Density over stretch** — Extra viewport width must surface **more modules / denser content** (side-by-side panels, dual inspector panes, multi-column tool strips, more cards per row). Do **not** spend width on empty gutters, a single stretched blank column, or exclusive tabs that hide sibling modules while the canvas grows empty bands. Prefer adaptive multi-column layouts keyed to information density.
3. **Small, consistent gutters** — Prefer CSS tokens `--shell-gutter` (16px) and `--shell-gutter-lg` (20px). Avoid ad-hoc `padding: 0 44px` or `max-width: 1600px; margin: auto` on the App shell.
4. **Canvas is primary** — The branch/world infinite canvas should expand with the viewport (width and usable height) and remain the largest surface. Side inspectors nest beside it; never bury the canvas under a wall of panels.
5. **Prose is the exception** — Long reading text (e.g. `.reading-page`, connect/demo marketing copy) may keep a comfortable measure (`--prose-max` / ~70–75ch or an existing reading `max-width`). That exception must not leak into workbench chrome or canvas shells.
6. **Panels nest inside fill** — Side inspectors and tool panels sit *inside* the full-width stage (grid columns), not outside a centered column.
7. **Agent workspace** — A232px persistent navigation/history rail (248px at1680px) and300px context/activity pane (340px at1680px) use wide screens productively. Conversation reading measure is the prose exception inside the full-width center, not a constraint on the app shell. At≤1100px context opens on demand; at≤760px navigation/history use dialogs. Avoid stacking rails above the composer or scrolling the whole app to reach Send.

## Wide-viewport density (suggest ≥1440px)

| Surface | Density expectation |
|---------|---------------------|
| Draft canvas + inspector | Show **≥2 inspector modules** at once (e.g. scene + worldbook/variables), not only exclusive tabs while canvas empty-grows |
| Toolbar / meta strip | Horizontal multi-column / denser rows for actions and key fields |
| `source-layout` / `generation-layout` / `play-layout` | Modest wider useful columns (or more cards), not stretch-only |
| `world-grid` | More cards per row on wide screens |
| `scene-layout` | Slightly wider nav + content columns when space allows |

Keep mobile stacking (`max-width` breakpoints that collapse to one column).

## Checklist for UI changes

- [ ] No new `max-width` + `margin: auto` on App shell, work-section, draft-workspace, or canvas stage.
- [ ] New full-viewport surfaces reuse `--shell-gutter*` instead of hard-coded large side padding.
- [ ] Canvas / main editor still reaches ~full width on ≥1200px viewports **and** remains the primary/largest surface when inspectors open.
- [ ] On ≥1440px, extra width shows more modules or denser columns — not bilateral empty whitespace or a single stretched blank region.
- [ ] Screenshot or visual check on a wide desktop (≥1440px, prefer ~1680×980) for density and whitespace.

## Tokens

Defined in `apps/web/src/styles.css` `:root`:

| Token | Role |
|-------|------|
| `--shell-gutter` | Default horizontal inset |
| `--shell-gutter-lg` | Slightly larger inset on wide screens |
| `--prose-max` | Optional reading measure (not for canvas) |
| `--density-wide` | Wide density breakpoint (~1440px) — dual inspector / multi-column |

## Related

Visual chrome, type, and control principles: [`design-ui.md`](./design-ui.md).
- Full system: [`../DESIGN_SYSTEM.md`](../DESIGN_SYSTEM.md)


## 2026-10-30 specialist tools

Author tools use the fixed studio navigation/header and one internal main scroll area. Mount a route at first visit, then preserve its local editor/form state; do not mount every canvas on the initial Agent route. The 280px source shelf stacks below1101px; production records and its disclosed creation brief share wide screens. On phones, canvas modes and views remain visible while advanced tools expand inline; inspector panes stack below the graph. Search is a viewport-bounded native dialog. All nine author tools were rendered at375/768/1280px; the manuscript's tablet overflow was corrected. Exact evidence and bounds: [workspace surfaces](workspace-surfaces-2026-10-30.md).
