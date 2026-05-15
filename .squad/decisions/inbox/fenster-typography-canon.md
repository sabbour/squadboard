# Fenster Typography Canon
**Date:** 2026-05-15
**Author:** Fenster (UX Designer)
**Status:** Ratified — apply app-wide

---

## Reference shape

`packages/client/src/components/layout/PageHeader.tsx` is the gold standard.
It uses `<Title2>` / `<Subtitle1>` for the page title (via `size` prop),
`<Caption1>` for the eyebrow and description, and `tokens.*` for all spacing.
Every other component should follow this lead.

`FluentProvider` (with `webLightTheme`) is confirmed wrapping the entire app in
`packages/client/src/main.tsx` — all `tokens.*` values resolve correctly.

---

## Typography map

| Where | Component | Notes |
|-------|-----------|-------|
| Page title (top of a route) | `<Subtitle1 as="h1">` (or `<Title2 as="h1">` for top-level landing pages) | Built into `PageHeader` |
| Section heading within a page | `<Caption1>` styled with `textTransform: 'uppercase'` + `fontWeight: tokens.fontWeightSemibold` | Matches GitHub/Linear label-section style |
| Card / panel title (15-16 px) | `<Subtitle2>` | e.g. drawer header |
| Body copy / item primary label | `<Body1Strong>` for bold labels, `<Body1>` for running text | |
| Secondary metadata / captions | `<Caption1>` | 12 px, Segoe UI |
| Muted small labels (11 px) | `<Caption1>` with `color: tokens.colorNeutralForeground3` | |
| Numeric / monospace data | `<Body1Strong>` with `fontFamily: tokens.fontFamilyMonospace` | Cost figures, paths |

Available Fluent2 v9 typography components (all from `@fluentui/react-components`):
`Display`, `LargeTitle`, `Title1`, `Title2`, `Title3`, `Subtitle1`, `Subtitle2`,
`Body1`, `Body1Strong`, `Body1Stronger`, `Body2`,
`Caption1`, `Caption1Strong`, `Caption1Stronger`, `Caption2`, `Caption2Strong`

---

## Spacing map

| Where | Token |
|-------|-------|
| Page content padding (full page) | `tokens.spacingVerticalXXL` (24 px vertical) + `tokens.spacingHorizontalXXL` (24 px horizontal) |
| Stack gap between sections | `tokens.spacingVerticalXXL` (24 px) |
| Stack gap between rows in a list | `tokens.spacingVerticalS` (8 px) |
| Row padding inside a card / panel | `tokens.spacingVerticalM` (12 px) x `tokens.spacingHorizontalL` (16 px) |
| Icon-to-text gap | `tokens.spacingHorizontalXS` (4 px) |
| Small inline gap (badges, chips) | `tokens.spacingHorizontalS` (8 px) |

Fluent2 spacing scale reference:
- `XXS` = 2 px, `XS` = 4 px, `SNudge` = 6 px, `S` = 8 px, `MNudge` = 10 px,
  `M` = 12 px, `L` = 16 px, `XL` = 20 px, `XXL` = 24 px, `XXXL` = 32 px
  (same for Horizontal and Vertical variants)

---

## Color map (text only)

| Semantic role | Token |
|---------------|-------|
| Primary text | `tokens.colorNeutralForeground1` |
| Secondary text | `tokens.colorNeutralForeground2` |
| Muted / disabled text | `tokens.colorNeutralForeground3` |
| Placeholder | `tokens.colorNeutralForeground4` |

`var(--surface)`, `var(--border)`, `var(--bg)`, `var(--accent)`, `var(--danger)`,
`var(--success)` remain valid for **layout / structural** colors (backgrounds,
borders). Only text colors are migrated to tokens.

---

## Font-weight tokens

| Value | Token |
|-------|-------|
| 400 (regular) | `tokens.fontWeightRegular` |
| 500 (medium) | `tokens.fontWeightMedium` |
| 600 (semibold) | `tokens.fontWeightSemibold` |
| 700 (bold) | `tokens.fontWeightBold` |

Prefer the `<*Strong>` typography variant over an explicit `fontWeight` override
wherever the entire text run should be semibold.

---

## Global CSS (packages/client/src/styles/globals.css)

Rules that conflict with Fluent2 typography were removed in this sweep.
What remains is intentional:

- `box-sizing: border-box` — kept (essential layout reset)
- `margin: 0; padding: 0` — kept on `*` (prevents browser default spacing)
- `html, body, #root { height: 100% }` — kept (app shell requires full height)
- `body { font-family: ...; font-size: 14px; line-height: 1.5; }` — **removed** (FluentProvider sets this)
- `-webkit-font-smoothing: antialiased` — kept (visual quality)
- `a { color: var(--accent); }` — kept (links are not Fluent2 managed)
- `button { cursor: pointer; font-family: inherit; font-size: inherit; }` — kept for native `<button>` fallback

---

## Exclusions

- `pages/CeremonyEditor.tsx` — pre-existing TS errors owned by another worker
- `pages/Consult.tsx` — pre-existing TS errors owned by another worker
