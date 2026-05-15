# A/B Test Orchestrator — Squad Edition

A Squad sample that turns an **experiment hypothesis** into a complete A/B test plan. Provide a hypothesis at the terminal or point it at an experiment brief file, and four AI specialists collaborate to design your test.

## How It Works

1. Provide an experiment hypothesis — type it interactively or pass a brief file
2. Four AI agents collaborate to build a complete A/B test plan:
   - **Experiment Designer** — formulates testable hypotheses, designs variants, selects metrics, estimates sample sizes
   - **Traffic Strategist** — plans traffic allocation, randomization, ramp-up schedules, and bias prevention
   - **Metrics Analyst** — defines KPIs, selects statistical tests, sets confidence thresholds, establishes early stopping rules
   - **Results Interpreter** — prepares the analysis framework, decision criteria, and follow-up experiment suggestions
3. Get a structured plan with specific numbers: sample sizes, traffic splits, confidence thresholds, and timelines

## Prerequisites

- Node.js ≥ 20
- GitHub Copilot CLI installed and authenticated

## Setup

```bash
npm install
```

## Usage

### From a brief file (recommended for detailed experiments)

```bash
npm start -- experiment-briefs/homepage-cta-test.md
npm start -- experiment-briefs/pricing-page-layout.md
```

### Interactive mode (type your hypothesis)

```bash
npm start
```

You'll be prompted to type or paste your experiment hypothesis. Press Enter twice to submit.

## Sample Briefs

Two ready-to-use experiment briefs are included in `experiment-briefs/`:

- **`homepage-cta-test.md`** — Testing CTA button color (green vs. blue) on the homepage to increase signups. Includes traffic estimates, baseline metrics, and constraints.
- **`pricing-page-layout.md`** — Testing two pricing page layouts (tiered cards vs. feature comparison table) to increase paid conversions. Includes segment considerations and stakeholder requirements.

## What You Get

The squad produces a structured A/B test plan including:

- **Testable hypothesis** with null and alternative statements
- **Variant designs** comparing control and treatment in detail
- **Sample size calculations** with power analysis
- **Traffic allocation strategy** with ramp-up schedule and bias guards
- **Metric definitions** with precise formulas and measurement windows
- **Statistical test selection** with significance thresholds
- **Early stopping rules** for safe experiment monitoring
- **Analysis framework** for interpreting results and deciding next steps

## Notes

- **Read-only** — this demo plans experiments but doesn't deploy them
- **Extensible** — connect to your analytics platform, feature flag system, or CI/CD pipeline
- **Realistic** — sample briefs use real-world traffic numbers and constraints
- **Educational** — the squad explains its statistical reasoning, not just the conclusions
