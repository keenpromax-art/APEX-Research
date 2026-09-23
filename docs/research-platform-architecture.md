# APEX Research Platform Architecture

> Phases 1–10 of the multi-report institutional refactor (complete). This
> document records the current (as-is) architecture, the target platform
> architecture, the non-negotiable rules, and the phased migration plan.
> Phase 1 introduces
> `ResearchCase`; Phase 2 attaches it to `/api/company`; Phase 3 adds
> deterministic `research-modules/` wrappers; Phase 4 adds `report-types/`
> blueprints (`institutional_equity_v1` golden-matched to the PDF); Phase 5
> adds the report composer (`research → ComposedReport → PDF`), making the
> renderer presentation-only; Phase 6 adds `ai-orchestration/` — reusable
> roles, a deterministic `ResearchTask` planner, committee gate and red-team
> probes over an injected provider-agnostic transport; Phase 7 adds
> `evidence-graph/` — Source → Evidence → Claim → Analysis → Conclusion →
> Section traceability over the existing registry/claim-validator; Phase 8
> adds `report-types/advanced-blueprints.ts` — 10 specialized report types
> over the same module catalog; Phase 9 adds the report-type + research-depth
> selectors and the Report Outline web view; Phase 10 hardens the whole
> migration (`lint` / `tsc` / `npm test` / `test:golden` / `build` all green)
> — none of these phases change existing report output.

---

## 0. Non-negotiable rules

```text
1.  DO NOT rewrite or replace the existing financial kernel.
2.  DO NOT remove existing QA/guardrails.
3.  DO NOT hardcode company-specific logic.
4.  DO NOT hardcode report-specific numbers.
5.  DO NOT hardcode peers for individual companies (seeds only, gated by similarity).
6.  DO NOT make LLM output the source of truth for financial numbers.
7.  Preserve the canonical facts / assumptions / provenance architecture.
8.  Preserve all existing sector-specific financial architectures.
9.  Every report type must consume the same canonical research data.
10. AI providers must remain interchangeable.
11. Every report must remain deterministic where calculations are concerned.
12. Existing reports must continue working after each refactor step.
13. Do not impose a maximum page count.
14. Report length is determined by report type, company complexity, available
    evidence and materiality — never by a hardcoded cap.
15. Never invent missing information to fill a section.
16. If data is unavailable, explicitly mark it unavailable / N/A / insufficient evidence.
17. Every material numerical claim must be traceable to canonical facts or a calculation.
18. Every qualitative material claim should carry evidence provenance where available.
19. The PDF renderer is a presentation layer, not the research engine.
20. Build incrementally. No giant destructive rewrite.
```

---

## 1. Current architecture (as-is)

```text
Ticker
  ↓
Yahoo / cross-check data            (/api/company)
  ↓
Company classification              company-archetype, sectors/profiles, company-ontology
  ↓
Financial architecture              sectors/architectures (A–E), statement unions
  ↓
Ratios / DuPont                     calculations.ts
  ↓
Valuation                           valuation/ (selector, reverse-dcf, residual-income, sotp, calibration)
  ↓
Canonical facts / assumptions       canonical-facts, assumptions-ledger, canonical-forecast, canonical-report
  ↓
Evidence / reconciliation           evidence-registry, source-reconciliation, independent-validator
  ↓
6 AI personas + PE fallback         openrouter, pe-analysis-engine, ai-providers (5-provider failover)
  ↓
QA / publication gates              report-qa, report-validator, publication-gate, valuation-audit, data-confidence
  ↓
24-section PDF                      components/PDFDocument/index.tsx
```

Key observations:

- The **report is currently the endpoint** of the architecture.
- Canonical machinery already exists and is production-grade: sealed fact
  graph, single assumptions ledger, evidence IDs (`EV:<TIER>:<SOURCE>:<FIELD>`),
  sector ontology with forbidden concepts, 11-check QA, publication gate.
- The AI layer already has writer/checker loops, sector guardrails, and
  multi-provider failover. These must be preserved and made reusable — not
  replaced.

---

## 2. Target architecture

