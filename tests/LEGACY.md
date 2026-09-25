# Legacy scratch classification

Valuable deterministic scratch coverage remains executable during migration.
Canonical replacements live under `tests/`.

## Canonical replacements

| Legacy scratch | Canonical replacement |
| --- | --- |
| `scratch/test-ai-first-regression.ts` | `tests/ai/ai-first.test.ts`, `tests/model/forecast.test.ts`, `tests/valuation/*` |
| `scratch/test-ai-first-acceptance.ts` | `tests/ai/ai-first.test.ts`, `tests/regression/contamination.test.ts` |
| `scratch/test-ai-first-model-forecast.ts` | `tests/model/forecast.test.ts`, `tests/unit/*` |
| `scratch/test-ai-first-valuation.ts` | `tests/valuation/valuation.test.ts`, `tests/valuation/scenarios-reverse.test.ts` |
| `scratch/test-ai-first-architecture.ts` | `tests/unit/accounting-architecture.test.ts`, `tests/evidence/lineage.test.ts` |
| `scratch/test-canonical-qa.ts` | `tests/integration/canonical-qa.test.ts` |
| `scratch/test-research-package-cutover.ts` | `tests/integration/package-cutover.test.ts`, `tests/report/renderer-compat.test.ts` |
| `scratch/test-research-retrieval.ts` | `tests/evidence/lineage.test.ts`, `tests/integration/package-cutover.test.ts` |
| `scratch/test-institutional-analytics.ts` | preserved legacy; structural slice covered by `tests/regression/goldens.test.ts` |
| `scratch/test-peer-discovery.ts` | preserved legacy; isolation covered by `tests/regression/contamination.test.ts` |
| `scratch/test-golden-regression.mjs` | preserved legacy; structural successor is `tests/regression/goldens.test.ts` |
| `scratch/test-forecast-compatibility.ts` | `tests/model/forecast-compatibility.test.ts` |
| `scratch/test-report-composer.ts`, `test-report-blueprints.ts`, `test-report-ui.ts` | `tests/report/composer.test.ts`, `tests/report/renderer-compat.test.ts` |
| `scratch/test-research-ledger-phase2.ts`, `test-research-runs.ts`, `test-guidance-tracker.ts` | preserved legacy; QA slice covered by `tests/integration/canonical-qa.test.ts` |

## Preserved executable legacy

All deterministic `scratch/test-*.ts`, `scratch/test-request-validation.mjs`,
`scratch/test-golden-regression.mjs`, and `scratch/test-event-price-movement.mjs`
invoked by `npm run test:legacy` stay executable. Nothing valuable was deleted.

## Manual-only boundary

The following patterns are never part of default verification. Use `tests/e2e/MANUAL.md`:

- `test-ai-provider.mjs`, `test-openrouter*.mjs`, `test-models.mjs`, `test-available-free.mjs`,
  `test-candidates.mjs`, `test-stream.mjs`, `test-multi-agent.mjs`
- localhost fixtures: `test-analyze.mjs`, `test-api.mjs`, `test-bankbaroda-pdf.mjs`,
  `test-itc-pdf.mjs`, `test-reliance-pdf.mjs`, `test-render-msft.mjs`, `test-suzlon-*.mjs`
- debug snapshots: `dbg-*.mjs`, `inspect-pages.mjs`, `check-page-count.mjs`, image previews
- live market QA: `test-hdfc-qa.mjs`, `test-institutional-qa.mjs`, `test-pi-industries-diagnostic.mjs`,
  `test-quant-overhaul.mjs`, `test-sbi-audit.mjs`
