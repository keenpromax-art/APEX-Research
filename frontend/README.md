# APEX Terminal — frontend

Next.js 16 App Router client for the APEX Terminal equity research platform.

Everything runs in the browser: fundamentals, three-statement forecasts, DCF and
sensitivity analysis, LBO/options/bond calculators, research-note generation and
PDF/Excel export. There is no backend and no environment configuration.

## Run

```powershell
npm install
npm run dev
```

No `.env` file is needed. Projects, models and report versions are stored in this
browser's `localStorage`.

## Pages

- `/` — research home and ticker search
- `/company` — company index and saved workspaces
- `/company/[ticker]` — ten-tab workspace (statements, forecast, valuation, sensitivity, report, sources)
- `/modelling` — LBO, options, bond and WACC calculators
- `/ai` — provider configuration, connection tests and research job history
- `/library` — projects and saved model snapshots
- `/research` — Research Studio: build, version and export institutional notes
- `/settings` — theme, engine status and shortcuts

A local synthetic sample fixture is used automatically when the market-data provider is unreachable.

## Engine

`lib/api.ts` is the single entry point. `api()` and `apiBlob()` dispatch to the
in-browser engine in the same file; exports are rendered by `lib/pdf.ts`,
`lib/xlsx.ts` and `lib/exporters.ts`. Nothing leaves the machine unless you
configure an AI provider on `/ai`.

## Checks

```powershell
npm run lint
npx tsc --noEmit
npm run build
```