```text
                         APEX RESEARCH CORE
                                │
             ┌──────────────────┼──────────────────┐
             ↓                  ↓                  ↓
        DATA LAYER        RESEARCH LAYER      ANALYTICS
             │                  │                  │
             └──────────────────┼──────────────────┘
                                ↓
                         RESEARCH CASE
                                ↓
                      REPORT TYPE PLANNER
                                ↓
                      MODULE SELECTION
                                ↓
                         AI RESEARCH
                                ↓
                           QA / RED TEAM
                                ↓
                       REPORT COMPOSITION
                                ↓
                    ┌───────────┼────────────┐
                    ↓           ↓            ↓
                 PDF        Web Report   JSON/API
```

Conceptual change:

```text
Before:   Ticker → Report
After:    Ticker + Research Objective + Report Type + Research Depth
            → RESEARCH CASE → RESEARCH PLAN → EVIDENCE → ANALYSIS
            → VALUATION → RED TEAM → QA → REPORT
```

---

## 3. Module map (target)

```text
APEX
├── DATA          providers · normalization · reconciliation · provenance
├── FINANCIAL     financial-kernel · statements · ratios · sector architectures · identities
├── VALUATION     DCF · reverse-DCF · comps · SOTP · residual income · NAV · DDM
├── RESEARCH CORE ResearchCase · planner · complexity · modules · evidence · claims · thesis · risks · catalysts
├── AI            providers · roles · tasks · committee · red-team · writer/checker
├── QA            data · accounting · financial · valuation · evidence · narrative · sector · publication
├── REPORTS       blueprints · composer · sections · formats
└── UI            search · report selector · research depth · progress · viewer
```

---

## 4. Phase 1 — ResearchCase (DONE) · Phase 2 — Wire (DONE) · Phase 3 — Modules (DONE) · Phase 4 — Blueprints (DONE) · Phase 5 — Composer (DONE) · Phase 6 — AI orchestration (DONE) · Phase 7 — Evidence graph (DONE) · Phase 8 — Advanced report types (DONE) · Phase 9 — Report UI (DONE) · Phase 10 — Hardening (DONE)

### New files

