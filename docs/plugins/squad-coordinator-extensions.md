# Squad Coordinator Extensions — Plugin Author Guide

Your plugin can extend Squad (the coordinator) without forking its upstream `squad.agent.md` preamble. This guide shows you how.

## What This Enables

Squad is loaded into every Copilot CLI session with a fixed behavior preamble. That preamble lives upstream in the `bradygaster/squad-duck` repo — your users pull updates from there, and if you forked it, you'd lose those updates forever.

Instead, **write a Markdown fragment** that Squad loads at session start. Your fragment adds behavior (calls MCP tools, implements workflows) additively, on top of the upstream preamble. No fork. No merge pain. When Squad upgrades, your fragment keeps working.

Fragments are ideal for:
- MCP server integration (Trello, Aspire, Azure, Notion, your own tools).
- Domain-specific workflows ("when I see a Jira ticket, …").
- Custom directive capture logic.
- Team rituals specific to your org.

## Where Fragments Live

Fragments are discovered and loaded in this order:

| Location | Scope | Priority | Format |
|----------|-------|----------|--------|
| `~/.squad/extensions/coordinator/<name>.md` | User-global, per-machine | Lower | All files matching `*.md` |
| `<repo>/.squad/extensions/coordinator/<name>.md` | Project-local, per-repo | **Higher** | All files matching `*.md`; wins over global |

Squad loads them **in sorted filename order** (alphabetical). A global `trello.md` is loaded before a global `squadboard.md`. Within a single repo, project-local fragments override global ones by filename (project-local `squadboard.md` disables the user-global `squadboard.md`).

## Fragment Shape & Style

Fragments are written in **Squad coordinator voice** — terse, imperative, action-oriented. Squad is a dispatcher, not a philosopher; your fragment should match that tone.

**Length guideline:** ≤200 lines. Keep it focused.

**Required structure:**

1. **Detection block** — "If you see tools `{your_prefix_}*` or the artifact `{your_file}` exists, activate the workflow below."
2. **Tool inventory table** — one row per tool, use case → what it does.
3. **Workflow sections** — the actions you want Squad to take (when to call what).
4. **Boundaries** — what NOT to do (don't contradict upstream rules).

**Optional sections:**
- Project/environment routing (if your tool supports multiple endpoints).
- Override mechanism (how users customize locally).
- Status read-outs (what to display when users ask "what's happening?").

**Example structure:**

```markdown
<!-- {your-package}:auto-installed -->

## {Your Service} Integration

### Detection

Scan your available tools for `{service}_` prefix.

### Tools

| When | Tool | What It Does |
...

### Capture Workflow

When you detect ... call {service}_capture ...

### Boundaries

You DO NOT bypass ...
```

## Naming Convention

**Fragment filename = stable identifier for your plugin.** Use your package name or service name:

- ✅ `squadboard.md` (clear, stable, ties to @sabbour/squadboard)
- ✅ `trello.md` (Trello integration)
- ✅ `aspire-dashboard.md` (Aspire metrics integration)
- ❌ `extension.md` (generic; confusing if multiple plugins ship extensions)
- ❌ `workflow.md` (too generic)

The filename becomes the unique key for override detection (see below). Use a name that won't collide with other plugins.

## Installation Pattern — Postinstall Script

**Recommended:** Ship a postinstall script in your npm package that installs the fragment to `~/.squad/extensions/coordinator/{name}.md`. This runs on `npm install` / `npm update`, so upgrades are automatic.

**Reference implementation:** See `packages/squadboard/scripts/postinstall-coordinator-fragment.mjs` in the Squadboard repo (once shipped). It demonstrates the idempotent + diff-aware pattern.

**Pseudocode:**

```javascript
// scripts/postinstall-coordinator-fragment.mjs

const targetPath = path.join(
  os.homedir(),
  '.squad/extensions/coordinator',
  '{your-fragment-name}.md'
);

// 1. Ensure parent dir exists
mkdirSync(path.dirname(targetPath), { recursive: true });

// 2. Read bundled fragment from ../coordinator-fragment.md
const bundledContent = readFileSync(path.join(__dirname, '..', 'coordinator-fragment.md'));

// 3. Compute SHA-256 of bundled content
const bundledSha = sha256(bundledContent);

// 4. If target does not exist → install
if (!existsSync(targetPath)) {
  writeFileSync(targetPath, bundledContent);
  console.log('✅ Installed {your-service} coordinator fragment');
  process.exit(0);
}

// 5. If target exists:
const targetContent = readFileSync(targetPath);
const targetSha = sha256(targetContent);

// 5a. SHAs match → no-op
if (targetSha === bundledSha) {
  console.log('✅ Coordinator fragment up to date');
  process.exit(0);
}

// 5b. SHAs differ; check marker
const MARKER = '<!-- {your-package}:auto-installed -->';
if (targetContent.includes(MARKER)) {
  // We own this file; upgrade silently
  writeFileSync(targetPath, bundledContent);
  console.log('🔄 Coordinator fragment upgraded');
  process.exit(0);
}

// 5c. User has edited; save new version alongside
writeFileSync(`${targetPath}.new`, bundledContent);
console.log('⚠️  User-edited coordinator fragment detected.');
console.log(`   New version saved to ${targetPath}.new`);
process.exit(0);
```

**Key points:**

- Always exit 0 (postinstall must not break `npm install`).
- Use a **unique auto-installed marker** (`<!-- {your-package}:auto-installed -->` at the top of the file you write). Squad uses `<!-- squadboard:auto-installed -->`.
- Idempotency: detect if you own the file via the marker; if so, upgrade it. If the user removed the marker, stop touching it.
- Diff-aware: if you don't own it, save `.new` alongside instead of overwriting.

## Upgrade Story

Your postinstall runs on every `npm install` / `npm update`. Users stay in sync with your latest fragment without manual action.

**Versioning:** The `<!-- {your-marker} -->` line tells your postinstall that you placed this file. If a user edits it and removes the marker, your postinstall respects that and stops touching it (writes `.new` instead).

**For users:** They can hand-edit `~/.squad/extensions/coordinator/{your-name}.md` and remove your marker. From that point, your postinstall backs off — the user owns the file.

## User Override — Project-Local Customization

Users can override the user-global fragment with a project-local version. If they create:

```
<repo>/.squad/extensions/coordinator/{your-fragment-name}.md
```

Squad will load that instead of (and completely ignore) the user-global `~/.squad/extensions/coordinator/{your-fragment-name}.md`.

**Use case:** A team wants Squadboard on most projects, but on `internal-tools`, they use a custom workflow that differs from the default fragment. They copy the global fragment to `.squad/extensions/coordinator/squadboard.md` in that one repo and edit it.

**Important:** Project-local overrides are **whole-file replacements**, not merges. If a user creates a project-local fragment, they're responsible for including any Squad upstream behavior they still want (e.g., if a future upstream Squad update changes the directive-capture flow, the project-local fragment won't auto-inherit it).

