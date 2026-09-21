# APEX-Research — AI-First Rewrite Plan

## Objective

Redesign APEX-Research into an AI-first institutional equity research system.
The ONLY authoritative factual financial/market data source is **yfinance**.
Everything above it is generated, interpreted, modeled, analyzed, or written by AI.

Core axiom: **AI decides the model. Code executes the model.**

The system must NOT think: "If bank → use bank template."
It must think: "Here is the factual data for this company. Understand the company.
Determine how its economics work. Build the appropriate financial model. Determine
the appropriate valuation. Stress-test it. Write the institutional report."

## Target Architecture

```
USER ENTERS TICKER
      │
      ▼
YFINANCE DATA INGESTION ............ src/lib/ai-first/fact-pack.ts
      │  (raw fact pack; no zero-fill; every fact provenance-tagged)
      ▼
AI COMPANY UNDERSTANDING ........... src/lib/ai-first/company-understanding.ts
      │  (business model, unit economics, drivers, KPIs, what NOT to use)
      ▼
AI MODEL SPECIFICATION ............. src/lib/ai-first/model-builder.ts
      │  (dynamic formulas: Revenue = Vol×ASP, NII = IntInc−IntExp, ...)
      ▼
AI ASSUMPTION GENERATION ........... src/lib/ai-first/assumptions.ts
      │  (justified forward rates grounded in historical facts)
      ▼
DETERMINISTIC FORECAST ENGINE ...... src/lib/ai-first/forecast-engine.ts
      │  (code executes AI formulas; financial statements roll-forward)
      ▼
AI VALUATION SELECTION ............. src/lib/ai-first/valuation-builder.ts
      │  (AI picks DCF / P/BV / Residual Income / SOTP / NAV + rationale)
      ▼
DETERMINISTIC VALUATION ENGINE ..... src/lib/ai-first/valuation-engine.ts
      │  (code computes the numbers; AI never invents the target price)
      ▼
AI SCENARIOS ....................... src/lib/ai-first/scenarios-builder.ts
      │  (Bear/Base/Bull flow through model → statements → valuation)
      ▼
AI REVERSE VALUATION ............... src/lib/ai-first/reverse-valuation.ts
      ▼
AI THESIS / RISKS / CATALYSTS / MOAT  src/lib/ai-first/narrative-builders.ts
      ▼
AI QUALITY REVIEW LOOP ............. src/lib/ai-first/quality-review.ts
      │  (8 AI reviewers + adjudicator; component-level regeneration)
      ▼
AI RESEARCH REPORT OBJECT .......... src/lib/ai-first/research-report.ts
      ▼
PDF RENDERER (renders the object only — never invents content)
```

## Module Classification (Migration Map)

### KEEP — Deterministic Infrastructure

| Module | Rationale |
|---|---|
| `src/lib/ai-providers.ts` | Multi-provider transport, failure classification, key config |
| `src/lib/openrouter.ts` (transport parts) | LLM call plumbing, retry, streaming events |
| `src/lib/agent-team.ts` | `auditCitations` citation gate; transport-injected runner pattern |
| `src/lib/yahoo-finance.ts` | yfinance fetching (strip synthetic injections at reuse sites) |
| `src/lib/calculations.ts` | Deterministic math: ratios, WACC, DCF arithmetic, formatting |
| `src/lib/canonical-forecast.ts` | Deterministic forecast execution engine (re-purposed) |
| `src/lib/financial-kernel.ts` | Model lifecycle, audit graph (deterministic bookkeeping) |
| `src/lib/financial-provenance.ts` | Share-count resolution, market-integrity checks |
| `src/lib/valuation/residual-income.ts`, `reverse-dcf.ts`, `calibration.ts` | Pure valuation calculators |
| `src/lib/units.ts`, `ratio-guards.ts` | Number formatting / reporting units |
| `src/components/PDFDocument/` | Presentation layer (re-targeted at ResearchReport object) |
| `src/lib/accounting-identity-engine.ts` | Balance identity enforcement (deterministic) |
| `src/lib/evidence-registry.ts`, `claim-validator.ts` | Fact provenance plumbing |

### DELETE — Hardcoded Analytical Intelligence (removed after new pipeline verified)

| Module | Why it goes |
|---|---|
| `src/lib/company-archetype.ts` | Hardcoded company archetypes |
| `src/lib/company-ontology.ts` | Fixed required-concept/contamination vocabularies |
| `src/lib/sectors/` (profiles, architectures, types, allowlist) | Hardcoded sector profiles, gates, driver models |
| `src/lib/sector-allowlist.ts` | Sector allowlist |
| `src/lib/research-model/sector-drivers.ts` | Fixed sector driver packs |
| `src/lib/ai/sanitizer.ts` | String-replacement hack; replaced by AI regeneration |
| Hardcoded moat templates in `src/lib/moat.ts` | Fixed five-pillar moat logic (keep rating plumbing only) |
| Sector QA rules in `report-qa.ts` (ONT-01, OM-01 style) | Enforce fixed vocab; replaced by AI reviewers |

### REWRITE — Role redesign around the AI-first pipeline

