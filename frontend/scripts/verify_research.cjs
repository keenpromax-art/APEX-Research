// Regression harness for the research PDF pipeline.
// Zero-dep node:test; compiles lib/ to a temp dir, drives the mock API end-to-end,
// and writes three sample PDFs (US large-cap, INR listing, sparse fixture).

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const FRONTEND_ROOT = path.resolve(__dirname, "..");
const LIB_DIR = path.join(FRONTEND_ROOT, "lib");
const OUT_DIR = path.join(os.tmpdir(), "apexcheck");
const SAMPLES_DIR = path.join(FRONTEND_ROOT, "samples", "research");

// Allow the compiled temp output to resolve frontend deps (zod, etc.).
const nodeModules = path.join(FRONTEND_ROOT, "node_modules");
process.env.NODE_PATH = [nodeModules, process.env.NODE_PATH].filter(Boolean).join(path.delimiter);
require("node:module").Module._initPaths();

function compileLib() {
  const files = ["api.ts", "exporters.ts", "pdf.ts", "xlsx.ts", "format.ts", "provenance.ts", "narrative.ts"];
  const tscPath = path.join(FRONTEND_ROOT, "node_modules", "typescript", "bin", "tsc");
  execFileSync(
    process.execPath,
    [
      tscPath,
      ...files.map((f) => path.join(LIB_DIR, f)),
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

compileLib();

// localStorage shim must exist before api.js is required.
const store = new Map();
global.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
};

const { api, apiBlob } = require(path.join(OUT_DIR, "api.js"));
const { inspectPdfBytes } = require(path.join(OUT_DIR, "exporters.js"));
const { parseListing } = require(path.join(OUT_DIR, "provenance.js"));
const { validateNarrative, tryProviderNarrative } = require(path.join(OUT_DIR, "narrative.js"));

async function generateReport(ticker, overrides = {}) {
  const body = {
    ticker,
    report_type: "full",
    years: 5,
    horizon: "12M",
    terminal_mode: "growth",
    terminal_growth: 0.025,
    rating_mode: "auto",
    force_refresh: false,
    peers: [],
    report_date: "2026-10-26",
    title: "",
    ...overrides,
  };
  return api("/api/research/generate", { method: "POST", body: JSON.stringify(body) });
}

async function pdfBytesForReport(id) {
  const blob = await apiBlob(`/api/research/reports/${id}/pdf`, { id });
  const bytes = Buffer.from(await blob.arrayBuffer());
  return { blob, bytes };
}

test("parseListing maps tickers to venue and currency", () => {
  assert.equal(parseListing("AAPL").currency, "USD");
  assert.equal(parseListing("AAPL").market, "US");
  assert.equal(parseListing("RELIANCE.NS").currency, "INR");
  assert.equal(parseListing("RELIANCE.NS").market, "IN");
  assert.equal(parseListing("GAPCO").currency, "USD");
  assert.equal(parseListing("GAPCO").market, "US");
  assert.equal(parseListing("SHEL.L").currency, "GBp");
  assert.equal(parseListing("SHEL.L").market, "UK");
  assert.equal(parseListing("DEMO").isDemo, true);
});

test("AAPL (US) report generates with rating, currency and clean layout", async () => {
  const record = await generateReport("AAPL");
  assert.equal(record.ticker, "AAPL");
  assert.equal(record.currency, "USD");
  assert.equal(record.status, "complete");
  assert.ok(["BUY", "HOLD", "SELL"].includes(record.rating), `rating=${record.rating}`);
  assert.ok(Number.isFinite(record.target_price));
  assert.ok(Number.isFinite(record.upside));
  assert.ok(record.page_count >= 1);
  assert.ok(record.pdf_size > 1000);
  assert.ok(record.warnings.length >= 1);
  assert.ok(record.pdf_qa.length >= 3);
  assert.equal(record.inputs.ticker, "AAPL");
  assert.ok(record.narrative, "record stores narrative for reproducible download");

  const qaErrors = record.pdf_qa.filter((row) => row.level === "error");
  assert.deepEqual(qaErrors, [], `pdf_qa errors: ${JSON.stringify(qaErrors)}`);

  const { blob, bytes } = await pdfBytesForReport(record.id);
  assert.equal(blob.type, "application/pdf");
  assert.equal(bytes.subarray(0, 5).toString("latin1"), "%PDF-");
  const text = bytes.toString("latin1");
  assert.ok(text.includes("AAPL"), "PDF contains ticker");
  assert.ok(!text.includes("NaN"), "PDF has no NaN");
  assert.ok(!text.includes("undefined"), "PDF has no undefined");
  const layout = inspectPdfBytes(new Uint8Array(bytes));
  assert.deepEqual(layout.filter((i) => i.level === "error"), [], `layout errors: ${JSON.stringify(layout)}`);
});

test("RELIANCE.NS (INR) report is denominated in INR, not USD", async () => {
  const record = await generateReport("RELIANCE.NS");
  assert.equal(record.currency, "INR");
  assert.equal(record.status, "complete");
  const { bytes } = await pdfBytesForReport(record.id);
  const text = bytes.toString("latin1");
  assert.ok(text.includes("RELIANCE.NS"), "PDF contains ticker");
  assert.ok(!text.includes("NaN"), "PDF has no NaN");
  const layout = inspectPdfBytes(new Uint8Array(bytes));
  assert.deepEqual(layout.filter((i) => i.level === "error"), [], `layout errors: ${JSON.stringify(layout)}`);
});

test("GAPCO sparse fixture renders with warnings and no crashes", async () => {
  const record = await generateReport("GAPCO");
  assert.equal(record.ticker, "GAPCO");
  assert.equal(record.currency, "USD");
  // Sparse data must not crash; rating may be issued or withheld depending on gates.
  assert.ok(["BUY", "HOLD", "SELL", "NOT RATED"].includes(record.rating), `rating=${record.rating}`);
  assert.ok(record.warnings.length >= 1);
  const { bytes } = await pdfBytesForReport(record.id);
  assert.equal(bytes.subarray(0, 5).toString("latin1"), "%PDF-");
  const text = bytes.toString("latin1");
  assert.ok(text.includes("GAPCO"), "PDF contains ticker");
  assert.ok(!text.includes("NaN"), "PDF has no NaN");
  const layout = inspectPdfBytes(new Uint8Array(bytes));
  assert.deepEqual(layout.filter((i) => i.level === "error"), [], `layout errors: ${JSON.stringify(layout)}`);
});

test("INOXWIND.NS (INR) report has clean formatting and layout", async () => {
  const record = await generateReport("INOXWIND.NS");
  assert.equal(record.currency, "INR");
  assert.equal(record.status, "complete");
  const { bytes } = await pdfBytesForReport(record.id);
  const text = bytes.toString("latin1");
  assert.ok(text.includes("INOXWIND.NS"), "PDF contains ticker");
  assert.ok(!text.includes("Y2,026"), "no malformed year");
  assert.ok(!text.includes("10.000000"), "no long decimal");
  assert.ok(!text.includes("NaN"), "PDF has no NaN");
  const layout = inspectPdfBytes(new Uint8Array(bytes));
  assert.deepEqual(layout.filter((issue) => issue.level === "error"), [], `layout errors: ${JSON.stringify(layout)}`);
});

test("AI provider failure returns null and deterministic fallback remains valid", async () => {
  const result = await tryProviderNarrative(
    { name: "bad", provider: "openai", base_url: "http://127.0.0.1:1/v1", api_key: "x", model: "m" },
    { ticker: "AAPL" },
    100,
  );
  assert.equal(result, null);
  const record = await generateReport("NVDA");
  const { ok } = validateNarrative(record.narrative);
  assert.ok(ok, "deterministic narrative still validates");
});

test("narrative schema validates for a generated report", async () => {
  const record = await generateReport("NVDA");
  const { ok, issues } = validateNarrative(record.narrative);
  assert.ok(ok, `narrative schema issues: ${JSON.stringify(issues)}`);
  assert.equal(record.narrative.ai_generated, false);
  assert.equal(record.narrative.narrative_source, "deterministic-engine");
});

test("report lifecycle: list, rebuild, delete", async () => {
  const first = await generateReport("MSFT");
  const list = await api("/api/research/reports?limit=50");
  assert.ok(list.length >= 1);

  const rebuilt = await api(`/api/research/reports/${first.id}/rebuild`, { method: "POST" });
  assert.equal(rebuilt.previous_version_id, first.id);
  assert.equal(rebuilt.inputs.ticker, "MSFT");

  const missing = await api("/api/research/reports/99999/rebuild", { method: "POST" }).then(
    () => "resolved",
    (error) => error.message,
  );
  assert.equal(missing, "Report 99999 was not found.");

  const removed = await api(`/api/research/reports/${first.id}`, { method: "DELETE" });
  assert.equal(removed.status, "deleted");
});

test("/api/ai/research returns flattened string arrays for the company page", async () => {
  const result = await api("/api/ai/research", { method: "POST", body: JSON.stringify({ ticker: "TSLA" }) });
  assert.ok(result.report, "has report");
  assert.ok(result.payload, "has payload");
  assert.ok(Array.isArray(result.report.risks));
  assert.ok(result.report.risks.every((r) => typeof r === "string"));
  assert.ok(Array.isArray(result.report.catalysts));
  assert.ok(result.report.catalysts.every((c) => typeof c === "string"));
  assert.equal(typeof result.report.valuation_view, "string");
});

test("writes three sample PDFs", async () => {
  fs.mkdirSync(SAMPLES_DIR, { recursive: true });
  const cases = [
    { ticker: "AAPL", file: "AAPL_us_large_cap.pdf" },
    { ticker: "RELIANCE.NS", file: "RELIANCE_ns_inr.pdf" },
    { ticker: "GAPCO", file: "GAPCO_sparse.pdf" },
  ];
  for (const { ticker, file } of cases) {
    const record = await generateReport(ticker);
    const { bytes } = await pdfBytesForReport(record.id);
    fs.writeFileSync(path.join(SAMPLES_DIR, file), bytes);
    assert.ok(bytes.length > 2000, `${file} size`);
  }
  const written = fs.readdirSync(SAMPLES_DIR).filter((f) => f.endsWith(".pdf"));
  assert.equal(written.length, 3, `expected 3 sample PDFs, got ${written.join(", ")}`);
  console.log(`samples -> ${SAMPLES_DIR}`);
});
