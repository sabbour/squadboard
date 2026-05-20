---
name: customer-research
description: Gather, deduplicate, and rank customer signals for product decisions.
domain: product-management
confidence: high
source: bundled
---

## Use when

Use this skill when a feature needs evidence from customers, users, community feedback, support tickets, surveys, interviews, analytics, or sales notes.

## Process

1. Define the decision the research must inform.
2. Gather signals from approved sources and keep source links with each signal.
3. Remove duplicates by customer problem, not by wording.
4. Tag each signal with persona, workflow, severity, frequency, recency, and confidence.
5. Separate direct evidence from assumptions.
6. Recommend one of: create feature, merge into existing feature, investigate more, or reject.

## Output

Return a table with: problem, evidence, source, frequency, severity, confidence, related feature, and recommended next action.

## Guardrails

Anonymize personal data. Do not include confidential customer identifiers. Do not inflate weak evidence.
