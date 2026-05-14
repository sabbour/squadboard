# Fenster — Fluent 2 Design Spec
**Date:** 2026-05-14  
**Scope:** Full audit of `packages/client/src/` — all components and pages  
**Audience:** Keyser (implementation), Ahmed (review)

> *What the eye misses, the hand will not fix. Every emoji is a door left unlocked.*

---

## 1. Icon Library — Emoji → Fluent Icon Mapping

All emoji and text symbols must be replaced with components from `@fluentui/react-icons`.  
Install if not yet present: `pnpm add @fluentui/react-icons` (in `packages/client`).

**Naming convention:** `{Name}{Size}{Weight}` — e.g., `Home20Regular`, `Play16Filled`.  
**Import pattern:** `import { Home20Regular } from '@fluentui/react-icons'`

### Layout.tsx — Sidebar Nav Items
| Emoji | Location | Fluent Icon | Size | Weight | Notes |
|-------|----------|-------------|------|--------|-------|
| 🏠 | Projects nav link | `HomeRegular` | 20 | Regular | Top-level "home" |
| 📊 | Dashboard nav item | `DataBarVerticalRegular` | 20 | Regular | |
| 📋 | Board nav item | `BoardRegular` | 20 | Regular | |
| 🤖 | Agents nav item | `BotRegular` | 20 | Regular | |
| ⚙ | Workflows nav item | `FlowRegular` | 20 | Regular | |
| 💰 | Costs nav item | `MoneyRegular` | 20 | Regular | |
| ⚙️ | Settings nav item (bottom) | `SettingsRegular` | 20 | Regular | Use Filled on active |

**Active state icon rule:** swap `Regular` → `Filled` when `isActive === true` (e.g., `BoardFilled`).

### Board Components
| Emoji/Symbol | Location | Fluent Icon | Size | Weight |
|-------------|----------|-------------|------|--------|
| 🔍 | FilterBar search prefix | `Search20Regular` | 20 | Regular |
| ✕ (text button) | FilterBar clear button | `Dismiss16Regular` | 16 | Regular |
| ➕ (implicit) | KanbanColumn "+ create" button | `Add20Regular` | 20 | Regular |
| 💬 | IssueCard comment count | `Comment16Regular` | 16 | Regular |
| ⚡ | RoutingBadge "Auto" prefix | `Flash16Regular` | 16 | Regular |
| ⚙ | WorkflowBadge prefix | `Flow16Regular` | 16 | Regular |
| ⚠️ | ConflictToast warning | `Warning20Filled` | 20 | Filled (semantic) |
| ✕ (close button) | CardDetail close, modals | `Dismiss20Regular` | 20 | Regular |
| ▾ (chevron) | RunButton agent picker dropdown | `ChevronDown12Regular` | 12 | Regular |

### Run / Status Components
| Emoji/Symbol | Location | Fluent Icon | Size | Weight |
|-------------|----------|-------------|------|--------|
| ▶ | RunButton "Run" label | `Play16Regular` | 16 | Regular |
| ✓ Done (flash text) | RunButton done state | `Checkmark16Regular` | 16 | Regular |
| ● (pulse dot) | RunButton running indicator | `CircleFilled` | 8 | Filled (inline, 8px) |
| ▶ expand/collapse | RunHistory row toggle | `ChevronRight16Regular` / `ChevronDown16Regular` | 16 | Regular |

### Agent Components
| Emoji | Location | Fluent Icon | Size | Weight |
|-------|----------|-------------|------|--------|
| ● (status dot) | AgentCard active/inactive | `CircleFilled` (8px) via CSS | — | Filled |
| ✕ | HireAgentModal close | `Dismiss20Regular` | 20 | Regular |

### Project / Review Components
| Emoji | Location | Fluent Icon | Size | Weight |
|-------|----------|-------------|------|--------|
| 📋 | ProjectCard icon | `FolderRegular` | 24 | Regular |
| 🗂️ | EmptyBoard hero icon | `GridDots28Regular` | 28 | Regular (increase to 48px in CSS) |
| ● (BackendConnected) | EmptyBoard status indicator | `CircleFilled` | 12 | Filled |
| ✅ | ReviewDecisionBadge approved | `CheckmarkCircle16Regular` | 16 | Regular |
| 🔄 | ReviewDecisionBadge changes_requested | `ArrowSync16Regular` | 16 | Regular |
| ⏳ | ReviewDecisionBadge pending | `Clock16Regular` | 16 | Regular |
| ✕ Removed | ProjectCard remove hover button | `Delete16Regular` | 16 | Regular |

