import { listChartCatalog, listTableCatalog, isKnownChartId, isKnownTableId, getChartCatalogEntry, getTableCatalogEntry } from "../src/lib/report-charts/catalog";
import { validateChartProposals, validateTableProposals, filterProposalsToCatalog } from "../src/lib/report-charts/proposal";
import { buildChartSpecs, buildTableSpecs, verifyChartSpec, verifyTableSpec } from "../src/lib/report-charts/builder";
import { compileReportPlan } from "../src/lib/report-plan/compiler";
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
function profile(): CompanyProfile {
  return {
    ticker: "CHART.NS",
    name: "Chart Ltd",
    exchange: "NSE",
    exchangeTimezoneName: "Asia/Kolkata",
    sector: "Industrials",
    industry: "Industrial Machinery",
    country: "India",
    currency: "INR",
    description: "Chart company.",
    website: "example.com",
    employees: 1000,
    officers: [{ name: "C. Rao", title: "CEO" }],
  };
}
function stock(): StockData {
  return {
    currentPrice: 200,
    previousClose: 199,
    open: 199,
    dayHigh: 201,
    dayLow: 198,
    marketCap: 200e9,
    enterpriseValue: 210e9,
    pe: 20,
    forwardPE: 18,
    pb: 3,
    ps: 4,
    dividendYield: 0.01,
    dividendRate: 1,
    beta: 1.0,
    week52High: 220,
    week52Low: 180,
    sharesOutstanding: 1e9,
    floatShares: 8e8,
    avgVolume: 1e6,
    volume: 1e6,
    fiftyDayAvg: 200,
    twoHundredDayAvg: 195,
    eps: 10,
    forwardEps: 11,
    bookValue: 60,
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
    numberOfAnalystOpinions: 10,
    targetHighPrice: 240,
    targetLowPrice: 180,
    targetMeanPrice: 210,
  } as StockData;
}
function year(y: string): CorporateAnnualFinancials {
  const revenue = 60e9;
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
    netIncome: 6e9,
    netMargin: 0.1,
    depreciation: revenue * 0.02,
    eps: 6,
    dilutedEps: 6,
    sharesOutstanding: 1e9,
    totalAssets: 90e9,
    totalLiabilities: 55e9,
    totalEquity: 35e9,
    cash: 9e9,
    shortTermInvestments: 2e9,
    netReceivables: 7e9,
    inventory: 5e9,
    currentAssets: 22e9,
    netFixedAssets: 32e9,
    totalDebt: 12e9,
    shortTermDebt: 3e9,
    longTermDebt: 9e9,
    accountsPayable: 4e9,
    currentLiabilities: 13e9,
    netWorkingCapital: 9e9,
    operatingCashFlow: 8e9,
    capitalExpenditures: 3e9,
    freeCashFlow: 5e9,
    investingCashFlow: -3e9,
    financingCashFlow: -2e9,
    dividendsPaid: 1.5e9,
    changeInCash: 1e9,
    goodwill: 0,
    otherIntangibles: 0,
  };
}
function pkg(): CanonicalResearchPackage {
  return {
    ticker: "CHART.NS",
    packageId: "CRPKG-CHART",
    dataCutoff: AS_OF,
    sourceSnapshotHash: "hash",
    sourceContext: {
      profile: profile(),
      stockData: stock(),
      annualFinancials: [year("FY2023"), year("FY2024"), year("FY2025")] as AnnualFinancials[],
    },
    factPack: { ticker: "CHART.NS" },
    forecastSpec: { assumptions: [], driverPaths: {} },
    executedForecast: { incomeStatement: [{ period: "FY2026", values: { revenue: 66e9 } }], cashFlow: [] },
    valuationSpec: { discountRate: 0.11, assumptions: [] },
    valuationMatrix: { status: "ready" },
    valuationResult: { fairValuePerShare: 220, upsidePct: 10, status: "ready", methodology: "fcff", outputs: {}, bridge: {} },
    rating: "HOLD",
    scenarios: [{ targetPrice: 180 }, { targetPrice: 220 }, { targetPrice: 260 }],
    sensitivity: [{ wacc: 0.11, value: 220 }],
    researchPlan: { questions: [], unknowns: [], requiredResearch: [], epistemicSummary: "" },
    researchReport: { debates: [], thesis: { thesis: "t" }, moat: { hasMoat: false, verdict: "none" } },
    evidenceRegistry: { items: [{ id: "EV:1" }] },
    quality: { canPublish: true, blockers: [], warnings: [], checks: [] },
    versions: { package: "canonical-research-package-v1", factPack: "f1", model: "m1", forecast: "fv1", valuation: "vv1", review: "rv1", prompt: "p1" },
    packageHash: "x",
    run: { startedAt: AS_OF, completedAt: AS_OF },
  } as unknown as CanonicalResearchPackage;
}
console.log("REPORT CHARTS TESTS");
{
  const charts = listChartCatalog();
  const tables = listTableCatalog();
  check("chart catalog non-empty", charts.length > 5);
  check("table catalog non-empty", tables.length > 5);
  check("chart catalog sorted", JSON.stringify(charts.map((c) => c.id)) === JSON.stringify([...charts.map((c) => c.id)].sort()));
  check("table catalog sorted", JSON.stringify(tables.map((c) => c.id)) === JSON.stringify([...tables.map((c) => c.id)].sort()));
  check("known chart id", isKnownChartId("chart-revenue-growth") === true);
  check("unknown chart rejected", isKnownChartId("chart-fake-xyz") === false);
  check("known table id", isKnownTableId("table-statements") === true);
  check("unknown table rejected", isKnownTableId("table-fake-xyz") === false);
  const entry = getChartCatalogEntry("chart-revenue-growth");
  check("chart entry fact-bound", Boolean(entry) && typeof entry?.dataSelector === "string" && typeof entry?.units === "string" && Array.isArray(entry?.allowedProvenance));
  const tentry = getTableCatalogEntry("table-statements");
  check("table entry fact-bound", Boolean(tentry) && typeof tentry?.dataSelector === "string");
  check("chart entry unknown null", getChartCatalogEntry("nope") === null);
  check("table entry unknown null", getTableCatalogEntry("nope") === null);
}
{
  const chartResult = validateChartProposals(["chart-revenue-growth", "chart-fake-xyz", "chart-profitability", "chart-revenue-growth"]);
  check("chart proposals accept known", chartResult.accepted.includes("chart-revenue-growth") && chartResult.accepted.includes("chart-profitability"));
  check("chart proposals reject unknown", chartResult.rejected.some((r) => r.id === "chart-fake-xyz"));
  check("chart proposals dedupe", chartResult.accepted.filter((id) => id === "chart-revenue-growth").length === 1);
  check("chart proposals sorted", JSON.stringify(chartResult.accepted) === JSON.stringify([...chartResult.accepted].sort()));
  const tableResult = validateTableProposals(["table-statements", "table-fake-xyz"]);
  check("table proposals accept known", tableResult.accepted.includes("table-statements"));
  check("table proposals reject unknown", tableResult.rejected.some((r) => r.id === "table-fake-xyz"));
  const filtered = filterProposalsToCatalog(["chart-revenue-growth", "bad"], ["table-statements", "bad"]);
  check("filter proposals charts", filtered.charts.includes("chart-revenue-growth") && filtered.rejectedCharts.length === 1);
  check("filter proposals tables", filtered.tables.includes("table-statements") && filtered.rejectedTables.length === 1);
  const malformed = validateChartProposals(["", 42, null]);
  check("malformed proposals rejected", malformed.accepted.length === 0 && malformed.rejected.length === 3);
}
{
  const value = pkg();
  const plan = compileReportPlan({ packageValue: value, blueprintId: "institutional_equity_v1", depth: "concise", identity: null, researchPlan: value.researchPlan as never, generatedAt: AS_OF });
  const chartBuilt = buildChartSpecs({ packageValue: value, plan, proposedChartIds: ["chart-revenue-growth", "chart-fake-xyz", "chart-valuation-scenarios"] });
  check("chart specs built", chartBuilt.specs.length > 0);
  check("unknown proposal never built", [...chartBuilt.specs, ...chartBuilt.omitted].every((s) => s.id !== "chart-fake-xyz"));
  for (const spec of chartBuilt.specs) {
    check(`chart ${spec.id} hash 64`, spec.hash.length === 64);
    check(`chart ${spec.id} verified`, verifyChartSpec(spec) === true);
    check(`chart ${spec.id} canonical series`, Array.isArray(spec.periods) && Array.isArray(spec.series));
    check(`chart ${spec.id} units currency`, typeof spec.units === "string" && (spec.currency === null || typeof spec.currency === "string"));
    check(`chart ${spec.id} source derivation ids`, Array.isArray(spec.sourceIds) && Array.isArray(spec.derivationIds));
    check(`chart ${spec.id} status valid`, spec.provenance === "measured" || spec.provenance === "derived" || spec.provenance === "illustrative");
    check(`chart ${spec.id} omission null when accepted`, spec.omissionReason === null);
  }
  for (const spec of chartBuilt.omitted) {
    check(`omitted chart ${spec.id} has reason`, typeof spec.omissionReason === "string" && (spec.omissionReason?.length ?? 0) > 0);
  }
  const tableBuilt = buildTableSpecs({ packageValue: value, plan, proposedTableIds: ["table-statements", "table-fake-xyz", "table-scenarios"] });
  check("table specs built", tableBuilt.specs.length > 0);
  check("unknown table never built", [...tableBuilt.specs, ...tableBuilt.omitted].every((s) => s.id !== "table-fake-xyz"));
  for (const spec of tableBuilt.specs) {
    check(`table ${spec.id} hash 64`, spec.hash.length === 64);
    check(`table ${spec.id} verified`, verifyTableSpec(spec) === true);
    check(`table ${spec.id} omission null`, spec.omissionReason === null);
  }
  const again = buildChartSpecs({ packageValue: value, plan, proposedChartIds: ["chart-revenue-growth", "chart-valuation-scenarios"] });
  check("chart determinism", JSON.stringify(chartBuilt.specs.map((s) => s.hash)) === JSON.stringify(again.specs.map((s) => s.hash)));
  const emptyPkg = { ...value, sourceContext: { ...value.sourceContext, annualFinancials: [] } } as CanonicalResearchPackage;
  const emptyPlan = compileReportPlan({ packageValue: emptyPkg, blueprintId: "institutional_equity_v1", depth: "concise", identity: null, researchPlan: value.researchPlan as never, generatedAt: AS_OF });
  const emptyCharts = buildChartSpecs({ packageValue: emptyPkg, plan: emptyPlan, proposedChartIds: ["chart-revenue-growth"] });
  check("missing history omits with reason", emptyCharts.specs.length === 0 && emptyCharts.omitted.length > 0 && emptyCharts.omitted.every((s) => Boolean(s.omissionReason)));
}
console.log(`report-charts: ${passes} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
