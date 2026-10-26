// Regenerates scripts/fixtures/yahoo_raw_AAPL.json: a trimmed recording of live
// Yahoo Finance responses (quoteSummary + chart + fundamentals-timeseries) used
// by the offline normalization test in verify_research.cjs.

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const FRONTEND_ROOT = path.resolve(__dirname, "..");
const LIB_DIR = path.join(FRONTEND_ROOT, "lib");
const OUT_DIR = path.join(os.tmpdir(), "apex-record");

function compileYahoo() {
  execFileSync(
    process.execPath,
    [
      path.join(FRONTEND_ROOT, "node_modules", "typescript", "bin", "tsc"),
      path.join(LIB_DIR, "server", "yahoo.ts"),
      "--outDir", OUT_DIR,
      "--module", "commonjs",
      "--target", "es2020",
      "--lib", "es2021,dom",
      "--moduleResolution", "node",
      "--esModuleInterop",
      "--skipLibCheck",
      "--types", "node",
    ],
    { cwd: FRONTEND_ROOT, stdio: "inherit" },
  );
}

function trimTimeseries(timeseries) {
  if (!timeseries || !Array.isArray(timeseries.result)) return null;
  return {
    result: timeseries.result.map((entry) => {
      const key = entry?.meta?.type?.[0];
      const rows = key && Array.isArray(entry[key]) ? entry[key] : [];
      return { ...entry, [key]: rows.slice(-6) };
    }),
  };
}

function trimChart(chart, keep = 60) {
  const result = chart?.chart?.result?.[0];
  if (!result || !Array.isArray(result.timestamp)) return chart;
  const start = Math.max(0, result.timestamp.length - keep);
  result.timestamp = result.timestamp.slice(start);
  const quote = result.indicators?.quote?.[0];
  if (quote) {
    Object.keys(quote).forEach((key) => {
      if (Array.isArray(quote[key])) quote[key] = quote[key].slice(start);
    });
  }
  const adjusted = result.indicators?.adjclose?.[0];
  if (adjusted && Array.isArray(adjusted.adjclose)) adjusted.adjclose = adjusted.adjclose.slice(start);
  return chart;
}

async function main() {
  compileYahoo();
  const yahoo = require(path.join(OUT_DIR, "server", "yahoo.js"));
  const raw = await yahoo.fetchYahooRaw("AAPL");
  raw.timeseries = trimTimeseries(raw.timeseries);
  raw.chart = trimChart(raw.chart);
  const target = path.join(FRONTEND_ROOT, "scripts", "fixtures", "yahoo_raw_AAPL.json");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(raw, null, 1));
  console.log(`recorded -> ${target}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
