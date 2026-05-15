# Real Estate Investment Analyzer

A Squad sample that opens **Redfin or Zillow** in a browser, scrapes visible property listings using Playwright, and feeds them to a four-agent AI squad for investment analysis.

## How It Works

1. A Chromium browser launches and opens Redfin
2. You navigate to a search results page (any city, any filters)
3. Press Enter once the listing cards are visible
4. The app scrapes address, price, beds/baths, sqft, and details from visible listings
5. Four AI agents collaborate to analyze the properties:
   - **Property Evaluator** — assesses price/sqft, condition, and deal quality
   - **Investment Analyst** — runs mortgage, rental income, cap rate, and cash flow scenarios
   - **Neighborhood Scorer** — evaluates location factors (schools, transit, growth)
   - **Summary Reporter** — produces a ranked opportunity list with buy/watch/skip calls
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

Navigate to any Redfin or Zillow search results page in the browser that opens. The app works with whatever listings are visible on the page — no login required for public search results.

## Notes

- **Read-only** — this demo scrapes listings but never submits offers, contacts agents, or modifies anything
- **Extensible** — add tools to track properties over time, calculate mortgage with your rates, or compare neighborhoods
- **Flexible scraping** — uses multiple selector strategies with fallbacks since real estate sites change DOM frequently
- **Session persistence** — browser profile is saved in `.realestate-session/` so preferences carry across runs
- **Works with Redfin and Zillow** — selector strategies cover both sites, with a generic fallback for others