### Settings / MCP Panel
| Symbol | Location | Fluent Icon | Size | Weight |
|--------|----------|-------------|------|--------|
| Copy text | CopyButton | `Copy16Regular` | 16 | Regular |
| ✓ Copied | CopyButton copied state | `Checkmark16Regular` | 16 | Regular |
| ▸/▾ | McpConfigPanel Accordion toggle | `ChevronRight16Regular` / `ChevronDown16Regular` | 16 | Regular |

---

## 2. Component Mapping Table

Every custom UI pattern → its Fluent 2 replacement.

| Custom Component | File | Fluent Replacement | Priority | Notes |
|-----------------|------|-------------------|----------|-------|
| Sidebar `<aside>` + `<NavLink>` | `Layout.tsx` | `<NavDrawer type="inline">` + `<NavItem>` | P0 | See §5 for full spec |
| `<input type="text">` search | `FilterBar.tsx` | `<SearchBox>` | P0 | Has built-in search icon slot |
| Label filter `<button>` chips | `FilterBar.tsx` | `<ToggleButton size="small">` | P1 | isChecked = activeLabelId === label.id |
| `<CardDetail>` slide-in panel | `board/CardDetail.tsx` | `<DrawerOverlay position="end">` | P0 | 480px width, escape key handled by Fluent |
| CardDetail tabs (`overview` / `runs`) | `board/CardDetail.tsx` | `<TabList>` + `<Tab>` | P0 | Underline appearance |
| `<CreateIssueModal>` | `board/CreateIssueModal.tsx` | `<Dialog>` + `<DialogSurface>` + `<DialogBody>` | P0 | modalType="non-modal" or "modal" |
| `<HireAgentModal>` | `agents/HireAgentModal.tsx` | `<Dialog>` + `<DialogSurface>` | P0 | Same pattern |
| `<AttachWorkflowModal>` | `workflows/AttachWorkflowModal.tsx` | `<Dialog>` | P0 | |
| `<ConflictToast>` (portal, fixed) | `board/ConflictToast.tsx` | `<Toaster>` + `<Toast>` + `useToastController` | P0 | intent="warning", action button |
| `<BulkActionBar>` (fixed bottom) | `board/BulkActionBar.tsx` | `<Toolbar>` + `<ToolbarButton>` | P1 | Wrap in card/popover anchored to bottom |
| `<IssueCard>` div | `board/IssueCard.tsx` | `<Card>` + `<CardHeader>` | P1 | Keep draggable integration; add `<Checkbox>` |
| `<IssueCard>` selection checkbox | `board/IssueCard.tsx` | `<Checkbox>` | P1 | |
| `<ProjectCard>` | `ProjectCard.tsx` | `<Card>` + `<CardHeader>` | P1 | |
| `<AgentCard>` | `agents/AgentCard.tsx` | `<Card>` + `<Persona>` | P1 | Persona handles avatar + name + role |
| `<AgentDetailPanel>` | `agents/AgentDetailPanel.tsx` | `<Drawer>` or `<DrawerOverlay>` | P1 | Side panel pattern |
| `<Avatar>` (custom initials) | `Avatar.tsx` | `<Avatar>` | P1 | Supports `image`, `name` (→ initials), `color` |
| `<PresenceBar>` overlapping avatars | `board/PresenceBar.tsx` | `<AvatarGroup>` + `<AvatarGroupItem>` + `<PresenceBadge>` | P1 | AvatarGroup has overflow built-in |
| PresenceBar connection dot | `board/PresenceBar.tsx` | `<PresenceBadge status="available/away/offline">` | P1 | Map connected→available, reconnecting→away, disconnected→offline |
| `<RunStatusBadge>` | `runs/RunStatusBadge.tsx` | `<Badge appearance="filled" color="...">` | P1 | color: success/danger/warning/informative/subtle |
| `<StatusBadge>` (agents) | `agents/StatusBadge.tsx` | `<Badge>` | P1 | active→success, disabled→subtle, retired→warning |
| `<RoutingTierBadge>` | `routing/RoutingTierBadge.tsx` | `<Badge appearance="tint">` | P2 | T1→informative, T2→warning, T3→important |
| `<LabelBadge>` | `LabelBadge.tsx` | `<Badge appearance="filled" style={{background: color}}>` | P2 | Custom color, not a Fluent semantic color |
| `<RoutingBadge>` (tooltip on hover) | `board/RoutingBadge.tsx` | `<Tooltip content={ruleSummary}><Badge>⚡ Auto</Badge></Tooltip>` | P1 | Replace hover state logic |
| `<WorkflowBadge>` (tooltip on hover) | `board/WorkflowBadge.tsx` | `<Tooltip content={...}><Badge>name</Badge></Tooltip>` | P1 | |
| `<ReviewDecisionBadge>` | `reviews/ReviewDecisionBadge.tsx` | `<Badge>` with icon | P2 | |
| KanbanColumn issue count pill | `board/KanbanColumn.tsx` | `<CounterBadge count={issues.length}>` | P2 | |
| `<RoutingLogTable>` custom `<table>` | `routing/RoutingLogTable.tsx` | `<DataGrid>` | P2 | Built-in sorting + column widths |
| `<AgentLeaderboard>` custom `<table>` | `dashboard/AgentLeaderboard.tsx` | `<DataGrid>` or `<Table>` | P2 | No selection needed → simpler Table |
| `<CostDashboard>` BudgetBar | `costs/CostDashboard.tsx` | `<ProgressBar>` | P2 | `color="error"` when >95%, `"warning"` >80% |
| `<McpConfigPanel>` Accordion | `settings/McpConfigPanel.tsx` | `<Accordion>` + `<AccordionItem>` + `<AccordionPanel>` | P2 | |
| `<RunHistory>` expand/collapse rows | `runs/RunHistory.tsx` | `<Accordion>` | P2 | |
| `<CharterEditor>` textarea | `agents/CharterEditor.tsx` | `<Textarea>` wrapped in `<Field>` | P2 | |
| `<CreateIssueModal>` title input | `board/CreateIssueModal.tsx` | `<Input>` wrapped in `<Field>` | P0 | |
| `<CreateIssueModal>` body textarea | `board/CreateIssueModal.tsx` | `<Textarea>` wrapped in `<Field>` | P0 | |
| `<CreateIssueModal>` column select | `board/CreateIssueModal.tsx` | `<Dropdown>` + `<Option>` | P0 | |
| `<HireAgentModal>` model select | `agents/HireAgentModal.tsx` | `<Dropdown>` + `<Option>` | P0 | |
| `<RunButton>` agent picker dropdown | `runs/RunButton.tsx` | `<SplitButton>` or `<MenuButton>` | P1 | Primary = Run; menu = agent picker |
| Loading text ("Loading…") | Multiple files | `<Spinner size="small" label="Loading…">` | P2 | |
| Loading state (empty string) | `WorkflowList.tsx` etc. | `<SkeletonItem>` | P2 | |
| `<EmptyBoard>` | `EmptyBoard.tsx` | Keep structure; use Fluent typography + icon | P2 | |
| `+ New Workflow` primary button | `WorkflowList.tsx` | `<Button appearance="primary">` | P1 | Already `<Button>` elsewhere |
| `▶ Run` main action | `runs/RunButton.tsx` | `<Button appearance="primary" icon={<Play16Regular/>}>` | P1 | |
| Cancel run button | `runs/RunButton.tsx` | `<Button appearance="subtle" size="small">` | P1 | |

