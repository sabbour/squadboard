# LinkedIn Monitor & Engagement Tracker

A Squad sample that opens your **real LinkedIn** in a browser, scrapes your notifications and messages using Playwright, and feeds them to a four-agent AI squad that tells you what needs your attention — with direct links to take action.

## How It Works

1. A Chromium browser launches and navigates to LinkedIn
2. You log in (or it uses your saved session from a previous run)
3. Press Enter once LinkedIn is loaded
4. The app scrapes your notifications and messages
5. Four AI agents collaborate to triage your LinkedIn:
   - **Classifier** — categorizes each item (comment, mention, connection request, message) and flags product mentions
   - **Engagement Scorer** — scores each item 1-10 for priority based on influence and time-sensitivity
   - **Action Advisor** — recommends what to do (respond, like, connect, ignore) with direct LinkedIn URLs
   - **Summary Reporter** — delivers a scannable executive briefing grouped by priority with time estimates
6. Get ideas for how to extend this sample further

## Prerequisites

- Node.js ≥ 20
- GitHub Copilot CLI installed and authenticated

## Setup

```bash
npm install
npx playwright install chromium
```

## Usage

```bash
npm start
```

On first run you'll need to log into LinkedIn in the browser window that opens. Subsequent runs remember your session (stored in `.linkedin-session/`), so you'll likely be logged in automatically.

## Notes

- **Read-only** — this demo reads your LinkedIn but never posts, messages, or connects on your behalf
- **Extensible** — add LinkedIn API tools to let agents take real actions — see the closing message for ideas
- **Privacy** — your LinkedIn data is sent to the AI model for triage but is not stored anywhere
- **LinkedIn DOM** — LinkedIn's interface changes frequently; if scraping fails, the app falls back to extracting raw text
- **Session persistence** — browser profile is saved in `.linkedin-session/` so you don't re-authenticate every run