| File | Purpose |
|------|---------|
| `src/lib/research-case/types.ts` | `ResearchCase`, architecture, peer set, research domains, unknowns, data quality, builder params |
| `src/lib/research-case/complexity.ts` | Deterministic 10-dimension complexity engine (`LOW/MEDIUM/HIGH/VERY_HIGH`) |
| `src/lib/research-case/builder.ts` | `buildResearchCase(params)` — references existing canonical objects; derives only missing optional pieces via existing engines |
| `src/lib/research-case/index.ts` | Module entry point |
| `scratch/test-research-case.ts` | Unit tests: construction, complexity, missing data, sector architecture, canonical-facts preservation, immutability, determinism |
| `src/lib/research-modules/types.ts` | Module contract, `ModuleContext`, typed module data slices |
| `src/lib/research-modules/anchors.ts` | Single-source anchor hierarchy (ledger → masterReportFacts → dcf) for FV/rating/moat |
| `src/lib/research-modules/modules.ts` | 9 deterministic wrapper modules (business, statements, valuation, peers, moat, risk-catalyst, management, quality, thesis) |
| `src/lib/research-modules/runner.ts` | `runResearchModules` — ordered, non-blocking, fail-closed |
| `src/lib/research-modules/index.ts` | Module entry point |
| `scratch/test-research-modules.ts` | Pass-through identity, anchor hierarchy, missing-data, determinism, bank architecture |
| `src/lib/report-types/types.ts` | `ReportBlueprint`, TOC/section contracts, depth modes, outline resolution types |
| `src/lib/report-types/institutional-equity.ts` | `institutional_equity_v1` — golden TOC + PDF render order |
| `src/lib/report-types/planned-blueprints.ts` | Skeletons: tearsheet, valuation dossier, earnings deep-dive, forensic (`status: planned`) |
| `src/lib/report-types/resolve.ts` | `resolveReportOutline` — depth + research-debates gates (pure) |
| `src/lib/report-types/registry.ts` | Blueprint registry |
| `src/lib/report-types/index.ts` | Report-types entry point |
| `scratch/test-report-blueprints.ts` | Golden TOC/render-order match vs PDF; module wiring; no page caps |
| `src/lib/report-composer/types.ts` | `ComposedReport`, `ComposeReportInput`, `PdfComponentName` |
| `src/lib/report-composer/compose.ts` | `composeReport` / `composeReportFromData` — outline + module references |
| `src/lib/report-composer/index.ts` | Report-composer entry point |
| `scratch/test-report-composer.ts` | Golden outline, reference identity, debates gate, ReportData wire, fail-closed |
| `src/lib/ai-orchestration/types.ts` | `ResearchTask`/plan/committee/red-team contracts; `COUNCIL_PASS_THRESHOLD` mirror; re-exports `WRITER_CHECKER_MAX_ATTEMPTS` |
| `src/lib/ai-orchestration/roles.ts` | `RESEARCH_ROLES` catalog — references `AI_AGENT_PERSONAS`, `AGENT_TEAM_ROSTER`, `QUALITY_REVIEWER_NAMES` |
| `src/lib/ai-orchestration/transport.ts` | `OrchestrationTransport` + adapters over the four existing transport shapes (no fetch / no provider branch) |
| `src/lib/ai-orchestration/planner.ts` | `buildResearchTasks` — deterministic plan → author → checker → red-team → committee graph |
| `src/lib/ai-orchestration/committee.ts` | `runCommitteeReview` — folds existing QA + council audit + red-team blockers |
| `src/lib/ai-orchestration/red-team.ts` | 7 deterministic probes + optional LLM adversary via injected transport |
| `src/lib/ai-orchestration/index.ts` | AI-orchestration entry point |
| `scratch/test-ai-orchestration.ts` | Role catalog, transport adapters, planner graph, committee gate, red-team probes, provider interchangeability |
| `src/lib/evidence-graph/types.ts` | `EvidenceGraph` stages/nodes/edges, `ClaimTrace`, narrative input, exit criterion fields |
| `src/lib/evidence-graph/build.ts` | `buildEvidenceGraph` / `traceClaimPath` — pure Source→…→Section graph over registry + claim-validator + outline |
| `src/lib/evidence-graph/index.ts` | Evidence-graph entry point |
| `scratch/test-evidence-graph.ts` | Stage wiring, claim-validator reuse, material-claims exit, fail-closed, determinism, purity |
| `src/lib/report-types/advanced-blueprints.ts` | 10 stable blueprints (industry, competitive, management, risk, sotp, bank, insurance, reit, special situation, portfolio) + `ADVANCED_BLUEPRINTS` |
| `scratch/test-advanced-blueprints.ts` | Golden TOC/section order (concise+full), module wiring, purity, determinism, composer compatibility, regression of existing types |
| `src/lib/report-types/selector.ts` | Phase 9 selector helpers — `selectableReportTypes` (stable only), fail-closed `parseReportTypeParam`/`parseDepthParam`, `buildReportQuery`, `reportTypeTitle` |
| `src/components/ProgressTracker/steps.ts` | Pure `buildProgressSteps(reportTitle)` — steps 03–05 + council header carry the selected blueprint title (per-report-type progress labels; steps 01–02 stay shared) |
| `src/lib/ai-orchestration/live-progress.ts` | Phase B — pure `derivePlanProgressTasks(plan, { phase, agentCheckpoints, redTeam, committee })`: maps the deterministic ResearchTask graph + real pipeline events to display rows (authors follow council personas, checkers follow the verifier, blocked tasks stay blocked, red-team/committee rows carry their real results) |
| `scratch/test-report-ui.ts` | Selector options, fail-closed query parsing, query round-trip, compose honouring type/depth (re-compose contract), institutional pdfComponent regression |
| `.eslintrc.json` | Phase 10 — `next/core-web-vitals` config (root cause of the previously hanging interactive `next lint` prompt); 0 errors after fixes |

### Design decisions

**Reference, don't copy.** When the pipeline already built a canonical object
(canonical facts, assumptions ledger, valuation, evidence registry, data
confidence, ontology, scenarios), the builder stores the *same reference*. It
never clones, recomputes, or forks those values.

**Derive only what's missing, through existing engines.** If an optional input
is absent, the builder calls the *existing* engine — `buildCanonicalFacts` +
`sealCanonicalFacts`, `createAssumptionsLedger`, `buildScenarioSet` (same call
shape as `report-facts.ts`), `buildEvidenceRegistryFromInputs`,
`assessDataConfidence`, `buildCompanyOntology` / `classifyArchetype`. There is
no second implementation of any calculation.

