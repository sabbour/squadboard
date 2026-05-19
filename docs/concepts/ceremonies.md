# Ceremonies and Workflows

## TL;DR

**Ceremony** = trigger + workflow. A named process your team runs, activated by a schedule, GitHub event, agent signal, or explicit run action.

**Workflow** = execution graph. The ordered steps that run *inside* the ceremony — agent runs, approvals, fan-outs, retries, all orchestrated deterministically.

You write ceremonies (YAML trigger + workflow reference). The engine runs workflows (steps + guardrails).

---

## Mental Model

```
Ceremony
├─ Trigger config
│  ├─ Type (manual, scheduled, GitHub event)
│  └─ Parameters (cron, label, webhook path)
├─ Workflow version reference
│  └─ Locked to a specific workflow_versions.id
└─ Metadata (name, slug, status: draft/active/paused/archived)

     ↓ When trigger activates…

Workflow (execution graph)
├─ Step 1: agent_run (LLM agent on issue)
├─ Step 2: peer_review (N-of-M approval gate)
├─ Step 3: fan_out (parallel agent runs on sub-tasks)
├─ Step 4: wait_timer (cooldown before next phase)
└─ Step 5: route (dispatch downstream by classification)
```

---

## The 5 Built-in Ceremony Templates

### Simple Review

**What it does:** One agent reviews the issue, comments with findings, waits for approval, then marks done.

**When to use:** Bug triage, design review, RFC feedback, any "one pass, then approve" flow.

**Steps:**
1. `agent_run` — analyzer pass (gather facts, propose solution)
2. `peer_review` — 1-of-2 reviewers approve
3. Mark done

**Example trigger:** Manual button on kanban card.

---

### Bug Fix

**What it does:** Reproduce bug, propose fix, wait approval, commit to issue branch, open PR, wait merge.

**When to use:** Production bugs, regressions, urgent fixes requiring audit trail.

**Steps:**
1. `agent_run` — reproducer + fix proposal
2. `peer_review` — 2-of-3 approve (high bar)
3. `github_pr` — push fix branch + open PR
4. `github_pr_wait_merged` — block until PR merges
5. Mark done (now linked to commit hash)

**Example trigger:** Label `bug/critical` on issue.

---

### RFC (Request for Comments)

**What it does:** Gather async feedback from reviewers on a proposal. Collect comments, summarize, decide.

**When to use:** Architecture decisions, API design, breaking changes — anything needing distributed input.

**Steps:**
1. `agent_run` — read RFC, extract decision points
2. `peer_review` — 3-of-5 reviewers comment (advisory timeout 48h)
3. `agent_run` — synthesize feedback, revise proposal
4. Mark done + link final RFC version

**Example trigger:** `type:rfc` GitHub issue label.

---

### Spike

**What it does:** Research task. Agent investigates, produces findings doc (not code), reports back.

**When to use:** Feasibility studies, vendor evaluation, tech proof-of-concept exploration.

**Steps:**
1. `agent_run` — investigation pass
2. `wait_timer` — optional cooldown (e.g., for manual research)
3. `agent_run` — draft findings doc
4. `peer_review` — 1-of-1 sign-off
5. Mark done (deliverable = findings, not merged code)

**Example trigger:** Manual + schedule (weekly research time).

---

### Pair-Programming Session

**What it does:** Two agents work in alternation (back-and-forth passes) on a feature or bug.

**When to use:** Complex features needing debate, debugging tricky issues, knowledge transfer.

**Steps:**
1. `agent_run` — agent A proposes approach
2. `agent_run` — agent B reviews, refines, suggests alternate
3. `agent_run` — agent A iterates
4. Repeat 2–3 cycles (configurable max rounds)
5. `peer_review` — human decides which direction wins
6. Mark done

**Example trigger:** Label `work-mode:pair` on issue.

---

## Trigger Types

### Manual

User clicks a button on the kanban card. The ceremony runs immediately.

```yaml
ceremony:
  name: "Review on demand"
  trigger:
    type: "manual"
```

### Scheduled

Cron expression. Ceremony runs at intervals.

```yaml
ceremony:
  name: "Weekly sweep"
  trigger:
    type: "scheduled"
    cron: "0 9 * * MON"  # 9 AM Monday
```

### GitHub Event

Activates when a GitHub event matches a condition (label added, PR opened, issue closed).

```yaml
ceremony:
  name: "Auto-fix on bug label"
  trigger:
    type: "github_event"
    event: "issues"
    action: "labeled"
    labelMatch: "^bug/"
```

---

## Creating a Custom Ceremony

Save this as `.squad/ceremonies/my-review.ceremony.yaml`:

