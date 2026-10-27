# APEX Terminal

Institutional-grade AI equity research, financial modelling and valuation platform —
running entirely in your browser.

APEX Terminal takes you from a ticker to a full research workflow: analyze historical
statements, build a linked three-statement forecast with a cash revolver, run
DCF / reverse DCF / sensitivity analysis, use advanced models (LBO, options, fixed
income), save projects and model snapshots, generate a versioned research note, and
export Excel/PDF deliverables.

There is no backend: the Next.js app carries the whole engine. Financial figures are
produced by deterministic TypeScript in `frontend/lib/api.ts`; AI providers are
optional (OpenRouter, Groq, NVIDIA NIM, any OpenAI-compatible endpoint) and write the
narrative only. Projects, models and report versions live in this browser's
`localStorage`, and nothing is uploaded anywhere.

## Overview

| Layer      | Stack                                             |
|------------|---------------------------------------------------|
| App        | Next.js 16 + React 19 + TypeScript + Tailwind 4, Recharts, lucide-react |
| Engine     | In-browser TypeScript: statements, forecast, DCF, sensitivity, LBO, Black–Scholes, bonds |
| Storage    | Browser `localStorage` (projects, models, report versions) |
| Exports    | In-browser PDF 1.4 writer and XLSX writer (`lib/pdf.ts`, `lib/xlsx.ts`) |
| AI         | Optional, provider-agnostic (OpenRouter / Groq / NVIDIA / OpenAI-compatible) |

## Quickstart

Requirements: Node.js 20+ (Node 24 tested). No Python, no database, no API server.

```powershell
cd frontend
npm install
npm run dev
```

The app is now at http://localhost:3000.

1. Open http://localhost:3000 and use **Try demo** (or open `/company/DEMO`).
2. Explore statements and history, then run the forecast and DCF in the company
   workspace. Re-run the forecast with your own assumptions and check the balance check.
3. Open `/modelling` for LBO, option, bond and WACC calculators; save a result.
4. Add an AI key in the AI Control Center to write narratives (optional).
5. Open `/research` to build a versioned institutional note, then download the PDF.
6. Save the project / model, reopen it from the Library, and export XLSX / PDF.

Deploy by hosting the `frontend/` directory on any static-capable Node host
(Vercel, Netlify, a local build). There are no environment variables.

## Repository layout

```
frontend/
  app/                  App Router pages (home, company, modelling, ai, library, research, settings)
  components/           Shell, ThemeProvider, shared UI primitives, charts
  lib/
    api.ts              in-browser engine: statements, forecast, valuation, reports, storage
    exporters.ts        research note -> PDF / XLSX payload assembly
    pdf.ts              minimal PDF 1.4 writer
    xlsx.ts             minimal XLSX (ZIP + OOXML) writer
    format.ts           number, percentage, currency and date formatting
docs/                   ARCHITECTURE.md, MODELS.md (formula reference)
```

## Testing

```powershell
cd frontend
npm run lint        # eslint
npx tsc --noEmit    # typecheck
npm run build       # production build
```

## Limitations

- Real company data comes from Yahoo Finance via the in-browser proxy. The
  provider is retried with bounded backoff until it returns sufficient data
  (identity, price and at least one reported statement period). If it still
  cannot, the report is issued as a preliminary note with rating and target
  withheld — no synthetic, estimated or placeholder figures are ever substituted.
- The only synthetic path is the explicitly labelled local sample (tickers
  `SAMPLE*`, `DEMO`), which is always banner-marked as non-company data.
- Coverage gaps and missing periods are surfaced in the data-quality panel rather
  than zero-filled.
- The three-statement forecast is a driver-based annual model (revenue growth,
  margins, working capital, capex, interest, cash revolver, optional excess-cash
  sweep); LBO is a multi-tranche annual sweep screening model, and peer comps /
  Monte Carlo run over the available provider data.
- AI narrative generation requires a configured provider key, which stays in this
  browser's `localStorage` and is only sent to the endpoint you chose.
- There is no authentication layer: treat a shared browser profile as shared data.
