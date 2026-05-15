# Price Monitor & Deal Finder

A Squad sample that opens a real browser, scrapes product prices from any shopping page, and feeds them to a four-agent deal analysis squad for actionable buy/wait/skip advice.

## How It Works

1. **Browser opens** — Playwright launches Chromium with a persistent session (no re-login each run)
2. **You navigate** — Go to any shopping page: Amazon wishlist, Best Buy deals, Walmart, etc.
3. **Press Enter** — The app scrapes visible product names, prices, and sale indicators
4. **Scrape more pages** — Navigate to another page and press Enter again, or type "done"
5. **Squad analyzes** — Four AI specialists evaluate every product and deliver a deal report

## Agents

| Agent | Role | What it does |
|-------|------|--------------|
| **Price Analyst** | Market Evaluator | Assesses each price against market ranges, seasonal patterns, sale authenticity |
| **Deal Scorer** | Quality Rater | Scores each item 1-10 on deal quality: discount depth, category, timing, urgency |
| **Purchase Advisor** | Decision Maker | Recommends Buy Now / Wait / Skip with reasoning and timing advice |
| **Summary Reporter** | Report Generator | Produces a scannable terminal report: hot deals, worth waiting, skippable |

## Run

```bash
npm install
npx playwright install chromium
npm start
```

## Prerequisites

- Node.js >= 20
- GitHub Copilot CLI installed and authenticated (`copilot auth login`)

## Read-Only

This sample **never** makes purchases or modifies anything on shopping sites. It only reads and analyzes.

## Extending Ideas

- Track prices over time and alert on drops
- Compare the same product across multiple retailer tabs
- Set a budget and get the best combination of items within it
- Run on a schedule to catch flash deals automatically