---

## 3. Typography Migration

Replace all hardcoded `fontSize` + `fontWeight` style props with Fluent typography components.

| Current pattern | Location(s) | Fluent Component | Token alternative |
|----------------|-------------|-----------------|-------------------|
| `fontSize: '20px', fontWeight: 600` | `ProjectPicker` h1 | `<Title2>` | `tokens.fontSizeBase500` + `tokens.fontWeightSemibold` |
| `fontSize: '18px', fontWeight: 600` | `EmptyBoard` h2 | `<Title3>` | |
| `fontSize: '15px', fontWeight: 600` | `ProjectCard` project name | `<Subtitle1>` | |
| `fontSize: '13px', fontWeight: 600` | `IssueCard` title, `KanbanColumn` header | `<Body1Strong>` | |
| `fontSize: '13px', fontWeight: 400` | `IssueCard` body, nav links, modal body | `<Body1>` | |
| `fontSize: '12px', fontWeight: 400` | Secondary text in cards, table cells | `<Body2>` | |
| `fontSize: '11px', fontWeight: 500/600` | Badges, labels, `Caption` text | `<Caption1>` / `<Caption1Strong>` | |
| `fontSize: '11px', fontWeight: 600, textTransform: 'uppercase'` | Table headers, nav section labels | `<Caption1Strong>` + letterSpacing | `tokens.fontWeightSemibold` |
| `fontSize: '10px'` | Routing tier badges | `<Caption2>` | |
| `fontFamily: 'ui-monospace, ...'` | Agent model badge, `McpConfigPanel` code | Use `tokens.fontFamilyMonospace` | |

