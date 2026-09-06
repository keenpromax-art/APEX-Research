<div align="center">

# ▲ APEX RESEARCH

### Equity Valuation Terminal

*Type any public ticker. Get an institutional-grade equity research PDF in minutes.*

[![Next.js 15](https://img.shields.io/badge/Next.js-15-black?logo=next.js)](https://nextjs.org)
[![React 18](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![PDF](https://img.shields.io/badge/PDF-%40react--pdf%2Frenderer-E01A22)](https://react-pdf.org)
[![Cloudflare Pages](https://img.shields.io/badge/Edge-Cloudflare_Pages-F68204?logo=cloudflare&logoColor=white)](https://pages.cloudflare.com)
[![Yahoo Finance](https://img.shields.io/badge/Data-Yahoo_Finance-6001D2)](https://finance.yahoo.com)
[![AI](https://img.shields.io/badge/AI-5_Providers-8A63D2)](https://openrouter.ai)

**Live Yahoo data · Deterministic valuation engine · 6-agent LLM narratives · Machine-checked QA · No paid data keys**

[Quickstart](#run-it) · [Sample reports](#sample-outputs) · [How scoring works](#how-scoring-works) · [Backtesting](#backtesting) · [BYOK](#bring-your-own-ai-key)

</div>

---

## Sample outputs

| Report | Call | Price → Fair value |
|--------|------|--------------------|
| [`1788519619311.md`](1788519619311.md) — Cipla Ltd (NSE) | SELL | Rs. 1,415 → Rs. 1,019 |
| Swiggy `SWIGGY.NS` | HOLD | Rs. 276 → Rs. 311 · 24 sections / ~38 printed pages |

**Try it:** `npm run dev` → search `SWIGGY.NS` or `CIPLA.NS` → watch the analysts work live → download the PDF. Or open `/backtest` to inspect model win-rates first.

---

## Contents

- [Why this exists](#why-this-exists)
- [Demo flow](#demo-flow)
- [What the PDF contains](#what-the-pdf-contains)
- [How scoring works](#how-scoring-works)
- [AI architecture](#ai-architecture)
- [Bring your own AI key](#bring-your-own-ai-key)
- [Data coverage](#data-coverage)
- [Backtesting](#backtesting)
- [Event intelligence](#event-intelligence)
- [Project tour](#project-tour)
- [Architecture](#architecture)
- [Run it](#run-it)
- [Testing](#testing)
- [Limitations](#limitations)
- [Credits](#credits)

---

## Why this exists

Real equity dossiers take analysts days and Bloomberg-grade data. This terminal turns any public ticker into a 24-section A4 dossier: DCF valuation, DuPont, 5-year statements, peer comps, credit scorecard, moat and Five Forces, catalysts, governance, plus a machine-checked QA page — and then lets you backtest whether its calls actually worked.

Three hard problems, solved with deterministic-core-plus-LLM-prose:

1. **Free data is messy** — newly listed names return `Revenue 0`, negative EBITDA breaks multiples. Solved with `ratio-guards.ts` (`N/M` instead of `276x P/E`), financial validation, and unit normalization.
2. **LLMs hallucinate** — wrong numbers, wrong sectors (e.g. describing a food-delivery firm as a chipmaker). Solved with a single-source `assumptions-ledger.ts`, a sector ontology with forbidden concepts, a master facts layer (`report-facts.ts`) with validator gates, and an AI sanitizer that cannot override numbers.
3. **Valuation must reconcile** — one fair value, one WACC, one rating everywhere. Solved with an 11-check QA suite including 5 BS-detectors (credit on losses, dividend on losses, margin inversion, sector bleed, cloned peers).

> Academic / demonstration project. **Not investment advice.** Every PDF carries statutory disclaimers.

---

## Demo flow

```text
Landing → Search "SWIGGY.NS"  (Yahoo autocomplete, /api/search)
        → /api/company         (financials → archetype → valuation → ledger → peers → news)
        → /api/analyze?stream  (6 agents in parallel, SSE: agent_start / agent_complete / done)
        → ReportDocument       (star rating, 10-column KPI strip, 24 sections, QA page)
        → Download PDF
        → /backtest            (win-rate dashboard: filter by sector / rating / region)
```

Landing ships with quick chips: `SUZLON.NS · RELIANCE.NS · AAPL · NVDA · TCS.NS · MSFT · CIPLA.NS`. Every request is validated (`request-validation.ts`); every report must pass `report-validator.ts` before it renders.

---

## What the PDF contains

24 logical sections (dense tables paginate to ~30–38 printed pages):

| # | Section | # | Section |
|---|---------|---|---------|
| 1 | Cover: thesis, star rating, P/FV, 10-col KPI, vitals, yield, float, returns, news pulse | 13–15 | Income / Balance / Cash Flow multi-year (Millions) |
| 2 | Fundamental and Valuation: scenarios + sensitivity grids | 16–17 | Comps: valuation / returns / growth + profitability / leverage / DuPont |
| 3–4 | Moat and P/FV + Sources and Five Forces | 18–19 | Methodology: 3-stage DCF + uncertainty / star bands |
| 5 | Bulls / Bears + catalysts and exit triggers | 20–21 | Credit framework + scorecard (4-pillar, CDS, covenants) |
| 6–7 | Credit: cash cushion + capital structure / risk matrix | 22 | Statutory disclosures |
| 8–9 | Management and governance + capital allocation | 23–24 | AI safe harbor + QA checksum (11 checks, score) |
| 10–12 | Notes archive I/II + forecasts summary | | |

Every section carries a masthead (`company · ticker · stars`), a KPI strip (`Last / Fair / Buy / Sell / Uncertainty / Moat / Trend / Stewardship / Credit / Industry`), and a fixed disclosure footer.

---

## How scoring works

No single score — six deterministic scores unified in `assumptions-ledger.ts`:

- **Valuation → rating + stars.** 5-year FCFF → Gordon terminal (`g = 4%`) → mid-year discount at CAPM WACC (`rf 6.85% + β·6%`, Blume-adjusted beta, +200bps distress / +150bps platform spread, clamped 8.5–16%, TV capped at 25x FCFF) → `FV = (EV − NetDebt) / Shares`. Banks, NBFCs, and insurers route to residual-income justified P/B (`(ROE−g)/(Ke−g)`, `g = 5%`, P/B floored 0.4x / capped 4.5x) instead of FCFF — FCFF is invalid when deposits are operating inventory. Rating is pure math: `upside = FV/CMP − 1` → `BUY` above +12%, `SELL` below −12%, else `HOLD`, `NR` if FV is invalid or upside exceeds +150%/−80%. Stars from P/FV: ≤0.70 = 5, ≤0.88 = 4, ≤1.12 = 3, ≤1.30 = 2, else 1. Sector-relative calibration (z-score, deciles, information coefficient) is layered on top for context, never to override the rating.
- **Scenarios.** `Bull = FV×1.25`, `Base = FV`, `Bear = FV×0.75` at 25/60/15 weights; implied returns always `(target/CMP) − 1`; probability-weighted expected price shown. Reverse-DCF backs out the growth the *market* price implies, so over-optimism is visible.
- **Moat.** Points engine (`moat.ts`: spread over WACC, margin stability, network/switching/cost/IP pillars, leverage penalty → Wide ≥75 / Narrow ≥50 / else None) overlaid with ROE/ROIC-vs-WACC rules, industry priors, and archetype overrides.
- **Credit.** Strict archetype table (`company-archetype.ts`): distressed → CCC/B, burning platforms → BB-, cyclicals by NetDebt/EBITDA, mature compounders up to AAA, large banks AAA.
- **Uncertainty.** Dedicated engine (`uncertainty.ts` + ledger model) blending beta, valuation gap, leverage, earnings volatility, data completeness, cyclicality, and terminal-value concentration → Low / Moderate / High / Very High (N/A when valuation is invalid).
- **QA integrity.** `report-qa.ts`: `score = 100 − 15×FAIL − 5×WARN` across rating, DCF bridge, ledger match, balance sheet, ratios, narrative, and five BS-detectors. AI text is forbidden from changing any of these numbers.

---

## AI architecture

**Primary: 6 personas in parallel** (`src/lib/openrouter.ts`): strategist, news, moat, forensic, credit, governance. JSON-only, merged over the deterministic PE base. Ticker news (≤8 items, relevance-filtered) feeds the models and the cover News Pulse. Multi-model failover with 25s timeout; SSE streaming supported.

**Fallback: PE Firm Engine** (`src/lib/pe-analysis-engine.ts`). Always built first and fills any null agent. Sector-routed (`platform_gig_economy`, telecom, software/hardware, renewables, energy, financial-data, banks, pharma, FMCG, auto, industrials) with thesis pillars, moat durability, Five Forces, catalysts, credit, and governance — so the PDF is never empty, even with no AI key.

---

## Bring your own AI key

No server key required. Click the key button in the terminal to open the provider modal (`ApiKeyModal`), pick from five providers — **OpenRouter, NVIDIA NIM, Google Gemini, Groq, OpenAI** (`ai-providers.ts`, each with defaults, free-tier notes, and failover candidates) — paste a key, and hit **Test** (`/api/test-key` validates it live, including rate-limit detection). Keys persist in `localStorage` only, are sent per-request, and every analysis call retries on the next model when rate-limited.

```env
# Server-side defaults (optional — the modal overrides per browser)
OPENROUTER_API_KEY=sk-or-v1-xxxx
OPENROUTER_MODEL=minimax/minimax-m3:free
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

---

## Data coverage

Yahoo Finance modules: `assetProfile, summaryDetail, financialData, defaultKeyStatistics, income/balance/cashflow (+quarterly), majorHoldersBreakdown, institutionOwnership, price`. Zero paid keys.

NASDAQ/NYSE (`AAPL, MSFT, NVDA`) · NSE/BSE (`RELIANCE.NS, TCS.NS, CIPLA.NS, SWIGGY.NS`) · LSE/Euronext/SIX/TSE/HKEX (`AZN.L, ASML.AS, 7203.T, 0700.HK`).

Peers are geography- and sector-mapped in `api/company/route.ts` (e.g. India pharma → `SUNPHARMA / CIPLA / DRREDDY / LUPIN`; Swiggy/Zomato → `ZOMATO / DELHIVERY / NAUKRI / JUSTDIAL`; banks → `HDFCBANK / ICICIBANK / KOTAK / SBIN`).

---

## Backtesting

Two harnesses, same ±12% judging rule (`BUY` wins above +12%, `SELL` below −12%, `HOLD` inside the band; `NR` is exempt):

- **In-app dashboard — `/backtest`.** `BacktestDashboard` + `/api/backtest` over a curated historical record set: filter by sector, rating, and region; summary win-rate, decile performance, Spearman rank correlation, and alpha; per-record verdicts with reasons.
- **Colab harness — `fownloads/backtest_recommendations_colab.py`.** Rewind one year, rebuild the THEN-rating from only statements ending before the signal date (no lookahead; banks via residual income), judge against realized 1-year returns with benchmark excess (`^NSEI` / `^GSPC`). Add tickers in the `EXTRA_TICKERS` box without editing code; saves `backtest_1y_results.csv` with win rate by rating and calibration (correlation, MAE, bias).

---

## Event intelligence

`event-price-engine.ts` turns the news feed into tradable context: each headline is categorized (earnings, M&A, regulatory, product, management, macro…), then mapped to historical price impact, volume surges, and abnormal returns with full trajectories — powering the report's catalyst calendar and exit triggers.

---

## Project tour

| Area | Files | Why it matters |
|------|-------|----------------|
| Dossier | `components/PDFDocument/index.tsx` (~4,800 lines) | The entire 24-section PDF: cover, thesis, moat, credit, governance, statements, comps, methodology, disclosures, QA |
| Data | `lib/yahoo-finance.ts` (~800) | Sole ingress: search, quoteSummary, parsing, peers, company-filtered news |
| Narratives | `lib/openrouter.ts` (~700) + `lib/pe-analysis-engine.ts` (~720) | 6-agent synthesis with failover + zero-API deterministic fallback |
| Valuation | `lib/calculations.ts` + `lib/valuation/` (selector, residual-income, reverse-dcf, calibration) | Ratios, DuPont, Blume WACC, 3-stage DCF with TV cap; bank P/B routing; implied-expectations check |
| Guardrails | `company-archetype.ts` · `assumptions-ledger.ts` · `report-qa.ts` · `report-facts.ts` · `report-validator.ts` · `ratio-guards.ts` · `financial-validation.ts` · `units.ts` | Archetypes, single-source ledger, 11-check QA, facts layer, gates, `N/M` guards |
| Knowledge | `lib/sectors/` · `lib/moat.ts` · `lib/uncertainty.ts` · `lib/scenarios.ts` · `lib/recommendation.ts` | Sector ontology with forbidden concepts, moat points, uncertainty, scenario math, ±12% rating law |
| Proof | `lib/backtest/` + `app/backtest/` + `app/api/backtest/` | Win-rate engine, dashboard, filterable API |
| Access | `lib/ai-providers.ts` + `components/ApiKeyModal.tsx` + `app/api/test-key/` | 5-provider BYOK with live validation |

---

## Architecture

```text
Next.js 15 (App Router, nodejs runtime)
├── app/page.tsx                        terminal landing
├── app/backtest/page.tsx               win-rate dashboard
├── app/report/[ticker]/                report + PDF download
├── app/api/search | company | analyze  autocomplete · valuation pipeline · 6 agents (SSE)
├── app/api/backtest | test-key         backtest metrics · live key validation
├── lib/yahoo-finance · calculations · openrouter · pe-analysis-engine
├── lib/valuation (selector, residual-income, reverse-dcf, calibration, index)
├── lib/sectors (types, profiles, index) · moat · uncertainty · scenarios · recommendation
├── lib/company-archetype · assumptions-ledger · report-facts · report-validator
├── lib/report-qa · ratio-guards · financial-validation · units · request-validation
├── lib/ai (sanitizer) · ai-providers · event-price-engine
├── lib/backtest (types, data, engine, index)
├── components/PDFDocument · BacktestDashboard · ApiKeyModal · SearchBar · ProgressTracker
├── fownloads/backtest_recommendations_colab.py
├── scratch/test-golden-regression.mjs + test-ai-provider.mjs
└── @opennextjs/cloudflare → Cloudflare Pages
```

---

## Run it

Requires Node 18.17+ (20 recommended) and optionally a free provider key ([OpenRouter](https://openrouter.ai/keys) or [NVIDIA build](https://build.nvidia.com/explore/discover)).

```bash
git clone https://github.com/your-username/equity-research-generator.git
cd equity-research-generator
npm install
cp .env.example .env.local   # add a provider key, or use the in-app modal instead
npm run dev                  # → http://localhost:3000
```

| Command | Purpose |
|---------|---------|
| `npm run dev` | Local terminal |
| `npm run build` | Next + OpenNext Cloudflare build |
| `npm run preview` | Local Wrangler Pages simulation |
| `npm run deploy` | Build + deploy to Pages |
| `npm run lint` / `npx tsc --noEmit` | Lint / typecheck |
| `npm test` / `npm run test:golden` | Golden regression + AI provider tests |

Cloudflare Pages: build `npx @opennextjs/cloudflare build`, output `.open-next/assets`, env `OPENROUTER_API_KEY` · `OPENROUTER_MODEL` · `NODE_VERSION=20`.

> Build flakiness note: on Windows, `next build` occasionally fails with `Cannot find module './XXX.js'` (changing chunk ID each run) during static-page collection — a file-locking race, not a code error. Fix: delete `.next` and rebuild; it passes on retry. If persistent, exclude the folder from antivirus scanning.

---

## Testing

- `npm run test:golden` — deterministic regression over valuation, ledger, QA, and sector guards.
- `npm test` — golden suite plus AI provider checks.
- `/backtest` + Colab harness — out-of-sample checks of THEN-ratings vs realized returns (win rate, deciles, Spearman IC).

---

## Limitations

- No database; reports generate on demand. Yahoo is unofficial — quotes are delayed and newly listed names can have gaps (e.g. `Revenue 0` → CAGR artifact, flagged in-report; verify pre-IPO names manually).
- Tables take precedence over prose; LLMs can still err — the mandatory AI disclosure applies.
- Historical beta/shares in the backtest fall back to current values where point-in-time data is unavailable.
- Non-registered academic/demonstration software — not investment advice.

Good first contributions: broader peer maps, extra sector blocklists, stricter `N/M` enforcement in comp tables, DDM/SOTP models, PDF charts, larger backtest universe.

---

## Credits

Yahoo Finance · OpenRouter / NVIDIA / Gemini / Groq / OpenAI · `@react-pdf/renderer` · Cloudflare + OpenNext · Next.js. Methodology: Damodaran, McKinsey Valuation, CFA Institute.

> **Disclaimer — education and demo only, not investment advice.** Verify everything, do your own diligence, consult a qualified advisor. Past performance does not predict future results.
>
> **APEX RESEARCH — if useful, please star the repo.**