| Module | New role |
|---|---|
| `src/app/api/company/route.ts` | Fetch → build fact pack → hand to AI-first engine (no sector gate) |
| `src/app/api/analyze/route.ts` | Runs the AI-first agent pipeline instead of 6 fixed personas |
| `src/lib/valuation/selector.ts` | Executes the AI-selected `ValuationSpecification` |
| `src/lib/assumptions-ledger.ts` | Threads AI-generated assumptions into deterministic narratives |
| `src/lib/scenarios.ts` | Executes AI scenario specs through the model |

### NEW — AI-First Modules (`src/lib/ai-first/`)

| Module | Purpose |
|---|---|
| `types.ts` | FactPack, AIResearchModel, Formula, provenance tiers |
| `fact-pack.ts` | Raw yfinance normalization; no zero-fill; FACT_CONTEXT renderer |
| `company-understanding.ts` | AI company/industry/economics understanding |
| `model-builder.ts` | AI-generated formulas + model spec |
| `assumptions.ts` | AI assumption generation with historical evidence |
| `model-runtime.ts` | Safe arithmetic evaluator executing AI formulas |
| `forecast-engine.ts` | Deterministic forecast execution |
| `valuation-builder.ts` | AI valuation method selection + spec |
| `valuation-engine.ts` | Deterministic valuation execution |
| `scenarios-builder.ts` | AI Bear/Base/Bull generation |
| `reverse-valuation.ts` | AI-chosen reverse-engineering variable |
| `narrative-builders.ts` | Thesis, catalysts, risks, competitive, moat (all AI) |
| `quality-review.ts` | 8 AI reviewers + adjudicator + regeneration loop |
| `research-report.ts` | Final ResearchReport object + versioning |

## Implementation Sequence

1. **Fact layer**: types.ts + fact-pack.ts (no code depends on it yet — additive).
2. **Understanding layer**: company-understanding.ts, model-builder.ts, assumptions.ts.
3. **Execution layer**: model-runtime.ts, forecast-engine.ts, valuation-engine.ts.
4. **Narrative layer**: scenarios, reverse-valuation, narrative-builders.
5. **Quality layer**: quality-review.ts with regeneration loop.
6. **Assembly**: research-report.ts + new `/api/analyze-ai-first` route.
7. **Golden regression**: test-ai-first-regression.mjs on SBIN/HDFCBANK/GOOG/AAPL/BYD/TCS/RELIANCE/DELHIVERY/BHARTIARTL.
8. **Cutover**: switch main routes; delete hardcoded intelligence modules; retire stale tests.

## Acceptance Test

The same pipeline receiving SBIN.NS, GOOG, AAPL, BYD, TCS.NS, RELIANCE.NS,
DELHIVERY.NS must dynamically produce materially different business models, KPIs,
forecast drivers, financial models, valuation methods, risks, catalysts, competitive
analyses, and theses — without adding any new hardcoded company/sector rule.

Critical regressions:
- SBIN must NOT produce EBITDA-driven analysis, EV/EBITDA default, or platform concepts.
- GOOG must NOT be forced into a generic industrial DCF.
- BYD must NOT contain bank/FMCG/telecom terminology.

## Implementation Status (2026-09-21)

Implemented (additive, old routes untouched):
- `src/lib/ai-first/pipeline.ts` — ONE dynamic pipeline: fetchQuoteSummary
  (yfinance) -> buildFactPack -> understandCompany -> buildModelSpec ->
  executeForecast -> buildValuationSpec -> executeValuation -> buildScenarios +
  flowScenarioThroughModel -> chooseReverseVariable + solveRequiredValue ->
  buildNarrative -> runQualityReview + adjudicateRegeneration ->
  assembleResearchReport. AI decides the model; code executes it. No imports
  from company-archetype / company-ontology / sectors / sector-allowlist /
  research-model / driver-models / ai/sanitizer (verified by grep; only
  plan comments mention them).
- `src/app/api/analyze-ai-first/route.ts` — POST { ticker|symbol,
  customKeyConfig } with SSE streaming support; runs the pipeline and returns
  the versioned ResearchReport. Mechanical-preview fallback (generic
  revenue-compounding model, confidence 0.2, clearly labeled) when no AI key
  is configured so the route stays functional without a key.
- `npm run test:ai-first` — deterministic suite (37 checks: fact integrity,
  runtime, forecast, valuation, scenarios, reverse, assembly, quality,
  full mechanical pipeline, contamination screen) + mocked-AI acceptance
  (9 checks: SBIN/bank vs GOOG/ads vs BYD/auto produce different
  abstractions, formulas, and valuation methods through the same pipeline).
- Live-LLM golden regression on SBIN/HDFCBANK/GOOG/AAPL/BYD/TCS/RELIANCE/
  DELHIVERY/BHARTIARTL remains pending (requires provider key; run via the
  new route with `x-custom-api-key` once a key is configured).

Cutover (not yet executed, per migration strategy):
- `/api/company` and `/api/analyze` still run the legacy architecture
  (sector gates, archetype, ontology, hardcoded peers, fixed personas).
- Delete/replace of `company-archetype.ts`, `company-ontology.ts`,
  `sectors/`, `sector-allowlist.ts`, `research-model/sector-drivers.ts`,
  `ai/sanitizer.ts`, and sector QA rules is deferred until the live-LLM
  golden regression passes; the AI-first route already bypasses all of them.
