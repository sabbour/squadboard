# Squadboard — Wave 10: Dogfood + UX Bug Bash

## Problem

Ahmed surfaced ~25 issues spanning a **strategic dogfood transition** (run squadboard's own development on squadboard via MCP from this Copilot CLI), several **regressions/bugs** (project-from-template broken, Conjure didn't replace Capture, Heartbeat never wired, hover resize, "Reconnecting" status, Consult prefill empty), and a long tail of **Fluent2/UX polish** (empty-state alignment, dropdown wrap, stacked buttons, Costs table alignment, Save-as-template visuals, Now-page styling, ceremonies UX, Flow agent-centric pivot, HireTeamModal missing roles). One billing question: GitHub changed how Copilot is billed (premium-request multipliers, not USD/token) — squadboard's cost rollups need to follow.

## Approach

One omnibus wave (per user choice: `wave1Priority=all_in_one`), organised into **5 work-streams** that fan out in parallel. Each stream owned by the obvious specialist; no stream blocks another except where noted.

**Strategic anchor (Stream A) sets the dogfood loop.** Once squadboard is registered as a project in its own running instance and MCP is wired into THIS Copilot CLI's `.copilot/mcp-config.json`, every remaining bug/polish item from this prompt becomes a `capture` call into the squadboard inbox — and we close the loop by working those issues through the board. So Stream A delivers infrastructure + seeds the backlog for Streams B–E to consume.

**Decisions captured up-front (no further user input needed mid-wave):**
- Dogfood scope: **full** — register squadboard project + MCP wiring + Copilot directives flow through Conjure/inbox.
- HireTeamModal roles: **add 7 non-tech roles** (PM, Designer, Founder, Sales, Marketing, Customer Success, Research) layered over the 9 SDK roles via a Squadboard-side mapping.
- Costs: **migrate to GitHub Copilot premium-request-multiplier model.** Replace USD/token with per-model multipliers, "included models" billed at 0, auto-select 10% discount, FedRAMP/data-residency +10%. Keep USD as a derived/optional column for non-GitHub models.
- Scribe ↔ squadboard bridge: **out of scope** for this wave (`.squad/decisions.md` stays separate).

---

## Work-streams

### Stream A — Dogfood: squadboard-on-squadboard via MCP  (Hockney + Kobayashi + Ahmed)

Goal: by end of stream, Ahmed can say "capture: fix the hover resize on project tiles" in this CLI session and a card appears in the squadboard inbox of the squadboard project.

- **A1. Self-register squadboard as a project.** On `pnpm dev` first boot, if the running CWD contains `.squad/` AND no project row points at it, auto-insert a project row (name: "Squadboard", path: `<repo>/.squad`). Idempotent. Surfaces in the projects list immediately.
- **A2. Wire MCP into this Copilot CLI session.** Replace the placeholder `EXAMPLE-github` entry in `.copilot/mcp-config.json` with a `squadboard` entry pointing at `packages/server/src/mcp/index.ts` via `npx tsx` (dev) plus an HTTP fallback example. Document the HTTP transport URL (`http://localhost:<port>/mcp`) for VS Code / non-stdio clients.
- **A3. `x-project-id` defaulting for the dogfood loop.** Add an env var (`SQUADBOARD_DEFAULT_PROJECT_ID`) the stdio MCP transport reads at boot so `capture` / `list_inbox` / `list_issues` don't require `projectId` per call from this CLI session. Document the override in the README.
- **A4. Capture-on-directive coordinator workflow.** Document in this repo's `squad.agent.md` (or a sidecar `dogfood.md`) that when Copilot detects a directive/work item from Ahmed, it calls the `capture` MCP tool to land it in squadboard's inbox in addition to (not in place of) the existing decisions/inbox flow.
- **A5. Seed the squadboard backlog.** Use the new `capture` tool to push every Stream B/C/D/E item from this plan into the squadboard inbox as the first real dogfood test. Verify each lands; verify Conjure classifier routes them as `intent=issue`.
- **A6. Smoke test the loop.** End-to-end: capture from this CLI → see in `/projects/<squadboard>/inbox` → formulate → board → run → close. Document any rough edges discovered (will likely surface fresh issues; capture them too).

**Owner:** Hockney (MCP/server), with Kobayashi for the auto-registration shape and Keyser for the inbox-side UX checks.

---

### Stream B — Regressions & broken flows  (Keyser + Hockney)

- **B1. "Create project from template" broken.** Reproduce in `ProjectPicker.tsx` (the `CreateTab` path uses `useTemplates('project')` + `useInstantiateProjectTemplate`). Inspect server route `POST /api/templates/:id/instantiate`, the Drizzle path, and the template payload schema. Fix the failing branch; add an e2e in `packages/e2e` covering the happy path.
- **B2. Conjure has not replaced Capture.** Acceptance: the Layout's blue "+ Capture" button is gone (or repurposed into Conjure entry). The new Consult page already takes raw input; the Inbox page uses Conjure classifier. Audit `Layout.tsx`, `CaptureFab.tsx`, `CaptureModal.tsx`, `Inbox.tsx`, `Consult.tsx`, `Board.tsx`, `CeremonyEditor.tsx`, `components/inbox/Capture*` — wherever Capture surfaces, replace with Conjure intent. Delete dead Capture components once verified (or leave a thin shim for one release with a console warn).
- **B3. Heartbeat is paused / "service not yet active".** `pages/Heartbeat.tsx` has `TODO(p3-heartbeat): wire to /api/heartbeat once McManus ships the service`. Ship the service: a background sweeper (cadence configurable; default 60 s) that records last-tick timestamp + per-sweep results in a small in-memory ring + persisted last-state row. Expose `/api/heartbeat/status` and `/api/heartbeat/sweeps?since=…`. Wire the page; remove the placeholder.
- **B4. Project tile hover resizes the tile.** `ProjectCard.tsx` likely has a transform/scale on hover that grows the bounding box and reflows neighbours. Replace with elevation/shadow/border treatment that doesn't change layout dimensions.
- **B5. Project status indicator stuck on yellow "Reconnecting".** Wave 9 fixed the alignment + stale-timer (commit `5673d57b`) but the user still sees yellow. Inspect `realtime/ws-client.ts` state machine: `setConnectionState('reconnecting')` is fired in two places — verify the WS actually reaches `connected` for the squadboard project on first load and isn't getting stuck because the WS path/origin assumes a different port in dev. Fix root cause; add a regression assertion in the e2e suite that the badge reaches "Connected" within N seconds of page load.
- **B6. Consult button on issue panel opens empty session.** "Consult about this issue (open Ask)" in `Inbox.tsx`/`Board.tsx`/issue panel currently navigates to `/consult/new` without payload. Pass the issue summary + body + recent run logs as the seed message (Consult API supports `seedMessage` per `services/consult.ts`). Verify both Agent and Model modes accept the seed.

**Owner:** Keyser primary; Hockney backs B1/B3/B5 server-side.

---

### Stream C — Fluent2 / UX polish  (Fenster + Keyser)

