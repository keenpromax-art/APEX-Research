/**
 * APEX RESEARCH — Report UI (Phase 9) Tests
 * -----------------------------------------
 * Selector helpers (stable-only options, fail-closed query parsing, query
 * building) + composition honouring the selected report type / depth
 * (re-compose contract used by ReportClient) + institutional regression
 * (pdfComponent gate unchanged for the golden type).
 *
 * Run: npx tsx scratch/test-report-ui.ts (exit 1 on failure)
 */
import {
  DEFAULT_RESEARCH_DEPTH,
  DEFAULT_REPORT_TYPE,
  buildReportQuery,
  getReportBlueprint,
  listReportBlueprints,
  parseDepthParam,
  parseReportTypeParam,
  reportTypeTitle,
  selectableReportTypes,
  type ReportTypeId,
} from "../src/lib/report-types";
import { composeReportFromData } from "../src/lib/report-composer";
import { buildResearchCase, type BuildResearchCaseParams } from "../src/lib/research-case";
import { createAssumptionsLedger } from "../src/lib/assumptions-ledger";
import type {
  AnnualFinancials,
  CompanyProfile,
  CorporateAnnualFinancials,
  DCFResult,
  PeerData,
  QuarterlyFinancials,
  ReportData,
  StockData,
} from "../src/types/report";

