import { computeReportFingerprints, compareFingerprintSets } from "../src/lib/report-originality/fingerprints";
import { detectOriginalityCollision } from "../src/lib/report-originality/collision";
import { persistOriginalitySummary, loadOriginalitySummaries, loadPriorFingerprints, clearOriginalitySummaries, originalityStoreSize } from "../src/lib/report-originality/store";
import { evaluateOriginalityQa, originalityGateForPublication } from "../src/lib/report-originality/qa";
import { compileReportPlan } from "../src/lib/report-plan/compiler";
import { buildChartSpecs, buildTableSpecs } from "../src/lib/report-charts/builder";
import type { CompanyProfile, StockData, CorporateAnnualFinancials, AnnualFinancials } from "../src/types/report";
import type { CanonicalResearchPackage } from "../src/lib/research-package/types";
let passes = 0;
let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    passes++;
    console.log(`  PASS ${name}`);
  } else {
    failures++;
    console.error(`  FAIL ${name}${detail ? ` - ${detail}` : ""}`);
  }
}
const AS_OF = "2026-09-01T00:00:00.000Z";
function profile(ticker: string): CompanyProfile {
  return {
    ticker,
    name: `${ticker} Ltd`,
    exchange: "NSE",
    exchangeTimezoneName: "Asia/Kolkata",
    sector: "Industrials",
    industry: "Industrial Machinery",
    country: "India",
    currency: "INR",
    description: `Company ${ticker}.`,
    website: "example.com",
    employees: 1000,
    officers: [{ name: "C. Rao", title: "CEO" }],
  };
}
function stock(): StockData {
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
    beta: 1.0,
    week52High: 120,
    week52Low: 80,
    sharesOutstanding: 1e9,
    floatShares: 8e8,
    avgVolume: 1e6,
    volume: 1e6,
    fiftyDayAvg: 100,
    twoHundredDayAvg: 95,
    eps: 5,
    forwardEps: 5.5,
    bookValue: 30,
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
    freeCashflow: 5e9,
    totalDebt: 10e9,
    totalCash: 5e9,
    revenueGrowth: 0.1,
    earningsGrowth: 0.08,
    recommendationKey: "buy",
    numberOfAnalystOpinions: 10,
    targetHighPrice: 130,
    targetLowPrice: 90,
    targetMeanPrice: 110,
  } as StockData;
}
function year(y: string, revenue: number): CorporateAnnualFinancials {
  return {
    year: y,
    fiscalYearEnd: `${y.replace("FY", "")}-03-31`,
    statementType: "corporate",
    isFinancialInstitution: false,
    revenue,
    costOfRevenue: revenue * 0.6,
    grossProfit: revenue * 0.4,
    grossMargin: 0.4,
    researchDevelopment: revenue * 0.03,
    sellingGeneralAdministrative: revenue * 0.12,
    totalOperatingExpenses: revenue * 0.15,
    operatingIncome: revenue * 0.18,
    ebitda: revenue * 0.2,
    ebitdaMargin: 0.2,
    ebitMargin: 0.18,
    interestExpense: revenue * 0.01,
    otherIncome: revenue * 0.005,
    pretaxIncome: revenue * 0.175,
    incomeTaxExpense: revenue * 0.045,
    netIncome: revenue * 0.1,
    netMargin: 0.1,
    depreciation: revenue * 0.02,
    eps: 5,
    dilutedEps: 5,
    sharesOutstanding: 1e9,
    totalAssets: 80e9,
    totalLiabilities: 50e9,
    totalEquity: 30e9,
    cash: 8e9,
    shortTermInvestments: 2e9,
    netReceivables: 6e9,
    inventory: 5e9,
    currentAssets: 20e9,
    netFixedAssets: 30e9,
    totalDebt: 10e9,
    shortTermDebt: 3e9,
    longTermDebt: 7e9,
    accountsPayable: 4e9,
    currentLiabilities: 12e9,
    netWorkingCapital: 8e9,
    operatingCashFlow: 7e9,
    capitalExpenditures: 3e9,
    freeCashFlow: 4e9,
    investingCashFlow: -3e9,
    financingCashFlow: -2e9,
    dividendsPaid: 1e9,
    changeInCash: 1e9,
    goodwill: 0,
    otherIntangibles: 0,
  };
}
function pkg(ticker: string, revenue: number, thesis: string): CanonicalResearchPackage {
  return {
    ticker,
    packageId: `CRPKG-${ticker}`,
    dataCutoff: AS_OF,
    sourceSnapshotHash: "hash",
    sourceContext: {
      profile: profile(ticker),
      stockData: stock(),
      annualFinancials: [year("FY2024", revenue), year("FY2025", revenue * 1.1)] as AnnualFinancials[],
    },
    factPack: { ticker },
    forecastSpec: { assumptions: [], driverPaths: {} },
    executedForecast: { incomeStatement: [], cashFlow: [] },
    valuationSpec: { discountRate: 0.11, assumptions: [] },
    valuationMatrix: { status: "ready" },
    valuationResult: { fairValuePerShare: 110, upsidePct: 10, status: "ready", methodology: "fcff", outputs: {}, bridge: {} },
    rating: "HOLD",
    scenarios: [],
    sensitivity: [],
    researchPlan: { questions: [], unknowns: [], requiredResearch: [], epistemicSummary: "" },
    researchReport: { debates: [], thesis: { thesis }, conclusion: thesis, moat: { hasMoat: false, verdict: "none" } },
    evidenceRegistry: { items: [{ id: "EV:1" }] },
    quality: { canPublish: true, blockers: [], warnings: [], checks: [] },
    versions: { package: "canonical-research-package-v1", factPack: "f1", model: "m1", forecast: "fv1", valuation: "vv1", review: "rv1", prompt: "p1" },
    packageHash: "x",
    run: { startedAt: AS_OF, completedAt: AS_OF },
  } as unknown as CanonicalResearchPackage;
}
console.log("REPORT ORIGINALITY TESTS");
clearOriginalitySummaries();
{
  const value = pkg("ORIGA.NS", 50e9, "Compounder thesis with durable margins.");
  const plan = compileReportPlan({ packageValue: value, blueprintId: "institutional_equity_v1", depth: "concise", identity: null, researchPlan: value.researchPlan as never, generatedAt: AS_OF });
  const charts = buildChartSpecs({ packageValue: value, plan });
  const tables = buildTableSpecs({ packageValue: value, plan });
  const acceptedCharts = [...charts.specs].filter((s) => !s.omissionReason);
  const acceptedTables = [...tables.specs].filter((s) => !s.omissionReason);
  const set = computeReportFingerprints({ packageValue: value, plan, charts: acceptedCharts, tables: acceptedTables, identity: null });
  check("fingerprint version", set.version === "report-fingerprint-v1");
  check("fingerprint ticker", set.ticker === "ORIGA.NS");
  check("content 64", set.content.length === 64);
  check("analytical 64", set.analytical.length === 64);
  check("section 64", set.section.length === 64);
  check("chart 64", set.chart.length === 64);
  check("table 64", set.table.length === 64);
  check("visual 64", set.visual.length === 64);
  check("narrative 64", set.narrative.length === 64);
  check("combined 64", set.combined.length === 64);
  const again = computeReportFingerprints({ packageValue: value, plan, charts: acceptedCharts, tables: acceptedTables, identity: null });
  check("fingerprint deterministic", again.combined === set.combined);
  const other = pkg("ORIGB.NS", 90e9, "Turnaround thesis with distressed recovery.");
  const otherPlan = compileReportPlan({ packageValue: other, blueprintId: "institutional_equity_v1", depth: "concise", identity: null, researchPlan: other.researchPlan as never, generatedAt: AS_OF });
  const otherCharts = buildChartSpecs({ packageValue: other, plan: otherPlan });
  const otherTables = buildTableSpecs({ packageValue: other, plan: otherPlan });
  const otherSet = computeReportFingerprints({ packageValue: other, plan: otherPlan, charts: otherCharts.specs.filter((s) => !s.omissionReason), tables: otherTables.specs.filter((s) => !s.omissionReason), identity: null });
  check("different companies different combined", otherSet.combined !== set.combined);
  const detail = compareFingerprintSets(set, set);
  check("self overall 1", detail.overall === 1);
  check("self content 1", detail.content === 1);
}
{
  const value = pkg("ORIGA.NS", 50e9, "Compounder thesis.");
  const plan = compileReportPlan({ packageValue: value, blueprintId: "institutional_equity_v1", depth: "concise", identity: null, researchPlan: value.researchPlan as never, generatedAt: AS_OF });
  const charts = buildChartSpecs({ packageValue: value, plan });
  const tables = buildTableSpecs({ packageValue: value, plan });
  const set = computeReportFingerprints({ packageValue: value, plan, charts: charts.specs.filter((s) => !s.omissionReason), tables: tables.specs.filter((s) => !s.omissionReason), identity: null });
  const clear = detectOriginalityCollision({ ticker: "ORIGA.NS", fingerprints: set, priors: [], generatedAt: AS_OF });
  check("no priors clear", clear.status === "clear" && clear.comparisons === 0);
  const identicalPrior = { ticker: "ORIGB.NS", fingerprints: set };
  const collision = detectOriginalityCollision({ ticker: "ORIGA.NS", fingerprints: set, priors: [identicalPrior], generatedAt: AS_OF });
  check("identical cross-company collision", collision.status === "collision" && collision.maximumSimilarity === 1);
  check("collision comparisons", collision.comparisons === 1);
  const approved = detectOriginalityCollision({ ticker: "ORIGA.NS", fingerprints: set, priors: [identicalPrior], generatedAt: AS_OF, approvedFingerprints: [set.combined] });
  check("approved similarity not blocking", approved.status === "clear");
  const peers = detectOriginalityCollision({ ticker: "ORIGA.NS", fingerprints: set, priors: [], generatedAt: AS_OF, peerTickers: ["PEER1.NS", "PEER2.NS"] });
  check("peer mentions recorded", peers.peerMentionsAllowed.includes("PEER1.NS") && peers.peerMentionsAllowed.includes("PEER2.NS"));
  const sameTicker = detectOriginalityCollision({ ticker: "ORIGA.NS", fingerprints: set, priors: [{ ticker: "ORIGA.NS", fingerprints: set }], generatedAt: AS_OF });
  check("same ticker excluded", sameTicker.comparisons === 0 && sameTicker.status === "clear");
}
{
  clearOriginalitySummaries();
  check("store starts empty", originalityStoreSize() === 0);
  const value = pkg("STOREA.NS", 50e9, "Thesis A.");
  const plan = compileReportPlan({ packageValue: value, blueprintId: "institutional_equity_v1", depth: "concise", identity: null, researchPlan: value.researchPlan as never, generatedAt: AS_OF });
  const charts = buildChartSpecs({ packageValue: value, plan });
  const tables = buildTableSpecs({ packageValue: value, plan });
  const set = computeReportFingerprints({ packageValue: value, plan, charts: charts.specs.filter((s) => !s.omissionReason), tables: tables.specs.filter((s) => !s.omissionReason), identity: null });
  const report = detectOriginalityCollision({ ticker: "STOREA.NS", fingerprints: set, priors: [], generatedAt: AS_OF });
  const summary = persistOriginalitySummary({ ticker: "STOREA.NS", fingerprints: set, report });
  check("persist returns summary", summary.ticker === "STOREA.NS" && summary.combined === set.combined);
  check("store size 1", originalityStoreSize() === 1);
  check("load by ticker", loadOriginalitySummaries("STOREA.NS").length === 1);
  check("priors exclude self", loadPriorFingerprints("STOREA.NS").length === 0);
  const other = pkg("STOREB.NS", 60e9, "Thesis B.");
  const otherPlan = compileReportPlan({ packageValue: other, blueprintId: "institutional_equity_v1", depth: "concise", identity: null, researchPlan: other.researchPlan as never, generatedAt: AS_OF });
  const otherCharts = buildChartSpecs({ packageValue: other, plan: otherPlan });
  const otherTables = buildTableSpecs({ packageValue: other, plan: otherPlan });
  const otherSet = computeReportFingerprints({ packageValue: other, plan: otherPlan, charts: otherCharts.specs.filter((s) => !s.omissionReason), tables: otherTables.specs.filter((s) => !s.omissionReason), identity: null });
  const otherReport = detectOriginalityCollision({ ticker: "STOREB.NS", fingerprints: otherSet, priors: loadPriorFingerprints("STOREB.NS"), generatedAt: AS_OF });
  check("priors include other ticker", otherReport.comparisons === 1);
  persistOriginalitySummary({ ticker: "STOREB.NS", fingerprints: otherSet, report: otherReport });
  check("store bounded", originalityStoreSize() === 2);
  clearOriginalitySummaries("STOREA.NS");
  check("clear by ticker", loadOriginalitySummaries("STOREA.NS").length === 0 && originalityStoreSize() === 1);
  clearOriginalitySummaries();
  check("clear all", originalityStoreSize() === 0);
}
{
  const value = pkg("QAA.NS", 50e9, "Thesis.");
  const plan = compileReportPlan({ packageValue: value, blueprintId: "institutional_equity_v1", depth: "concise", identity: null, researchPlan: value.researchPlan as never, generatedAt: AS_OF });
  const charts = buildChartSpecs({ packageValue: value, plan });
  const tables = buildTableSpecs({ packageValue: value, plan });
  const set = computeReportFingerprints({ packageValue: value, plan, charts: charts.specs.filter((s) => !s.omissionReason), tables: tables.specs.filter((s) => !s.omissionReason), identity: null });
  const collision = detectOriginalityCollision({ ticker: "QAA.NS", fingerprints: set, priors: [{ ticker: "QAB.NS", fingerprints: set }], generatedAt: AS_OF });
  const qaFail = evaluateOriginalityQa(collision);
  check("collision fails QA", qaFail.passed === false && qaFail.blockers.length > 0);
  const clear = detectOriginalityCollision({ ticker: "QAA.NS", fingerprints: set, priors: [], generatedAt: AS_OF });
  const qaPass = evaluateOriginalityQa(clear);
  check("clear passes QA", qaPass.passed === true && qaPass.blockers.length === 0);
  const qaNull = evaluateOriginalityQa(null);
  check("null passes with warning", qaNull.passed === true);
  const gateBlocked = originalityGateForPublication(collision);
  check("gate blocks on collision", gateBlocked.publishAllowed === false);
  const gateAllowed = originalityGateForPublication(clear);
  check("gate allows on clear", gateAllowed.publishAllowed === true);
}
console.log(`report-originality: ${passes} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
