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
  const files = ["api.ts", "exporters.ts", "pdf.ts", "xlsx.ts", "format.ts", "provenance.ts", "narrative.ts", "server/yahoo.ts"];
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
const yahoo = require(path.join(OUT_DIR, "server", "yahoo.js"));

const RECORDED_RAW = path.join(__dirname, "fixtures", "yahoo_raw_AAPL.json");

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
  assert.equal(parseListing("SAMPLE").isDemo, true);
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

test("normalizeYahooSnapshot builds a labelled provider fixture from recorded responses (offline)", () => {
  const raw = JSON.parse(fs.readFileSync(RECORDED_RAW, "utf8"));
  const fixture = yahoo.normalizeYahooSnapshot("AAPL", raw, null);

  assert.equal(fixture.is_synthetic, false);
  assert.equal(fixture.provider, "Yahoo Finance");
  assert.equal(fixture.ticker, "AAPL");
  assert.equal(fixture.info.currency, "USD");
  assert.ok(fixture.info.longName && fixture.info.longName.length > 1, `longName=${fixture.info.longName}`);
  assert.ok(fixture.info.sharesOutstanding > 0);
  assert.ok(fixture.info.marketCap > 0);

  const income = fixture.annual.income_statement;
  assert.ok(income.length >= 3, `annual income periods=${income.length}`);
  const years = income.map((row) => Number(row.period_end.slice(0, 4)));
  years.forEach((year, index) => {
    assert.ok(Number.isInteger(year) && year > 1990 && year < 2100, `year=${year}`);
    if (index > 0) assert.ok(years[index - 1] > year, "periods strictly descending");
  });
  income.forEach((row) => {
    assert.ok(Number.isFinite(row.items.revenue) && row.items.revenue > 0, `revenue=${row.items.revenue}`);
    assert.ok(Number.isFinite(row.items.ebitda), `ebitda=${row.items.ebitda}`);
    Object.values(row.items).forEach((value) => {
      assert.ok(value === null || Number.isFinite(value), `income item not finite: ${value}`);
    });
  });

  const balance = fixture.annual.balance_sheet;
  assert.ok(balance.length >= 2, `annual balance periods=${balance.length}`);
  balance.forEach((row) => {
    ["total_assets", "current_assets", "current_liabilities", "cash", "total_debt", "equity", "shares_issued", "ppe_net"].forEach(
      (key) => assert.ok(Number.isFinite(row.items[key]), `${key}=${row.items[key]}`),
    );
    assert.ok(row.items.goodwill === null || Number.isFinite(row.items.goodwill));
    assert.ok(
      Math.abs(row.items.total_assets - row.items.current_assets - (row.items.goodwill ?? 0) - row.items.ppe_net) < 1,
      "derived PP&E reconciles to total assets",
    );
  });

  assert.ok(fixture.price_history.length > 0 && fixture.price_history.length <= 260, `sessions=${fixture.price_history.length}`);
  fixture.price_history.forEach((bar) => assert.ok(Number.isFinite(bar.close) && bar.close > 0));
  assert.ok(fixture.price_summary.last_close > 0);
  assert.ok(Number.isFinite(fixture.price_summary.high_52w) && Number.isFinite(fixture.price_summary.low_52w));
  assert.ok(fixture.data_quality.alerts.length >= 2);
  assert.ok(fixture.data_quality.alerts.every((alert) => alert.mode === "provider"));
});