let passes = 0;
let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    passes++;
    console.log(`  ✅ ${name}`);
  } else {
    failures++;
    console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const AS_OF = "2026-09-01T00:00:00.000Z";

// ── Minimal fixtures (same shape as test-advanced-blueprints) ──────────

function makeProfile(): CompanyProfile {
  return {
    ticker: "TEST.NS",
    name: "Test Industries Ltd",
    exchange: "NSE",
    exchangeTimezoneName: "Asia/Kolkata",
    sector: "Industrials",
    industry: "Industrial Machinery",
    country: "India",
    currency: "INR",
    description: "Test Industries manufactures industrial machinery.",
    website: "https://example.com",
    employees: 5000,
    officers: [{ name: "A. Sharma", title: "CEO" }],
  };
}

function makeStock(): StockData {
  return {
    currentPrice: 100,
    previousClose: 99,
    open: 99,
    dayHigh: 101,
    dayLow: 98,
    marketCap: 100e9,
    enterpriseValue: 110e9,
    pe: 20,
    forwardPE: 18,
    pb: 3,
    ps: 4,
    dividendYield: 0.01,
    dividendRate: 1,
    beta: 1.1,
    week52High: 120,
    week52Low: 80,
    sharesOutstanding: 1e9,
    floatShares: 8e8,
    avgVolume: 1e6,
    volume: 1.1e6,
    fiftyDayAvg: 102,
    twoHundredDayAvg: 98,
    eps: 5,
    forwardEps: 5.5,
    bookValue: 33.3,
    priceToBook: 3,
    returnOnEquity: 0.15,
    returnOnAssets: 0.07,
    debtToEquity: 0.5,
    currentRatio: 1.5,
    quickRatio: 1.2,
    grossMargins: 0.4,
    ebitdaMargins: 0.2,
    operatingMargins: 0.15,
    profitMargins: 0.1,
    freeCashflow: 8e9,
    totalDebt: 20e9,
    totalCash: 10e9,
    revenueGrowth: 0.1,
    earningsGrowth: 0.08,
    recommendationKey: "buy",
    numberOfAnalystOpinions: 20,
    targetHighPrice: 130,
    targetLowPrice: 90,
    targetMeanPrice: 115,
  } as StockData;
}

function makeYear(year: string): CorporateAnnualFinancials {
  const revenue = 50e9;
  return {
    year,
    fiscalYearEnd: `${year.replace("FY", "")}-03-31`,
    statementType: "corporate",
    isFinancialInstitution: false,
    revenue,
    costOfRevenue: revenue * 0.6,
    grossProfit: revenue * 0.4,
    operatingIncome: revenue * 0.18,
    ebitda: revenue * 0.2,
    netIncome: 5e9,
    totalAssets: 80e9,
    totalLiabilities: 50e9,
    totalEquity: 30e9,
    cash: 8e9,
    totalDebt: 10e9,
    operatingCashFlow: 7e9,
    capitalExpenditures: 3e9,
    freeCashFlow: 4e9,
    sharesOutstanding: 1e9,
    eps: 5,
  } as CorporateAnnualFinancials;
}

function makeQuarters(): QuarterlyFinancials[] {
  return ["Q1FY2026", "Q2FY2026", "Q3FY2026", "Q4FY2026"].map((period, i) => ({
    period,
    revenue: 12e9 + i * 0.5e9,
    netIncome: 1.2e9 + i * 0.1e9,
    ebitda: 2.5e9 + i * 0.1e9,
    ebit: 2e9 + i * 0.1e9,
  })) as QuarterlyFinancials[];
}

function makePeers(n: number): PeerData[] {
  return Array.from({ length: n }, (_, i) => ({
    ticker: `PEER${i}.NS`,
    name: `Peer ${i}`,
    price: 50 + i,
    marketCap: 20e9 + i * 1e9,
    pe: 15 + i,
    pb: 2 + i * 0.1,
    evEbitda: 10 + i,
    roe: 0.1 + i * 0.01,
    revenueGrowth: 0.05 + i * 0.01,
    ebitdaMargin: 0.15,
  })) as PeerData[];
}

function makeDcf(): DCFResult {
  return {
    intrinsicValue: 120,
    fairValuePerShare: 120,
    enterpriseValue: 110e9,
    netDebt: 10e9,
    equityValue: 100e9,
    verdict: "BUY",
    assumptions: { wacc: 0.11, terminalGrowthRate: 0.04 },
    projections: [],
  } as unknown as DCFResult;
}

function baseParams(): BuildResearchCaseParams {
  const profile = makeProfile();
  const stockData = makeStock();
  const annualFinancials = [
    makeYear("FY2022"),
    makeYear("FY2023"),
    makeYear("FY2024"),
    makeYear("FY2025"),
    makeYear("FY2026"),
  ] as AnnualFinancials[];
  const valuation = makeDcf();
  return {
    profile,
    stockData,
    annualFinancials,
    quarterlyFinancials: makeQuarters(),
    peers: makePeers(4),
    valuation,
    assumptionsLedger: createAssumptionsLedger({
      profile,
      stockData,
      annualFinancials,
      dcf: valuation,
    }),
    createdAt: AS_OF,
    dataCutoff: AS_OF,
  };
}

function makeReportData(): ReportData {
  const params = baseParams();
  const researchCase = buildResearchCase(params);
  return {
    generatedAt: AS_OF,
    profile: params.profile,
    stockData: params.stockData,
    annualFinancials: params.annualFinancials,
    quarterlyFinancials: params.quarterlyFinancials,
    ratiosByYear: [],
    dupontByYear: [],
    dcf: params.valuation,
    researchCase,
    peers: params.peers,
    aiAnalysis: {} as ReportData["aiAnalysis"],
    shareholding: {} as ReportData["shareholding"],
  } as unknown as ReportData;
}

// ══════════════════════════════════════════════════════════════════════

console.log("=======================================================");
console.log("REPORT UI PHASE 9 TESTS");
console.log("=======================================================\n");

// ── 1. Selector options (stable only) ──────────────────────────────────
console.log("--- 1. selector options ---");
{
  const opts = selectableReportTypes();
  check("selectable count is 11 (institutional + 10 advanced)", opts.length === 11, `got ${opts.length}`);
  check(
    "no planned types offered",
    opts.every((o) => getReportBlueprint(o.id)?.status === "stable")
  );
  check(
    "planned ids never selectable",
    ["tearsheet_v1", "valuation_dossier_v1", "earnings_deep_dive_v1", "forensic_v1"].every(
      (id) => !opts.some((o) => o.id === id)
    )
  );
  check("ids unique", new Set(opts.map((o) => o.id)).size === opts.length);
  check(
    "institutional first (registry order)",
    opts[0]?.id === "institutional_equity_v1"
  );
  check(
    "every option has a non-empty title + description",
    opts.every((o) => o.title.length > 0 && o.description.length > 0)
  );
  check(
    "every option defaultDepth is concise or full",
    opts.every((o) => o.defaultDepth === "concise" || o.defaultDepth === "full")
  );
  check(
    "stable count matches registry stable filter",
    opts.length === listReportBlueprints().filter((b) => b.status === "stable").length
  );
}

// ── 2. Fail-closed query parsing ───────────────────────────────────────
console.log("\n--- 2. query parsing (fail-closed) ---");
{
  check("DEFAULT_REPORT_TYPE is institutional", DEFAULT_REPORT_TYPE === "institutional_equity_v1");
  check("DEFAULT_RESEARCH_DEPTH is concise", DEFAULT_RESEARCH_DEPTH === "concise");
  check("parse type undefined → institutional", parseReportTypeParam(undefined) === DEFAULT_REPORT_TYPE);
  check("parse type null → institutional", parseReportTypeParam(null) === DEFAULT_REPORT_TYPE);
  check("parse type garbage → institutional", parseReportTypeParam("not_a_type") === DEFAULT_REPORT_TYPE);
  check("parse type number → institutional", parseReportTypeParam(42) === DEFAULT_REPORT_TYPE);
  check("parse type empty → institutional", parseReportTypeParam("") === DEFAULT_REPORT_TYPE);
  check("parse type planned id → institutional", parseReportTypeParam("tearsheet_v1") === DEFAULT_REPORT_TYPE);
  check("parse type valid advanced passes", parseReportTypeParam("bank_v1") === "bank_v1");
  check("parse type valid institutional passes", parseReportTypeParam("institutional_equity_v1") === "institutional_equity_v1");
  check("parse depth undefined → concise", parseDepthParam(undefined) === "concise");
  check("parse depth concise → concise", parseDepthParam("concise") === "concise");
  check("parse depth full → full", parseDepthParam("full") === "full");
  check("parse depth garbage → concise", parseDepthParam("FULL") === "concise");
  check("parse depth number → concise", parseDepthParam(1) === "concise");
}

// ── 3. Query building + round-trip ─────────────────────────────────────
console.log("\n--- 3. query building ---");
{
  const q = buildReportQuery();
  check("default query includes type", q.includes("type=institutional_equity_v1"));
  check("default query includes depth", q.includes("depth=concise"));
  check("default query starts with ?", q.startsWith("?"));
  const q2 = buildReportQuery("industry_v1", "full");
  check("custom query type", q2.includes("type=industry_v1"));
  check("custom query depth", q2.includes("depth=full"));
  const parsed = new URLSearchParams(q2);
  check(
    "round-trip type",
    parseReportTypeParam(parsed.get("type")) === "industry_v1"
  );
  check("round-trip depth", parseDepthParam(parsed.get("depth")) === "full");
  check(
    "round-trip garbage query falls back",
    parseReportTypeParam("bogus") === "institutional_equity_v1" &&
      parseDepthParam("bogus") === "concise"
  );
  check(
    "reportTypeTitle institutional",
    reportTypeTitle("institutional_equity_v1") === "Institutional Equity Research"
  );
  check("reportTypeTitle bank", reportTypeTitle("bank_v1") === "Banking Sector Report");
}

// ── 4. Composition honours selection (re-compose contract) ─────────────
console.log("\n--- 4. compose with selected type + depth ---");
{
  const report = makeReportData();

  const defaultComposed = composeReportFromData(report, { composedAt: AS_OF });
  check("default compose is institutional", defaultComposed?.blueprintId === "institutional_equity_v1");
  check("default compose is concise", defaultComposed?.depth === "concise");

  const industryFull = composeReportFromData(report, {
    reportTypeId: "industry_v1",
    depth: "full",
    composedAt: AS_OF,
  });
  check("industry full compose blueprintId", industryFull?.blueprintId === "industry_v1");
  check("industry full compose depth full", industryFull?.depth === "full");
  check(
    "industry full includes full-only section",
    (industryFull?.sections.some((s) => s.id === "regulatory-outlook") ?? false)
  );
  check(
    "industry full sections differ from institutional",
    JSON.stringify(industryFull?.sections.map((s) => s.id)) !==
      JSON.stringify(defaultComposed?.sections.map((s) => s.id))
  );

  const industryConcise = composeReportFromData(report, {
    reportTypeId: "industry_v1",
    depth: "concise",
    composedAt: AS_OF,
  });
  check(
    "industry concise excludes full-only section",
    !(industryConcise?.sections.some((s) => s.id === "regulatory-outlook") ?? false)
  );

  // Re-compose in place (ReportClient selector change contract).
  const recomposed = composeReportFromData(report, {
    reportTypeId: "bank_v1",
    depth: "full",
    composedAt: AS_OF,
  });
  check("re-compose to bank full works", recomposed?.blueprintId === "bank_v1" && recomposed?.depth === "full");
  check(
    "bank full has both full-only sections",
    (recomposed?.sections.some((s) => s.id === "nim-sensitivity") ?? false) &&
      (recomposed?.sections.some((s) => s.id === "regulatory-capital") ?? false)
  );
  check(
    "re-compose deterministic",
    JSON.stringify(
      composeReportFromData(report, { reportTypeId: "bank_v1", depth: "full", composedAt: AS_OF })?.sections.map(
        (s) => s.id
      )
    ) === JSON.stringify(recomposed?.sections.map((s) => s.id))
  );
  check(
    "original report object not mutated by compose",
    report.composedReport === undefined || report.composedReport === null
  );

  // Institutional regression: composed sections still carry pdfComponent
  // (PDF composed-path gate unchanged by Phase 9).
  check(
    "institutional composed sections all carry pdfComponent",
    (defaultComposed?.sections.every((s) => typeof s.pdfComponent === "string" && s.pdfComponent.length > 0) ??
      false)
  );
  check(
    "institutional TOC titles unchanged with options",
    JSON.stringify(
      composeReportFromData(report, {
        reportTypeId: "institutional_equity_v1",
        depth: "full",
        composedAt: AS_OF,
      })?.toc.map((t) => t.title)
    ) === JSON.stringify(
      composeReportFromData(report, { depth: "full", composedAt: AS_OF })?.toc.map((t) => t.title)
    )
  );
}

// ── 5. Purity: selector module stays data-only ─────────────────────────
console.log("\n--- 5. purity ---");
{
  check(
    "selectable options carry no functions",
    selectableReportTypes().every((o) => Object.values(o).every((v) => typeof v !== "function"))
  );
  check(
    "buildReportQuery has no side-effect fields",
    !buildReportQuery("industry_v1", "full").match(/maxPages|pageCount/)
  );
}

console.log("\n=======================================================");
console.log(`REPORT UI PHASE 9: ${passes} passed, ${failures} failed`);
console.log("=======================================================");
if (failures > 0) process.exit(1);
