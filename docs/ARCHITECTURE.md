# APEX Terminal — Architecture

## System overview

```
+--------------------------------------------------------------+
|  Next.js app (single process, runs in the browser)           |
|                                                              |
|  pages/  company workspaces, modelling, AI center, research  |
|    |                                                         |
|  lib/api.ts       in-browser engine + localStorage store     |
|  lib/exporters.ts research note -> PDF / XLSX                |
|  lib/pdf.ts       PDF 1.4 writer                              |
|  lib/xlsx.ts      OOXML (ZIP) writer                          |
|  components/      shell, theme, UI primitives, charts        |
+--------------------------------------------------------------+
            (optional) AI provider HTTP call from the browser
```

There is no server process, no database and no environment configuration. `api()` and
`apiBlob()` in `lib/api.ts` dispatch to pure functions in the same module, so the UI
code is unchanged in shape from the earlier client/server design and could be pointed
at a remote API again by swapping those two functions.

Principles enforced in code:

1. **Determinism** — every calculation is a pure function in `lib/api.ts` (statements,
   metrics, forecast, valuation, sensitivity, LBO, Black–Scholes, bonds). The AI layer
   proposes narrative text only; it never produces final numbers.
2. **Historical != forecast** — normalized statements (`annual`/`quarterly`) are
   immutable inputs; forecasts and assumptions live in separate structures.
3. **Explicit gaps** — missing values stay `null` and surface in the data-quality
   panel; they are never silently zero-filled.
4. **Provider-agnostic AI** — models configured on `/ai` use the OpenAI-compatible
   `/chat/completions` surface; keys live in this browser's `localStorage` and are
   only sent to the endpoint you configured.
5. **Nothing leaves the machine** — unless you configure an AI provider, no network
   request is made at all.

## Data flow: ticker to valuation

```
ticker  ->  mockTickerData()                  normalized {annual|quarterly, price history, info}
        ->  buildMetrics()                    ratio table per period (None-safe, period-aligned)
        ->  buildForecast()                   linked IS/BS/CF with revolver and optional cash sweep
        ->  dcfCompute() / reverseDcfCompute()
             / sensitivityCompute()           valuation, implied WACC, matrices
        ->  exporters.ts                      xlsx / pdf bytes
```

The Research Studio adds `buildReportRecord()` on top: it runs the pipeline above,
derives a rating from the DCF bands, renders the PDF once to record its real page
count and byte size, and versions each build in `localStorage` (`apex_reports`).

### Normalized statement schema

Each period: `{ "period_end": "2025-12-31", "items": { "<canonical>": float|null } }`.
Canonical keys (`revenue`, `cost_of_revenue`, `gross_profit`, `operating_income`,
`ebit`, `ebitda`, `net_income`, `tax_expense`, `pretax_income`, `interest_expense`,
`diluted_eps`, `total_assets`, `cash`, `total_debt`, `equity`, `shares_issued`,
`operating_cash_flow`, `capex`, `free_cash_flow`, ...) are mapped in
`buildMetrics()`. Missing values stay `null`.

### Fixtures

Every ticker resolves to a deterministic in-browser fixture (`mockTickerData`):
annual and quarterly statements, 90 daily price points, a price summary and a
data-quality record. It is synthetic and labelled as such in the UI and in AI
prompts, so the full workflow is demonstrable with no network access.

## Persistence

Browser `localStorage`, namespaced per feature:

| Key                   | Contents                                    |
|-----------------------|---------------------------------------------|
| `apex_projects`       | saved workspaces (ticker, assumptions, data)|
| `apex_models`         | AI provider configuration and keys          |
| `apex_saved_models`   | three-statement model snapshots             |
| `apex_reports`        | research note versions and their inputs     |
| `apex-theme`          | dark / light preference                     |

Report records store their *inputs*, not their outputs: the PDF is regenerated from
the inputs on download, so the store stays small and a rebuild is reproducible.

## Frontend structure

- App Router pages: `/` research home, `/company/[ticker]` workspace with ten tabs
  (Overview, Business, Statements, History, Forecast, Valuation, Sensitivity,
  Risks, Report, Sources), `/company` company index, `/modelling` LBO/options/bond/
  WACC studio, `/ai` control center, `/research` Research Studio, `/library`,
  `/settings`.
- `components/Shell.tsx` persistent desktop+mobile shell with ticker search and
  Ctrl/Cmd-K focus; `ThemeProvider` persists dark/light in `localStorage` with a
  pre-hydration boot script.
- Shared primitives in `components/ui.tsx`; charts in `components/charts.tsx`;
  number/date formatting in `lib/format.ts`; engine dispatch in `lib/api.ts`.
- Design tokens in `app/globals.css` (dark/light palette, tabular numerals).

## Exports

- `lib/pdf.ts` — a small PDF 1.4 writer: Helvetica/WinAnsi content streams, page
  breaking, wrapped text, key/value rows, cross-reference table and trailer.
- `lib/xlsx.ts` — a small OOXML writer: stored (uncompressed) ZIP with CRC32,
  `[Content_Types].xml`, workbook, relationships, styles and inline-string sheets.
- `lib/exporters.ts` — assembles the research note (market snapshot, reported
  figures, forecast table, DCF, sensitivity matrix, narrative sections, data quality)
  into either format. Export text is ASCII-sanitised for PDF and XML-escaped for
  XLSX.

## Security

- No server, no cookies, no third-party storage: data never leaves the browser.
- AI keys are stored unencrypted in `localStorage`; treat a shared browser profile as
  shared data. Keys are only transmitted to the provider endpoint on the model row.
- Export text is XML-escaped before rendering to XLSX and ASCII-sanitised for the
  PDF content stream.
- There is no authentication layer; add auth before exposing a shared deployment.

## Known gaps / next milestones

- Optional remote engine adapter so a hosted deployment can serve real market data.
- Comparable-companies harness with peer selection and Monte Carlo valuation.
- Full M&A pro forma module; LBO tranches and a maintenance-covenant schedule.
- IndexedDB instead of `localStorage` for large project libraries.