test("USD statements are converted into the listing currency and the conversion is disclosed", () => {
  const base = JSON.parse(fs.readFileSync(RECORDED_RAW, "utf8"));
  const raw = { ...base, ticker: "INFY.NS", quoteSummary: null, search: null };
  const source = raw.timeseries.result.find((entry) => entry?.meta?.type?.[0] === "annualTotalRevenue");
  assert.ok(source && source.annualTotalRevenue.length, "recorded revenue series present");
  const fx = { from: "USD", to: "INR", symbol: "USDINR=X", points: [], rateAt: () => 84 };

  const fixture = yahoo.normalizeYahooSnapshot("INFY.NS", raw, fx);
  assert.equal(fixture.info.currency, "INR");
  assert.equal(fixture.info.exchange, "NSE");

  const lastRow = source.annualTotalRevenue[source.annualTotalRevenue.length - 1];
  const converted = fixture.annual.income_statement.find((row) => row.period_end === lastRow.asOfDate);
  assert.ok(converted, `converted period ${lastRow.asOfDate} present`);
  assert.ok(
    Math.abs(converted.items.revenue - lastRow.reportedValue.raw * 84) < 1,
    `revenue=${converted.items.revenue} expected=${lastRow.reportedValue.raw * 84}`,
  );
  const messages = fixture.data_quality.alerts.map((alert) => alert.message).join(" ");
  assert.ok(messages.includes("converted") && messages.includes("USD") && messages.includes("INR"), `disclosure: ${messages}`);
});

test("statements are omitted, never mixed, when no FX series is available", () => {
  const base = JSON.parse(fs.readFileSync(RECORDED_RAW, "utf8"));
  const raw = { ...base, ticker: "INFY.NS", quoteSummary: null, search: null };
  const fixture = yahoo.normalizeYahooSnapshot("INFY.NS", raw, null);

  assert.equal(fixture.annual.income_statement.length, 0);
  assert.equal(fixture.annual.balance_sheet.length, 0);
  const messages = fixture.data_quality.alerts.map((alert) => alert.message).join(" ");
  assert.ok(messages.includes("omitted"), `disclosure: ${messages}`);
  assert.ok(fixture.price_summary.last_close > 0, "price identity survives so integrity gates still run");
});

test("forecast drivers are derived from reported history and labelled per driver (offline)", async () => {
  const raw = JSON.parse(fs.readFileSync(RECORDED_RAW, "utf8"));
  const providerFixture = yahoo.normalizeYahooSnapshot("AAPL", raw, null);
  const realFetch = global.fetch;
  global.fetch = (input, init) => {
    const url = typeof input === "string" ? input : input?.url;
    if (typeof url === "string" && url.startsWith("/api/market/")) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, cached: false, fixture: providerFixture }) });
    }
    return realFetch(input, init);
  };

  try {
    localStorage.removeItem("apex_market_AAPL");
    const forecast = await api("/api/forecast/AAPL", { method: "POST", body: JSON.stringify({ years: 5, assumptions: {} }) });
    assert.equal(forecast.error, undefined, `forecast error=${forecast.error}`);

    const income = providerFixture.annual.income_statement;
    const revs = income.map((row) => row.items.revenue);
    const span = Number(income[0].period_end.slice(0, 4)) - Number(income[income.length - 1].period_end.slice(0, 4));
    const expectedGrowth = Math.pow(revs[0] / revs[revs.length - 1], 1 / span) - 1;
    assert.ok(
      Math.abs(forecast.assumptions.revenue_growth - expectedGrowth) < 1e-9,
      `growth=${forecast.assumptions.revenue_growth} expected=${expectedGrowth}`,
    );
    assert.ok(forecast.assumption_sources.revenue_growth.startsWith("Derived from reported revenue CAGR"), forecast.assumption_sources.revenue_growth);
    assert.ok(
      Math.abs(forecast.periods[0].revenue - revs[0] * (1 + forecast.assumptions.revenue_growth)) < 1e-6,
      "the derived driver drives the projection",
    );

    const latest = income[0].items;
    if (Number.isFinite(latest.gross_profit) && Number.isFinite(latest.operating_expense)) {
      assert.ok(Math.abs(forecast.assumptions.gross_margin - latest.gross_profit / latest.revenue) < 1e-9, "gross margin derived from reported values");
      assert.ok(Math.abs(forecast.assumptions.opex_ratio - latest.operating_expense / latest.revenue) < 1e-9, "opex ratio derived from reported values");
    }
    assert.equal(
      forecast.assumption_sources.dividend_payout,
      "Engine default (documented assumption)",
      "undrivable drivers stay documented engine defaults",
    );

    const overridden = await api("/api/forecast/AAPL", {
      method: "POST",
      body: JSON.stringify({ years: 5, assumptions: { revenue_growth: 0.03 } }),
    });
    assert.equal(overridden.assumptions.revenue_growth, 0.03, "user input wins");
    assert.equal(overridden.assumption_sources.revenue_growth, "User input (documented assumption)");
  } finally {
    global.fetch = realFetch;
    localStorage.removeItem("apex_market_AAPL");
  }
});