**Never invent.** Missing valuation/ledger/scenarios/research stay `null`.
Gaps are recorded as `ResearchUnknown` entries (`source: "data-gap"`) and
`DataQualityAssessment.blockers` (`NO_VALUATION`, `NO_ANNUAL_FINANCIALS`, …).
AI confidence is `null` unless a research report actually supplied it.

**Deterministic complexity only.** `assessResearchComplexity` is a pure
function of structural inputs (segments, geography/cross-listing, statement
architecture A–E, financial archetype, debt, M&A/intangibles, regulation,
history depth, peer coverage/suppression, data grade). No LLM scores.

**No behavioral change (Phase 1).** Phase 1 did not touch `/api/company`,
`ReportClient`, `PDFDocument`, or any QA gate. Existing report output was
byte-for-byte unaffected.

**Phase 2 — wire, still additive.** `/api/company` now builds `researchCase`
in a non-blocking try/catch (same pattern as `valuationAudit` /
`dataConfidence`) after the pipeline already sealed facts, valuation, evidence
and data-confidence. The payload field and `ReportData.researchCase` are
optional: PDF/QA/renderers ignore absence; report sections and numbers are
unchanged. Research-layer inputs (`researchReport`, `researchPlan`,
`aiAnalysis`) stay null on this route — they attach when the AI research ran.

**Phase 3 — module wrappers, not a second calculator.** Each research module
is a pure slice over `ResearchCase` + optional pipeline context
(`ratiosByYear`, `masterReportFacts`, `valuationAudit`, …). Provided arrays
and objects are returned by **reference identity**. Rating / fair value /
current price resolve through the existing single-source hierarchy
(`assumptionsLedger` → `masterReportFacts` → `dcf`) — never a parallel
formula. Absent ratios/research/QA stay `null` with explicit unknowns
(`ratiosByYear not provided…`). The runner is non-blocking: a module throw is
recorded as `available: false`, never a bundle failure. ReportClient/PDF are
untouched in Phase 3.

**Phase 4 — blueprints describe structure, not pixels.** `ReportBlueprint`
declares TOC rows, page-sections in render order, depth gates
(`concise`/`full`), and which Phase 3 modules feed each section.
`institutional_equity_v1` is golden-tested against
`PDFDocument/index.tsx` cover TOC titles and `ReportDocument` component order
(including the `ResearchDebatesPage` omit rule). No `maxPages` field exists —
page length remains emergent (rule 13–14). Planned types
(`tearsheet_v1`, `valuation_dossier_v1`, `earnings_deep_dive_v1`, `forensic_v1`)
are registered with `status: "planned"` for Phase 8. PDF/ReportClient are
untouched.

**Phase 5 — composer wires research → structure → renderer.**
`composeReport` resolves the blueprint outline, runs only the modules that
outline needs, and attaches each section's module data **by reference** (same
objects the runner produced — never a second calculation). `ReportClient`
calls `composeReportFromData` after QA in a non-blocking try/catch and stores
the result on `ReportData.composedReport`. The PDF's `ReportDocument` consumes
that composed outline when present (`pdfComponent` → page component map;
cover TOC titles from `composed.toc`, page ranges stay presentation-only) and
falls back to its legacy hardcoded structure when absent. Page length is never
capped; missing module slices are `null` with explicit `unavailableModules`.
The renderer remains presentation-only: it never computes research and never
invents numbers.

