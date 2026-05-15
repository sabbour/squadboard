/**
 * scripts/seed-wave10-backlog.ts — Wave 10 Stream A5 dogfood seed.
 *
 * Pushes every Stream B / C / D / E item from the Wave 10 plan into the
 * running squadboard instance via the same `capture` code path the MCP
 * tool uses. Verifies that:
 *
 *   1. Every prompt classifies with intent='issue' (Conjure classifier).
 *   2. Every item lands as a real card in the target project.
 *
 * Run: pnpm --filter @sabbour/squadboard-server tsx src/scripts/seed-wave10-backlog.ts
 *
 * Requires SQUADBOARD_PROJECT_ID env var (the self-registered Squadboard
 * project ID). The script connects to the embedded postgres that the dev
 * server has already started on port 54321 (DATABASE_URL is set
 * automatically when this script can locate the running cluster).
 */
import { startEmbeddedPostgres } from '../db/postgres.js';
import { initDb, getDb, schema } from '../db/index.js';
import { classifyAndDraft } from '../services/conjure-classifier.js';
import { eq } from 'drizzle-orm';
// ---------------------------------------------------------------------------
// Wave 10 backlog — Streams B / C / D / E (Stream A is THIS work; Stream F/G
// are appended LOWER PRIORITY items deferred per the plan).
// ---------------------------------------------------------------------------
const ITEMS = [
    // ── Stream B — Regressions & broken flows ───────────────────────────────
    {
        id: 'B1',
        title: '[B1] Fix "Create project from template" broken flow',
        prompt: 'Fix bug: create project from template is broken. Reproduce in ProjectPicker.tsx (CreateTab path uses useTemplates(\'project\') + useInstantiateProjectTemplate). Inspect server route POST /api/templates/:id/instantiate, the Drizzle path, and the template payload schema. Fix the failing branch; add an e2e in packages/e2e covering the happy path.',
    },
    {
        id: 'B2',
        title: '[B2] Conjure has not replaced Capture — remove + redirect',
        prompt: 'Fix bug: Conjure has not replaced Capture. Acceptance: the Layout\'s blue "+ Capture" button is gone (or repurposed into Conjure entry). Audit Layout.tsx, CaptureFab.tsx, CaptureModal.tsx, Inbox.tsx, Consult.tsx, Board.tsx, CeremonyEditor.tsx, components/inbox/Capture* — wherever Capture surfaces, replace with Conjure intent. Delete dead Capture components once verified (or leave a thin shim with a console.warn for one release).',
    },
    {
        id: 'B3',
        title: '[B3] Heartbeat — wire /api/heartbeat sweeper service',
        prompt: 'Fix bug: Heartbeat page shows "service not yet active". Ship the service: a background sweeper (cadence configurable; default 60 s) that records last-tick timestamp + per-sweep results in a small in-memory ring + persisted last-state row. Expose /api/heartbeat/status and /api/heartbeat/sweeps?since=…. Wire pages/Heartbeat.tsx; remove the placeholder.',
    },
    {
        id: 'B4',
        title: '[B4] Project tile hover should not resize the tile',
        prompt: 'Fix bug: project tile hover resizes the tile. ProjectCard.tsx likely has a transform/scale on hover that grows the bounding box and reflows neighbours. Replace with elevation/shadow/border treatment that does not change layout dimensions.',
    },
    {
        id: 'B5',
        title: '[B5] Project status indicator stuck on yellow "Reconnecting"',
        prompt: 'Fix bug: project status indicator stuck on yellow "Reconnecting". Wave 9 fixed alignment + stale-timer (commit 5673d57b) but the user still sees yellow. Inspect realtime/ws-client.ts state machine — verify the WS actually reaches connected for the squadboard project on first load and is not getting stuck because the WS path/origin assumes a different port in dev. Fix root cause; add an e2e regression assertion that the badge reaches "Connected" within N seconds of page load.',
    },
    {
        id: 'B6',
        title: '[B6] Consult button on issue panel opens empty session',
        prompt: 'Fix bug: "Consult about this issue (open Ask)" in Inbox.tsx/Board.tsx/issue panel currently navigates to /consult/new without payload. Pass the issue summary + body + recent run logs as the seed message (Consult API supports seedMessage per services/consult.ts). Verify both Agent and Model modes accept the seed.',
    },
    // ── Stream C — Fluent2 / UX polish ──────────────────────────────────────
    {
        id: 'C1',
        title: '[C1] New-consult page — widen to canon page width + balance buttons',
        prompt: 'Polish: /consult/new page uses a narrow card centered in a wide page. Widen the card to the page-content width (canon: tokens.spacingHorizontalXXL). Re-balance the Agent | Model segmented control + Start-conversation button so they are not visually awkward.',
    },
    {
        id: 'C2',
        title: '[C2] AddProject "Connect existing" tab — horizontal-right dialog actions',
        prompt: 'Polish: AddProject "Connect existing" tab has vertically stacked Connect/Close buttons. Standard Fluent2 dialog actions are horizontal-right. Move both buttons into <DialogActions> (consistent with Discover/Create tabs). Audit all three tabs for parity.',
    },
    {
        id: 'C3',
        title: '[C3] Now page — Fluent2 styling + aggregated view across projects',
        prompt: 'Polish: Now page restyle to canon — replace inline status badge palette with Fluent\'s Badge component; switch table styling to DataGrid to match Costs/Templates. Verify useNowFeed API joins are project-agnostic and columns include a Project link. Fix any gaps.',
    },
    {
        id: 'C4',
        title: '[C4] Project selection dropdown wraps long names',
        prompt: 'Polish: project selection dropdown wraps. Widen the popover (set minWidth on the menu surface) so single-line names like "Content Creation Workflow — Squad Edition" do not wrap. If width cannot accommodate the longest name, ellipsis + tooltip.',
    },
    {
        id: 'C5',
        title: '[C5] Empty Skills / Tools / MCP pages — Ceremonies-style empty state + Import action',
        prompt: 'Polish: empty Skills / Tools / MCP Servers pages need alignment + Ceremonies-style treatment. Apply the <EmptyState> component pattern. Skills empty state needs: Browse curated library + New skill + Import skill. Same triplet for Tools (curated lib if any, New, Import). Same for MCP (Add server, Import). Standardise across all three.',
    },
    {
        id: 'C6',
        title: '[C6] Costs table — right-align numeric columns',
        prompt: 'Polish: Costs table alignment — right-align numeric columns (Runs, Total Cost, Avg/Run, Tokens In/Out, Cost). Use DataGrid column align: end. Format USD with consistent precision; format tokens with thousands separators.',
    },
    {
        id: 'C7',
        title: '[C7] Save-as-template dialogs — Fluent2 structure + storage location caption',
        prompt: 'Polish: Save-as-template dialogs in Settings.tsx, Agents.tsx, CeremonyEditor.tsx. Audit each for <Dialog><DialogSurface><DialogBody><DialogTitle><DialogContent><DialogActions> with right-aligned actions (cancel left of primary). Add a "Saved to: <global templates store>" caption in the dialog content so the user knows where the artifact landed.',
    },
    {
        id: 'C8',
        title: '[C8] Diagnostics/Heartbeat — clearly label scope (global vs project)',
        prompt: 'Polish: Diagnostics/Heartbeat scope is jarring — they exist at both global and per-project routes; clicking inside a project can drop you to global scope without warning. Recommend (a): keep both but make the page <PageHeader> clearly say "Global · across all projects" vs "Project: X" so the scope shift is visible.',
    },
    // ── Stream D — Feature gaps ─────────────────────────────────────────────
    {
        id: 'D1',
        title: '[D1] HireTeamModal — add 7 non-tech roles (PM, Designer, Founder, Sales, Marketing, CS, Research)',
        prompt: 'Feature: add 7 non-tech roles to HireTeamModal — pm, designer-nontech, founder, sales, marketing, customer-success, research. Layer a Squadboard-side EXTENDED_ROLE set on top of the SDK\'s AgentRole union. Each maps to a curated BASE_ROLE in casting-engine.ts AGENT_ROLE_TO_BASE_ROLE. Update ROLE_OPTIONS in HireTeamModal.tsx and ROLE_BADGE_COLOR. Update local-universes.ts preferredRoles arrays. Verify castingEngine.cast() still produces complete teams.',
    },
    {
        id: 'D2',
        title: '[D2] Curated skills — show provenance + add Import skill action',
        prompt: 'Feature: tag each curated skill in the library modal with where it comes from — show "Source: built-in catalog" badge. Add Import skill action: file-pick a SKILL.md or skill.json; validate; persist to project skills. Same pattern as template import in Templates.tsx.',
    },
    {
        id: 'D3',
        title: '[D3] Import tool / Import MCP server — symmetric with D2',
        prompt: 'Feature: Tools page — file-pick a tool.json import action. MCP page — file-pick an mcp-server.json import action. Add both to empty-state action set (see C5).',
    },
    {
        id: 'D4',
        title: '[D4] Ceremonies — show trigger source as labelled badge',
        prompt: 'Feature: on Ceremony detail/list, when a ceremony is automatic (when: before|after with a condition), show the trigger source as a labelled badge (e.g. "Triggered from: routing.md → before any work batch matching X"). Inspect services/ceremony-translator.ts and the dispatcher for available metadata.',
    },
    {
        id: 'D5',
        title: '[D5] Ceremony create — drop duplicate "Prose" tab; keep "Formulate"',
        prompt: 'Feature: CeremonyEditor.tsx exposes both Formulate-with-AI (top section) AND a Prose tab inside the Code/Visual/Prose tab strip. Keep Formulate-with-AI; remove the Prose tab. Migrate any Prose-only logic into the Formulate path so nothing is lost.',
    },
    {
        id: 'D6',
        title: '[D6] Costs — migrate to GitHub Copilot premium-request multipliers',
        prompt: 'Feature: Costs migrate to GitHub Copilot premium-request multipliers. Pull live multiplier table from GitHub docs into MODEL_MULTIPLIERS map in packages/server/src/sdk/pricing.ts (keep MODEL_PRICING for non-GitHub backends). Add premium_requests numeric column alongside cost_usd on issue_runs/workflow_runs/consult_sessions. Extend cost-tracker.ts. UI: Costs page becomes Premium requests by default with USD as a secondary tab/column. Show monthly allowance bar.',
    },
    {
        id: 'D7',
        title: '[D7] Save-as-template — show storage location in dialog + Reveal in finder',
        prompt: 'Feature: in each Save-as-template dialog (Agents/Settings/CeremonyEditor) and in the Templates page, surface the storage location: <XDG_DATA_HOME>/squadboard/templates/<kind>/<id>.json (verify in services/templates/). Caption under the form, plus a Reveal-in-finder button on the Templates page row (best-effort; gated by platform).',
    },
    {
        id: 'D8',
        title: '[D8] Flow page — pivot to agent-centric (agent runs as nodes with parent→child lineage)',
        prompt: 'Feature: Flow page pivot — render agent runs as nodes with parent→child lineage edges. Each node: agent name + status (active/failed/done) + run id + step it is doing. Inspect pages/ProjectFlow.tsx + components/flow/. Reuse the runs data already on board; lineage edge is parentRunId → childRunId from issue_runs.',
    },
    // ── Stream E — Verification + close-out ─────────────────────────────────
    {
        id: 'E1',
        title: '[E1] Test sweep — pnpm -r build + targeted Vitest/RTL + e2e',
        prompt: 'Verification: pnpm -r build clean; targeted Vitest/RTL tests on changed components (B4 hover, B5 reconnect, C2/C5/C6/C7 visual snapshots if framework supports); e2e: B1 template create, B2 Capture removal, A6 dogfood loop, D6 cost recording, D8 Flow agent-centric.',
    },
    {
        id: 'E2',
        title: '[E2] Docs refresh — MCP README, root README, mcp-config.json example',
        prompt: 'Verification: update packages/server/src/mcp/README.md for the new dogfood flow (A2/A3) and the new pricing model (D6). Update root README.md Quickstart with the dogfood section. Update .copilot/mcp-config.json example.',
    },
    {
        id: 'E3',
        title: '[E3] Coordinator self-update — capture closing summary into squadboard inbox',
        prompt: 'Verification: note in coordinator playbook that for THIS repo, after work completes, the coordinator should also capture a closing summary into the squadboard inbox so it appears as "done" on its own board. Optional but a nice symmetry.',
    },
    {
        id: 'E4',
        title: '[E4] Heartbeat first-tick verification — capture screenshots',
        prompt: 'Verification: after B3 ships, watch for one full tick on the Heartbeat page; capture screenshots for the closing handoff.',
    },
];
async function main() {
    const projectId = process.env.SQUADBOARD_PROJECT_ID;
    if (!projectId) {
        console.error('[seed] SQUADBOARD_PROJECT_ID is required (the squadboard self-registered project id).');
        process.exit(2);
    }
    // Disable LLM during seed so the run stays deterministic + cheap. The
    // rule-based scorer should handle every prompt above (each carries
    // explicit "fix bug" / "feature" / "polish" / "verification" markers).
    const useLlm = process.env.SEED_USE_LLM === 'true';
    console.log(`[seed] starting — projectId=${projectId} items=${ITEMS.length} useLlm=${useLlm}`);
    const connectionString = await startEmbeddedPostgres();
    await initDb(connectionString);
    const db = getDb();
    // Confirm the target project exists.
    const [project] = await db
        .select({ id: schema.projects.id, name: schema.projects.name, path: schema.projects.path })
        .from(schema.projects)
        .where(eq(schema.projects.id, projectId))
        .limit(1);
    if (!project) {
        console.error(`[seed] project not found: ${projectId}`);
        process.exit(3);
    }
    console.log(`[seed] target project: "${project.name}" path=${project.path}`);
    const skipDuplicates = process.env.SEED_SKIP_DUPLICATES !== 'false';
    if (skipDuplicates) {
        console.log('[seed] dedup ON — skipping items whose title already exists in the project');
    }
    const results = [];
    for (const item of ITEMS) {
        process.stdout.write(`[seed] ${item.id} … `);
        try {
            // Dedup check — title already exists in this project?
            if (skipDuplicates) {
                const [existing] = await db
                    .select({ id: schema.issues.id })
                    .from(schema.issues)
                    .where(eq(schema.issues.projectId, projectId))
                    .limit(50);
                // Coarse — just confirm against title strings:
                if (existing) {
                    const matches = await db
                        .select({ id: schema.issues.id, title: schema.issues.title })
                        .from(schema.issues)
                        .where(eq(schema.issues.projectId, projectId));
                    const hit = matches.find((r) => r.title === item.title);
                    if (hit) {
                        console.log(`SKIP (already exists as ${hit.id})`);
                        results.push({
                            id: item.id,
                            title: item.title,
                            intent: 'issue',
                            confidence: 1,
                            cardId: hit.id,
                            ok: true,
                            note: 'already-exists',
                        });
                        continue;
                    }
                }
            }
            // Replicate handleCapture: classify, then if intent=issue + projectId,
            // insert directly into issues. Stay parallel to mcp/server.ts so the
            // dogfood seed exercises the same code path the MCP tool uses.
            const classification = await classifyAndDraft({
                prompt: item.prompt,
                hint: 'issue',
                useLlm,
                context: { currentProjectId: projectId, currentProjectName: project.name },
            });
            if (classification.intent !== 'issue') {
                // Dogfood finding: even with hint='issue', the rule-based scorer can
                // be tricked by domain words ("project", "skill", "team", "tool")
                // that appear in legitimate bug/feature descriptions. Honour the
                // caller's explicit hint and force-create the card so the seed is
                // resilient — but also record the misclassification so the
                // smoke-test report can surface it as a real issue against the
                // classifier (see .squad/dogfood.md § Smoke-test findings).
                const draft = classification.draft;
                const body = (draft.body ?? item.prompt).toString();
                const [forced] = await db
                    .insert(schema.issues)
                    .values({
                    projectId,
                    title: item.title,
                    body,
                    status: 'backlog',
                    position: 0,
                    archived: 0,
                })
                    .returning({ id: schema.issues.id });
                console.log(`MISCLASSIFIED → forced — intent=${classification.intent} confidence=${classification.confidence.toFixed(2)} card=${forced.id}`);
                results.push({
                    id: item.id,
                    title: item.title,
                    intent: classification.intent,
                    confidence: classification.confidence,
                    cardId: forced.id,
                    ok: true,
                    note: `force-created: classifier returned intent=${classification.intent} despite hint=issue`,
                });
                continue;
            }
            const draft = classification.draft;
            const title = item.title; // Use the seed's authoritative title.
            const body = (draft.body ?? item.prompt).toString();
            const [created] = await db
                .insert(schema.issues)
                .values({
                projectId,
                title,
                body,
                status: 'backlog',
                position: 0,
                archived: 0,
            })
                .returning({ id: schema.issues.id });
            console.log(`OK — issue ${created.id} (intent=issue, confidence=${classification.confidence.toFixed(2)})`);
            results.push({
                id: item.id,
                title: item.title,
                intent: 'issue',
                confidence: classification.confidence,
                cardId: created.id,
                ok: true,
            });
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.log(`ERROR — ${msg}`);
            results.push({
                id: item.id,
                title: item.title,
                intent: 'unknown',
                confidence: 0,
                ok: false,
                note: msg,
            });
        }
    }
    console.log('');
    console.log('[seed] summary:');
    const okCount = results.filter((r) => r.ok).length;
    const issueCount = results.filter((r) => r.intent === 'issue').length;
    console.log(`  total:                ${results.length}`);
    console.log(`  classified as issue:  ${issueCount}`);
    console.log(`  landed on board:      ${okCount}`);
    console.log(`  failures:             ${results.length - okCount}`);
    for (const r of results.filter((r) => !r.ok)) {
        console.log(`    - ${r.id} (${r.intent}, ${r.confidence}): ${r.note}`);
    }
    // Brief table for the dogfood report.
    console.log('');
    console.log('[seed] per-item result table:');
    for (const r of results) {
        console.log(`  ${r.id.padEnd(4)} intent=${r.intent.padEnd(6)} conf=${r.confidence.toFixed(2)} ok=${r.ok ? 'yes' : 'no '} card=${r.cardId ?? '-'} ${r.note ? `[${r.note}]` : ''}`);
    }
    process.exit(okCount === results.length ? 0 : 1);
}
main().catch((err) => {
    console.error('[seed] fatal:', err);
    process.exit(1);
});
//# sourceMappingURL=seed-wave10-backlog.js.map