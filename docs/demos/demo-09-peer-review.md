# Demo 9 — Peer Review

> **Status:** 🔴 Not started  
> **Layer:** Board UI  
> **Estimated session:** ~8 minutes to run through

## What this demo shows

Add a peer-review step to a workflow. Reviewers approve, request changes, or comment. The workflow progresses only after N-of-M quorum is met. Full audit trail is threaded and auditable.

## Prerequisites

- Demo 6 complete (workflows working)
- `npx @sabbour/squadboard up` running
- At least 2 team members (see `.squad/team.md`)
- A workflow with a `peer_review` step

## Run it

```bash
# Step 1: Create a workflow with a peer_review step
# Add a step: kind: peer_review, reviewers: ["alice", "bob"], quorum: 2

# Step 2: Execute the workflow
# The workflow pauses at the peer_review step

# Step 3: Open the card detail panel
# The "Reviews" section shows Alice and Bob as reviewers

# Step 4: As Alice, click "Approve"
# Your vote is recorded and visible

# Step 5: As Bob, click "Request Changes"
# Bob's feedback is added to the thread

# Step 6: Once 2 votes are in, the workflow progresses
# Or, if all reviewers request changes, the workflow halts
```

## What to observe

- Reviewers are required fields in peer_review steps
- Each reviewer has a ballot (Approve / Request Changes / Comment)
- Quorum is N-of-M (e.g., 2-of-3 must approve)
- All decisions are threaded and timestamped
- The workflow respects the quorum rule before advancing

## Known gaps (hacking phase)

> Request-changes policy (first vs. all) is TBD pending decision in PRD §12. Reviewer lockout (prevent self-review) is partially stubbed.

---
*Auto-generated stub. Last updated: 2026-05-14. Update when demo ships.*
