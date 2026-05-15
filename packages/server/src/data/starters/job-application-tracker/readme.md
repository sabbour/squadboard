# Job Application Tracker

A Squad sample that opens a real browser, scrapes job listings from any job board, and analyzes them with a team of four AI specialists — matching opportunities to your profile, researching companies, preparing application strategies, and creating a prioritized action plan.

## How It Works

1. **Tell the squad what you're looking for** — role type, location, salary range, remote preferences
2. **A browser opens** — navigate to Indeed, LinkedIn Jobs, Glassdoor, or any job board
3. **Search for jobs** — use the site's search normally, get results on screen
4. **Press Enter** — the app scrapes all visible listings from the page
5. **Four AI specialists analyze everything** — you get a complete action plan

## Agents

| Agent | Role | What it does |
|-------|------|--------------|
| **Job Matcher** | Fit Scoring | Evaluates each listing against your preferences. Scores 1-10 with justification. |
| **Company Researcher** | Company Intel | Reads between the lines — what the listing language tells you about company culture, size, and maturity. |
| **Application Advisor** | Strategy | For top matches: what to emphasize, red flags, interview prep angles, salary negotiation points. |
| **Action Planner** | Prioritization | Creates a ranked action list: "Apply today (3 hot matches), Research further (2 interesting), Skip (5 poor fit)." |

## Run

```bash
npm install
npx playwright install chromium
npm start
```

## Requirements

- Node.js 20+
- GitHub Copilot CLI (`npm install -g @github/copilot && copilot auth login`)
- Chromium (installed automatically by `npx playwright install chromium`)

## Read-Only

This sample **never submits applications** or takes any action on job boards. It only reads what's visible on the page.

## Extend It

- Track applications across sessions with a local database
- Auto-customize your resume for each listing
- Set up alerts for new matching jobs on a schedule
- Compare offers side-by-side with salary research data
