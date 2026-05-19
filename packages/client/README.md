# @sabbour/squadboard-client

React + Vite + Fluent 2 front-end for Squadboard.

## Loading patterns

Squadboard provides a unified loading component family in `src/components/loading/`. Pick the right level based on what is loading:

| Component | When to use | Example |
|---|---|---|
| `<PageLoading />` | Entire page is not ready (no content to show) | Route-level data fetch |
| `<SectionLoading />` | A card or panel section is loading; rest of page is interactive | Tab body, member list |
| `<InlineLoading />` | Next to a label or inside body text | Micro-status indicator |
| `<ActionLoading />` | Inside a `<Button icon={…}>` while an action is pending | Save, Cast Team, Run ceremony |

All components are re-exported from the barrel:

```ts
import { PageLoading, SectionLoading, InlineLoading, ActionLoading } from './components/loading'
```

**Dev gallery**: navigate to `/__loading-gallery` (DEV mode only) to see every variant rendered side-by-side. This is the canonical reference surface for any future agent adding a loading state.

Source: `packages/client/src/components/loading/`

## Development

```bash
pnpm --filter @sabbour/squadboard-client dev
pnpm --filter @sabbour/squadboard-client build
```
