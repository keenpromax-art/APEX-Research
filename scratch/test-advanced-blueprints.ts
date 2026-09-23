/**
 * APEX RESEARCH — Advanced Report Types Phase 8 Tests
 * ----------------------------------------------------
 * Golden cases for the 10 Phase-8 blueprints: TOC titles/order and section
 * render order (concise + full), module wiring vs the Phase 3 catalog,
 * no page caps, determinism, and composer compatibility.
 *
 * Run: npx tsx scratch/test-advanced-blueprints.ts (exit 1 on failure)
 */
import {
  getReportBlueprint,
  isReportTypeId,
  listReportBlueprints,
  resolveReportOutline,
  INDUSTRY_V1,
  COMPETITIVE_V1,
  MANAGEMENT_V1,
  RISK_V1,
  SOTP_V1,
  BANK_V1,
  INSURANCE_V1,
  REIT_V1,
  SPECIAL_SITUATION_V1,
  PORTFOLIO_V1,
  ADVANCED_BLUEPRINTS,
  REPORT_BLUEPRINTS,
  REPORT_BLUEPRINTS_VERSION,
  type ReportBlueprint,
  type ReportTypeId,
} from "../src/lib/report-types";
import { RESEARCH_MODULE_ORDER, listResearchModules } from "../src/lib/research-modules";
import { composeReport } from "../src/lib/report-composer";
import { buildResearchCase, type BuildResearchCaseParams } from "../src/lib/research-case";
import { createAssumptionsLedger } from "../src/lib/assumptions-ledger";
import type {
  AnnualFinancials,
  CompanyProfile,
  CorporateAnnualFinancials,
  DCFResult,
  PeerData,
  QuarterlyFinancials,
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

function sameArray(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

const AS_OF = "2026-09-01T00:00:00.000Z";

// ── Golden case fixtures (structural goldens — not company conclusions) ─

interface GoldenCase {
  id: ReportTypeId;
  bp: ReportBlueprint;
  tocConcise: string[];
  tocFull: string[];
  sectionsConcise: string[];
  sectionsFull: string[];
}

const GOLDENS: GoldenCase[] = [
  {
    id: "industry_v1",
    bp: INDUSTRY_V1,
    tocConcise: [
      "Industry Structure",
      "Competitive Landscape",
      "Economics & Cycles",
      "Sector Valuation Benchmarks",
    ],
    tocFull: [
      "Industry Structure",
      "Competitive Landscape",
      "Economics & Cycles",
      "Sector Valuation Benchmarks",
    ],
    sectionsConcise: [
      "industry-structure",
      "competitive-landscape",
      "sector-economics",
      "valuation-benchmarks",
    ],
    sectionsFull: [
      "industry-structure",
      "competitive-landscape",
      "sector-economics",
      "valuation-benchmarks",
      "regulatory-outlook",
    ],
  },
  {
    id: "competitive_v1",
    bp: COMPETITIVE_V1,
    tocConcise: ["Competitive Set", "Market Position", "Moat Analysis", "Relative Valuation"],
    tocFull: ["Competitive Set", "Market Position", "Moat Analysis", "Relative Valuation"],
    sectionsConcise: ["competitive-set", "market-position", "moat-analysis", "relative-valuation"],
    sectionsFull: [
      "competitive-set",
      "market-position",
      "moat-analysis",
      "relative-valuation",
      "share-dynamics",
    ],
  },
  {
    id: "management_v1",
    bp: MANAGEMENT_V1,
    tocConcise: ["Leadership", "Governance", "Capital Allocation", "Ownership"],
    tocFull: ["Leadership", "Governance", "Capital Allocation", "Ownership"],
    sectionsConcise: ["leadership", "governance", "capital-allocation", "ownership"],
    sectionsFull: ["leadership", "governance", "capital-allocation", "ownership", "incentives"],
  },
  {
    id: "risk_v1",
    bp: RISK_V1,
    tocConcise: ["Risk Register", "Scenario Stress", "Catalysts & Timeline", "Monitoring Dashboard"],
    tocFull: ["Risk Register", "Scenario Stress", "Catalysts & Timeline", "Monitoring Dashboard"],
    sectionsConcise: [
      "risk-register",
      "scenario-stress",
      "catalysts-timeline",
      "monitoring-dashboard",
    ],
    sectionsFull: [
      "risk-register",
      "scenario-stress",
      "catalysts-timeline",
      "monitoring-dashboard",
      "tail-risks",
    ],
  },
  {
    id: "sotp_v1",
    bp: SOTP_V1,
    tocConcise: ["Segment Map", "Segment Valuation", "Bridge to Equity", "Scenarios"],
    tocFull: ["Segment Map", "Segment Valuation", "Bridge to Equity", "Scenarios"],
    sectionsConcise: ["segment-map", "segment-valuation", "bridge-equity", "sotp-scenarios"],
    sectionsFull: [
      "segment-map",
      "segment-valuation",
      "bridge-equity",
      "sotp-scenarios",
      "holdco-discount",
    ],
  },
  {
    id: "bank_v1",
    bp: BANK_V1,
    tocConcise: [
      "Franchise & Deposits",
      "Asset Quality",
      "Capital & Profitability",
      "Bank Valuation",
    ],
    tocFull: [
      "Franchise & Deposits",
      "Asset Quality",
      "Capital & Profitability",
      "Bank Valuation",
    ],
    sectionsConcise: [
      "franchise-deposits",
      "asset-quality",
      "capital-profitability",
      "bank-valuation",
    ],
    sectionsFull: [
      "franchise-deposits",
      "asset-quality",
      "capital-profitability",
      "bank-valuation",
      "nim-sensitivity",
      "regulatory-capital",
    ],
  },
  {
    id: "insurance_v1",
    bp: INSURANCE_V1,
    tocConcise: [
      "Underwriting & Float",
      "Reserves & Solvency",
      "Embedded Value",
      "Insurance Valuation",
    ],
    tocFull: [
      "Underwriting & Float",
      "Reserves & Solvency",
      "Embedded Value",
      "Insurance Valuation",
    ],
    sectionsConcise: [
      "underwriting-float",
      "reserves-solvency",
      "embedded-value",
      "insurance-valuation",
    ],
    sectionsFull: [
      "underwriting-float",
      "reserves-solvency",
      "embedded-value",
      "insurance-valuation",
      "combined-ratio",
    ],
  },
  {
    id: "reit_v1",
    bp: REIT_V1,
    tocConcise: ["Portfolio & Occupancy", "NAV & Distributions", "Tenant Credit", "REIT Valuation"],
    tocFull: ["Portfolio & Occupancy", "NAV & Distributions", "Tenant Credit", "REIT Valuation"],
    sectionsConcise: [
      "portfolio-occupancy",
      "nav-distributions",
      "tenant-credit",
      "reit-valuation",
    ],
    sectionsFull: [
      "portfolio-occupancy",
      "nav-distributions",
      "tenant-credit",
      "reit-valuation",
      "lease-roll",
    ],
  },
  {
    id: "special_situation_v1",
    bp: SPECIAL_SITUATION_V1,
    tocConcise: [
      "Situation Thesis",
      "Catalyst Timeline",
      "Scenario Valuation",
      "Risks & Invalidation",
    ],
    tocFull: [
      "Situation Thesis",
      "Catalyst Timeline",
      "Scenario Valuation",
      "Risks & Invalidation",
    ],
    sectionsConcise: [
      "situation-thesis",
      "catalyst-timeline",
      "scenario-valuation",
      "risks-invalidation",
    ],
    sectionsFull: [
      "situation-thesis",
      "catalyst-timeline",
      "scenario-valuation",
      "risks-invalidation",
      "event-drivers",
    ],
  },
  {
    id: "portfolio_v1",
    bp: PORTFOLIO_V1,
    tocConcise: ["Holdings Overview", "Allocation & Exposure", "Risk & Return", "Action List"],
    tocFull: ["Holdings Overview", "Allocation & Exposure", "Risk & Return", "Action List"],
    sectionsConcise: [
      "holdings-overview",
      "allocation-exposure",
      "risk-return",
      "action-list",
    ],
    sectionsFull: [
      "holdings-overview",
      "allocation-exposure",
      "risk-return",
      "action-list",
      "concentration",
    ],
  },
];

// ── Minimal ResearchCase for composer compatibility ────────────────────

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

// ══════════════════════════════════════════════════════════════════════

console.log("=======================================================");
console.log("ADVANCED REPORT TYPES PHASE 8 TESTS");
console.log("=======================================================\n");

// ── 1. Registry shape ──────────────────────────────────────────────────
console.log("--- 1. registry shape ---");
{
  check("10 advanced blueprints exported", ADVANCED_BLUEPRINTS.length === 10);
  check("registry total 15", listReportBlueprints().length === 15,
    `got ${listReportBlueprints().length}`);
  check(
    "registry contains all advanced ids",
    GOLDENS.every((g) => isReportTypeId(g.id) && getReportBlueprint(g.id) != null)
  );
  check(
    "advanced blueprints status=stable",
    ADVANCED_BLUEPRINTS.every((b) => b.status === "stable")
  );
  check(
    "version pinned on all advanced",
    ADVANCED_BLUEPRINTS.every((b) => b.version === REPORT_BLUEPRINTS_VERSION)
  );
  check(
    "defaultDepth concise on all advanced",
    ADVANCED_BLUEPRINTS.every((b) => b.defaultDepth === "concise")
  );
}

// ── 2. Golden cases: TOC + section order per type ──────────────────────
console.log("\n--- 2. golden TOC + section order ---");
const catalog = new Set(listResearchModules().map((m) => m.id));
for (const g of GOLDENS) {
  const outC = resolveReportOutline(g.bp, { depth: "concise" });
  const outF = resolveReportOutline(g.bp, { depth: "full" });

  check(
    `${g.id}: concise TOC golden`,
    sameArray(outC.toc.map((t) => t.title), g.tocConcise),
    JSON.stringify({ got: outC.toc.map((t) => t.title), want: g.tocConcise })
  );
  check(
    `${g.id}: full TOC golden`,
    sameArray(outF.toc.map((t) => t.title), g.tocFull),
    JSON.stringify({ got: outF.toc.map((t) => t.title), want: g.tocFull })
  );
  check(
    `${g.id}: concise section order golden`,
    sameArray(outC.sections.map((s) => s.id), g.sectionsConcise),
    JSON.stringify({ got: outC.sections.map((s) => s.id), want: g.sectionsConcise })
  );
  check(
    `${g.id}: full section order golden`,
    sameArray(outF.sections.map((s) => s.id), g.sectionsFull),
    JSON.stringify({ got: outF.sections.map((s) => s.id), want: g.sectionsFull })
  );
  check(
    `${g.id}: full ⊇ concise sections`,
    g.sectionsConcise.every((id) => g.sectionsFull.includes(id))
  );
  check(
    `${g.id}: section indexes 1-based contiguous`,
    outC.sections.every((s, i) => s.index === i + 1) &&
      outF.sections.every((s, i) => s.index === i + 1)
  );
  check(
    `${g.id}: TOC indexes 1-based`,
    outC.toc.every((t, i) => t.index === i + 1)
  );
}

// ── 3. Module wiring + purity ──────────────────────────────────────────
console.log("\n--- 3. module wiring + purity ---");
for (const g of GOLDENS) {
  check(`${g.id}: requiredModules ⊆ catalog`, g.bp.requiredModules.every((m) => catalog.has(m)));
  check(
    `${g.id}: section modules ⊆ catalog`,
    g.bp.sections.every((s) => s.modules.every((m) => catalog.has(m)))
  );
  check(
    `${g.id}: requiredModules cover section modules`,
    g.bp.sections.every((s) => s.modules.every((m) => g.bp.requiredModules.includes(m))),
    JSON.stringify({
      required: g.bp.requiredModules,
      used: [...new Set(g.bp.sections.flatMap((s) => s.modules))],
    })
  );
  check(`${g.id}: unique section ids`, new Set(g.bp.sections.map((s) => s.id)).size === g.bp.sections.length);
  check(`${g.id}: unique TOC titles`, new Set(g.bp.toc.map((t) => t.title)).size === g.bp.toc.length);
  check(
    `${g.id}: no maxPages/pageCount`,
    !("maxPages" in g.bp) && !("pageCount" in g.bp) && !("pageLimit" in g.bp)
  );
  check(
    `${g.id}: no financial numbers embedded`,
    !JSON.stringify(g.bp).match(/fairValue|targetPrice|intrinsicValue|BUY|SELL/)
  );
  check(
    `${g.id}: no run/compute functions`,
    Object.values(g.bp).every((v) => typeof v !== "function")
  );
  check(
    `${g.id}: modules follow RESEARCH_MODULE_ORDER subset`,
    g.bp.requiredModules.every((m) => RESEARCH_MODULE_ORDER.includes(m))
  );
}

// ── 4. Determinism ─────────────────────────────────────────────────────
console.log("\n--- 4. determinism ---");
for (const g of GOLDENS) {
  const a = resolveReportOutline(g.bp, { depth: "full" });
  const b = resolveReportOutline(g.bp, { depth: "full" });
  check(
    `${g.id}: deterministic section ids`,
    sameArray(a.sections.map((s) => s.id), b.sections.map((s) => s.id))
  );
  check(
    `${g.id}: deterministic toc titles`,
    sameArray(a.toc.map((t) => t.title), b.toc.map((t) => t.title))
  );
  check(
    `${g.id}: deterministic moduleIds`,
    sameArray(a.moduleIds, b.moduleIds)
  );
}

// ── 5. Composer compatibility (each type composes) ─────────────────────
console.log("\n--- 5. composer compatibility ---");
{
  const params = baseParams();
  const researchCase = buildResearchCase(params);
  const ctx = { researchCase };
  for (const g of GOLDENS) {
    let ok = false;
    let detail = "";
    try {
      const composed = composeReport({
        context: ctx,
        reportTypeId: g.id,
        depth: "concise",
        composedAt: AS_OF,
      });
      ok =
        composed.blueprintId === g.id &&
        composed.sections.length > 0 &&
        composed.sections.every((s) => s.id.length > 0) &&
        composed.moduleIds.length > 0;
      if (!ok) detail = JSON.stringify({ id: composed.blueprintId, n: composed.sections.length });
    } catch (e) {
      detail = e instanceof Error ? e.message : String(e);
    }
    check(`${g.id}: composeReport succeeds`, ok, detail);
  }

  // Full depth also composes for one sector type (bank) as a smoke check.
  try {
    const fullBank = composeReport({
      context: ctx,
      reportTypeId: "bank_v1",
      depth: "full",
      composedAt: AS_OF,
    });
    check(
      "bank_v1 full depth composes with full-only sections",
      fullBank.sections.some((s) => s.id === "nim-sensitivity") &&
        fullBank.sections.some((s) => s.id === "regulatory-capital"),
      JSON.stringify(fullBank.sections.map((s) => s.id))
    );
  } catch (e) {
    check("bank_v1 full depth composes", false, e instanceof Error ? e.message : String(e));
  }
}

// ── 6. Existing types still intact (no regression) ─────────────────────
console.log("\n--- 6. existing types intact ---");
{
  const inst = getReportBlueprint("institutional_equity_v1");
  check("institutional still stable", inst?.status === "stable");
  check(
    "institutional still golden-sized TOC template",
    (inst?.toc.length ?? 0) >= 7
  );
  const planned = ["tearsheet_v1", "valuation_dossier_v1", "earnings_deep_dive_v1", "forensic_v1"];
  check(
    "4 planned types still planned",
    planned.every((id) => getReportBlueprint(id as ReportTypeId)?.status === "planned")
  );
  check(
    "REPORT_BLUEPRINTS order: institutional first",
    REPORT_BLUEPRINTS[0]?.id === "institutional_equity_v1"
  );
}

console.log("\n=======================================================");
console.log(`ADVANCED REPORT TYPES PHASE 8: ${passes} passed, ${failures} failed`);
console.log("=======================================================");
if (failures > 0) process.exit(1);
