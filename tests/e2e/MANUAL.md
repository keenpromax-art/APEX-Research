# Manual and live checks

These checks are intentionally outside default verification.

## Live provider

```sh
RUN_LIVE=1 OPENROUTER_API_KEY=... npx tsx scratch/test-ai-provider.mjs
RUN_LIVE=1 OPENROUTER_API_KEY=... npx tsx scratch/test-openrouter.mjs
RUN_LIVE=1 OPENROUTER_API_KEY=... npx tsx scratch/test-models.mjs
```

## Localhost

Start the app first, then run the localhost fixture manually:

```sh
npm run dev
npx tsx scratch/test-analyze.mjs
npx tsx scratch/test-bankbaroda-pdf.mjs
```

## PDF snapshots and debug

```sh
npx tsx scratch/check-page-count.mjs
npx tsx scratch/inspect-pages.mjs
```

Image previews under `scratch/*.png` are manual artifacts only.

## Policy

Default `npm test` never requires keys, localhost, browsers, or network refresh.
`tests/e2e/live-boundary.test.ts` always passes in CI by skipping; it only
executes live assertions when `RUN_LIVE=1` and a provider key are present.
