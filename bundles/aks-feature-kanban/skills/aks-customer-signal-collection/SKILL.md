---
name: "aks-customer-signal-collection"
description: "Structured process for gathering, deduplicating, and prioritising customer signals for AKS from public forums, support escalations, and GitHub."
domain: "product-management"
confidence: "high"
source: "manual"
tools:
  - name: "web-search"
    description: "Search public forums and GitHub for customer-reported issues."
    when: "When gathering signals from GitHub, Stack Overflow, Microsoft Q&A, or Azure Feedback."
  - name: "aks-cluster-info"
    description: "Pull cluster state to cross-reference signals with known cluster configurations."
    when: "When a signal is cluster-version-specific or environment-specific."
---

## Context

Apply this skill whenever you are asked to aggregate customer signals — weekly digest, pre-triage review, or a targeted signal pull for a specific feature area. The goal is a ranked, deduplicated list of real customer pain points that drives backlog prioritisation.

## Sources (in priority order)

| Priority | Source | URL / Query |
|---|---|---|
| 1 | **GitHub AKS Issues** | `https://github.com/Azure/AKS/issues?q=is:open+label:customer-reported` |
| 2 | **GitHub AKS Discussions** | `https://github.com/Azure/AKS/discussions` |
| 3 | **Microsoft Q&A** | `https://learn.microsoft.com/answers/tags/133/azure-kubernetes-service` (filter: past 7 days) |
| 4 | **Stack Overflow** | `[azure-aks]` tag, score ≥ 2, past 7 days |
| 5 | **Azure Feedback (UserVoice)** | AKS category, ≥ 10 votes, past 30 days |
| 6 | **Internal escalations** | Any support ticket summaries shared in this project's Inbox column |

## Patterns

### Gathering
1. Query each source in priority order. For GitHub and Q&A, use the 7-day window. For UserVoice, use 30 days.
2. For each raw signal, record: `source`, `url`, `title/summary`, `date`, `reporter_count` (number of distinct people who reported the same issue).
3. Cap at 50 raw signals per run — stop when you hit the cap and note that signals beyond it were not reviewed.

### Deduplication
1. Cluster signals by topic using these canonical AKS domains: `networking`, `node-pool`, `control-plane`, `workload-identity`, `storage`, `autoscaler`, `addons`, `monitoring`, `upgrade`, `security`, `cost`.
2. Within each cluster, merge signals that describe the same root cause (same error message, same flow, same component).
3. Assign a `frequency` count: total distinct customers across merged signals.
4. Discard signals with frequency = 1 and no upvotes unless severity appears P0/P1.

### Prioritisation
Score each deduplicated signal: `score = frequency × severity_weight`
- P0 (service down): weight = 10
- P1 (major regression): weight = 5
- P2 (significant): weight = 2
- P3 (minor): weight = 1

Output the top 10 signals sorted by score descending.

### Anonymisation
- Never include customer names, tenant IDs, subscription IDs, or personal data in signal digests.
- Quote customer descriptions as: `"[Customer A] — 'node pool upgrade fails with error X'"`.

## Examples

**Good signal:**
```
Topic: node-pool-upgrade
Sources: GitHub #4521, SO #78234, Q&A #345
Frequency: 7 customers
Summary: Node pool upgrade hangs when PDB blocks eviction; no actionable error surfaced.
Severity: P1 (major regression — blocks production upgrades)
Score: 35
```

**Noise to discard:**
```
"How do I create an AKS cluster?" — documentation question, not a product signal. Skip.
```

## Anti-Patterns

- Including a signal without a source URL — unverifiable signals are not actionable.
- Reporting the same issue twice because it appeared on two sources.
- Treating upvote count as the only prioritisation signal — a single P0 bug with 1 reporter outranks a P3 cosmetic issue with 50 upvotes.
- Pulling signals older than 30 days unless specifically requested (stale signals skew the backlog).
