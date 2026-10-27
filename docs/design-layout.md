# Design layout rules

Content-first horizontal layout for the author workbench.

## Principles

1. **Horizontal fill** — Primary surfaces (App shell, draft/world workspaces, infinite canvas, main work area) use nearly the full viewport width. Do not center them in a fixed `max-width` column with large left/right gutters on desktop.
2. **Small, consistent gutters** — Prefer CSS tokens `--shell-gutter` (16px) and `--shell-gutter-lg` (20px). Avoid ad-hoc `padding: 0 44px` or `max-width: 1600px; margin: auto` on the App shell.
3. **Canvas is primary** — The branch/world infinite canvas should expand with the viewport (width and usable height). Do not cap the canvas stage with a tight `max-height` that leaves large empty side bands.
4. **Prose is the exception** — Long reading text (e.g. `.reading-page`, connect/demo marketing copy) may keep a comfortable measure (`--prose-max` / ~70–75ch or an existing reading `max-width`). That exception must not leak into workbench chrome or canvas shells.
5. **Panels nest inside fill** — Side inspectors and tool panels sit *inside* the full-width stage (grid columns), not outside a centered column.

## Checklist for UI changes

- [ ] No new `max-width` + `margin: auto` on App shell, work-section, draft-workspace, or canvas stage.
- [ ] New full-viewport surfaces reuse `--shell-gutter*` instead of hard-coded large side padding.
- [ ] Canvas / main editor still reaches ~full width on ≥1200px viewports.
- [ ] Screenshot or visual check on a wide desktop (≥1440px) for bilateral whitespace.

## Tokens

Defined in `apps/web/src/styles.css` `:root`:

| Token | Role |
|-------|------|
| `--shell-gutter` | Default horizontal inset |
| `--shell-gutter-lg` | Slightly larger inset on wide screens |
| `--prose-max` | Optional reading measure (not for canvas) |
