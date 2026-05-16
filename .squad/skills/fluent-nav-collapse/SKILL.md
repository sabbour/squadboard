# Skill: Fluent NavDrawer Collapsed-State Recipe

**Applies to:** `@fluentui/react-components` NavDrawer (Fluent2 / v9)
**Last validated:** 2026-05-16 (W24)

---

## Pattern: Hybrid CSS-Width + Conditional Tooltip Wrapping

Use this when you need a collapsible icon-only sidebar with the Fluent NavDrawer, where:
- Width transitions smoothly (200ms)
- Icons stay visible and selected state still works
- Tooltips appear on hover in collapsed mode
- State persists to localStorage

---

## Step 1 — State and toggle

```tsx
const [navCollapsed, setNavCollapsed] = useState(
  () => localStorage.getItem('squadboard.nav.collapsed') === 'true'
)

function toggleNav() {
  setNavCollapsed(prev => {
    const next = !prev
    localStorage.setItem('squadboard.nav.collapsed', String(next))
    return next
  })
}
```

## Step 2 — Styles (makeStyles / Griffel)

```ts
const useStyles = makeStyles({
  navDrawer: {
    borderRight: `1px solid ${tokens.colorNeutralStroke1}`,
    transition: 'width 200ms ease',   // ← add transition here on the base style
    '& nav': { display: 'flex', flexDirection: 'column', height: '100%' },
  },
  navDrawerCollapsed: {
    width: '56px',
    minWidth: '56px',
    overflow: 'hidden',
  },
  navCollapseToggle: {
    display: 'flex',
    justifyContent: 'center',
    paddingTop: tokens.spacingVerticalXS,
    paddingBottom: tokens.spacingVerticalXS,
  },
})
```

## Step 3 — NavDrawer className

```tsx
import { mergeClasses } from '@fluentui/react-components'

<NavDrawer
  className={mergeClasses(styles.navDrawer, navCollapsed ? styles.navDrawerCollapsed : undefined)}
  ...
>
```

## Step 4 — Toggle button (at top of NavDrawerBody)

```tsx
import { ChevronDoubleLeftRegular, ChevronDoubleRightRegular } from '@fluentui/react-icons'

<div className={styles.navCollapseToggle}>
  <Button
    appearance="subtle"
    icon={navCollapsed ? <ChevronDoubleRightRegular /> : <ChevronDoubleLeftRegular />}
    onClick={toggleNav}
    title={navCollapsed ? 'Expand navigation' : 'Collapse navigation'}
  />
</div>
```

## Step 5 — Each NavItem with conditional Tooltip + label

```tsx
{navCollapsed ? (
  <Tooltip content="Projects" relationship="label" positioning="after" hideDelay={0}>
    <NavItem icon={<Home24Regular />} value="projects" />
  </Tooltip>
) : (
  <NavItem icon={<Home24Regular />} value="projects">Projects</NavItem>
)}
```

For mapped items (e.g. from a data array):
```tsx
{items.map(item =>
  navCollapsed ? (
    <Tooltip key={item.value} content={item.label} relationship="label" positioning="after" hideDelay={0}>
      <NavItem icon={item.icon} value={item.value} />
    </Tooltip>
  ) : (
    <NavItem key={item.value} icon={item.icon} value={item.value}>{item.label}</NavItem>
  )
)}
```

## Step 6 — Hide section headers + logo when collapsed

```tsx
{!navCollapsed && <NavSectionHeader>SECTION</NavSectionHeader>}
{!navCollapsed && <div className={styles.sidebarLogo}>...</div>}
```

---

## Why this approach (not pure CSS, not full conditional render)

| Approach | Pro | Con |
|----------|-----|-----|
| Pure CSS (hide label spans via selector) | Single tree, no duplication | Fluent NavItem class names are unstable; can't wrap NavItem in Tooltip via CSS |
| Full conditional render (two trees) | Full control | Duplicates all NavItem logic; two separate selectedValue/onNavItemSelect wires |
| **Hybrid (this recipe)** | Single tree, stable API, proper Tooltip support | Slightly more verbose JSX per NavItem |

---

## Caveats

- Section headers disappear in collapsed mode — expected, acceptable.
- Horizontal logos overflow 56px — hide them when collapsed; add a compact icon variant if needed.
- NavItem with no children renders icon-only. Selected state (highlight) works via NavDrawer `selectedValue`.
- `ChevronDoubleLeftRegular` / `ChevronDoubleRightRegular` confirmed present in `@fluentui/react-icons` as of W24.
- localStorage key convention: `squadboard.nav.collapsed` (string `'true'`/`'false'`).