**Phase 6 — orchestration references existing rosters and QA.**
`RESEARCH_ROLES` unifies the 8 council personas, 50 agent-team seats, 9
quality-review seats (exported `QUALITY_REVIEWER_NAMES`), 4 writer/checker
seats and the red-team seat under source-prefixed ids — it never forks their
job text. `buildResearchTasks` is a pure function of `ResearchCase` + the
Phase 4 outline (no LLM, no page caps, no hardcoded rating/conclusion);
section → council routing uses the section's declared module order so
`moat-price-fair-value` lands on `council-moat` and credit titles on
`council-credit`. Authors use `WRITER_CHECKER_MAX_ATTEMPTS` (re-exported,
never a local copy) and carry fail-closed blockers (`NO_VALUATION`,
`PEERS_SUPPRESSED`, case blockers) — blocked authors never invent numbers.
`runCommitteeReview` does **not** reimplement scoring: it calls the existing
`runQualityReview` / `adjudicateRegeneration` and only *folds* QA blockers,
red-team blockers and council-audit status/score/FLAG checks into one
`CommitteeDecision`. `runRedTeam` runs 7 deterministic structural probes
(blockers propagate, peers gate, valuation consistency, graph closure,
author↔checker pairing, debates gate, unknowns not invented) and an optional
LLM adversary purely through an **injected `OrchestrationTransport`** —
transport errors are swallowed so deterministic probes still stand and no
findings are invented. Provider failover stays where it lives
(`ai-providers.ts` / `openrouter.ts`); the orchestration module never
fetches, never lists models, and never branches on provider id. Existing
report output is unchanged (library + tests only, like Phases 1/3/4/5).

**Phase 7 — evidence graph references the existing registry and validator.**
`buildEvidenceGraph` is a pure function of `ResearchCase` (+ optional
outline sections, module bundle, and narrative prose). Source/Evidence nodes
are minted from `EvidenceRegistry` items by reference (never rebuilt, never
mutated). Claims reuse `extractClaims` → `validateClaimSet` — claim-validator
remains the sole scoring engine; this module only records the resulting
`ClaimTrace` (evidence id, tier, Source→Evidence→Claim path) and folds
untraceable material claims into `UNTRACEABLE_CLAIM:` blockers. Analysis
nodes come from the Phase 3 `ModuleRunBundle` (or section module ids when the
bundle is absent, with an explicit unknown). The conclusion node uses
`resolveValuationAnchors` (ledger → facts → dcf) — never a parallel fair
value. Section nodes and `analysis-feeds-section` edges come from the Phase 4
outline / Phase 5 composed sections. Exit criterion:
`materialClaimsTraceable` is true only when every percentage/currency claim
has a full Source→Evidence chain (zero material claims is vacuously true;
missing registry / fabricated numbers fail closed). No LLM, no page caps,
existing report output unchanged (library + tests only).

**Phase 8 — advanced blueprints reuse the Phase 3/4/5 contracts.**
`advanced-blueprints.ts` registers 10 stable report types — industry,
competitive, management, risk, SOTP, bank, insurance, REIT, special situation,
portfolio — built from the same `ReportBlueprint` schema, the same 9-module
catalog, and `resolveReportOutline` / `composeReport` with zero new calculators.
Each type has 4 concise sections (TOC `depth: "both"`) plus ≥1 `depth: "full"`
section; `requiredModules` covers every module used by any section (concise or
full). Bank / insurance / REIT wire sector-native statements through the
`statements` module — statement architecture stays on `ResearchCase`. Section
titles are report-type copy (never company conclusions); no `maxPages` field;
no embedded financial numbers. Registry grows to 15 (4 Phase-4 skeletons stay
`status: "planned"`). PDF/ReportClient/QA untouched — library + tests only.

**Phase 9 — selectors are structure-only and fail-closed.** The home page
offers report type + research depth (`selectableReportTypes()` — stable
blueprints only; planned ids are never selectable and are rejected by
`parseReportTypeParam`) and navigates to `/report/:ticker?type=…&depth=…`.
The report page validates the query server-side before hydration (no
mismatch, unknown values fall back to institutional/concise). ReportClient
passes the selection into `composeReportFromData(report, { reportTypeId,
depth })` — selectors are refs at generation time and NOT `generateReport`
deps, so changing them **re-composes in place** (deterministic, no LLM, no
pipeline re-run) instead of restarting generation. The new **Report Outline**
tab renders the composed TOC + sections + modules + unknowns (the visible
effect of both selectors); the export heading and the staged ProgressTracker
context line show the selected type/depth; the PDF filename follows the
blueprint title. Depth reaches the PDF through `composed.depth` as before.
Post-Phase-10 addendum: the staged ProgressTracker is no longer
report-type-invariant — `buildProgressSteps(title)` labels steps 03–05
(`Structuring <Title>`, `Assembling <Title> Dossier`, `<Title> Ready`) and
the council sub-header prints `AI ANALYST COUNCIL · <TITLE>`; steps 01–02
(data fetch, ratios/DCF) stay shared because that work genuinely is.
**Phase B — live planner wiring (DONE).** ReportClient now snapshots the
selected type/depth at generation start, resolves the blueprint outline, and
builds the Phase 6 `buildResearchTasks` graph over the returned
ResearchCase; the deterministic `runRedTeam` probes run for real over
plan + case, and after the council audit resolves `runCommitteeReview`
folds the audit + red-team findings into a decision. The council
sub-progress renders `derivePlanProgressTasks` rows (per-section
author/checker + red-team + committee) instead of the fixed 7-agent roster:
authors track their assigned council persona's live status, checker seats
track the verifier, fail-closed blockers stay `BLOCKED ⚠`, and the
red-team/committee rows show their actual probe/flag results. The fixed
7-agent roster remains the fallback whenever no plan exists. Selector
semantics unchanged: the plan snapshots refs at generation start, exactly
like compose-at-end.
Limitation (documented, deliberate): non-institutional blueprints have no
`pdfComponent` page mappings yet, so the PDF body keeps the legacy
institutional page set for those types — the institutional composed path and
golden TOC are untouched (regression-pinned in `test-report-ui.ts`). No
financial numbers, no conclusions, no page caps added anywhere.