**Example migration:**
```tsx
// Before
<span style={{ fontSize: '13px', fontWeight: 600, color: '#e6edf3' }}>Board</span>

// After
import { Body1Strong } from '@fluentui/react-components'
<Body1Strong>Board</Body1Strong>
```

---

## 4. Token Migration — Hex → Fluent Tokens

All hardcoded hex colors should be replaced with `tokens.*` from `@fluentui/react-components`.

> **Note:** The app uses `webLightTheme`. The dark palette (`#0d1117` etc.) is from a GitHub-dark custom theme. **Before migrating tokens, the team must decide: ship with light theme or add a dark theme override.** Until then, tokens are shown as equivalents for the `webLightTheme` surface.

### Neutral Surfaces
| Hex | Count | Fluent Token | Semantic meaning |
|-----|-------|-------------|-----------------|
| `#0d1117` | 30× | `tokens.colorNeutralBackground1` | Page/canvas background |
| `#161b22` | 19× | `tokens.colorNeutralBackground2` | Panel/sidebar surface |
| `#21262d` | 25× | `tokens.colorNeutralBackground3` | Elevated card surface |
| `#1c2128` | — | `tokens.colorNeutralBackground4` | Toast/popover surface |

### Borders & Strokes
| Hex | Count | Fluent Token |
|-----|-------|-------------|
| `#30363d` | 80× | `tokens.colorNeutralStroke1` |
| `#484f58` | 12× | `tokens.colorNeutralStroke2` |

### Text Colors
| Hex | Count | Fluent Token |
|-----|-------|-------------|
| `#e6edf3` | 63× | `tokens.colorNeutralForeground1` |
| `#c9d1d9` | 2× | `tokens.colorNeutralForeground2` |
| `#8b949e` | 103× | `tokens.colorNeutralForeground3` |
| `#484f58` | 12× | `tokens.colorNeutralForeground4` |

### Brand / Accent
| Hex | Count | Fluent Token |
|-----|-------|-------------|
| `#388bfd` | 29× | `tokens.colorBrandBackground` |
| `#58a6ff` | 9× | `tokens.colorBrandForeground1` |
| `#79c0ff` | 6× | `tokens.colorBrandForeground2` |
| `rgba(56,139,253,0.12)` | — | `tokens.colorBrandBackgroundInverted` (tinted) |
| `rgba(9, 105, 218, 0.08)` | — | `tokens.colorBrandBackground2` |

### Status Colors
| Hex | Count | Fluent Token | Meaning |
|-----|-------|-------------|---------|
| `#3fb950` | 16× | `tokens.colorStatusSuccessForeground1` | Success green |
| `#238636` / `#2ea043` | 6× | `tokens.colorStatusSuccessBackground1` | Success bg |
| `#1a7f37` | 2× | `tokens.colorStatusSuccessBackground3` | Deep success |
| `#f85149` | 26× | `tokens.colorStatusDangerForeground1` | Error/danger red |
| `#cf222e` / `#a12424` | 5× | `tokens.colorStatusDangerBackground1` | Danger bg |
| `#d29922` | 9× | `tokens.colorStatusWarningForeground1` | Warning amber |
| `#e36209` | 3× | `tokens.colorStatusWarningForeground2` | Orange warning |
| `#9a6700` | 2× | `tokens.colorStatusWarningBackground1` | Warning bg |
| `#eab308` | 2× | `tokens.colorStatusWarningForeground1` | (duplicate) |

### Accent Palette (Tier/Category Colors)
| Hex | Count | Fluent Token |
|-----|-------|-------------|
| `#bc8cff` / `#d2a8ff` | 6× | `tokens.colorPaletteLilacForeground2` |
| `#ffa657` | 4× | `tokens.colorPaletteMarigoldForeground2` |
| `#f78166` | 3× | `tokens.colorPaletteCranberryForeground2` |
| `#56d364` | 3× | `tokens.colorPaletteGreenForeground1` |
| `#6366f1` | — | `tokens.colorPaletteRoyalBlueForeground2` |

### Spacing Tokens (replace magic pixel numbers)
| Current value | Fluent Token |
|--------------|-------------|
| `4px` | `tokens.spacingHorizontalXS` |
| `8px` | `tokens.spacingHorizontalS` |
| `12px` | `tokens.spacingHorizontalM` |
| `16px` | `tokens.spacingHorizontalL` |
| `24px` | `tokens.spacingHorizontalXL` |
| `32px` | `tokens.spacingHorizontalXXL` |