test("live end-to-end: real Yahoo data drives company, forecast and report (skips when offline)", async (t) => {
  let probe;
  try {
    probe = await yahoo.fetchYahooSnapshot("AAPL");
  } catch (error) {
    t.skip(`Yahoo Finance unreachable: ${error.message}`);
    return;
  }
  assert.equal(probe.is_synthetic, false);
  assert.ok(probe.annual.income_statement.length >= 3, `live annual periods=${probe.annual.income_statement.length}`);

  const realFetch = global.fetch;
  global.fetch = (input, init) => {
    const url = typeof input === "string" ? input : input?.url;
    if (typeof url === "string" && url.startsWith("/api/market/")) {
      const ticker = decodeURIComponent(url.slice("/api/market/".length).split("?")[0]);
      return yahoo.fetchYahooSnapshot(ticker).then((fixture) => ({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, cached: false, fixture }),
      }));
    }
    return realFetch(input, init);
  };

  try {
    const record = await generateReport("AAPL", { force_refresh: true });
    assert.equal(record.origin, "provider", `origin=${record.origin}`);
    assert.equal(record.currency, "USD");
    assert.ok(["BUY", "HOLD", "SELL"].includes(record.rating), `rating=${record.rating}`);
    assert.ok(record.fixture && record.fixture.is_synthetic === false, "record stores the provider snapshot");
    assert.ok(
      record.warnings.some((warning) => warning.includes("Provider data") || warning.includes("withheld")),
      `warnings=${record.warnings.join(" | ")}`,
    );

    const { bytes } = await pdfBytesForReport(record.id);
    const text = bytes.toString("latin1");
    assert.ok(!text.includes("SYNTHETIC DATA"), "provider report carries no synthetic sample banner");
    assert.ok(text.includes("Yahoo Finance"), "cover cites the market-data source");
    assert.ok(!text.includes("NaN"), "PDF has no NaN");
    const layout = inspectPdfBytes(new Uint8Array(bytes));
    assert.deepEqual(layout.filter((issue) => issue.level === "error"), [], `layout errors: ${JSON.stringify(layout)}`);

    const company = await api(`/api/company/AAPL?refresh=true`);
    assert.equal(company.demo, false);
    assert.equal(company.provider, "Yahoo Finance");
    assert.ok(company.name && company.name.length > 2, `longName=${company.name}`);

    const forecast = await api(`/api/forecast/AAPL`, {
      method: "POST",
      body: JSON.stringify({ years: 5, assumptions: {} }),
    });
    assert.equal(forecast.error, undefined, `forecast error=${forecast.error}`);
    assert.equal(forecast.periods.length, 5);
    forecast.periods.forEach((period) => {
      ["revenue", "ebitda", "free_cash_flow", "equity", "balance_check"].forEach((key) => {
        assert.ok(Number.isFinite(period[key]), `${key}=${period[key]}`);
      });
    });
    assert.ok(Number.isFinite(forecast.summary.base_balance_residual), "base residual recorded");

    const indian = await yahoo.fetchYahooSnapshot("INFY.NS").catch(() => null);
    if (indian) {
      assert.equal(indian.info.currency, "INR");
      assert.ok(/NSE|BSE/i.test(String(indian.info.exchange)), `exchange=${indian.info.exchange}`);
      const periods = indian.annual.income_statement;
      if (periods.length) {
        assert.ok(periods[0].items.revenue > 5e11, `revenue presented in INR: ${periods[0].items.revenue}`);
      } else {
        assert.ok(
          indian.data_quality.alerts.some((alert) => alert.message.includes("omitted")),
          "missing FX disclosed instead of mixed currencies",
        );
      }
    }
  } finally {
    global.fetch = realFetch;
  }
});
