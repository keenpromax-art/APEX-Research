# APEX Terminal — frontend

Next.js 16 App Router client for the APEX Terminal equity research platform.

## Run

```powershell
npm install
npm run dev
```

The client expects the FastAPI backend at `http://localhost:8000` by default. Copy
`.env.example` to `.env.local` and set `NEXT_PUBLIC_API_URL` to point elsewhere.

## Pages

- `/` — research home and ticker search
- `/company` — company index and saved workspaces
- `/company/[ticker]` — ten-tab workspace (statements, forecast, valuation, sensitivity, report, sources)
- `/modelling` — LBO, options, bond and WACC calculators
- `/ai` — provider configuration, connection tests and research job history
- `/library` — projects and saved model snapshots
- `/settings` — theme, API diagnostics and shortcuts

Use the `DEMO` ticker for the synthetic fixture.

## Checks

```powershell
npm run lint
npx tsc --noEmit
npm run build
```

See the repository root `README.md` for full setup, and `docs/` for architecture and
financial model documentation.