### Border Radius Tokens
| Current value | Fluent Token |
|--------------|-------------|
| `4px` | `tokens.borderRadiusSmall` |
| `6px` | `tokens.borderRadiusMedium` |
| `8px` | `tokens.borderRadiusLarge` |
| `12px` / `10px` / `50%` (pill) | `tokens.borderRadiusCircular` |

---

## 5. Layout Spec — Sidebar (Layout.tsx)

### Current state
Custom `<aside>` with React Router `<NavLink>` elements. Emoji icons, inline styles, manual active state detection, hardcoded `var(--border)` CSS variables.

### Recommended: `<NavDrawer type="inline">`

```tsx
import {
  NavDrawer,
  NavDrawerBody,
  NavDrawerHeader,
  NavItem,
  NavSectionHeader,
  AppItem,
} from '@fluentui/react-components/unstable'; // Nav components are in unstable
// OR use the stable nav pattern below
```

> **Stable alternative** (recommended until Nav stabilizes): Keep the `<aside>` structural HTML but replace all styling with Fluent tokens and replace emoji with Fluent icons. This is lower risk.

#### Option A — Stable approach (recommended for now)
Use `<nav>` wrapper styled with tokens, but replace each `<NavLink>` with a styled component using `makeStyles` and Fluent tokens. Add active-state icon swapping (Regular → Filled).

```tsx
import { makeStyles, tokens } from '@fluentui/react-components'

const useStyles = makeStyles({
  sidebar: {
    width: '200px',
    borderRight: `1px solid ${tokens.colorNeutralStroke1}`,
    background: tokens.colorNeutralBackground2,
  },
  navItem: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
    padding: `7px ${tokens.spacingHorizontalL}`,
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    textDecoration: 'none',
    borderLeft: `2px solid transparent`,
  },
  navItemActive: {
    color: tokens.colorNeutralForeground1,
    background: tokens.colorBrandBackground2,
    borderLeftColor: tokens.colorBrandBackground,
    fontWeight: tokens.fontWeightSemibold,
  },
})
```

#### Option B — NavDrawer (when stable)
```tsx
<NavDrawer type="inline" open={true} size="small">
  <NavDrawerHeader>
    <img src={squadboardLogo} alt="Squadboard" height={32} />
  </NavDrawerHeader>
  <NavDrawerBody>
    <NavItem icon={<HomeRegular />} href="/">Projects</NavItem>
    {id && (
      <>
        <NavSectionHeader>Project</NavSectionHeader>
        <NavItem icon={<DataBarVerticalRegular />} href={`/projects/${id}/dashboard`}>Dashboard</NavItem>
        <NavItem icon={<BoardRegular />} href={`/projects/${id}/board`}>Board</NavItem>
        <NavItem icon={<BotRegular />} href={`/projects/${id}/agents`}>Agents</NavItem>
        <NavItem icon={<FlowRegular />} href={`/projects/${id}/workflows`}>Workflows</NavItem>
        <NavItem icon={<MoneyRegular />} href={`/projects/${id}/costs`}>Costs</NavItem>
      </>
    )}
  </NavDrawerBody>
</NavDrawer>
```

**Recommendation:** Implement Option A now (tokens + Fluent icons, no emoji). Migrate to `NavDrawer` when Nav exits unstable.

---

## 6. Phase Priority — Implementation Order for Keyser

Ordered by visual impact × implementation effort ratio. P0 = ship immediately.

### Phase 1 — Icons (P0, ~2h)
**Impact: Immediately eliminates all emoji. Zero behavior change.**
- Swap all emoji in `Layout.tsx` nav items → Fluent icons (Regular, 20px)
- Swap `🔍` in `FilterBar.tsx` → `Search20Regular`
- Swap `💬` in `IssueCard.tsx` → `Comment16Regular`
- Swap `▶` in `RunButton.tsx` → `Play16Regular`
- Swap `✕`/`×` dismiss buttons everywhere → `Dismiss20Regular` / `Dismiss16Regular`
- Swap `⚠️` in `ConflictToast.tsx` → `Warning20Filled`
- Swap emoji in `ReviewDecisionBadge.tsx`, `RoutingBadge.tsx`, `WorkflowBadge.tsx`
- Swap `🗂️` in `EmptyBoard.tsx` → `GridDots28Regular`
- Swap `📋` in `ProjectCard.tsx` → `FolderRegular`

