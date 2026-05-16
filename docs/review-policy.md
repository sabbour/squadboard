# Review Policy — How It Works

A **review policy** controls who must approve a workflow step marked `type: approve`, how many approvals are needed, and what happens when the deadline is missed.

---

## Policy fields

| Field | What it means |
|---|---|
| **Approvers** | Comma-separated role names (e.g. `lead, qa`). Leave blank to allow any reviewer. |
| **Quorum** | "N of M" — how many of the assigned approvers must approve before the step passes. |
| **Block policy** | What a "request changes" verdict does: **First blocks** (one veto stops the step), **Majority blocks** (most must veto), or **All must approve** (unanimous approval required). |
| **Exclude author** | When checked, the person who triggered the workflow cannot approve their own step. |
| **Review deadline** | ISO-8601 duration (e.g. `24h`, `2d`, `1w`). If no approval arrives by this time, the timeout action fires. |
| **When deadline passes** | What happens after the review deadline: notify only, auto-approve, auto-reject, or escalate to a fallback reviewer. |
| **Escalate to** | Role name for the fallback reviewer. Only used when "When deadline passes" is set to "Escalate". |

---

## Resolution order

Policy fields are resolved in this priority order (highest wins):

1. **Workflow step override** — fields set directly on a `type: approve` step in the workflow YAML.
2. **Board default** *(coming soon)* — a policy set at the board level, applying to all projects under it.
3. **Project default** — set on the **Settings → Review policy** page; applies to every `approve` step that doesn't override the policy.
4. **System default** — built-in fallback: any approver, first request_changes blocks, 24 h deadline, notify only.

Each field resolves independently, so a step can override just `timeout` and inherit everything else from the project default.

---

## Presets

Presets are named bundles of policy fields. Choosing a preset fills all fields at once.

**Built-in presets** are provided by the system and cannot be edited.  
**Project presets** are saved configurations you create for this project (coming soon).

You can still fine-tune individual fields after choosing a preset — the preset just gives you a starting point.

---

## Example

Given a project default of:
- Approvers: `lead`
- Quorum: none (any single approval)
- Exclude author: on
- Deadline: 24 h → notify

A workflow step with `approvers: [qa]` will use `qa` as the approver (step override wins), but inherit the 24 h deadline and exclude-author rule from the project default.

---

## Tips

- Use **"Any approver"** (empty approvers list) for fast-moving projects — any team member can unblock the step.
- Use **"First blocks"** for strict quality gates where a single reviewer can stop a bad change.
- Set **"Escalate to lead"** on critical steps so reviews never silently timeout.
