# 🧾 Receipt Scanner & Expense Analyzer

A Squad-powered sample that reads receipt files from a folder and processes them
with a team of four AI financial specialists — extracting transaction data,
categorizing expenses, detecting anomalies, and building a summary report.

Supports text files and **image receipts via OCR** (tesseract.js). Includes
special handling for **multi-day hotel folios** with day-by-day breakdowns.
Outputs results on-screen and saves a **markdown expense report** to disk.

## Agents

| Agent | Role | What It Does |
|-------|------|-------------|
| **Receipt Parser** | Data Extractor | Extracts structured data from each receipt: vendor, date, amount, payment method, line items. Handles messy formats, OCR artifacts, and multi-day hotel folios. |
| **Expense Categorizer** | Category Analyst | Assigns categories (Meals, Travel, Office Supplies, Software, etc.) and flags personal vs. business expenses. Handles hotel sub-categories: Room, Meals, Parking, Spa, Minibar, Laundry, Business Services. |
| **Anomaly Detector** | Fraud & Error Spotter | Spots duplicate charges, unusual amounts, potential fraud indicators, and missing receipts in date sequences. |
| **Report Builder** | Summary Generator | Creates an expense summary: totals by category, top vendors, monthly trends, hotel folio day-by-day breakdowns, and flagged items requiring attention. Outputs clean markdown. |

## How It Works

```
Receipt files (*.txt, *.md, *.csv, *.jpg, *.png, ...) → [OCR if image]
    → Receipt Parser → Expense Categorizer → Anomaly Detector
    → Report Builder → On-screen output + expense-report.md
```

Point it at a folder of receipt files and the squad analyzes everything.
Image files are automatically OCR'd using tesseract.js before analysis.
Hotel folios are broken down by day and by category.

## Run

```bash
npm install && npm start
```

Uses the included `sample-receipts/` folder by default. Point to your own:

```bash
npm start -- /path/to/my/receipts
```

Supported file types:
- **Text:** `.txt`, `.md`, `.csv`
- **Images (OCR):** `.jpg`, `.jpeg`, `.png`, `.gif`, `.bmp`

After analysis, the report is saved to `expense-report.md` in the current directory.

## Hotel Folio Itemization

Drop a hotel checkout bill into the receipts folder and the squad will:
- Parse every line item by date
- Categorize charges (room, meals, parking, spa, minibar, laundry, etc.)
- Build a day-by-day breakdown table with daily totals
- Summarize category totals across the entire stay
- Flag personal vs. business charges for each line item

See `sample-receipts/hotel-folio.txt` for an example.

## Privacy Note

Receipt data is sent to the AI model for analysis but is **not stored** by this
application. Receipt files are read-only — never modified. If your receipts
contain sensitive information (card numbers, personal details), be aware that
the content is transmitted to the configured AI provider for processing.

Image files are processed locally via tesseract.js for OCR — the image data
itself is not sent to the AI model, only the extracted text.

## Extension Ideas

- Connect to your bank's CSV export for automatic categorization
- Auto-generate expense reports for accounting software
- Track spending trends over time with scheduled runs
- Bulk-scan a folder of photographed receipts with OCR
