---
name: "aks-disclosure-quality"
description: "How to write a customer-facing AKS feature disclosure: structure, tone, required content, and what to exclude."
domain: "documentation"
confidence: "high"
source: "manual"
---

## Context

Apply this skill whenever you are writing or reviewing a customer-facing AKS feature disclosure — What's New entry, release note, changelog item, or short-form feature announcement for learn.microsoft.com or the Azure blog. The disclosure is the first (and often only) thing customers read about a new feature.

## Required Structure

A compliant AKS disclosure has exactly these sections, in this order:

```markdown
## <Feature Name> [Preview | GA]

> **Availability:** <regions or "all public regions"> | **Kubernetes versions:** <versions> | **SKU:** <SKU restrictions, if any>

<One or two sentences: what is this feature and why does it matter to the customer. Lead with the customer outcome, not the implementation detail.>

**What's new:**
- <Bullet 1: concrete capability added>
- <Bullet 2: concrete capability added>
- <Bullet 3 (optional)>

**To get started:** See [<doc title>](<url>).

**Known limitations (if any):**
- <Limitation 1>
```

## Tone and Voice

Follow [Microsoft Writing Style Guide](https://learn.microsoft.com/style-guide/welcome/) and these AKS-specific rules:

- **Customer-outcome first:** Start with what the customer can now do, not with what the engineering team built. ❌ "We added support for…" → ✅ "You can now…"
- **Plain English:** No internal codenames, org names, or team abbreviations. "The AKS team" not "AKS RP" or "the Mesh team".
- **Active voice and present tense:** "AKS automatically upgrades…" not "Automatic upgrades are now performed by AKS…"
- **Concrete and specific:** State the Kubernetes version, region, or SKU where the feature applies. Vague disclosures erode trust.
- **No marketing superlatives:** No "industry-leading", "revolutionary", "best-in-class".

## Required Content

| Element | Required? | Notes |
|---|---|---|
| Feature name | Yes | Match the exact name on learn.microsoft.com. |
| GA / Preview status | Yes | One of: `[GA]`, `[Preview]`, `[Public Preview]`, `[Private Preview]`. |
| Availability line | Yes | Regions + K8s versions + SKU restrictions. |
| Customer-outcome sentence | Yes | ≤ 2 sentences. Lead with "You can now…" or "AKS now…". |
| What's new bullets | Yes | ≥ 1 bullet. Each bullet = one concrete capability. |
| "To get started" link | Yes | Must point to a live learn.microsoft.com URL. |
| Known limitations | If any | List only limitations that affect day-1 customer use. |

## What to Exclude

- Internal ticket numbers, ADO work item IDs, GitHub PR numbers.
- Engineering implementation details (e.g., "this was implemented using a new controller in the RP").
- SLAs or uptime guarantees not officially published.
- Comparisons with competitor products.
- Future roadmap commitments ("in a future release, we will…").
- Customer names or logos without explicit approval from the customer.

## Examples

**Good disclosure:**
```markdown
## Automatic node image upgrade channels [GA]

> **Availability:** All public regions | **Kubernetes versions:** 1.28+ | **SKU:** Standard, Premium

You can now configure AKS to automatically apply the latest OS and runtime patches to your node pools on a schedule you control — without manual intervention or rolling upgrades.

**What's new:**
- Four upgrade channels: `None`, `Unmanaged`, `NodeImage`, `SecurityPatch`.
- Per-node-pool channel override: set different channels for system and user pools.
- Maintenance window integration: upgrades respect your configured maintenance windows.

**To get started:** See [Configure automatic node image upgrades](https://learn.microsoft.com/azure/aks/auto-upgrade-node-os-image).
```

**Bad disclosure (annotated):**
```markdown
## AKS Node OS Upgrade Feature — GA  ← BAD: vague name, inconsistent with docs

We are happy to announce that... ← BAD: "we", not "you"; marketing opener

The AKS RP team has added support for... ← BAD: internal org name; passive framing

...in eastus only (other regions coming soon). ← BAD: no commitment to timeline
```

## Anti-Patterns

- Writing the disclosure before the feature reaches GA and the docs URL is live.
- Omitting the Kubernetes version requirement — customers on older versions will be confused.
- Using the past tense ("was added", "has been released") — use present tense.
- Burying the customer outcome in the third sentence — it must be in the first sentence.
- Sending the disclosure without a docs engineer review for accuracy.
