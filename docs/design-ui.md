# Design UI principles

Visual language for the author workbench. Layout density rules live in `design-layout.md`; this file covers chrome, type, color, and controls.

## Goal

Feel like a normal modern productivity app (Linear / Notion / Figma-adjacent): clean, calm, dense, consistent. Not a literary brochure, cream-paper demo, or ornate prototype.

## Surfaces & color

| Token | Role |
|-------|------|
| `--bg` | App canvas behind panels (`#f4f4f2`) |
| `--surface` / `--paper` | Cards, inspectors, panels (`#fff`) |
| `--surface-muted` | Nested strips, toolbars, soft fills |
| `--ink` / `--muted` | Primary / secondary text |
| `--line` / `--line-strong` | Borders (quiet, clear) |
| `--green` / `--accent` | Single brand accent (actions, active tab) |
| `--rust` | Danger / destructive only |
| `--focus` | Focus ring |

Avoid cream paper fills, heavy inset seals, and multi-pastel “theater” boxes for ordinary chrome. Tinted callouts (生成、天道、旁白) stay light and bordered, not ornate.

## Typography

- **UI chrome** uses `--font-ui`: `Segoe UI`, `PingFang SC`, `Microsoft YaHei`, `system-ui`, sans-serif.
- Headings in the workbench use the UI stack (not serif).
- **Serif (`--serif`) is only for long reading prose**: `.reader-text`, `.source-paragraph`, `.story-input`, history body copy.
- Keep letter-spacing tight; avoid brochure tracking on tabs/labels.

## Shell & navigation

- Compact top bar: quiet brand mark (no rotated seal), subtle connection status.
- Workspace tabs: flat text + thin active underline; numbered prefixes stay tabular and muted.
- Hide decorative vertical edition labels (`.edition`); section eyebrows stay short and muted.

## Controls

- Shared radius: `--radius-sm` (6) / `--radius` (8) / `--radius-lg` (12).
- Buttons, inputs, selects, chips, and tabs share padding, hover, focus, and disabled treatment.
- Focus: 2px `--focus` ring on `:focus-visible` only (buttons/links/summary). Fields use border + soft glow on `:focus-visible` — no mouse `:focus` flash.

## Panels & canvas

- Panels: white surface, 1px `--line`, light `--shadow-xs` only — no deep drop shadows or “serify section theater”.
- Canvas remains primary (see `design-layout.md`). Inspectors nest beside it with a quiet left border, not a heavy cast shadow. Flatten inspector hierarchy (no card-in-card).
- Wide viewports show more modules (dual inspector), not empty stretch.
- Generation / playability / skeleton / extend cues are **compact status strips** (left accent + muted fill), not tall pastel posters.
- Workbench section titles stay quiet (small h2; hide long blurbs on canvas pages) so the graph keeps vertical space.

## Play reader

- Reader chrome matches the workbench (sans title, left-aligned scene title, quiet meta).
- Choice buttons are plain list actions (muted surface + clear border), not brochure cards.
- Body prose may keep serif for reading comfort; chrome around it stays sans.

## Checklist

- [ ] No new cream/serif chrome on app shell, tabs, or inspectors
- [ ] New UI text uses `--font-ui`; serif only for long prose
- [ ] Controls reuse radius / focus tokens
- [ ] Layout still follows `design-layout.md` (fill + density)
- [ ] Screenshot check ~1680×980 after UI-facing changes

## Related

- Layout density: [`design-layout.md`](./design-layout.md)
- Full token/system record: [`../DESIGN_SYSTEM.md`](../DESIGN_SYSTEM.md)
