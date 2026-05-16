// ---------------------------------------------------------------------------
// Curated built-in ceremony templates (W16 curation — 5 picks).
//
// Removed from built-ins (moved to community-examples pool, not deleted):
//   feature, refactor, ops_incident, design_review, documentation_update,
//   security_patch — too niche / half-implemented for a default set.
//
// Added: spike, pair_programming.
//
// scribe-close-out is intentionally absent — it lives in BUILT_IN_CEREMONIES
// (ceremony-translator.ts) as an SDK-backed ceremony, not a YAML template.
// ---------------------------------------------------------------------------
const SIMPLE_YAML = `# Simple Review Workflow
# A three-step workflow: auto-route → agent run → manual approve
name: "Simple Review"
description: "Route an issue to the right agent, let them work, then approve the result."
output_schema:
  type: object
  properties:
    summary:
      type: string
      description: "A brief summary of what was done"
    result:
      type: string
      enum: [approved, rejected, needs_changes]
      description: "The outcome of the agent's work"
    notes:
      type: string
      description: "Optional notes for the approver"
  required: [summary, result]
steps:
  - type: route
    description: "Auto-assign to the right agent based on routing rules"
  - type: agent_run
    description: "Execute the assigned agent's work"
    prompt: |
      Review this issue carefully and complete the requested work.
      Return your response as JSON matching this schema:
      - summary: what you did (string)
      - result: approved | rejected | needs_changes
      - notes: any notes for the approver (optional string)
  - type: approve
    description: "Lead reviews and approves (Solo policy)"
    approvers: [lead]
    request_changes_policy: first
    timeout: 24h
    timeout_action: notify
`;
const BUG_FIX_YAML = `# Bug Fix Workflow — reproduce → fix → verify
# Demonstrates the Solo Reviewer policy (lead approves; first request_changes blocks).
name: "Bug Fix"
description: "Reproduce the bug, ship a fix, and verify in a separate pass."
steps:
  - type: route
  - type: agent_run
    label: "Reproduce"
    prompt: |
      Reproduce the reported bug. Document the exact steps you took, the
      observed behaviour, and the expected behaviour.
  - type: agent_run
    label: "Fix"
    prompt: |
      Implement a minimal fix for the reproduced bug. Do not refactor.
      Return a unified diff and a one-line description of the change.
  - type: agent_run
    label: "Verify"
    prompt: |
      Re-run the reproduction steps from the first step against the fix.
      Confirm the bug is resolved with no regressions.
  - type: approve
    description: "Lead approves (Solo policy)"
    approvers: [lead]
    request_changes_policy: first
    timeout: 24h
    timeout_action: notify
`;
const FEATURE_YAML = `# Feature Workflow — spec → design review → implement → review → ship
# Demonstrates the Two Eyes policy (2 reviewers must approve; either may block).
name: "Feature"
description: "Spec, review, build, review again, ship."
steps:
  - type: agent_run
    label: "Spec"
    prompt: "Write a one-page spec for this feature: problem, approach, acceptance criteria."
  - type: approve
    label: "Design review"
    description: "Two reviewers approve the design (Two Eyes policy)"
    approvers: [lead, reviewer]
    quorum: { n: 2, of: 2 }
    request_changes_policy: first
    timeout: 48h
    timeout_action: notify
  - type: route
  - type: agent_run
    label: "Implement"
  - type: approve
    label: "Code review"
    description: "Two reviewers approve the implementation (Two Eyes policy)"
    approvers: [lead, reviewer]
    quorum: { n: 2, of: 2 }
    request_changes_policy: first
    timeout: 48h
    timeout_action: notify
`;
const REFACTOR_YAML = `# Refactor Workflow — spec → impl → review → land
name: "Refactor"
description: "Plan a refactor, implement it, review, land."
steps:
  - type: agent_run
    label: "Spec"
    prompt: "Document the refactor: scope, blast radius, risk, rollout plan."
  - type: route
  - type: agent_run
    label: "Implement"
  - type: approve
    description: "Lead approves (Solo policy)"
    approvers: [lead]
    request_changes_policy: first
    timeout: 24h
`;
const RFC_YAML = `# RFC Workflow — draft → discuss → decide
# Demonstrates the Strict policy (every reviewer must approve).
name: "RFC"
description: "Draft an RFC, gather input from all stakeholders, decide."
steps:
  - type: agent_run
    label: "Draft"
    prompt: "Write the RFC: motivation, design, alternatives, drawbacks, open questions."
  - type: agent_run
    label: "Discuss"
    prompt: "Surface concerns from each stakeholder area; record them inline."
  - type: approve
    label: "Decide"
    description: "Strict policy — every reviewer must approve."
    approvers: [lead, reviewer, devops, security]
    request_changes_policy: all
    timeout: 72h
    timeout_action: notify
`;
const OPS_INCIDENT_YAML = `# Ops Incident Workflow — triage → mitigate → root-cause → postmortem
name: "Ops Incident"
description: "Stop the bleeding, then learn from it."
steps:
  - type: route
  - type: agent_run
    label: "Triage"
    prompt: "Classify severity, scope of impact, and immediate user-facing symptoms."
  - type: agent_run
    label: "Mitigate"
    prompt: "Apply the smallest change that restores normal operation. Document it."
  - type: agent_run
    label: "Root cause"
    prompt: "Identify the root cause; produce a 5-whys analysis."
  - type: approve
    label: "Postmortem review"
    description: "Two-eyes review of postmortem (lead + ops on-call)."
    approvers: [lead, devops]
    quorum: { n: 2, of: 2 }
    request_changes_policy: first
    timeout: 48h
    timeout_action: notify
`;
const DESIGN_REVIEW_YAML = `# Design Review Workflow — review → approve
name: "Design Review"
description: "A focused single-pass design review."
steps:
  - type: agent_run
    label: "Review"
    prompt: "Read the proposal and write a structured critique: strengths, risks, blockers."
  - type: approve
    description: "Lead signs off (Solo policy)"
    approvers: [lead]
    request_changes_policy: first
    timeout: 24h
`;
const DOCUMENTATION_UPDATE_YAML = `# Documentation Update Workflow — draft → publish
# Demonstrates the Advisory policy (auto-approve on timeout — docs ship by default).
name: "Documentation Update"
description: "Draft docs, optionally review, ship within a short window."
steps:
  - type: agent_run
    label: "Draft"
    prompt: "Update the relevant doc(s). Preserve voice and structure."
  - type: approve
    label: "Optional review"
    description: "Advisory policy — auto-approves after the timeout if no decision is recorded."
    approvers: [lead]
    request_changes_policy: first
    timeout: 24h
    timeout_action: auto_approve
`;
const SECURITY_PATCH_YAML = `# Security Patch Workflow — assess → patch → review → ship
# Demonstrates the Security Quorum policy (2-of-3 reviewers, author excluded,
# escalates to a fallback reviewer if the timeout fires).
name: "Security Patch"
description: "Assess the vulnerability, ship a patch, review under quorum, escalate if stalled."
steps:
  - type: agent_run
    label: "Assess"
    prompt: "Score severity (CVSS), affected versions, exploit prerequisites."
  - type: route
  - type: agent_run
    label: "Patch"
    prompt: "Implement the minimal patch and a regression test."
  - type: approve
    label: "Security review"
    description: "Security Quorum — 2-of-3 reviewers, author excluded, escalates on timeout."
    approvers: [security, lead, devops]
    quorum: { n: 2, of: 3 }
    exclude_author: true
    request_changes_policy: first
    timeout: 24h
    timeout_action: escalate
    fallback_reviewer: lead
`;
const SPIKE_YAML = `# Spike Workflow — investigate → write findings → close
# Use for time-boxed research tasks that produce findings, not shipped code.
name: "Spike"
description: "Investigate a question, write up findings, close without merging."
steps:
  - type: route
    description: "Assign to the agent best suited to investigate."
  - type: agent_run
    label: "Investigate"
    prompt: |
      Time-box your investigation to the agreed duration. Explore the
      problem space, run experiments, read references. Do not ship code.
  - type: agent_run
    label: "Write findings"
    prompt: |
      Summarise what you learned: key insights, open questions, recommended
      next steps. Write for someone who wasn't present during the spike.
  - type: approve
    label: "Review findings"
    description: "Lead reviews the findings document (Solo policy)."
    approvers: [lead]
    request_changes_policy: first
    timeout: 24h
    timeout_action: notify
`;
const PAIR_PROGRAMMING_YAML = `# Pair-Programming Session Workflow
# Two agents alternate passes on the same context, building on each other's work.
name: "Pair-Programming Session"
description: "Two agents alternate work passes on shared context."
steps:
  - type: route
    description: "Assign primary and secondary agents."
  - type: agent_run
    label: "First pass"
    prompt: |
      Take the first pass on the task. Write clean, readable code.
      Leave inline comments where you'd like the next agent to pay
      attention or build on.
  - type: agent_run
    label: "Second pass"
    prompt: |
      Review the first agent's work. Improve it, fill gaps, and address
      the inline notes left for you. Do not discard working code.
  - type: approve
    label: "Final review"
    description: "Lead reviews the combined output (Solo policy)."
    approvers: [lead]
    request_changes_policy: first
    timeout: 24h
    timeout_action: notify
`;
export function getBuiltinTemplates() {
    return [
        {
            slug: 'simple',
            name: 'Simple Review',
            description: 'Route an issue to the right agent, let them work, then approve.',
            tags: ['baseline', 'solo'],
            yamlContent: SIMPLE_YAML,
        },
        {
            slug: 'bug_fix',
            name: 'Bug Fix',
            description: 'Investigate a bug, fix it, verify the fix, ship a PR.',
            tags: ['bug', 'solo'],
            yamlContent: BUG_FIX_YAML,
        },
        {
            slug: 'rfc',
            name: 'RFC / Proposal',
            description: 'Draft a proposal, gather stakeholder input, decide.',
            tags: ['rfc', 'strict'],
            yamlContent: RFC_YAML,
        },
        {
            slug: 'spike',
            name: 'Spike',
            description: 'Time-boxed investigation — produce findings, not shipped code.',
            tags: ['research', 'spike'],
            yamlContent: SPIKE_YAML,
        },
        {
            slug: 'pair_programming',
            name: 'Pair-Programming Session',
            description: 'Two agents alternate work passes on shared context.',
            tags: ['pair', 'collaborative'],
            yamlContent: PAIR_PROGRAMMING_YAML,
        },
    ];
}
//# sourceMappingURL=index.js.map