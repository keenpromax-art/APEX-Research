# APEX Terminal — Architecture

## System overview

```
+--------------------------------------------------------------+
|  Next.js app (server + browser)                              |
|                                                              |
|  pages/  company workspaces, modelling, AI center, research  |
|    |                                                         |
|  lib/api.ts       in-browser engine + localStorage store     |
|  lib/marketData.ts provider cache (apex_market_*, 10 min)    |
|  lib/exporters.ts research note -> PDF / XLSX                |
|  lib/pdf.ts       PDF 1.4 writer                             |
|  lib/xlsx.ts      OOXML (ZIP) writer                         |
|  components/      shell, theme, UI primitives, charts        |
|                                                              |
|  app/api/market/[ticker]  route handler (one dynamic route)  |
|    -> lib/server/yahoo.ts   Yahoo Finance client + normalizer|
|       quoteSummary (crumb+cookie), chart, fundamentals-      |
|       timeseries, FX pairs; in-memory 10-min response cache  |
+--------------------------------------------------------------+
            (optional) AI provider HTTP call from the browser
```

There is no database and no environment configuration. The single dynamic route
`GET /api/market/[ticker]` exists because browsers cannot call Yahoo Finance
directly (CORS); it proxies to `lib/server/yahoo.ts` and caches raw responses in
memory for 10 minutes. Everything else — `api()` and `apiBlob()` in `lib/api.ts`
— dispatches to pure functions, so the UI code is unchanged in shape from a
fully client/server design.

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
5. **Honest data origin** — every figure is either reported (provider snapshot),
   derived (a calculation shown in the provenance table), or an explicitly
   labelled synthetic/engine value. Provider failures degrade to a cached snapshot
   or a clearly-marked synthetic fixture; they never fabricate reported figures.

## Data flow: ticker to valuation

```
ticker  ->  resolveFixture()                  provider snapshot | fresh cache | labelled synthetic
             fetchTickerFixture()             GET /api/market/[ticker] (browser cache, 10 min TTL)
        ->  buildMetrics()                    ratio table per period (None-safe, period-aligned)
        ->  buildForecast()                   linked IS/BS/CF; drivers derived from reported
             deriveAssumptions()              history where available (per-driver provenance labels)
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

### Market data & fixtures

Fixture resolution order (`resolveFixture` in `lib/api.ts`):

1. **Provider snapshot** — `GET /api/market/[ticker]` returns a normalized fixture
   built from Yahoo Finance's public endpoints (quoteSummary with cookie+crumb,
   1y daily chart, fundamentals-timeseries for statements). Statements reported in
   a different currency than the listing are converted at each period end via a
   monthly FX series (`USDINR=X`, `GBPUSD=X`, ...); when the FX series is
   unavailable the statements are omitted with a warning — currencies are never
   mixed. Result: `is_synthetic: false`, `provider: "Yahoo Finance"`,
   `retrieved_at`, data-quality alerts with `mode: "provider"`.
2. **Fresh browser cache** — `apex_market_{TICKER}` in `localStorage`, 10-minute
   TTL, keeps reports reproducible when the provider is unreachable
   (`mode: "cache"` alert).
3. **Labelled synthetic fallback** — `mockTickerData()` emits a deterministic
   fixture marked `is_synthetic: true` with a demo banner in the UI, PDF and AI
   prompts, so the workflow is demonstrable with no network access.

Forecast drivers are derived from reported history where inputs exist
(`deriveAssumptions`): revenue growth from the reported revenue CAGR, margins from
the latest reported statements, capex/D&A/interest/NWC/share-dilution ratios from
the matching period. Each driver carries a source label (user input / derived from
reported history / engine default) that is rendered in the provenance table, the
forecast section of the PDF and the Drivers sheet of the XLSX.

## Persistence

Browser `localStorage`, namespaced per feature:

| Key                   | Contents                                    |
|-----------------------|---------------------------------------------|
| `apex_projects`       | saved workspaces (ticker, assumptions, data)|
| `apex_models`         | AI provider configuration and keys          |
| `apex_saved_models`   | three-statement model snapshots             |
| `apex_reports`        | research note versions and their inputs     |
| `apex_market_{SYM}`   | cached provider snapshot (10-min TTL)       |
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
  number/date formatting in `lib/format.ts`; engine dispatch in `lib/api.ts`;
  market-data route handler in `app/api/market/[ticker]/route.ts` calling
  `lib/server/yahoo.ts`; browser-side cache in `lib/marketData.ts`.
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

- Opening a ticker issues market-data requests to Yahoo Finance's public
  endpoints through the local route handler; nothing else leaves the browser.
  Snapshots are stored only in this browser's `localStorage`.
- AI keys are stored unencrypted in `localStorage`; treat a shared browser profile as
  shared data. Keys are only transmitted to the provider endpoint on the model row.
- Export text is XML-escaped before rendering to XLSX and ASCII-sanitised for the
  PDF content stream.
- There is no authentication layer; add auth (and provider rate limiting) before
  exposing a shared deployment.

## Known gaps / next milestones

- Rate limiting / request throttling on the market-data route for shared deployments.
- Comparable-companies harness with peer selection and Monte Carlo valuation.
- Full M&A pro forma module; LBO tranches and a maintenance-covenant schedule.
- IndexedDB instead of `localStorage` for large project libraries.
