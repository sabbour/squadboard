# @sabbour/squadboard-sdk

Pre-alpha library-first SDK for Squadboard ceremonies and agent primitives. Separate from the `@sabbour/squadboard` MCP distribution package.

## Installation

```bash
npm install @sabbour/squadboard-sdk
```

## Usage

### Scribe Module — Close Out Ceremonies

```typescript
import { squadboard } from '@sabbour/squadboard-sdk';

const result = await squadboard.scribe.closeOut({
  spawnManifest,
  push: true,
});
```

### Direct Imports — Fine-Grained Composition

```typescript
import { archiveDecisionsBySize, writeHealthReport } from '@sabbour/squadboard-sdk/scribe';
```

### Bundle Schema Types

```typescript
import type {
  SquadboardBundle,
  BundleProject,
  BundleKanban,
  BundleWorkflow,
  BundleAgent,
} from '@sabbour/squadboard-sdk';
```

## API

### `squadboard.scribe`

Ceremony and workflow primitives.

| Export | Description |
|--------|-------------|
| `closeOut(options)` | Close out a spawn ceremony with health reporting and decision archival |
| `archiveDecisionsBySize(...)` | Archive decisions by size classification |
| `writeHealthReport(...)` | Generate a health report for a spawn |

**Types:**
- `CloseOutOptions` — Configuration for closeOut
- `CloseOutResult` — Result of a closeOut operation
- `SpawnManifest` — Description of a spawn/ceremony instance
- `SpawnManifestEntry` — Individual entry in a spawn manifest

### Bundle Schema

Types for portable project configuration artifacts. Use these to describe agents, workflows, ceremonies, tools, and MCP servers in a declarative format.

Core types:
- `SquadboardBundle` — Root bundle type
- `BundleProject` — Project configuration
- `BundleKanban` — Kanban board setup
- `BundleWorkflow` — Workflow definition
- `BundleAgent` — Agent configuration
- `BundleCeremony` — Ceremony definition
- `BundleSkill` — Skill/capability definition
- `BundleTool` — Tool integration
- `BundleMcpServer` — MCP server configuration

## Development

```bash
pnpm build     # Build TypeScript to dist/
pnpm test      # Run vitest tests
pnpm typecheck # Check types without emitting
```

## Notes

- This is a library package — not intended for direct CLI use
- Exports sub-entry points: `@sabbour/squadboard-sdk/scribe`, `@sabbour/squadboard-sdk/bundle`
- Fully typed TypeScript — no runtime validation of bundle schemas
- Pre-alpha — API may change