```yaml
ceremony:
  name: "Custom Review Flow"
  slug: "custom-review-flow"
  description: "Agent deep-dive, then expert approval"
  trigger:
    type: "manual"

  workflow:
    name: "Deep Review"
    slug: "deep-review-v1"
    
    steps:
      - kind: "agent_run"
        agent: "deep-analyzer"
        prompt: "Audit this issue for correctness, security, performance."
        timeout: 300s
      
      - kind: "peer_review"
        name: "Expert sign-off"
        reviewers: 1
        timeout: 3600s
      
      - kind: "route"
        classifier: "approved_or_rejected"
        branches:
          - condition: "approved"
            steps:
              - kind: "route"
                classifier: "has_code_changes"
                branches:
                  - condition: "true"
                    steps:
                      - kind: "github_pr"
                        branchName: "fix/{{ issueId }}"
          - condition: "rejected"
            steps:
              - kind: "agent_run"
                agent: "reviser"
                prompt: "Address the feedback."
```

**Best practices:**
- Give steps meaningful names.
- Use descriptive prompts (agents see these).
- Set timeouts for human gates (peer_review, approve).
- Use `route` to branch based on classification.

---

## Ceremony vs Workflow — When to Author Which

| Question | Answer | Author |
|----------|--------|--------|
| "I have a named process my team runs weekly." | → Ceremony (with scheduled trigger) | You |
| "I want to define the steps that run when something happens." | → Workflow | You (in the ceremony file) |
| "I need a new gate between two steps." | → Modify the workflow steps | You |
| "I want to trigger something manually from the board." | → Ceremony (with manual trigger) | You |
| "I want to swap the approval logic in mid-run." | → Publish new workflow version, restart ceremony | You (via UI or CLI) |
| "I want two ceremonies to share the same step sequence." | → Save the workflow in `templates/`, reference it by ID in both ceremonies | You (reusable workflow template) |

---

## Key Concepts: Ceremony Lifecycle

- **Draft:** Created but not active. Trigger disabled. Use for testing.
- **Active:** Trigger is live. Runs when condition matches.
- **Paused:** Trigger disabled temporarily. No new runs start.
- **Archived:** No longer used. Hidden from UI by default.

---

## Workflow Step Catalogue

| Step | Purpose | Config |
|------|---------|--------|
| `agent_run` | Run an agent (LLM call) on the issue | agent ID, prompt, timeout |
| `peer_review` | Wait for N-of-M reviewers to approve | reviewer count, timeout |
| `approve` | Hard gate: wait for designated approver | approver ID, timeout |
| `fan_out` | Spawn parallel agent runs on sub-tasks | count, agent ID per branch |
| `branch` | Conditional split (if/then/else) | classifier, branches |
| `route` | Classification-based dispatch | classifier ID, routing table |
| `retry_wrap` | Wrap any step; retry on failure | step, max attempts, backoff |
| `wait_event` | Wait for external event (webhook) | event type, timeout |
| `wait_timer` | Sleep N seconds | duration |
| `github_pr` | Push branch + open PR | branch name, title, body |
| `github_pr_wait_merged` | Block until PR merges | PR ID (optional; uses latest by branch) |

---

## Linking Ceremonies to Saved Workflows

1. Write a workflow YAML (the step sequence).
2. Run it once via the **Workflow Editor** in the UI.
3. Click **Save as template** → name it (e.g., "two-pass-review").
4. The workflow is now in the **Saved Workflows** tab.
5. Create a new ceremony and reference the saved workflow by ID.

From then on, changes to the ceremony's trigger only — the workflow stays locked until you publish a new version.

---

## Common Patterns

### Approval with Escalation

```yaml
steps:
  - kind: "peer_review"
    name: "Initial review"
    reviewers: 1
    timeout: 3600s
  
  - kind: "route"
    classifier: "approved"
    branches:
      - condition: "false"
        steps:
          - kind: "approve"
            approver: "tech-lead"
            timeout: 7200s
```

### Parallel Investigation

```yaml
steps:
  - kind: "fan_out"
    count: 3
    agent: "researcher"
    parameterByIndex:
      - prompt: "Security analysis"
      - prompt: "Performance profiling"
      - prompt: "Documentation completeness"
```

### Retry on Failure

```yaml
steps:
  - kind: "retry_wrap"
    maxAttempts: 3
    backoffMs: 5000
    step:
      kind: "github_pr"
      branchName: "fix/{{ issueId }}"
```

---

## Links

- **[Workflow Editor Guide](../guides/workflow-editor.md)** — Build workflows visually (coming soon)
- **[MCP Tools: run_agent, list_agents](../../packages/server/src/mcp/README.md)** — Automate ceremony runs from agents
- **[Bundle Schema](../prd.md#bundle-schema)** — Ship ceremonies as part of project bundles
