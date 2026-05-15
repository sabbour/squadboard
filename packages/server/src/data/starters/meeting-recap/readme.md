# Meeting Recap & Action Item Generator

A Squad sample that turns meeting transcripts into structured recaps with action items, decisions, and follow-ups. Paste your notes directly or point to a transcript file — four AI specialists do the rest.

## How It Works

1. Run the app and choose your input method: paste notes or provide a file path
2. The app reads your meeting content and sends it to a four-agent squad
3. Four AI specialists collaborate to produce a complete post-meeting package:
   - **Summarizer** — executive summary, key topics, attendees, notable quotes
   - **Action Tracker** — every action item with owner, deadline, priority, and dependencies
   - **Decision Logger** — all decisions with context, impact, and status
   - **Follow-Up Coordinator** — open questions, deferred topics, communication plan, check-ins
4. Get a structured recap streamed to your terminal

## Prerequisites

- Node.js ≥ 20
- GitHub Copilot CLI installed and authenticated

## Setup

```bash
npm install
```

## Usage

```bash
npm start
```

You'll be prompted to either paste meeting notes directly or provide a path to a transcript file. Two sample transcripts are included to try immediately:

```bash
# When prompted for input, type a file path:
./sample-transcripts/sprint-planning.md
./sample-transcripts/product-review.md
```

### Sample Transcripts

- **`sample-transcripts/sprint-planning.md`** — A sprint planning meeting with backend/frontend coordination, deadlines, and deployment planning
- **`sample-transcripts/product-review.md`** — A product review meeting covering design decisions, beta launch planning, and customer communication

## Notes

- **Read-only** — this demo analyses your transcript but never modifies any external systems
- **Extensible** — add tools to let agents create Jira tickets, send Slack messages, or update project boards
- **Privacy** — your meeting notes are sent to the AI model for analysis but are not stored anywhere
- **Any format** — works with any text-based meeting notes, transcripts, or minutes