- **C1. New-consult page: width + button sizing.** `/consult/new` content (the Mode/Model/Open-with form) sits in a narrow card centered in a wide page. Widen the card to the page-content width (already canon: `tokens.spacingHorizontalXXL`). Re-balance the "Agent | Model" segmented control + Start-conversation button so they aren't visually awkward.
- **C2. AddProject "Connect existing" tab — vertically stacked buttons.** The Connect/Close stack is wrong; standard Fluent2 dialog actions are horizontal-right. Move both buttons into `<DialogActions>` (consistent with the Discover/Create tabs). Audit all three tabs for parity.
- **C3. Now page Fluent2 + aggregated view across projects.** Restyle to match the canon: `PageHeader` already used; replace the inline status badge palette with Fluent's Badge component; switch table styling to `DataGrid` to match Costs/Templates. The data model already aggregates across projects (`useNowFeed` joins `live_sessions`, `issue_runs`, `workflow_runs` globally) — verify the API joins are project-agnostic and the columns include a Project link. Fix any gaps.
- **C4. Project selection dropdown wraps.** Widen the popover (set `minWidth` on the menu surface) so single-line names like "Content Creation Workflow — Squad Edition" don't wrap. If width can't accommodate longest name, ellipsis + tooltip.
- **C5. Empty Skills / Tools / MCP Servers pages — alignment + Ceremonies-style treatment.** Ceremonies' empty state (centered icon + heading + body + primary action) is the reference. Apply the same `<EmptyState>` component pattern to Skills, Tools, MCP pages. Skills empty state ALSO needs to show: "Browse the curated library" + "New skill" + (NEW) "Import skill". Same triplet for Tools (curated lib if any, New, Import). Same for MCP (Add server, Import). Standardise across all three.
- **C6. Costs table alignment.** Right-align numeric columns (Runs, Total Cost, Avg/Run, Tokens In/Out, Cost). Use `DataGrid` column `align: 'end'`. Format USD with consistent precision; format tokens with thousands separators.
- **C7. Save-as-template dialogs Fluent2.** `Settings.tsx`, `Agents.tsx`, `CeremonyEditor.tsx` all open a Save-as-template dialog. Audit each for `<Dialog><DialogSurface><DialogBody><DialogTitle><DialogContent><DialogActions>` structure with right-aligned actions (cancel left of primary, primary right). Add a "Saved to: `<global templates store>`" caption in the dialog content so the user knows where the artifact landed.
- **C8. Diagnostics/Heartbeat scope is jarring.** Today they exist at both global and per-project routes; clicking inside a project can drop you to global scope without warning. Two options for Hockney/Keyser to choose: (a) keep both but make the page `<PageHeader>` clearly say "Global · across all projects" vs "Project: X" so the scope shift is visible; (b) make Diagnostics/Heartbeat project-scoped only and remove the global entry from the bottom nav. Recommend (a) for v1 — preserves the muscle memory.

**Owner:** Fenster (designs C1/C3/C5/C7/C8), Keyser implements.

---

### Stream D — Feature gaps  (Hockney + Keyser + McManus)