**Phase 10 — hardening gates, all green.** The interactive-hang root cause
was a missing ESLint config: `.eslintrc.json` (`next/core-web-vitals`) was
added so `next lint` runs non-interactively. The 6 pre-existing lint *errors*
were fixed at the source (unescaped JSX entities in `ReportClient`,
`PDFDocument`, `SearchBar`; a stale `@typescript-eslint/no-unused-vars`
disable comment in `calculations.ts` referencing an unloaded rule). Remaining
lint output is warnings only (anonymous default exports, one hooks-deps
note) — warnings do not fail the gate. Final gates: `npm run lint` EXIT=0 ·
`npx tsc --noEmit` EXIT=0 · `npm test` EXIT=0 (all 18 chained suites:
97/101/139/64/83/55/211/48 phase tests + legacy tracks) · `npm run test:golden`
85/85 (golden ticker matrix: INFY, CIPLA, SUZLON, SPANDANA, HDFCBANK,
RELIANCE — classification, KPIs, sector-leakage guards, valuation routing,
Image-2/3 ground-truth fidelity, accounting identities) · `npm run build`
EXIT=0 (Next 15.5.25, lint+types pass inside build, 9/9 static pages).
No kernel/QA/valuation code was rewritten in any phase.

### Complexity dimensions (weights sum to 100)

| Dimension | Max | Signals |
|-----------|-----|---------|
| Segment complexity | 15 | Reported segment count |
| Geographic complexity | 10 | Geography count + cross-listing (FX/share restatement) |
| Statement architecture | 12 | A=3, E=6, D=9, B/C=12 |
| Financial archetype | 10 | Distressed 10 … Mature compounder 4 |
| Balance-sheet complexity | 12 | Lenders max; corporates by Debt/Equity |
| M&A / intangibles | 6 | Goodwill or other intangibles present |
| Regulatory complexity | 8 | Regulated sector ID list |
| Historical depth | 8 | Annual + quarterly period counts |
| Peer coverage | 9 | Usable peers; suppressed gate also costly |
| Data quality burden | 10 | Grade A–D/N/A, synthesized + missing fields |

Levels: `LOW < 30 ≤ MEDIUM < 50 ≤ HIGH < 70 ≤ VERY_HIGH`.

Report length (later phases) is a *function of selected modules × complexity ×
evidence density* — never a hardcoded `maxPages`.

---

## 5. Migration phases

