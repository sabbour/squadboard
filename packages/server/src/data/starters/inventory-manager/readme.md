# Inventory Manager

A Squad-powered inventory analysis demo. Reads a CSV file of product data and feeds it to a four-agent Squad that predicts stockouts, optimises reorder points, finds cost savings, and produces an actionable restock plan.

## Agents

| Agent | Role | What it does |
|-------|------|--------------|
| **Stock Analyst** | Inventory Evaluation | Evaluates current levels — overstocked, understocked, dead stock. Calculates days-of-supply remaining. |
| **Demand Predictor** | Trend Analysis | Spots trending items, seasonal indicators, velocity analysis. Flags items that will run out soon. |
| **Reorder Optimizer** | Order Calculation | Calculates optimal reorder quantities and timing — MOQs, bulk discounts, storage costs, lead times. |
| **Action Reporter** | Restock Planning | Creates a restock action plan with priority tiers and estimated spend. |

## Run

```bash
npm install && npm start
```

Uses `sample-inventory.csv` by default. To analyse your own file:

```bash
npm start -- /path/to/your-inventory.csv
```

## CSV Format

```csv
product,sku,quantity,unit_cost,supplier,last_restock,daily_usage
Widget A,WA-001,150,2.50,Acme Supply,2026-02-15,8
```

## What Could You Build Next?

- Connect to Shopify or Square inventory APIs for live data
- Auto-generate purchase orders from the restock plan
- Track inventory trends over time with periodic snapshots
- Add supplier lead-time lookups for smarter reorder timing
