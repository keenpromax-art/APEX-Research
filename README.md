# APEX Terminal

Institutional-grade AI equity research, financial modelling and valuation platform.

APEX Terminal takes you from a ticker to a full research workflow: retrieve historical
statements (yfinance), analyze historical performance, build a linked three-statement
forecast with a cash revolver, run DCF / reverse DCF / sensitivity analysis, use
advanced models (LBO, options, fixed income), save projects and model snapshots,
generate an AI-assisted research report over SSE, and export Excel/PDF deliverables.

AI is never the calculation engine: every financial number is produced by deterministic,
tested Python code. AI providers are pluggable (OpenRouter, Groq, NVIDIA NIM, any
OpenAI-compatible endpoint) and keys never reach the browser.

A synthetic `DEMO` ticker exercises the entire workflow without calling Yahoo Finance,
so the product can be evaluated offline or while the data provider is throttled.

## Overview

| Layer      | Stack                                             |
|------------|---------------------------------------------------|
| Frontend   | Next.js 16 + React 19 + TypeScript + Tailwind 4, Recharts, lucide-react |
| API        | FastAPI (Python 3.12), Pydantic, SQLAlchemy 2     |
| Data       | yfinance with session + disk cache and rate-limit quarantine |
| Storage    | SQLite by default (zero setup); PostgreSQL via `DATABASE_URL` + `psycopg` |
| AI         | Provider-agnostic gateway (OpenRouter / Groq / NVIDIA / OpenAI-compatible) |
| Exports    | openpyxl (XLSX), ReportLab (PDF)                  |

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the system design and
[docs/MODELS.md](docs/MODELS.md) for financial formulas and conventions.

## Quickstart

Requirements: Python 3.12+, Node.js 20+ (Node 24 tested).

### 1. Backend

```powershell
cd backend
pip install -r requirements.txt
copy .env.example .env     # then edit if you have AI keys
python -m uvicorn app.main:app --port 8000
```

The API is now at http://localhost:8000 — interactive docs at http://localhost:8000/docs.

### 2. Frontend

```powershell
cd frontend
npm install
npm run dev
```

The app is now at http://localhost:3000.

### 3. Try it

1. Open http://localhost:3000 and use **Try demo** (or open `/company/DEMO`).
2. Explore statements and history, then run the forecast and DCF in the company
   workspace. Re-run the forecast with your own assumptions and check the balance check.
3. Open `/modelling` for LBO, option, bond and WACC calculators; save a result.
4. Add an AI key in the AI Control Center to generate research reports.
5. Save the project / model, reopen it from the Library, and export XLSX / PDF.

> Yahoo Finance rate limits aggressively. If you hit a throttle the UI shows a clear
> 503 with a retry hint; previously fetched tickers are served from the local cache
> and explicitly flagged as possibly stale.

## Repository layout

```
backend/
  app/
    main.py             FastAPI app, lifespan wiring
    config.py           Settings (env-driven)
    db.py               SQLAlchemy models + session
    exceptions.py       Typed error hierarchy
    routers/
      core.py           company/data/metrics/forecast/valuation/sensitivity/advanced
      ai.py             provider CRUD, connection test, generation, research, SSE, jobs
      export.py         XLSX and PDF exports
      projects.py       projects + saved models (full CRUD)
    services/
      yfinance_adapter.py  the only module allowed to call yfinance
      normalizer.py        statement line-item mapping to canonical schema
      metrics.py           financial ratios (deterministic, period-aligned)
      calc_engine.py       three-statement forecast builder with revolver
      valuation.py         DCF, reverse DCF, WACC, sensitivity
      advanced.py          LBO, Black-Scholes, bond maths
      data_access.py       normalized-data loading and refresh
      demo.py              deterministic DEMO fixture
      ai_gateway.py        provider-agnostic AI gateway
      ai_state.py          gateway singleton + env seeding
  tests/                pytest suites (see Testing)
frontend/
  app/                  App Router pages (home, company, modelling, ai, library, settings)
  components/           Shell, ThemeProvider, shared UI primitives, charts
  lib/                  api client, number/date formatting, class merge
docs/                   ARCHITECTURE.md, MODELS.md
```

## Testing

Backend (from `backend/`):

```powershell
python -m pytest -q
```

Suites cover DCF, reverse DCF, WACC and sensitivity maths, Black–Scholes prices and
Greeks, bond price/duration/convexity, LBO schedule identities, metric formulas and
period alignment, revolver/cash-sweep/dilution behaviour in the three-statement
engine, statement normalization, saved-model CRUD, XLSX/PDF bytes, and the HTTP API
via TestClient (Yahoo is mocked; no live API keys are required for tests).

Frontend:

```powershell
npm run lint        # eslint
npx tsc --noEmit    # typecheck
npm run build       # production build
```

## Configuration

All configuration is environment-driven — see `backend/.env.example`. Provider keys
are read server-side only and never returned to the client; models added via the AI
Control Center are stored server-side (SQLite/Postgres) and masked in every list
response. Models seeded from `.env` are read-only in the UI and protected from
edit/delete by the API.

## Limitations

- Data coverage matches what Yahoo Finance exposes per ticker; missing periods and
  line items are surfaced in the data-quality panel rather than zero-filled.
- The three-statement forecast is a driver-based annual model (revenue growth,
  margins, working capital, capex, interest, cash revolver, optional excess-cash
  sweep) — not a tranche-level debt schedule.
- LBO is a single-tranche annual sweep screening model; M&A, peer comps and Monte
  Carlo are on the roadmap.
- Research reports require at least one configured AI model. Streaming is supported
  by the API; the current UI uses the non-streaming endpoint.
- There is no authentication layer. Run locally or add auth/TLS before exposing the
  service.