| Phase | Scope | Exit criteria |
|-------|-------|---------------|
| **1 — ResearchCase** | `research-case/` types + builder + complexity + tests + this doc | `tsc` clean, Phase 1 tests pass, golden regression unchanged, existing report unchanged |
| **2 — Wire ResearchCase** | Attach case to `/api/company` as additive field (pattern: `valuationAudit`, `dataConfidence`) | DONE — report output unchanged; `researchCase` present on payload and `ReportData` |
| **3 — Module framework** | `research-modules/` wrapping existing calculations (no rewrites) | DONE — existing numbers flow through modules unchanged (reference identity + ledger anchors); `npm run test:research-modules` green |
| **4 — ReportBlueprint** | `report-types/` starting with `institutional_equity_v1` (must reproduce today's report), plus tearsheet, valuation dossier, earnings deep-dive, forensic | DONE — `institutional_equity_v1` TOC + render order golden-match the PDF; 4 planned types registered; `npm run test:report-blueprints` green |
| **5 — Report composer** | `research → ComposedReport → PDF renderer` | DONE — `ReportDocument` consumes composed outline when present (legacy fallback when absent); renderer is presentation-only; `npm run test:report-composer` green |
| **6 — AI orchestration** | Existing 6 personas → reusable roles; `ResearchTask`, planner, committee, red-team; keep provider failover | DONE — provider interchangeability preserved (injected `OrchestrationTransport` only; no fetch / no provider branch); `npm run test:ai-orchestration` green |
| **7 — Evidence graph** | Source → Evidence → Claim → Analysis → Conclusion → Section | DONE — material claims traceable (registry + claim-validator reused; `materialClaimsTraceable` exit); `npm run test:evidence-graph` green |
| **8 — Advanced report types** | Industry, competitive, management, risk, SOTP, bank, insurance, REIT, special situation, portfolio | DONE — 10 stable blueprints over the same module catalog (4 concise + ≥1 full-only section each; `requiredModules` covers all section modules); `npm run test:advanced-blueprints` green (211 assertions) |
| **9 — UI** | Report type + research depth selectors; staged progress | DONE — home + report-page selectors (`?type=…&depth=…`, fail-closed), in-place re-compose, Report Outline tab, progress context line + per-report-type step labels/council header + Phase B live task-plan derivation; `npm run test:report-ui` green (78 assertions) + Manual QA |
| **10 — Hardening** | `npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run test:golden`, `npm run build` + full golden ticker matrix | DONE — all five gates EXIT=0 (lint 0 errors after `.eslintrc.json` + 6 fixes; golden 85/85; build 9/9 pages); migration Phases 1–10 complete |

### Golden-case matrix (from Phase 4 onward)

Tickers: `RELIANCE.NS`, `CIPLA.NS`, `HDFCBANK.NS`, a REIT, an insurer, a US
tech name, an international cross-listing, a high-growth name, a loss-maker, a
conglomerate.

Per ticker × report type, verify: financial anchors (revenue, EBITDA, PAT, FCF,
debt, shares, price), valuation anchors (DCF, FV, upside, WACC, TV), sector
guards (no forbidden metrics; correct KPIs/architecture), and evidence coverage
on material claims.

---

## 6. What must NOT be done

```text
✗ Rewrite calculations.ts from scratch
✗ Rewrite valuation/
✗ Replace assumptions-ledger.ts
✗ Remove report-facts.ts
✗ Remove report-validator.ts
✗ Remove sector guardrails
✗ Move financial calculations into prompts
✗ Put financial numbers inside LLM prose as the source of truth
✗ Create one prompt containing the entire report
✗ Create 20 independent PDF generators
✗ Hardcode report page counts
✗ Hardcode company-specific conclusions
✗ Hardcode peer sets as the final system (seeds + similarity gate only)
✗ Hardcode AI provider/model dependencies
```

---

## 7. Verification commands

```bash
npx tsc --noEmit                      # typecheck
npx tsx scratch/test-research-case.ts # Phase 1 unit tests
npx tsx scratch/test-research-modules.ts # Phase 3 module pass-through tests
npx tsx scratch/test-report-blueprints.ts # Phase 4 blueprint golden match
npx tsx scratch/test-report-composer.ts # Phase 5 composer + renderer wire
npx tsx scratch/test-ai-orchestration.ts # Phase 6 orchestration roles/tasks/committee/red-team
npx tsx scratch/test-evidence-graph.ts # Phase 7 Source→…→Section material-claim traceability
npx tsx scratch/test-advanced-blueprints.ts # Phase 8 advanced report-type golden cases
npx tsx scratch/test-report-ui.ts # Phase 9 selector options + compose-with-options contract
npm run test:golden                   # deterministic golden regression (ticker matrix)
npm run lint                          # EXIT=0 (0 errors; warnings are non-failing)
npm run build                         # Next build — lint + typecheck inside, all pages
npm test                              # full suite (all 18 chained tests)
```
