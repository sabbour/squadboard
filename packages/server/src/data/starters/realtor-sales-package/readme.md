# Realtor Home Sales Package Builder

A Squad sample that scrapes **Redfin and Zillow** using Playwright and feeds the listings to a four-agent AI squad that builds a client-ready **Comparative Market Analysis (CMA)** sales package for realtors.

## How It Works

1. Enter your target area (city, zip code, or neighborhood)
2. A Chromium browser launches and navigates to Redfin
3. You search for the area and filter for recent sales/active listings
4. Press Enter — the app scrapes all visible listings from Redfin
5. A second tab opens Zillow for the same area
6. Press Enter again — the app scrapes Zillow listings too
7. Four AI agents collaborate to build your CMA package:
   - **Market Scanner** — analyzes inventory, pricing trends, and market conditions
   - **Comp Analyst** — identifies comparable sales, calculates adjustments, and recommends a list price
   - **Presentation Builder** — assembles a polished, client-ready sales package
   - **Neighborhood Profiler** — researches schools, transit, amenities, and community character
8. Get a complete sales package ready for your next listing presentation

## Who Is This For?

**Real estate agents** building listing presentations and CMAs for sellers. This is NOT an investment analysis tool — it's focused on helping agents win listings with professional, data-backed presentations.

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

The app will ask for a target area, then guide you through searching both Redfin and Zillow. Browser sessions are saved in `.realtor-session/` so you don't need to accept cookies or set preferences on every run.

## Tips for Best Results

- **Filter for recently sold**: The best comps are homes sold in the last 3-6 months
- **Match the area tightly**: Search a specific neighborhood or zip code, not a whole city
- **Include active listings too**: Active inventory helps the Market Scanner assess competition
- **Use both sites**: Redfin and Zillow often have different listings — cross-referencing gives better results

## Notes

- **Read-only** — this demo scrapes listings but never creates accounts, saves searches, or takes actions on either site
- **DOM changes** — Redfin and Zillow update their interfaces frequently; the scraper uses multi-strategy selectors with fallbacks
- **Session persistence** — browser profile is saved in `.realtor-session/` for consistent sessions
- **Not a substitute for MLS** — scraped data supplements but doesn't replace official MLS comparable sales data
