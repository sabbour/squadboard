# Support Ticket Router

A Squad sample that reads **real support ticket files** from a folder and triages them with a four-agent AI squad — classifying priority, matching known issues, drafting responses, and producing a prioritized action queue.

## How It Works

1. Point the app at a folder of ticket files (`.txt` or `.md`, one per ticket)
2. The ticket reader loads and formats each file
3. Four AI agents collaborate to triage the batch:
   - **Ticket Classifier** — categorizes (Billing / Technical / Account / Feature Request / Complaint), assigns priority (P1–P4), detects sentiment
   - **Knowledge Matcher** — checks for known issues, FAQ matches, standard resolutions, and duplicates
   - **Response Drafter** — writes empathetic draft responses calibrated to tone and priority
   - **Queue Manager** — produces a prioritized action queue with summary statistics
4. Get ideas for how to extend this sample further

## Prerequisites

- Node.js ≥ 20
- GitHub Copilot CLI installed and authenticated

## Setup

```bash
npm install
```

## Usage

```bash
# Triage the included sample tickets
npm start

# Triage your own ticket files
npm start -- /path/to/your/tickets
```

The `sample-tickets/` folder includes five realistic tickets you can test with immediately:
- `billing-overcharge.txt` — Customer charged twice
- `login-broken.txt` — Can't access account (time-sensitive)
- `feature-request.txt` — Wants dark mode
- `angry-complaint.txt` — Frustrated repeat customer, escalation risk
- `technical-bug.txt` — App crashing on file upload

## Notes

- **Read-only** — this demo drafts responses but never sends anything
- **Extensible** — connect to Zendesk/Freshdesk, add auto-send, track trends
- **File-based** — drop `.txt` or `.md` files in any folder and point the app at it
- **Streaming** — responses stream in real-time with ANSI-colored output

## Extension Ideas

- Connect to Zendesk or Freshdesk API for live ticket ingestion
- Auto-send approved responses after human review
- Track resolution time trends across ticket batches
- Add SLA monitoring and escalation alerts
- Build a dashboard showing ticket volume and category breakdown