### Phase 2 — Panels & Modals (P0, ~4h)
**Impact: Proper focus trapping, escape handling, accessibility.**
- `CardDetail.tsx` → `<DrawerOverlay>` + `<TabList>`/`<Tab>`
- `CreateIssueModal.tsx` → `<Dialog>` + form fields (`<Input>`, `<Textarea>`, `<Dropdown>`)
- `HireAgentModal.tsx` → `<Dialog>`
- `AttachWorkflowModal.tsx` → `<Dialog>`

### Phase 3 — Toast & Toolbar (P1, ~2h)
**Impact: Proper notification system, accessible alerts.**
- `ConflictToast.tsx` → `<Toaster>` + `<Toast>` + `useToastController`
- `BulkActionBar.tsx` → `<Toolbar>` + `<ToolbarButton>` (keep fixed positioning)

### Phase 4 — Cards & Buttons (P1, ~4h)
**Impact: Consistent card chrome, accessible buttons, Persona pattern.**
- `IssueCard.tsx` → `<Card>` + `<Checkbox>` (selection)
- `ProjectCard.tsx` → `<Card>` + `<CardHeader>`
- `AgentCard.tsx` → `<Card>` + `<Persona>`
- `RunButton.tsx` → `<SplitButton>` or `<MenuButton>` + `<Button appearance="primary">`
- `Avatar.tsx` → `<Avatar name={...} image={...}>`

### Phase 5 — Badges (P1, ~2h)
**Impact: Consistent visual language for all status indicators.**
- `RunStatusBadge.tsx` → `<Badge>` with semantic colors
- `StatusBadge.tsx` → `<Badge>`
- `RoutingBadge.tsx` + `WorkflowBadge.tsx` → `<Tooltip>` + `<Badge>`
- `RoutingTierBadge.tsx` → `<Badge appearance="tint">`
- `KanbanColumn` count → `<CounterBadge>`
- `PresenceBar.tsx` → `<AvatarGroup>` + `<PresenceBadge>`

### Phase 6 — Tables & Data (P2, ~4h)
**Impact: Sortable, accessible data tables.**
- `RoutingLogTable.tsx` → `<DataGrid>`
- `AgentLeaderboard.tsx` → `<Table>`
- `CostDashboard` BudgetBar → `<ProgressBar>`

### Phase 7 — Typography & Tokens (P2, ~3h)
**Impact: Design system coherence.**
- Global pass: replace all `fontSize`/`fontWeight` inline styles with typography components
- Replace all hardcoded hex values with `tokens.*`
- Replace `var(--border)` / `var(--surface)` / `var(--accent)` CSS vars with tokens

### Phase 8 — Remaining Forms & Misc (P2, ~3h)
- `McpConfigPanel` accordion → `<Accordion>`
- `RunHistory` expand rows → `<Accordion>`
- `CharterEditor` → `<Textarea>` + `<Field>`
- Loading states → `<Spinner>` / `<SkeletonItem>`
- `WorkflowList` toolbar → `<Toolbar>`

---

## 7. Notes & Gotchas

1. **Dark theme:** `webLightTheme` is wired but the CSS variables (`--surface`, `--bg`, `#0d1117`) are GitHub dark palette. There will be a visual conflict until a dark theme override (`webDarkTheme` or custom) is applied. **Recommend adding a `<FluentProvider theme={webDarkTheme}>` option or custom theme tokens mapped to the GitHub palette.**

2. **`@fluentui/react-icons` is not yet installed** — must be added: `pnpm --filter @squadboard/client add @fluentui/react-icons`.

3. **Drag-and-drop + `<Card>`:** `@hello-pangea/dnd` wraps `IssueCard` with `Draggable`. The `provided.innerRef` and spread props (`{...provided.draggableProps}`) must be applied to the Fluent `<Card>` root element. Use the `ref` prop on `<Card>`.

4. **NavDrawer is in `@fluentui/react-components/unstable`** — API may change. Option A (token-styled nav) is safer for the hacking phase.

5. **`<Checkbox>` appearance in dark theme:** Fluent checkboxes use brand tokens for checked state which will look correct once dark theme is applied.

6. **`<Dialog>` vs custom modal z-index:** Fluent `<Dialog>` uses a portal and manages z-index internally — remove the `zIndex: 300` from custom modals.

7. **`makeStyles` is the recommended styling approach** for components using Fluent tokens (uses Griffel under the hood, generates atomic CSS).