- **D1. HireTeamModal — add the 7 non-tech roles.** Layer a Squadboard-side `EXTENDED_ROLE` set on top of the SDK's `AgentRole` union (since the SDK only exports 9). Add: `pm`, `designer-nontech` (or rename existing `designer`?), `founder`, `sales`, `marketing`, `customer-success`, `research`. Each maps to a curated `BASE_ROLE` (in `casting-engine.ts`'s `AGENT_ROLE_TO_BASE_ROLE`). Update `ROLE_OPTIONS` in `HireTeamModal.tsx` and `ROLE_BADGE_COLOR`. Update `local-universes.ts` `preferredRoles` arrays to support the new roles in each universe. Verify `castingEngine.cast()` still produces complete teams.
- **D2. Curated skills — provenance + import.** Tag each curated skill in the library modal with where it comes from (likely a hard-coded list in `services/skills.ts` or a JSON catalog) — show "Source: built-in catalog" badge. Add "Import skill" action: file-pick a `SKILL.md` or `skill.json`; validate; persist to project skills. Same pattern as template import in `Templates.tsx`.
- **D3. Import tool / Import MCP server.** Symmetric with D2. Tools page: file-pick a `tool.json`; MCP page: file-pick an `mcp-server.json`. Add to empty-state action set (see C5).
- **D4. Ceremonies — clarify routing trigger source.** On Ceremony detail/list, when a ceremony is automatic (`when: before|after` with a condition), show the trigger source as a labelled badge (e.g., "Triggered from: routing.md → 'before any work batch matching X'") so the user knows where the schedule came from. Inspect `services/ceremony-translator.ts` and the dispatcher to see what metadata is available.
- **D5. Ceremony create — drop duplicate "Prose" tab; keep "Formulate".** `CeremonyEditor.tsx` exposes both "Formulate with AI" (top section) AND a "Prose" tab inside the Code/Visual/Prose tab strip. Keep "Formulate with AI" (it's higher in the page and produces YAML); remove the "Prose" tab. Migrate any Prose-only logic into the Formulate path so nothing is lost.
- **D6. Costs — migrate to GitHub Copilot premium-request multipliers.** Background: GitHub now bills Copilot by *premium request* with a per-model multiplier (auto-select gets a 10% discount; FedRAMP/data-residency adds 10%; included models — GPT-5 mini, GPT-4.1, GPT-4o — are 0). Action:
  - Research: pull the live multiplier table from GitHub docs (`/copilot/concepts/billing/copilot-requests` and the `auto-model-selection` page) into a Squadboard-maintained `MODEL_MULTIPLIERS` map in `packages/server/src/sdk/pricing.ts` (keep the USD `MODEL_PRICING` map for non-GitHub backends).
  - Schema: add a `premium_requests` numeric column alongside `cost_usd` on `issue_runs`, `workflow_runs`, `consult_sessions`. Backfill from existing `cost_usd` is not possible cleanly — leave 0 for old rows, accept it.
  - Engine: extend `cost-tracker.ts` to record `premiumRequests` per turn = `multiplier × (auto ? 0.9 : 1) × (residency ? 1.1 : 1)`. For included models, record 0.
  - UI: Costs page becomes "Premium requests" by default (with USD as a secondary tab/column for non-GitHub model usage). Show monthly allowance bar (configurable per plan; default to a placeholder of the user's plan).
- **D7. Save-as-template — show storage location.** In each Save-as-template dialog (Agents/Settings/CeremonyEditor) and in the Templates page, surface the storage location: `<XDG_DATA_HOME>/squadboard/templates/<kind>/<id>.json` (or wherever the server writes them — verify in `services/templates/`). Caption under the form, plus a "Reveal in finder" button on the Templates page row (best-effort; gated by platform).
- **D8. Flow page — agent-centric.** Today Flow renders steps. Pivot to render *agent runs* as nodes with parent→child lineage edges. Each node: agent name + status (active/failed/done) + run id + step it's doing. Inspect `pages/ProjectFlow.tsx` + `components/flow/`. Reuse the runs data already on board; the lineage edge is `parentRunId` → `childRunId` from `issue_runs`.

**Owner:** Hockney leads D1/D6 (server data shapes); Keyser leads D2/D3/D4/D5/D7/D8 (UI); McManus reviews D1/D6 architecture.

---

### Stream E — Verification + close-out  (Kujan + Redfoot)

- **E1. Test sweep.** `pnpm -r build` clean; targeted Vitest/RTL tests on changed components (B4 hover, B5 reconnect, C2/C5/C6/C7 visual snapshots if framework supports); e2e: B1 template create, B2 Capture removal, A6 dogfood loop, D6 cost recording, D8 Flow agent-centric.
- **E2. Docs refresh.** Update `packages/server/src/mcp/README.md` for the new dogfood flow (A2/A3) and the new pricing model (D6). Update the root `README.md` "Quickstart" with the dogfood section. Update `.copilot/mcp-config.json` example.
- **E3. Coordinator self-update.** Note in coordinator playbook that for THIS repo, after work completes, the coordinator should also `capture` a closing summary into the squadboard inbox so it appears as "done" on its own board. Optional but a nice symmetry.
- **E4. Heartbeat "first tick" verification.** After B3 ships, watch for one full tick on the Heartbeat page; capture screenshots for the closing handoff.

**Owner:** Kujan tests; Redfoot docs.

---

## Notes / Considerations

- **Parallelism:** A1/A2 must precede A4/A5/A6 (linear inside Stream A). All other streams (B/C/D) are independent and run in parallel. E1 waits for B/C/D outputs; E2 can start once any stream lands its first commit.
- **Reviewer gates:** D6 (cost migration — schema change + new metric semantics) goes through Lead review (McManus) before implementation. D8 (Flow pivot — visual + data-shape change) goes through UX review (Fenster) before code.
- **Backward compat:** D6 adds columns rather than renaming, so old rows survive. The Costs page falls back to USD when premium-request data is missing.
- **Risk — A5 chicken-and-egg:** seeding the squadboard backlog by capturing the bug list itself requires A1+A2+A3 to be working. If A1/A2 stall, fall back to manually inserting issues via the existing UI to unblock the rest.
- **Risk — D6 multiplier table churn:** GitHub updates multipliers periodically. The `MODEL_MULTIPLIERS` map should cite the source URL + retrieval date in a comment so future agents know when to refresh.
- **Out of scope (this wave):** Bridging `.squad/decisions.md` into squadboard inbox (per user). Coordinator-side workflow rewrites beyond the dogfood capture-on-directive note. Multi-tenant / shared-instance squadboard.
- **Out of scope (intentionally deferred):** Removing the deprecated `Capture*` components in B2 — leave a 1-release shim with a console warning, then delete in the next wave.

---

## Acceptance criteria for the wave

1. From this Copilot CLI session, `capture: <text>` lands in the squadboard project's inbox without me providing a project id.
2. Project-from-template works end-to-end (covered by an e2e).
3. No "+ Capture" button anywhere; only Conjure surfaces (Inbox + Consult).
4. Heartbeat page shows a real ticking timestamp.
5. Project tiles do not change size on hover.
6. Project status indicator reaches "Connected" within ~3 s of the projects page loading.
7. Consult-from-issue prefills the conversation with the issue context.
8. AddProject dialog actions are horizontal-right across all 3 tabs.
9. New-consult page uses the canon page width.
10. Now page uses Fluent2 styling and aggregates across projects.
11. Project switcher dropdown does not wrap on the longest current project name.
12. Empty Skills / Tools / MCP pages match the Ceremonies empty-state pattern; all three offer Import.
13. Costs table is right-aligned; premium-request column visible alongside USD.
14. Save-as-template dialogs are Fluent2 + show storage location.
15. Diagnostics/Heartbeat clearly label scope (global vs project) at all times.
16. HireTeamModal shows the 9 SDK roles + the 7 non-tech roles.
17. Curated skills show provenance; Skills/Tools/MCP all support Import.
18. Ceremonies show their trigger source.
19. Ceremony create has a single text-to-ceremony entry (Formulate); Prose tab gone.
20. Costs records premium requests per turn using the GitHub multiplier model.
21. Flow page renders agent run nodes with parent/child lineage edges.

---

## Stream F (appended) — Templates, Squad Apps, Marketplace, Docs  (LOWER PRIORITY)

> Per Ahmed's follow-up: append, don't prioritise. These items deliver after Streams A–E land. They're a strategic surface — packaging + community + first-run experience — not regression fixes.

**Investigation findings that shaped this stream:**
- **Workflow templates "disappeared"** because the Templates page is mounted only at `/projects/:id/ceremonies/templates` (sub-route, not in main nav). The Templates page itself still exists with Ceremonies/Workflows/Teams/Projects tabs.
- **Ceremony-from-markdown import** has full backend (`POST /api/ceremonies/import-narrative` + `useImportNarrative` + the `ceremony-translator.ts` service that converts narrative MD → executable YAML) but no UI surfaces it anywhere.
- **Plugin/marketplace** does not exist in squadboard yet. Upstream Squad has a spec (`.squad/templates/plugin-marketplace.md` — read for reference) with `.squad/plugins/marketplaces.json`, CLI commands (`squad plugin marketplace add/remove/list/browse`), and a clean install pattern (drop SKILL.md into `.squad/skills/`). Squadboard should align here AND extend the same model to workflows/ceremonies/tools/MCP/teams/projects.

### Items

- **F1. Restore workflow-templates visibility.**
  - Add Templates to the main nav (or as a per-project tab next to Ceremonies/Skills/Tools).
  - On the Ceremonies page header, add "Browse templates" entry-point.
  - Audit App.tsx routes: keep `/projects/:id/ceremonies/templates` for back-compat but redirect to the new top-level route.

- **F2. Re-add ceremony-from-markdown import UI.**
  - In `pages/CeremonyList.tsx` and the new-ceremony flow (`CeremonyEditor.tsx`), add an "Import from markdown" action: file-pick a `.md`, POST to `/api/ceremonies/import-narrative`, then route the user to `CeremoniesReview.tsx` to approve the LLM-generated YAML draft.
  - Drag-and-drop a `.md` onto the Ceremonies page should work too.
  - Document the narrative format (one-pager in `docs/`).

- **F3. Squad Apps — packaging model.**
  - Define a **Squad App** as a packaged, installable bundle that contains: a project skeleton + team (charters) + workflows + ceremonies + skills + tools + MCP recipes + seed issues + README. Single file/dir/git-url; one-click install becomes a fully functional kanban project.
  - **Format proposal** — `.squadapp/` directory (or `.squadapp.tar.gz`) containing:
    ```
    squadapp.json               # manifest: name, version, author, description, requires
    project.json                # project skeleton
    team/                       # one .json per agent + team-summary.json
    workflows/*.yaml
    ceremonies/*.yaml
    skills/*/SKILL.md           # aligns with upstream Squad's skill format
    tools/*.json
    mcp/*.json
    issues/*.md                 # seed cards (optional)
    README.md
    ```
  - **Install entry-points** — UI drag-and-drop, `npx squadboard app install <path|git-url>`, MCP `install_app` tool.
  - **Run** — installed apps appear under a new "Apps" entry. "Create from app" instantiates a real project (similar to current "Create from template" but with much more pre-filled context).
  - Schema + validator land in `packages/server/src/services/squad-apps/`.
  - **Open question for later (NOT for this wave):** Do we publish a registry/index of community Squad Apps? Defer until F6 lands.

- **F4. Curated quality-over-quantity project templates.**
  - Today: 18 starters from `bradygaster/Squad-IRL` (auto-imported). Largely demo-ware.
  - Goal: ship **5 hand-tuned Squad Apps** (built on the F3 format) covering distinct use-cases:
    1. **AKS feature kanban** (technical) — engineering team, design/dev/test/devops/security ceremonies, AKS-specific MCP tools.
    2. **Content marketing pipeline** (non-tech) — PM + Designer + Marketing + Customer Success agents, weekly editorial-cadence ceremony, social-export tool.
    3. **Product launch** (cross-functional) — PM + Sales + Marketing + DevRel, GA-readiness checklist ceremony.
    4. **Customer support triage** (CS) — CS + PM + Dev, ticket-routing ceremony.
    5. **Research project** (analyst) — Research + Designer + PM, literature-review ceremony.
  - Each app: tasteful kanban columns/labels, 4-6 charter-quality agents, 2-3 ceremonies, 5-10 curated skills, 1-3 MCP recipes, a real README, 5-10 seed issues.
  - Existing `data/starters/` is preserved as-is (back-compat); the 5 curated apps live in `data/squad-apps/` and become the headline first-run choice.

- **F5. Unified import/export structure.**
  - Today imports/exports are scattered: `useImportTeam`, `useImportProject`, `useImportWorkflow`, `useImportNarrative`, plus the proposed Skills/Tools/MCP/ceremony imports from Wave 10 Stream D2/D3/F2.
  - Unify on a single bundle schema (Squad App shape from F3 is the maximal form; partial bundles — e.g., just a single skill — are subsets).
  - Spec the schema in `docs/squadapp-spec.md`. JSON-schema validation on every import endpoint.
  - UI: a single drop-zone component (`BundleDropZone`) that accepts any bundle (single-artifact or full app), inspects the manifest, and routes to the right import flow.
  - Export: every artifact (project, team, workflow, ceremony, skill, tool, mcp-server) gets an "Export" action that produces a partial bundle. "Export project as Squad App" produces the maximal bundle.
  - Aligns with upstream Squad's plugin format (SKILL.md for skills; workflows already YAML); doesn't conflict.

- **F6. Plugin marketplace — align with upstream Squad.**
  - Adopt upstream's `.squad/plugins/marketplaces.json` registry shape verbatim. Per-project AND user-global registries supported.
  - **UI** — new "Marketplace" page (under SYSTEM nav): list registered marketplaces, browse plugins in each (GitHub repo listings), one-click install.
  - **Install behaviour** — for upstream-shape plugins (a directory with SKILL.md), drop into `.squad/skills/{plugin-name}/SKILL.md` per upstream contract. For squadapp-shape bundles, run the F5 importer.
  - **CLI** — `npx squadboard plugin marketplace add|remove|list|browse` (matches upstream verbs).
  - **Dedupe** — if a plugin already exists locally, the install dialog offers "Upgrade", "Reinstall", or "Cancel".
  - **MCP** — `marketplace_browse` and `install_plugin` tools so this CLI can install plugins via Conjure capture too.

- **F7. Community contribution workflow.**
  - In repo: `CONTRIBUTING.md` covers how to author + submit a Squad App or a single-artifact plugin.
  - GitHub Action validates submitted bundles against the F5 schema.
  - A first-party "official" marketplace (separate repo, e.g., `bradygaster/squadboard-marketplace`) listed by default in `marketplaces.json`. PRs against that repo are how the community contributes.
  - Documented review/acceptance criteria.

- **F8. Docs, README, feature list refresh.**
  - **Top-level `README.md`**: feature list, dogfood story (from Stream A), Squad Apps story, marketplace story, screenshots/GIFs (Hockney's Heartbeat tick, Keyser's Flow agent-centric, the Squad App install flow). Quickstart should let a user go from `npx squadboard init` → installed Squad App → first board in <5 min.
  - **`docs/` directory** (new):
    - `docs/architecture.md` — overview of squadboard's services + data model + MCP surface.
    - `docs/squadapp-spec.md` — F3/F5 schema reference.
    - `docs/marketplace.md` — F6 marketplace authoring + install spec.
    - `docs/plugins/skills.md` — how to author a skill (aligns with upstream Squad).
    - `docs/plugins/tools.md`, `docs/plugins/mcp.md`, `docs/plugins/ceremonies.md`.
    - `docs/mcp.md` — copy of `packages/server/src/mcp/README.md` plus dogfood story (from Stream A).
    - `docs/changelog.md` — per-wave changelog. Wave 10 entry seeded.
  - **Mermaid diagrams** for architecture + import/export flow + marketplace flow.
  - **In-app help** — sidebar "?" menu links to the new docs site (or local `docs/` if no site yet).

### Sequencing inside Stream F

- **Quick wins first (F1, F2):** small surface restoration. Can ship in days.
- **Spec before code (F3, F5, F6):** McManus writes a one-page spec for Squad App format, unified import/export, and marketplace. Lead review before Hockney/Keyser implement.
- **Curated apps follow the format (F4):** depends on F3 spec landing.
- **Marketplace plumbing (F6):** depends on F5 importer shape.
- **Community workflow (F7):** depends on F6 plumbing.
- **Docs (F8):** depends on everything else stabilising; small portions can land alongside each item.

### Acceptance for Stream F

22. Workflow/ceremony templates are reachable from the main nav, not just buried sub-routes.
23. A user can drop a `.md` ceremony narrative onto the Ceremonies page (or click "Import from markdown") and get a reviewable YAML draft.
24. The Squad App format is specced in `docs/squadapp-spec.md` and validated server-side.
25. 5 hand-tuned Squad Apps ship in `data/squad-apps/` with quality kanban + ceremonies + agents + skills.
26. Every import/export action goes through the unified `BundleDropZone` + bundle schema.
27. A user can register a marketplace (`.squad/plugins/marketplaces.json`) and browse/install plugins from it both via UI and CLI.
28. `CONTRIBUTING.md` + a separate marketplace repo exist, with a CI validator on bundles.
29. README + `docs/` are refreshed with feature list, dogfood story, app/marketplace story, and screenshots.

---

## Stream G (appended) — GitHub integration: actions first, then triggers  (LOWER PRIORITY)

> Per Ahmed's follow-up: append, don't prioritise. Actions land before triggers (user's stated ordering).

**Investigation findings — what already exists:**
- **Auth & client:** `packages/server/src/github/client.ts` wraps PAT + GitHub-App auth and exposes: `createIssue`, `updateIssue`, `closeIssue`, `listIssues`, `getRef`, `getDefaultBranchSha`, **`createOrUpdateBranch`** (idempotent), **`createPullRequest`**, **`createCheckRun`**, plus comment helpers.
- **Sync:** `github/sync.ts` does bidirectional issue sync (Demo 15), with a periodic pull loop and a fire-and-forget hook on local issue/comment events.
- **Per-project config:** schema already carries `githubSyncEnabled`, owner/repo/PAT/App fields.
- **Routes:** `routes/github-sync.ts` exposes config CRUD, manual `sync`, log, and **a webhook ingest endpoint at `POST /api/projects/:id/github/webhook`** — but currently only handles issue events.
- **UI:** Settings has a GitHub-sync section. Nothing else (no PR action, no branch action, no workflow trigger, no event-driven ceremony hook).

**Therefore:**
- "Actions first" is mostly **UI + MCP wrapping over existing client capabilities**, with one new action-piece (workflow dispatch).
- "Triggers later" is mostly **expanding the webhook ingest + a new trigger schema for ceremonies**.

### G1. Foundations — bring the GitHub surface up to feature parity

- **G1.1. Workflow dispatch in the client.** Add `dispatchWorkflow(workflowFile, ref, inputs)` → `POST /repos/{}/actions/workflows/{}/dispatches`. Add `getWorkflowRun(id)` and `listWorkflowRuns(branch?)` for status polling.
- **G1.2. Repo-introspection helpers.** `listBranches`, `listCommits(branch, since?)`, `getCommit(sha)`, `mergePullRequest(number, method)`, `listPullRequests(state)`. All thin REST wrappers; consistent with existing client style.
- **G1.3. Branch convention service.** `services/github-branching.ts`: given an issue (id, title, optional `githubIssueNumber`), produce the squadboard-canonical branch name `squadboard/{issueNumber-or-shortId}-{kebab-title-truncated}`. Reuse upstream Squad's worktree convention (`squad/{n}-{slug}`) for compat — pick one, document it.
- **G1.4. PR-body template service.** Generate a PR body that links: issue URL, board card URL, recent run outputs, ceremony context. Configurable per-project (markdown template lives in `.squad/squadboard/pr-template.md` if present).

### G2. UI surface — actions on the card

Card detail panel + board card menu both gain a "GitHub" action group, gated on `project.githubSyncEnabled`:

- **G2.1. "Push branch"** — calls `getDefaultBranchSha` + `createOrUpdateBranch` with the canonical name from G1.3. Idempotent. Shows the branch URL on success. Records the branch in the issue row (new `github_branch` column).
- **G2.2. "Open draft PR"** — requires a branch from G2.1 (or asks the user to pick a branch from `listBranches`). Calls `createPullRequest` with the title from the issue and body from G1.4. Records `github_pr_number` + `github_pr_url`. Auto-comments on the issue: "📌 Linked to PR #N".
- **G2.3. "Comment on linked GitHub issue"** — quick action, prefills the run's last summary as the comment body.
- **G2.4. "Trigger workflow"** — picker over `listBranches` + `listWorkflows`. Optional input fields parsed from the workflow's `workflow_dispatch.inputs` schema. Records the run in a new `github_workflow_runs` table linked to the issue.
- **G2.5. "Merge PR"** — appears once a linked PR exists and is ready. Calls `mergePullRequest`; on success, moves the card to a project-configured destination column (default: `done`).
- **G2.6. Card badges** — show "📦 squadboard/42-foo", "🔃 PR #51 (open)", "✅ CI green / ❌ CI failing" inline on the card.

### G3. MCP tools — symmetric surface for this CLI

Add to `packages/server/src/mcp/server.ts` so the dogfood loop (Stream A) can drive GitHub from this Copilot CLI:

- `github_push_branch` — wraps G2.1.
- `github_open_pr` — wraps G2.2.
- `github_comment_issue` — wraps G2.3.
- `github_trigger_workflow` — wraps G2.4.
- `github_get_run_status` — polls G1.1.
- `github_merge_pr` — wraps G2.5.
- `github_list_branches`, `github_list_workflows` — discovery.

All accept `projectId` arg or `x-project-id` header (matches the existing convention). Return JSON-RPC payloads consistent with the rest.

### G4. Squadboard ↔ @copilot coding agent

Upstream Squad supports `@copilot` as a roster member that picks up GitHub issues and opens draft PRs autonomously. Surface that in squadboard:

- **G4.1. Roster entry.** When @copilot is on the project's team (per `team.md`), expose an "Assign to @copilot" action on the card. Posts the GitHub issue with the `squad:copilot` label and an `assignees: ['copilot']` (or whatever upstream uses) — reuse the spec from upstream Squad's `copilot-agent.md` template if available.
- **G4.2. Watch.** Once assigned, watch for the @copilot-authored draft PR (G6 webhook hook). When it appears, link it to the card and move to `in_review`.
- **G4.3. Auto-assign rule.** Optional per-project toggle: "Auto-assign issues with label X to @copilot."

### G5. Verification + UX polish

- **G5.1.** End-to-end smoke: from a card, push branch → open PR → trigger workflow → see CI status badge → merge PR → card moves to done.
- **G5.2.** Failure modes: no PAT, expired PAT, branch already exists with different content, PR conflict, workflow not found. Each surfaces a Fluent2 MessageBar with a clear next step.
- **G5.3.** Settings page: add a "GitHub" section that documents the required PAT scopes (or App permissions) for each action group. Validate on save with a `GET /repos/{owner}/{repo}` ping.

---

### G6. Triggers — second phase (after G1-G5 ship)

**Goal:** GitHub events drive squadboard reactions. Reuse the existing webhook endpoint; expand it.

- **G6.1. Webhook expansion.** Current `POST /api/projects/:id/github/webhook` only handles issue events. Add handlers for: `push`, `pull_request`, `pull_request_review`, `issue_comment`, `workflow_run`, `check_run`, `status`, `release`. Persist incoming events to a new `github_events` table for audit + replay.
- **G6.2. Trigger schema for ceremonies.** Extend the ceremony YAML schema with a `triggers:` array that supports GitHub-event matchers:
  ```yaml
  triggers:
    - kind: github
      event: pull_request
      action: opened          # optional filter
      branches: [main]        # optional filter
      labels: [bug, urgent]   # optional filter
  ```
  At ingest time, match incoming events against active ceremony triggers and `spawnCeremonyRun` for each match.
- **G6.3. Card-state side-effects.** Default reactions (configurable per project):
  - PR opened → linked card moves to `in_review`.
  - PR merged → linked card moves to `done`.
  - PR closed without merge → card moves back to `in_progress` with a system comment.
  - CI fails on linked PR → card gets a `ci-failing` label and a system comment with the run URL.
  - GitHub issue created with `squad:capture` label → land in squadboard inbox via Conjure.
- **G6.4. Webhook security.** Validate the `X-Hub-Signature-256` HMAC against a per-project webhook secret stored on the project row. Reject unsigned or mis-signed payloads. Document the setup flow in Settings.
- **G6.5. UI — Activity feed.** New "GitHub activity" timeline on the project (and on each card) showing inbound events with timestamps, payloads, and any side-effects taken.
- **G6.6. Coordinator-side dogfood loop closure.** When a GH event arrives that resolves a Wave-10 dogfood card (e.g., a PR merging), the coordinator gets a notification and can close the loop with a `capture` summary — completes the symmetry started in Stream A's E3.

### Sequencing inside Stream G

- **Phase 1 (G1-G5) — actions only:** ships in this order: G1 → G2 (UI) and G3 (MCP) in parallel → G4 → G5. User can do everything they asked for ("push branches, create PRs, etc.") at the end of Phase 1.
- **Phase 2 (G6) — triggers:** ships after Phase 1 stabilises. G6.4 (webhook security) is a hard prerequisite for G6.1.
- **Cross-stream:** depends on Stream A (MCP wired into this CLI) for G3 to be useful from the dogfood loop, and on Stream D6 (cost migration) for workflow-dispatch costs to land in the right column. Otherwise independent.

### Acceptance for Stream G

30. From a board card with GitHub sync enabled, the user can push a canonical branch in one click.
31. From the same card, the user can open a draft PR linked back to the card and the GitHub issue.
32. The user can trigger a GitHub Actions workflow from the card and watch the run status update inline.
33. Once the linked PR is merged, the card automatically moves to `done`.
34. Equivalent MCP tools exist (`github_push_branch`, `github_open_pr`, `github_trigger_workflow`, `github_merge_pr`, `github_get_run_status`, `github_list_*`) so this Copilot CLI can drive the same flow.
35. @copilot can be assigned to a card; squadboard tracks the resulting draft PR back to the card.
36. **(Phase 2)** A ceremony YAML can declare GitHub event triggers; matching events spawn ceremony runs.
37. **(Phase 2)** PR/CI events drive default card-state side-effects (in_review, done, ci-failing label).
38. **(Phase 2)** Webhook payloads are HMAC-validated against a per-project secret.
39. **(Phase 2)** A GitHub-activity timeline is visible on the project and per-card.

---

## Stream H (appended) — Ceremony Editor UX  (LOWER PRIORITY)

> Per Ahmed: append. Polish + capability work on the ceremony Code/Visual editor.

**Investigation findings:**
- Editor lives in `packages/client/src/pages/CeremonyEditor.tsx`; visual canvas in the `packages/client/src/components/ceremonies/visual-editor/` family.
- Trigger is currently a LEFT-SIDEBAR form (Trigger + scope + column + labels) — separate from the canvas. Should be a NODE on the flow, the root / starting point.
- "Kind" options (workflow / ceremony / review_policy / narrative) — labels not self-explanatory; users can't tell when to pick which.
- "Scope" options (project / board / task) — impact unclear; changing it doesn't expose different narrowing fields and there's no warning about reach.
- No undo/redo on the canvas.
- Edge creation requires knowing to drag from a node's bottom handle to another node's top handle.

**Items:**

- **H1. Trigger as a canvas node (root / starting point).** Promote the Trigger sidebar into a first-class node on both Code and Visual canvases. Exactly ONE trigger node per ceremony, pinned at the top, distinct treatment (teal "TRIGGER" badge). All trigger config (Manual / Schedule / Event / Issue entry, scope, column slug, labels, schedule cron, event filters) edited inline on the node or in the right-hand Properties panel when selected. Code view: trigger is the first YAML block; remains source of truth. Free up the left sidebar; collapse Metadata into Properties or a header strip.

- **H2. Undo / Redo in the visual editor.** Toolbar buttons + Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z. History stack of canvas operations: add / delete / move / connect / disconnect / property edit. In-memory only; bound at ~50 entries; no server round-trip. Disabled state when no history.

- **H3. Smarter connection mechanism.** When a node is selected and a new node is dropped from the palette (or added via keyboard), auto-connect the new node FROM the selected node. Click an edge → Backspace / Delete to disconnect. Drag an edge endpoint to another node's handle to reconnect. Hover affordance + tooltip on edges. Existing top/bottom drag-to-create still works as a secondary path.

- **H4. Clarify the "Kind" dropdown.** Inline per-option descriptions in the dropdown items (Fluent2 `Option` rich content):
  - **workflow** — Multi-step automation that can fan out, route, and run agents.
  - **ceremony** — Recurring team meeting with predefined participants and outputs.
  - **review_policy** — Reviewer rules + gates that govern when work can advance (no execution).
  - **narrative** — Documentation-only; describes a flow without making it executable.

  Below the dropdown render a `Caption1` / `MessageBar` info line that updates with the selection (what palette items appear, what trigger types are valid, whether Run-now is enabled). Same hint surfaced on the Code view header.

- **H5. Clarify "Scope" dropdown impact.** Inline per-option descriptions:
  - **project** — Trigger fires for ANY board in the project that matches column_slug + labels.
  - **board** — Trigger fires only for the specified board (board picker appears).
  - **task** — Trigger fires only for a specific issue/card (issue picker appears).

  Dynamically show / hide narrowing fields (board picker, issue picker) on scope change. On change, surface an info banner: "Changing scope to board will limit this trigger to {board name}; existing matches in other boards will stop firing."

- **H6. Ceremonies page Fluent2 audit.** `packages/client/src/pages/Ceremonies.tsx` + editor sub-components — replace any raw HTML controls with Fluent2 (`Card`, `Toolbar`, `Button`, `Field`, `Input`, `Dropdown`, `Tab` / `TabList`, `MessageBar`). Tokens for all spacing/colors/shadows. Empty state aligned with the empty-ceremonies treatment used for the C5 polish. Verify dark-theme parity.

**Sequencing inside Stream H:**
- H1 first (trigger-as-node) because H3 + H5 interact with it.
- H2 (undo/redo) parallel with H1.
- H3 after H1.
- H4 + H5 parallel; H5 prefers H1 first.
- H6 last so the audit covers the new H1/H3 surfaces.

**Owners:** Keyser leads (frontend), Fenster reviews UX, Hockney covers tests.

**Acceptance for Stream H:**
40. The Trigger appears as a pinned root node on the visual canvas; the left sidebar Trigger panel is gone (or collapsed into Properties).
41. Undo / Redo buttons + Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z work for canvas operations (add / delete / move / connect / disconnect / property edit).
42. Selecting a node + dropping a new node from the palette auto-connects them; clicking an edge + Backspace disconnects; dragging an endpoint reconnects.
43. The Kind dropdown shows inline per-option descriptions and an updating info caption.
44. The Scope dropdown shows inline per-option descriptions; changing scope dynamically updates the visible narrowing fields and warns about impact.
45. The Ceremonies page passes a Fluent2 audit (no raw HTML, all tokens, empty state aligned with C5).

---

## Hotfix — Stream B follow-up  (HIGH PRIORITY — front of queue)

> Per Ahmed: in-flight bug discovered after Stream B closed. Promote ahead of Streams F / G / H / I.

- **B8. Sending a message over Consult crashes the app.**
  - **Repro:** open `/consult/new` (or an existing Consult session), type any message, Send → app crashes.
  - **Likely culprits given Stream B6's recent changes** (seed-message embedding tail of recent runs):
    - `packages/client/src/pages/Consult.tsx` send-handler — possibly mutating state or dereferencing undefined when the seed-message tail is empty / null / very long.
    - `packages/client/src/api/consult.ts` request schema — payload may mismatch server after Stream B's envelope changes.
    - `packages/server/src/services/consult.ts` — may throw if `seedMessage` exceeds max length or contains binary content.
    - `packages/server/src/routes/consult.ts` — possible null deref on the new resolver path.
  - **Acceptance:**
    - Sending a message in BOTH Agent mode AND Model mode never crashes.
    - New regression e2e at `packages/e2e/tests/07-consult-send.spec.ts`: open a Consult, send a message, assert response renders, assert page does not navigate to an error boundary.
    - If any client-side state is corrupted, recover gracefully (Fluent2 `MessageBar` error + Retry button) — never crash the whole SPA.
    - Add server-side input validation on `seedMessage` (length cap, type check) returning 400 with a readable error rather than 500.

- **B9. Define + enforce "disabled" agent semantics consistently.**
  - **What "disabled" means today (verified in code):** `agentStatusEnum = ['active', 'disabled', 'retired']`. `DELETE /api/projects/:projectId/agents/:id` soft-deletes by setting `status='disabled'` (charter file untouched). The routing engine (`engine/router.ts`) and `RunButton.tsx` correctly filter to `status === 'active'`. So far so good.
  - **The leak Ahmed hit:** `packages/client/src/pages/Consult.tsx` calls `useAgents(projectId)` with NO status filter, then auto-picks `agents[0]`. Result: a disabled agent IS pickable and invocable in Consult.
  - **Suspected sibling leaks (verify during implementation):**
    - `packages/client/src/components/ceremony/StepPropertyForm.tsx` — agent picker on ceremony steps.
    - `packages/server/src/mcp/server.ts` — `list_agents` tool.
    - Any other agent-picker call site (`useAgents` consumers).
  - **Decide semantics — recommend STRICT:** disabled = invisible to every invocation surface, cannot be invoked anywhere. Charter + history preserved on disk; one-click re-enable. Matches user mental model ("if it's disabled, why can I talk to it?").
    - `disabled` ≠ `retired`. Document on `AgentDetailPanel`:
      - **active** — on the team, picker-visible, auto-routable.
      - **disabled** — paused; hidden from default pickers; charter preserved; re-enable any time. Does not count toward team size.
      - **retired** — off the team for good; hidden from default pickers AND from the Agents page default view; kept for run-history attribution. Surfaces only under "Show retired".
  - **Acceptance:**
    - Disabled agents cannot appear in: Consult agent picker, RunButton, ceremony StepPropertyForm, MCP `list_agents` (default).
    - Routing engine continues to skip disabled agents (already correct — add a regression test).
    - Server-side defense in depth: every invoke endpoint (`POST /agents/:id/run`, consult start with `agentId`, ceremony step execution, MCP invoke) returns 422 with a clear message if the agent is disabled.
    - Agents page surfaces a "Disabled — cannot be invoked" pill on disabled cards with an inline "Re-enable" button.
    - MCP `list_agents` accepts `?status=all|active|disabled|retired` (default `active`).
    - DELETE-button copy on `AgentDetailPanel` and `AgentCard` renamed from "Delete" → "Disable" so the action label matches the state. Keep an irreversible "Retire" action separate (sets `status='retired'`).
    - New regression e2e at `packages/e2e/tests/08-disabled-agent.spec.ts`: disable an agent, attempt to start a consult / pick from RunButton / pick from ceremony step / call MCP `list_agents` — assert the agent is absent from each.

---

## Stream I (appended) — Reliability & Recovery  (LOWER PRIORITY)

> Per Ahmed: append. Cover periodic DB backups, crash recovery (server + agents + restarts + work pickup), and "anything else to consider." Strategic — ships after the regression bus is clean (Streams B/C/D + B8) but before / alongside F/G/H.

**Investigation findings (assumptions to verify during scoping):**
- Squadboard server uses Drizzle with a SQLite store (per `packages/server/src/db/`). DB file path likely `data/squadboard.sqlite` or under `XDG_DATA_HOME`.
- Workflow runs (`workflow_runs`) and issue runs (`issue_runs`) currently track top-level status (`running` / `done` / `failed`) but **per-step checkpoint state** is not yet persisted in a way that survives a process kill. Confirm before I4/I5.
- Agent invocations execute under the SDK's async runtime in-process; if the parent server dies mid-turn, the LLM call is lost. There is no orphan detector that promotes "stuck running" runs to a recoverable state on restart.
- WS clients already retry (Stream B5 fix); Heartbeat surface (Stream B3) gives a way to detect liveness.
- No file lock / single-instance guard exists; running `pnpm dev` twice would race on the same DB.
- No idempotency keys on `capture` — replaying the same MCP call duplicates inbox entries.

**Items:**

- **I1. Periodic DB backup + retention.**
  - In-process backup task (cadence configurable; default every 6 h + on graceful shutdown). Use SQLite's online backup API (`db.backup(dest)` via better-sqlite3) — safe with concurrent writes, no `VACUUM INTO` lock issues.
  - Backups land under `<dataDir>/backups/squadboard-YYYYMMDD-HHmm.sqlite`.
  - Retention policy: keep last 24 hourly + 14 daily + 12 monthly (Tower-of-Hanoi style); configurable via env / settings.
  - Optional gzip; optional offsite hook (just a shell command the user can configure: e.g., `aws s3 cp` or `rclone`). No first-party cloud dependency.
  - Surface backup status on Diagnostics: last backup time, size, success/fail, retention list.

- **I2. Restore flow.**
  - CLI command: `npx squadboard restore <backup-path>` — refuses to run if server is up; renames current DB to `.pre-restore.<ts>`; copies backup; runs `PRAGMA integrity_check`; runs migrations to bring schema to current; reports outcome.
  - UI: Diagnostics → "Restore from backup" picker (server stops itself, runs restore, restarts). Gated by a confirm dialog with the consequences spelled out.
  - Post-restore verification: count rows, run a read-only smoke query against each major table, surface results in the dialog.

- **I3. Graceful shutdown + restart pickup.**
  - SIGTERM / SIGINT handler in the server process: stop accepting new HTTP/WS connections, drain in-flight requests with a 30 s deadline, persist any in-memory queues, snapshot the heartbeat state, take a final backup (per I1), then exit.
  - On boot: scan for `workflow_runs` and `issue_runs` with status `running` whose `last_heartbeat_at` is older than the boot time; mark them `interrupted`; surface "Resume?" affordance on the board card and a system comment ("Run was interrupted by a server restart at <ts>").

- **I4. Workflow run checkpointing + resume.**
  - Schema: add `current_step_id`, `step_state` (JSON blob: tool call args/results, intermediate outputs), `checkpoint_at` to `workflow_runs`. Mirror on `issue_runs` for single-agent runs.
  - Engine: after each completed step (or N seconds, whichever first), persist `current_step_id` + `step_state`. Use a small write-batched updater so we don't thrash SQLite.
  - Resume: a "Resume run" action on interrupted runs replays from the last checkpoint rather than restarting from scratch. Best-effort — if the world has changed (e.g., source file deleted), surface what couldn't be replayed.
  - Acceptance: kill -9 the server mid-run, restart, click "Resume" on the interrupted card, run completes from the last checkpoint without re-doing prior steps.

- **I5. Agent crash detection + escalation.**
  - Each in-process agent run writes a heartbeat to its run row every N seconds (default 30 s).
  - A sweeper (extends Stream B3's heartbeat service) checks for runs whose `last_heartbeat_at` is older than 3× the cadence; marks them `agent_lost`; spawns a system comment with the last known step.
  - Per-project policy (default + override): "On agent loss → auto-retry up to N times → escalate to coordinator (capture into inbox with `agent_lost` label)."
  - UI: a small ⚠ badge on cards with lost agents and a "Retry" button.

- **I6. DB integrity & maintenance.**
  - On boot: confirm SQLite is in WAL mode (set if not). Verifies durability + concurrent reader behavior.
  - Periodic `PRAGMA integrity_check` (weekly default); failure surfaces in Diagnostics + halts new writes until acknowledged.
  - Periodic `VACUUM` (monthly default, or when `freelist_count` > N) — runs after a fresh backup so we always have a known-good copy.
  - Single-instance lock: PID/file lock at `<dataDir>/squadboard.lock`; second process fails fast with "Another squadboard is using this data dir at PID X."

- **I7. Idempotency on capture / MCP writes.**
  - Add an optional `idempotencyKey` (or compute one from `(projectId, source, contentHash)`) to `capture`, `create_issue`, and other write-MCP tools. Server stores recent keys (7-day TTL) and short-circuits duplicates with the original result. Prevents replays from duplicating inbox entries.
  - Same pattern surfaced in Stream G (GitHub action MCP tools) so retried branch/PR ops don't double-create.

- **I8. Health, liveness, diagnostics surface.**
  - `GET /healthz` (process up, DB reachable) + `GET /readyz` (queues healthy, last heartbeat fresh) — small JSON responses suitable for any restart-supervisor.
  - Diagnostics page: surface last N stack traces / unhandled rejections (last 50, persisted to a small ring table). Gives Ahmed a place to look when something crashed without forcing him to dig through console.
  - Optional auto-restart hint: if `/readyz` is unhealthy for > N minutes, log a "supervisor: please restart me" line so any nodemon/pm2/systemd wrapper can act.

- **I9. Migration safety.**
  - Pre-migration snapshot: just before any schema migration runs on boot, take a backup tagged `<dataDir>/backups/pre-migration-<from>-to-<to>.sqlite`.
  - On migration failure: roll the DB back to the pre-migration snapshot, log the failure, and refuse to start (prevents partial-migration corruption). Surface the rollback decision clearly so Ahmed knows what happened.

**Sequencing inside Stream I:**
- I1 → I2 (backup useless without restore).
- I3 + I6 are foundational and unblock the rest; they ship in parallel with I1/I2.
- I4 + I5 (checkpointing + agent crash) build on I3.
- I7 is small and parallel-safe; ship anytime.
- I8 + I9 layer on once the rest is stable.

**Owners:** Hockney leads (server-side); McManus reviews architecture (especially I4 schema + I9 rollback semantics); Kobayashi data shapes; Kujan tests + chaos drills.

**Acceptance for Stream I:**
46. A backup is created on the configured cadence and on graceful shutdown; retention prunes per the Tower-of-Hanoi policy.
47. `npx squadboard restore <path>` and the UI restore flow successfully replace the live DB with a backup, run integrity checks, and report results.
48. Killing the server (SIGKILL) mid-run leaves interrupted runs detectable on next boot with a "Resume" affordance.
49. A workflow run resumes from its last checkpoint after an unexpected restart without re-executing completed steps.
50. An agent that stops heartbeating is marked `agent_lost` within 3× cadence; per-project retry/escalation policy fires.
51. Idempotent `capture` (and other write MCP tools) deduplicate replays within the TTL.
52. SQLite runs in WAL mode; periodic `integrity_check` + `VACUUM` are visible in Diagnostics; a second squadboard process fails fast with the lock error.
53. `/healthz` + `/readyz` respond appropriately; Diagnostics shows the last N crashes.
54. A failed schema migration auto-rolls back to a pre-migration snapshot and the server refuses to start with a clear diagnostic.

---

## Stream J (appended) — Chat Surface Polish & Context-Aware Consult  (LOWER PRIORITY)

> Per Ahmed: chat surfaces should show who's chatting, support markdown, support streaming, show when the agent is thinking; and consulting an agent or model should take project + squadboard meta context into account.

**Investigation findings (verified in code):**
- **Streaming already works** over WebSocket via `packages/server/src/sdk/consult-stream.ts` → `useConsultStream` hook → `ChatRowView` shows progressive text with a `▍` cursor. ✅
- **No markdown** — `ChatRowView` (`pages/Consult.tsx` ~line 838) renders `{m.content}` directly inside a `<div>`. But the codebase already uses `react-markdown` in `IssueBodyMarkdown.tsx`, `CommentList.tsx`, and `TextDeliverable.tsx` — so the parser, plugin set, and styling tokens already exist. Just need to apply them here.
- **No identity per message** — assistant vs user is differentiated only by CSS class (`msgUser` / `msgAssistant`). No "McManus · Lead" badge above an assistant turn. No "You" or user-handle above a user turn.
- **No "thinking" indicator** between Send-clicked and first token. Cursor shows only DURING streaming.
- **System prompt build** in `consult-stream.ts` (~line 348): agent mode uses the charter (read from disk) + `AGENT_CONSULT_PROMPT_SUFFIX`; model mode uses `MODEL_THINKING_PARTNER_PROMPT`. **No project context** (board snapshot, team roster, recent runs, inbox state, ceremonies in flight). **No squadboard meta context** ("you are inside Squadboard, a tool for…"). Result: the agent has no idea what's on the board, who's on the team, or what surface it's running on.

**Items:**

- **J1. Per-message identity (avatar + name + role badge).**
  - For each chat row in `ChatRowView`:
    - **Assistant turn (agent mode):** small avatar (initials in a colored circle keyed off the agent name hash) + `Body1Strong` agent name + `Caption1` role badge ("Lead", "Engineer", "Designer", etc.).
    - **Assistant turn (model mode):** `Brain20Regular` icon + `Body1Strong` model id ("gpt-5", "claude-opus-4.7", …) + `Caption1` "model".
    - **User turn:** small avatar (user initials) + `Body1Strong` user display name (default "You" if no profile) + timestamp on hover.
  - Place identity above the message bubble; tokens-driven spacing; consistent with Fluent2 chat patterns.
  - Wire up: agent identity comes from `session.agentName` + a new `session.agentRole` field (already in `agents` table; surface it on the consult session payload).

- **J2. Markdown rendering in chat (streaming-aware).**
  - Replace `<div>{m.content}</div>` and the streaming `<div>{row.streamingText}</div>` with the project's existing `react-markdown` component (same plugin set as `IssueBodyMarkdown` — GFM, code-fence with syntax highlight, sanitised HTML).
  - **Streaming caveat:** progressive markdown can render badly mid-token (unclosed code fences, half-tables). Strategy: render markdown only when streaming text ends with a "safe boundary" (newline, end of code block, etc.); otherwise render as preformatted text with the cursor. On stream completion, do a final markdown render pass. Acceptable trade-off — keeps the cursor smooth and avoids flashing layout reflow.
  - Make sure code blocks support copy-to-clipboard (Fluent2 `Button` overlay).
  - Keep the `reasoning` `<details>` block for o1-style models, also rendered as markdown.

- **J3. Streaming reliability + SSE alternative.**
  - **Verify** the existing WS stream end-to-end (regression test from Stream B's WS work — Wave 10 B5 fixed the WS path; ensure consult streaming uses it correctly).
  - **Add SSE alternative** for environments where WS is blocked (corporate proxies, some browsers): `GET /api/consult/:sessionId/stream` returning `text/event-stream` with the same delta shape (`token`, `reasoning`, `tool_call`, `done`, `error` event names). Client picks WS by default; falls back to SSE if WS upgrade fails within 3 s.
  - **Heartbeat** on the stream every 15 s (WS ping + SSE comment line) so reverse proxies don't time out.
  - Reconnect: on disconnect mid-stream, the client retries once (with last-message-id resume); if the server can replay tail-of-stream do so, otherwise show a friendly "Connection dropped — request to retry" Fluent2 `MessageBar` with a Retry button.

- **J4. "Agent is thinking…" pre-stream indicator.**
  - Between the user pressing Send and the first delta arriving, render a row in the assistant-bubble style with: agent avatar/name (per J1) + Fluent2 `Spinner size="extra-small"` + `Caption1` "{agentName} is thinking…".
  - Auto-hide on first delta event; replaced seamlessly by the streaming bubble.
  - If the model is in extended-reasoning mode (o1-class), surface "{agentName} is reasoning…" instead, with the reasoning content streamed into a `<details>` block (already supported).
  - Show a "Stop" button (`Stop20Regular`) next to the indicator so the user can cancel a slow turn.

- **J5. Inject context the way the SquadCoordinator does (agent AND model modes).**

  > Mirror the upstream `SquadCoordinator` (`@bradygaster/squad-sdk/coordinator`) so consult agents see the same world the Coordinator does — same shape, same sources, same precedence — and get the same first-pass shortcut for trivial queries.

  - **Mirror `CoordinatorContext`.** The SDK's `CoordinatorContext` is `{ sessionId, config, eventBus, teamRoster, activeAgents, metadata }`. In `packages/server/src/sdk/consult-stream.ts`, build the same struct and feed it into the system-prompt assembler:
    - **`teamRoster`** — raw text content of the project's `.squad/team.md` (resolved via existing `resolveSquadPath(projectId)` plumbing). Same source the Coordinator uses; do NOT synthesize a synthetic list.
    - **`activeAgents`** — `string[]` of agent names where `status === 'active'` (project-scoped DB query; uses the B9 strict semantics).
    - **`config`** — pull `SquadConfig` essentials (`defaultModel`, `defaultTier`, `routing.rules.length`, `models.respectTierCeiling`) from the project's compiled config. Mirror the format `DirectResponseHandler.config` handler renders.
    - **`metadata`** — squadboard-specific extension namespace (see "Squadboard layer" below) so we don't pollute the SDK shape.

  - **Coordinator identity preamble.** Stamp the consult system prompt with the Squad Coordinator preamble pattern: `Squad vX.Y.Z` version line + role + refusal rules. Source order:
    1. `.github/agents/squad.agent.md` if present in the project's repo (the actual Coordinator playbook the user runs against).
    2. Fall back to the SDK's bundled coordinator template.
    Append `AGENT_CONSULT_PROMPT_SUFFIX` AFTER this preamble so propose-only mode rules still apply.

  - **Reference artifacts the Coordinator reads.** When the file exists in the project's `.squad/`, include trimmed/recent content of:
    - `.squad/decisions.md` — last N decisions (default 10).
    - `.squad/orchestration-log/` — last N orchestration log entries (default 5, newest first).
    - Each is labeled with its source path so the consult agent knows where the content came from (and that the user can open the file).

  - **Squadboard layer** (additional context the Coordinator can't see, surfaced under a clearly-labeled "Squadboard view" section, NOT mixed into the Coordinator-shaped fields):
    - Board snapshot: per-column issue counts + last 5 most-recent issue titles + ages.
    - Recent runs: last 5 `issue_runs` + `workflow_runs` with `agentName · status · finishedAt · output[head 200 chars]`.
    - Inbox: pending count + last 3 captures (titles only).
    - Ceremonies in flight: any active ceremony runs with `kind` + current step.
    - GitHub sync state if enabled (owner/repo, last sync, open PR count).

  - **Always-on squadboard meta preamble** (~150 tokens): "You are an agent inside Squadboard, a kanban / agent-orchestration tool that wraps the Squad SDK and runs ceremonies, workflows, and issue runs against this project. The user is consulting you in propose-only mode — nothing you say side-effects the project unless the user accepts a proposal." Sits ABOVE the Coordinator identity preamble so the agent knows the outer surface first.

  - **Wire SDK's `DirectResponseHandler` into the consult send-path** (before any LLM round-trip). Import from `@bradygaster/squad-sdk/coordinator/direct-response.js`; instantiate per consult session; on each user message:
    1. Build the `CoordinatorContext` (see above).
    2. Call `directHandler.shouldHandleDirectly(message, config)`.
    3. If `true`: invoke `directHandler.handleDirect()`, persist the synthesized assistant turn, stream it as a single delta + done, skip the LLM entirely. Tag the message with `kind: 'direct'` so the UI shows a small "Coordinator quick reply" caption (no thinking-indicator delay, no token cost).
    4. If `false`: fall through to the existing SDK consult-stream path.
    Categories handled: `status`, `help`, `config`, `roster`, `greeting`. Custom squadboard patterns can extend (e.g., "show inbox count").

  - **Token budget.** Cap total system prompt at 8 K tokens. Truncation order (drop oldest first): orchestration-log → recent runs → decisions tail → inbox tail → board column tails. NEVER truncate: meta preamble, Coordinator identity, charter, team.md, activeAgents list.

  - **Refresh on each turn.** Project context + activeAgents + team.md are re-read per `sendConsultMessage` call so stale state never leaks. (Cheap — these are small filesystem + indexed DB reads.)

  - **Privacy / no-leak.** Never include credentials (PATs, API keys); never include other consult sessions' content; redact `.env`-style secrets if they accidentally appear in `decisions.md`. A small allow-list keeps this safe.

  - **Model mode** receives meta preamble + Coordinator identity + Coordinator-shaped context (`teamRoster`, `activeAgents`, config summary, decisions, orchestration-log) + squadboard view. Skips the per-agent charter (there is none). Rationale: even a "raw model" consult should see what the Coordinator sees so it can reason about the team consistently.

  - **Surface the assembled context in the UI.** A collapsed `<details>` "What context this agent has" panel above the chat shows:
    - Resolved `CoordinatorContext` fields (path-stamped).
    - The squadboard-view block.
    - Token count + the truncation decisions made.
    Read-only; copy-to-clipboard. Builds trust + makes consult-debugging tractable.

- **J6. Apply chat polish to any other chat-like surfaces.**
  - Audit for surfaces that render assistant/user message lists. Confirmed candidates: just Consult. (Board comments are already markdown via `CommentList`; agent run output is one-shot, not chat.)
  - If new chat surfaces appear in Streams F/G/H/I, the J1/J2/J4 components are reusable: extract `ChatRowView` into a shared `components/chat/ChatBubble.tsx` so future surfaces get the polish for free.

**Sequencing inside Stream J:**
- J1 + J2 + J4 are UI-only — parallel.
- J3 verify-first; if WS works, only the SSE-fallback piece is new code. Parallel with UI.
- J5 is server-side — parallel with all UI work.
- J6 last (extraction refactor after the new bits stabilise).

**Owners:** Keyser leads UI (J1, J2, J4, J6); Hockney owns server-side (J3 SSE alternative, J5 context injection); Fenster reviews J1 + J4 visuals; Kujan covers e2e (streaming + thinking-indicator + markdown rendering + context-injection assertion).

**Acceptance for Stream J:**
55. Each chat row shows the speaker's identity: agent avatar + name + role badge for assistant turns (agent mode); model id + brain icon for assistant turns (model mode); user avatar + display name for user turns.
56. Assistant + user content renders as markdown (code fences with copy-to-clipboard, GFM, lists, tables) using the project's existing `react-markdown` setup; streaming text degrades gracefully without mid-token reflow.
57. Streaming over WS is verified working end-to-end; SSE fallback engages when WS upgrade fails; heartbeats keep streams alive through reverse proxies; mid-stream disconnects show a Retry affordance.
58. Between Send and first delta, an "{agentName} is thinking…" indicator (with Stop button) renders in the assistant bubble; it disappears on first delta.
59. Consult system prompt mirrors the SquadCoordinator: a `CoordinatorContext`-shaped block (`teamRoster` from `team.md`, `activeAgents` list, `SquadConfig` summary, recent `decisions.md` + `orchestration-log/` entries) is assembled per turn and prepended to the system prompt; trivial queries (status / help / config / roster / greeting) are short-circuited via the SDK's `DirectResponseHandler` with no LLM round-trip; squadboard-specific context (board, runs, inbox, ceremonies, GH sync) is layered on under a clearly-labeled "Squadboard view" section; a collapsible "What context this agent has" panel surfaces the verbatim assembled context with token counts and truncation decisions.
60. The chat-bubble surface is extracted into a reusable `components/chat/ChatBubble.tsx` so future chat surfaces inherit identity + markdown + thinking treatment.


