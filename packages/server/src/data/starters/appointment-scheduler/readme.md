# Appointment Scheduler

A Squad sample that turns plain-text scheduling requests into optimized meeting proposals across timezones. Describe who needs to meet, when, and what to avoid — four AI specialists handle the rest.

## How It Works

1. You describe your scheduling need in plain text
2. Four agents collaborate to produce a meeting proposal:
   - **Constraint Parser** — extracts participants, timezones, duration, date ranges, and preferences
   - **Timezone Coordinator** — maps business-hour overlaps and flags awkward times
   - **Slot Ranker** — generates and ranks the top 5 time slots by overall convenience
   - **Meeting Formatter** — produces a polished proposal with times in all timezones, agenda template, and calendar invite draft
3. You get a ready-to-send meeting proposal

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

Describe your scheduling scenario when prompted. Examples:

- "I need to schedule a 1-hour meeting with Alice in San Francisco, Bob in London, and Chandra in Mumbai. Next week, avoid Monday mornings."
- "Find a 30-minute slot for a daily standup with our NYC and Tokyo offices."
- "Set up a 2-hour workshop for 6 people across Berlin, São Paulo, and Sydney. No Fridays."

## Notes

- **Read-only** — suggests optimal meeting times but doesn't book anything
- **No external APIs** — works entirely through conversational AI analysis
- **Timezone-aware** — every suggestion includes times in every participant's local timezone
- **Extensible** — add real calendar APIs to check availability and send invites

## Extending This Sample

The closing message suggests next steps, but here are the big ones:

- **Google Calendar API** — pull real free/busy data so suggestions reflect actual availability
- **Calendar invites** — auto-create `.ics` files or send invites via Google Calendar / Outlook APIs
- **Room booking** — integrate with Outlook or Google Workspace for conference room scheduling
- **Recurring meetings** — optimize weekly or biweekly slots across changing schedules
