# Tests taxonomy

## Layout

- `tests/unit/` — deterministic unit coverage: accounting architectures, fact packs, model runtime.
- `tests/model/` — forecast compilation, execution, validation, forecast compatibility.
- `tests/valuation/` — valuation matrix, scenarios, sensitivity, Monte Carlo, reverse valuation.
- `tests/evidence/` — source taxonomy, fact provenance, research lineage.
- `tests/ai/` — AI-first mechanical pipeline plus mocked-transport acceptance across companies.
- `tests/report/` — report composer plus renderer compatibility for legacy statement types.
- `tests/integration/` — canonical package cutover, canonical QA, reproducibility, audit package.
- `tests/regression/` — structural goldens plus cross-company contamination.
- `tests/goldens/` — versioned structural datasets and normalization.
- `tests/e2e/` — live/manual boundary. Everything here skips by default.
- `tests/helpers/` — shared deterministic fixtures and assertion helper.

## Running

```sh
npm run test:canonical
npm run test:unit
npm run test:model
npm run test:valuation
npm run test:evidence
npm run test:ai
npm run test:report
npm run test:integration
npm run test:regression
npm test
npm run typecheck
```

`npm test` runs canonical taxonomy first, then the preserved deterministic legacy scratch suite.
Typecheck covers `tests/**` through the root `tsconfig.json` include.

## Live-only policy

Live provider calls, localhost servers, browser rendering, PDF snapshots, and market-data
refresh checks are manual-only. They are documented in `tests/e2e/MANUAL.md` and skipped
unless both conditions hold:

```sh
RUN_LIVE=1 OPENROUTER_API_KEY=... npx tsx tests/e2e/live-boundary.test.ts
```

No default test contacts the network, reads local servers, or requires keys.
Mechanical transports are used everywhere else with fixed timestamps.

## Goldens

`tests/goldens/companies.json` is structural only. It pins accounting architecture,
economic abstraction patterns, minimum KPI and forecast-output names, forbidden concepts,
and valuation applicability. It never pins prose conclusions, target prices, ratings,
timestamps, run IDs, latency, or provider metadata. `tests/goldens/normalize.ts`
strips those volatile fields before comparison.
