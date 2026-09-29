# Equity Research Engine

An AI-native equity research engine — now a **TypeScript / Next.js** app that deploys
on Vercel. Enter any public ticker: the system retrieves Yahoo Finance data, computes
deterministic financial metrics, and lets AI reason over the numbers to produce a
dynamically structured analysis.

**Data-driven · AI-native · Format-agnostic · Company-agnostic · Provider-agnostic**

## How it works

```
ticker → yfinance (Python function) → normalize → calculate → AI context → AI analysis → validate → render
```

1. **Fetch** — a small Python serverless function (`api/fetch/[ticker].py`) is the only
   place yfinance is called (Vercel supports polyglot projects)
2. **Normalize** — one internal `FinancialData` model with full provenance
3. **Calculate** — deterministic metrics (growth, margins, ROE, FCF, multiples, volatility, …)
4. **Analyze** — a single AI call over one coherent context package
5. **Validate** — machine-checked output: every number must trace to the dataset
6. **Render** — a generic block renderer (headings, metrics, tables, charts, callouts, …)

There is no fixed report format. The AI decides what matters and how to organize it.

## Quickstart

```bash
npm install
cp .env.example .env.local   # optional: server-side AI keys (or use the in-app key modal)
npm run dev                  # → http://localhost:3000
```

Enter a ticker (`RELIANCE.NS`, `AAPL`, `NVDA`, `MSFT`, `TCS.NS`, …) or several
(`AAPL, MSFT` for comparison). No company-specific code anywhere — the same engine
serves every ticker.

## Deploy on Vercel

```bash
npx vercel
```

The project is Vercel-ready: Next.js frontend + Python serverless function for the
yfinance data layer (`vercel.json` configures the Python runtime). Set the AI provider
keys in the Vercel environment variables, or use the in-app settings modal (keys are
stored only in your browser and never persisted server-side).

## Architecture

| Area | File | Responsibility |
|---|---|---|
| yfinance function | `api/fetch/[ticker].py` + `python_lib/adapter.py` | the only module that calls yfinance |
| normalizer | `lib/normalizer.ts` | raw data → `FinancialData` + provenance |
| calculator | `lib/calculator.ts` | deterministic metrics (code calculates, AI interprets) |
| context | `lib/context.ts` | one coherent AI context package + data quality |
| AI engine | `lib/engine.ts` | the single analysis call |
| providers | `lib/providers.ts` | `AIProvider` interface: Gemini, OpenRouter, Groq |
| validator | `lib/validator.ts` | block schema + no-hallucinated-numbers guarantee |
| types | `lib/types.ts` | the rendering protocol (not a report template) |
| analysis API | `app/api/analyze/route.ts` | orchestration + SSE status streaming |
| UI | `app/`, `components/` | Next.js frontend with generic block renderer |

## AI providers

Set in `.env.local` (or per-request via the in-app settings modal):

| Provider | Env vars | Default model |
|---|---|---|
| Gemini | `GEMINI_API_KEY`, `GEMINI_MODEL` | `gemini-3-flash-preview` |
| OpenRouter | `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` | `google/gemini-flash-1.5` |
| Groq | `GROQ_API_KEY`, `GROQ_MODEL` | `qwen/qwen3.8-27b` |

Select with `AI_PROVIDER=gemini|openrouter|groq`.

## Numerical integrity

- The AI never invents numbers. Every number in the output is machine-checked against
  the raw yfinance data or the deterministic derived metrics.
- Metric blocks reference a `metricKey` into the derived-metrics map; the validator
  re-checks the value.
- Chart blocks reference named series; the backend resolves them to real data.
- Text numbers are extracted and verified against the known-values set (with tolerance
  for rounding and formatted variants like `1.2B`, `18%`, `1.5x`).
- Invalid output is rejected and the AI is asked to fix it (one retry), then fails clearly.

## API

`GET /api/analyze?tickers=AAPL,MSFT&request=Compare+these` — Server-Sent Events stream:

```
event: status   data: "Fetching data..."
event: status   data: "AI analyzing..."
event: result   data: {"title": "...", "summary": "...", "blocks": [...], "meta": {...}}
event: error    data: {"message": "...", "status": 502}
```

Optional per-request provider override: `&provider=groq&key=...`

## Testing

```bash
npm test                  # vitest: calculator, validator, pipeline (26 tests)
python -m pytest tests/test_adapter.py -q   # yfinance adapter (3 tests)
```

Covers: deterministic calculations, numerical provenance (hallucination rejection),
output schema, ticker parsing, and the yfinance adapter (valid/empty/NaN data).

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `AI_PROVIDER` | `gemini` | which AI provider to use |
| `AI_TIMEOUT_SECONDS` | `120` | AI call timeout |

## Principles

- Code calculates numbers; the AI interprets them.
- The data layer never knows how the AI writes; the AI never invents data;
  the renderer never invents content.
- Missing data is reported as missing — never fabricated.
- Small, cohesive modules. One source of truth per concept.

> Academic / demonstration project. Not investment advice.