## Upstream PR — Q3 Plan

This generic extension mechanism is being submitted as a pull request against `bradygaster/squad-duck` under Q3 (timeline: May–July 2026). Until merged:

1. Individual plugins (Squadboard, Trello, Aspire, etc.) use this postinstall pattern to drop fragments into `~/.squad/extensions/`.
2. Coordinate with the Squad maintainer (Brady) to enable the extension discovery in the upstream preamble.
3. Once merged, all fragments automatically load — no per-plugin wiring needed.

For now, **you must add a small preamble section to your plugin's install/onboarding docs** to tell users about the fragment install and verify it worked.

## Anti-Patterns — What NOT to Do

- **❌ Contradict the upstream preamble.** If upstream Squad says "always await user confirmation before dispatching agents," your fragment can't say "dispatch agents proactively." The two rules conflict; users will be confused.
- **❌ Dispatch agents from the fragment.** Fragments are rules + tool calls. Squad does the dispatching. If your fragment needs a specialized workflow, propose a tool call to Squad; let the upstream preamble decide whether to dispatch an agent or handle inline.
- **❌ Use repo-specific paths.** Fragments are reusable across repos. Don't reference `/home/user/project-x/.squad/routing.md` or hardcode org names. Use `SQUADBOARD_DEFAULT_PROJECT_ID` (environment variable) or `TRELLO_BOARD_ID` if your tool needs project/board routing.
- **❌ Assume file structure.** Don't check for `.squad/team.md` or expect a particular directory layout. Fragments should work on fresh repos too.
- **❌ Silent no-ops.** If your fragment detects missing config or tools, tell the user. Example: "Trello tools not found. Install the Trello MCP server and add it to `.copilot/mcp-config.json`."

## Testing Your Fragment

Before shipping:

1. **Fresh install:** Run `npm install @your-org/your-plugin` on a clean machine. Verify the fragment lands at `~/.squad/extensions/coordinator/{name}.md`.
2. **Idempotency:** Run `npm install` again. Verify the fragment is not duplicated or corrupted.
3. **Upgrade:** Modify the bundled fragment (e.g., add a word), bump the package version, reinstall. Verify the file upgrades and contains your change.
4. **User override:** Remove the auto-installed marker from the file. Run `npm install` again. Verify the file is NOT overwritten (instead, a `.new` copy is created).
5. **Session test:** Load a Squad session with the fragment installed. Verify Squad detects your tools and the workflow activates.

## Related Reading

- **Squadboard coordinator fragment** — `.../packages/squadboard/coordinator-fragment.md` — the canonical example of a full-featured fragment.
- **Postinstall script** — `.../packages/squadboard/scripts/postinstall-coordinator-fragment.mjs` — reference implementation of idempotent install logic.
- **Upstream Squad preamble** — `bradygaster/squad-duck/.github/agents/squad.agent.md` — the coordinator's core behavior that fragments extend.
- **Squad routing** — `<repo>/.squad/routing.md` — how projects configure agent dispatch; fragments can hint at routing but don't override it.

## FAQ

**Q: Can two plugins install fragments with the same filename?**
A: No — they'll collide. Use unique filenames (`squadboard.md`, not `fragment.md`). The second plugin to install wins. Coordinate on naming in the ecosystem.

**Q: What if my fragment needs async operations or long-running setup?**
A: Fragments are static Markdown that Squad reads at session start. They don't execute code. If you need runtime setup, use a postinstall hook in your npm package. The fragment can then *refer to* that setup (e.g., "if `~/.trello/config.json` exists, the service is configured").

**Q: Can fragments call other MCP tools, or only their own?**
A: Fragments can instruct Squad to call ANY available MCP tools. Your fragment might say: "when capturing, call `squadboard_capture` AND `github_create_issue` if applicable." Squad has access to all registered MCP servers.

**Q: What happens if Squad upgrades and breaks my fragment?**
A: Fragments are designed to be robust against upstream changes. The upstream preamble's core rules (reviewer gating, directive capture, dispatch) are stable. If Squad changes, check the upgrade notes. If your fragment becomes incompatible, your postinstall will detect it (marker is present, content differs) and upgrade the fragment automatically.

**Q: Can I distribute fragments outside npm?**
A: Yes, but postinstall automation is the recommended pattern. If you're a plugin author without an npm package, document the manual install step: "Copy [this file](link/to/fragment.md) to `~/.squad/extensions/coordinator/my-service.md`." The same idempotency rules apply — add your marker, users can override by removing it.
