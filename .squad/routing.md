# Work Routing

How to decide who handles what.

## Routing Table

| Work Type | Route To | Examples |
|-----------|----------|----------|
| Architecture, scope, decisions, PR review | McManus | "Should fan-out children inherit pinnedAgentRevisions?", review of cross-cutting PRs |
| Engine internals, dispatcher/stepper/spawner, Postgres, sweepers | Hockney | Lease+heartbeat, retry policy, workflow_step_runs claim, embedded-postgres install, Drizzle schema |
| Squad SDK bridge, CharterCompiler/HookPipeline/CostTracker wiring, structured output | Kobayashi | "Add the engine_emit_final_output MCP tool", forward CostTracker into cost_records, specifier agent prompt |
| React UI, kanban board, components, drawers, layout | Keyser | Card grid, side drawer, workflow lens, run transcript pane, dashboards UI |
| Real-time / WebSocket, Live ops view, run streaming, animations | Verbal | WS server endpoint, since-id reconnect cursor, EventEmitter fan-out, status-pill transitions |
| Visual design, UX flows, color/type/icon system, empty states | Fenster | First-launch onboarding flow, board visual hierarchy, dashboard typography, motion principles |
| Tests, durability, recovery, contract pinning, regression suites | Kujan | Lease-expiry reap test, fan-out atomicity, idempotent-create dedup, PR-webhook-cursor restart |
| README, guides, demo scripts, workflow YAML cookbook, MCP reference | Redfoot | Getting-started walkthrough, demo 1–15 narration, troubleshooting playbook, release notes |
| Session logging | Scribe | Automatic — never needs routing |

## Issue Routing

| Label | Action | Who |
|-------|--------|-----|
| `squad` | Triage: analyze issue, assign `squad:{member}` label | Lead |
| `squad:{name}` | Pick up issue and complete the work | Named member |

### How Issue Assignment Works

1. When a GitHub issue gets the `squad` label, the **Lead** triages it — analyzing content, assigning the right `squad:{member}` label, and commenting with triage notes.
2. When a `squad:{member}` label is applied, that member picks up the issue in their next session.
3. Members can reassign by removing their label and adding another member's label.
4. The `squad` label is the "inbox" — untriaged issues waiting for Lead review.

## Rules

1. **Eager by default** — spawn all agents who could usefully start work, including anticipatory downstream work.
2. **Scribe always runs** after substantial work, always as `mode: "background"`. Never blocks.
3. **Quick facts → coordinator answers directly.** Don't spawn an agent for "what port does the server run on?"
4. **When two agents could handle it**, pick the one whose domain is the primary concern.
5. **"Team, ..." → fan-out.** Spawn all relevant agents in parallel as `mode: "background"`.
6. **Anticipate downstream work.** If a feature is being built, spawn the tester to write test cases from requirements simultaneously.
7. **Issue-labeled work** — when a `squad:{member}` label is applied to an issue, route to that member. The Lead handles all `squad` (base label) triage.

## Work Type → Agent

| Work Type | Primary | Secondary |
|-----------|---------|----------|
| Architecture, decisions, cross-cutting PR review | McManus | — |
| Backend / engine internals / Postgres / sweepers | Hockney | McManus (architecture sign-off) |
| Squad SDK bridge / hook wiring / cost forwarding | Kobayashi | Hockney (DB persistence) |
| React UI / kanban / layout / components | Keyser | Fenster (visual review), Verbal (live state hooks) |
| WebSocket / live updates / Live ops view / animations | Verbal | Hockney (event_log writes), Kobayashi (EventBus source) |
| Visual design / color / type / motion principles | Fenster | Keyser (component impl), Verbal (transition timing) |
| Tests / durability / contract pinning / regressions | Kujan | reject authority on durability + user-facing copy contracts |
| README / guides / demo scripts / cookbook / release notes | Redfoot | reject authority on user-facing copy |
| MCP tool / slash command surface | Kobayashi | Hockney (engine wiring), Redfoot (docs) |
| GitHub adapter / push / PR / webhooks / check runs | Hockney | Kobayashi (idempotency), Redfoot (setup docs) |

## Non-tech Work Types

When a project includes business/non-tech members, route accordingly. These complement (not replace) the tech work types above.

| Work Type | Primary Role | Examples |
|-----------|--------------|---------|
| Product strategy, prioritization, roadmap, backlog grooming | PM | Quarterly planning, feature triage, scope decisions |
| Visual design, brand, illustration, design system | Designer | Logo, marketing site, design tokens, brand guide |
| Sales pipeline, deals, customer outreach, contracts | Sales | Lead qualification, demo prep, contract drafts |
| Marketing, launches, content, growth, positioning | Marketing | Launch plan, blog posts, positioning docs, ad copy |
| Customer success, support, account management | Customer Success | Onboarding flows, support docs, churn analysis |
| User research, surveys, interviews, data analysis | Research | User interviews, survey design, insights synthesis |

**Cross-functional rules:**
1. If a non-tech member is on the roster, the Lead/Architect coordinates handoffs between tech and non-tech members.
2. PM owns prioritization across both tech and non-tech work — when capacity is constrained, PM trims scope.
3. Marketing and Sales gate user-facing copy/positioning — they're reject-authority for launch announcements.

