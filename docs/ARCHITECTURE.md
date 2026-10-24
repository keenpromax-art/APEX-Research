# APEX Terminal — Architecture

## System overview

```
+---------------------------+          +----------------------------------+
|  Next.js frontend         |  HTTP    |  FastAPI backend                 |
|  company workspaces,      | -------> |  routers -> services -> engine   |
|  modelling studio, AI     |          |                                  |
|  control center           |          |  yfinance adapter | calc engine  |
+---------------------------+          |  AI gateway       | persistence  |
                                       +-----------------|----------------+
                                                         v
                                                 SQLite / PostgreSQL
```

Principles enforced in code:

1. **Determinism** — every calculation is pure Python in `services/` with unit tests.
   The AI layer proposes text/assumptions; it never produces final numbers.
2. **Single data adapter** — `yfinance_adapter.py` is the only module importing
   `yfinance`. Everything else consumes the normalized JSON schema.
3. **Historical != forecast** — normalized statements (`annual`/`quarterly`) are
   immutable inputs; forecasts and assumptions live in separate structures.
4. **Provider-agnostic AI** — `ai_gateway.py` exposes generate/stream/test over any
   OpenAI-compatible provider; capability flags adapt unsupported features.
5. **Server-side secrets** — API keys are persisted server-side, never returned or
   logged; the UI masks them.

## Data flow: ticker to valuation

```
ticker  ->  YFinanceAdapter.fetch()           RawTickerData (DataFrames)
        ->  normalize_statements()            {annual|quarterly -> [ {period_end, items{canonical: value}} ]}
        ->  compute_metrics()                 ratio table per period (None-safe, aligned by period_end)
        ->  last_historical()                 base-year driver dict
        ->  build_three_statement()           linked IS/BS/CF with revolver and optional cash sweep
        ->  dcf() / reverse_dcf() /          valuation, implied WACC, matrices
            sensitivity_table()
        ->  exports (xlsx/pdf)
```

### Normalized statement schema

Each period: `{ "period_end": "2025-12-31", "items": { "<canonical>": float|null } }`.
Canonical keys (`revenue`, `cost_of_revenue`, `gross_profit`, `operating_income`,
`ebit`, `ebitda`, `net_income`, `tax_expense`, `pretax_income`, `interest_expense`,
`diluted_eps`, `total_assets`, `cash`, `total_debt`, `equity`, `shares_issued`,
`operating_cash_flow`, `capex`, `free_cash_flow`, ...) are mapped in
`normalizer.py` with fuzzy fallback for renamed yfinance line items. Missing values
stay `None` — never silently zero.

### Caching and rate limits

- Process memory cache + persistent pickle cache in `backend/.cache/`.
- Freshness window: `CACHE_TTL_SECONDS` (default 1h).
- Empty responses, timeouts and refresh failures fall back to the last disk snapshot
  with `data_quality.stale = true` and a visible alert.
- Quarantine (5 min) prevents hammering Yahoo during active throttle; the API maps
  this to HTTP 503 with an explanatory message. The quarantine clears on the next
  successful fetch.
- Yahoo's cookie/crumb bootstrap is warmed through a `curl_cffi` browser-impersonating
  session, then handed to yfinance. yfinance remains the statement parser.

### Demo mode

`DEMO` is a synthetic fixture (`services/demo.py`): deterministic statements, 120
daily price points and a price summary. It never calls Yahoo and is always labelled
in the UI and in AI prompts. It exists so the full workflow can be evaluated offline
and so the product can be tested when Yahoo throttles the network.

## AI gateway

`ModelConfig` = name, provider (openrouter|groq|nvidia|openai_compatible), model_id,
base_url, api_key, capabilities {streaming, json_mode, tool_calling}, params, enabled,
source (`db` | `env`).

- All providers use the OpenAI-compatible `/chat/completions` surface; NVIDIA NIM
  and Groq are OpenAI schema-compatible. Capability flags decide whether
  `response_format=json_object` is sent (fails over to plain text on 400).
- Connection test issues a minimal completion and reports latency/error.
- Generation retries 429/5xx with exponential backoff, then surfaces a typed
  `AIProviderError`/`AITimeoutError`. Streaming is available over SSE.
- Models added in the UI persist in `ai_provider_configs`; env keys seed built-in
  provider rows at startup. Env-sourced models are protected from edit/delete in the
  API (HTTP 409) and are shown as read-only in the UI.

## Research pipeline (AI)

`POST /api/ai/research` runs a single structured-call pipeline: fetch normalized
data -> build a prompt containing *only verified metrics* -> request a JSON report
with fixed sections -> parse -> persist a `research_jobs` row. The job records
status, progress, result and error.

`POST /api/ai/research/stream` exposes the same pipeline over Server-Sent Events
(`status`, `token`, `done`, `error`). `GET /api/ai/jobs` and `/api/ai/jobs/{id}`
expose job history. A malformed model response is stored as narrative text rather
than crashing the request. AI never mutates the deterministic metric payload.

## Persistence

SQLAlchemy models (`projects`, `saved_models`, `ai_provider_configs`,
`research_jobs`, `audit_log`). Projects and saved models expose full CRUD; saved
models store assumptions and results separately so a snapshot never silently
changes when new market data arrives. Writes append to the audit log. SQLite is the
zero-setup default; set `DATABASE_URL=postgresql+psycopg://...` and install
`psycopg[binary]` for Postgres. Migrations via Alembic are recommended before
production.

## Frontend structure

- App Router pages: `/` research home, `/company/[ticker]` workspace with ten tabs
  (Overview, Business, Statements, History, Forecast, Valuation, Sensitivity,
  Risks, Report, Sources), `/company` company index, `/modelling` LBO/options/bond/
  WACC studio, `/ai` control center, `/library`, `/settings`.
- `components/Shell.tsx` persistent desktop+mobile shell with ticker search and
  Ctrl/Cmd-K focus; `ThemeProvider` persists dark/light in `localStorage` with a
  pre-hydration boot script.
- Shared primitives in `components/ui.tsx`; charts in `components/charts.tsx`;
  number/date formatting in `lib/format.ts`; fetch/error handling in `lib/api.ts`.
- Design tokens in `app/globals.css` (dark/light palette, tabular numerals).

## Security

- CORS restricted to configured origins.
- Input validation via Pydantic for every JSON body; invalid numeric input returns
  422 instead of silently coercing to zero.
- Secrets: env vars for dev; `ai_provider_configs.api_key_encrypted` stores the
  server-side key; list responses only expose `has_key` booleans. Env-sourced
  models cannot be mutated through the API.
- Export text is XML-escaped before rendering to XLSX/PDF.
- The app has no authentication layer; do not expose it directly to the internet
  without adding auth and TLS.

## Known gaps / next milestones

- Alembic migrations + Postgres integration tests; authentication and per-user
  workspaces.
- Comparable-companies harness with peer selection and Monte Carlo valuation.
- Full M&A pro forma module; LBO tranches and a maintenance-covenant schedule.
- Redis-backed job queue with cancellation for long research runs.
