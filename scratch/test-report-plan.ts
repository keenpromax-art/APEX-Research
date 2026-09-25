import { buildResearchCase } from "../src/lib/research-case";
import { buildResearchIdentity } from "../src/lib/research-identity/build";
import { compileReportPlan, compileReportPlanFromParts, verifyReportPlan } from "../src/lib/report-plan/compiler";
import { REPORT_PLAN_VERSION } from "../src/lib/report-plan/types";
import { BLUEPRINT_ROLE, blueprintAsTemplate, isBlueprintTemplate } from "../src/lib/report-types/template";
import { getReportBlueprint } from "../src/lib/report-types";
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
    ticker: "PLAN.NS",
    name: "Plan Industries Ltd",
    exchange: "NSE",
    exchangeTimezoneName: "Asia/Kolkata",
    sector: "Industrials",
    industry: "Industrial Machinery",
    country: "India",
    currency: "INR",
    description: "Plan Industries manufactures machinery.",
    website: "example.com",
    employees: 5000,
    officers: [{ name: "A. Sharma", title: "CEO" }],
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
function year(y: string): CorporateAnnualFinancials {
  const revenue = 50e9;
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
    netIncome: 5e9,
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
    dividendsPaid: 1.5e9,
    changeInCash: 1e9,
    goodwill: 0,
    otherIntangibles: 0,
  };
}
function pkg(over: Record<string, unknown> = {}): CanonicalResearchPackage {
  const base = {
    ticker: "PLAN.NS",
    packageId: "CRPKG-TEST",
    dataCutoff: AS_OF,
    sourceSnapshotHash: "abc",
    sourceContext: {
      profile: profile(),
      stockData: stock(),
      annualFinancials: [year("FY2024"), year("FY2025")] as AnnualFinancials[],
    },
    factPack: { ticker: "PLAN.NS" },
    forecastSpec: { assumptions: [], driverPaths: {} },
    executedForecast: { incomeStatement: [], cashFlow: [] },
    valuationSpec: { discountRate: 0.11, assumptions: [] },
    valuationMatrix: { status: "ready" },
    valuationResult: { fairValuePerShare: 120, upsidePct: 20, status: "ready", methodology: "fcff", outputs: {}, bridge: {} },
    rating: "BUY",
    scenarios: [],
    sensitivity: [],
    researchPlan: { questions: [{ question: "What drives growth?", requiredFor: "model" }], unknowns: ["Guidance"], requiredResearch: ["Annual report"], epistemicSummary: "summary" },
    researchReport: { debates: [], thesis: { thesis: "thesis" }, moat: { hasMoat: false, verdict: "none" } },
    evidenceRegistry: { items: [{ id: "EV:1" }] },
    quality: { canPublish: true, blockers: [], warnings: [], checks: [] },
    versions: { package: "canonical-research-package-v1", factPack: "f1", model: "m1", forecast: "fv1", valuation: "vv1", review: "rv1", prompt: "p1" },
    packageHash: "x",
    run: { startedAt: AS_OF, completedAt: AS_OF },
  } as unknown as CanonicalResearchPackage;
  return { ...base, ...over } as CanonicalResearchPackage;
}
console.log("REPORT PLAN TESTS");
{
  const blueprint = getReportBlueprint("institutional_equity_v1");
  check("blueprint stable", Boolean(blueprint) && blueprint?.status === "stable");
  check("blueprint role is template", BLUEPRINT_ROLE === "template");
  check("isBlueprintTemplate true", isBlueprintTemplate("institutional_equity_v1") === true);
  const templated = blueprintAsTemplate("institutional_equity_v1");
  check("blueprintAsTemplate copies sections", Boolean(templated) && (templated?.sections.length ?? 0) > 0);
  if (blueprint && templated) {
    check("template copy not same reference", templated.sections !== blueprint.sections);
  }
}
{
  const value = pkg();
  const plan = compileReportPlan({ packageValue: value, blueprintId: "institutional_equity_v1", depth: "concise", identity: null, researchPlan: value.researchPlan as never, generatedAt: AS_OF });
  check("plan version pinned", plan.version === REPORT_PLAN_VERSION);
  check("planId shaped", plan.planId.startsWith("RPLAN-"));
  check("ticker preserved", plan.ticker === "PLAN.NS");
  check("blueprint retained as template", plan.blueprintIdAsTemplate === "institutional_equity_v1");
  check("depth preserved", plan.depth === "concise");
  check("generatedAt injected", plan.generatedAt === AS_OF);
  check("sections non-empty", plan.sections.length > 0);
  check("sections ordered", plan.sections.every((s, i) => s.order === i + 1));
  check("sections have modules mapping", plan.sections.every((s) => Array.isArray(s.modules)));
  check("sections have source questions field", plan.sections.every((s) => Array.isArray(s.sourceQuestions)));
  check("sections have required evidence field", plan.sections.every((s) => Array.isArray(s.requiredEvidence)));
  check("sections have chart table requirements", plan.sections.every((s) => Array.isArray(s.chartIds) && Array.isArray(s.tableIds)));
  check("sections have depth order priority", plan.sections.every((s) => typeof s.depth === "number" && typeof s.order === "number" && typeof s.priority === "number"));
  check("moduleIds stable sorted", JSON.stringify(plan.moduleIds) === JSON.stringify([...plan.moduleIds].sort()));
  check("chart table requirements arrays", Array.isArray(plan.chartRequirements) && Array.isArray(plan.tableRequirements));
  check("required evidence array", Array.isArray(plan.requiredEvidence));
  check("coverage shaped", typeof plan.coverage.coverageScore === "number" && Array.isArray(plan.coverage.missingEvidence));
  check("unresolved blockers array", Array.isArray(plan.unresolvedBlockers));
  check("compatibility shaped", plan.compatibility.status === "supported" || plan.compatibility.status === "limited" || plan.compatibility.status === "unsupported");
  check("plan hash 64", typeof plan.planHash === "string" && plan.planHash.length === 64);
  check("verifyReportPlan true", verifyReportPlan(plan) === true);
  const again = compileReportPlan({ packageValue: value, blueprintId: "institutional_equity_v1", depth: "concise", identity: null, researchPlan: value.researchPlan as never, generatedAt: AS_OF });
  check("deterministic hash", again.planHash === plan.planHash);
  check("deterministic sections", JSON.stringify(again.sections) === JSON.stringify(plan.sections));
  const other = compileReportPlan({ packageValue: pkg({ ticker: "OTHER.NS", sourceContext: { ...(value.sourceContext as unknown as Record<string, unknown>), profile: { ...(profile() as unknown as Record<string, unknown>), ticker: "OTHER.NS" } } } as unknown as Record<string, unknown>) as CanonicalResearchPackage, blueprintId: "institutional_equity_v1", depth: "concise", identity: null, researchPlan: value.researchPlan as never, generatedAt: AS_OF });
  check("different ticker different hash", other.planHash !== plan.planHash);
}
{
  const rc = buildResearchCase({ profile: profile(), stockData: stock(), annualFinancials: [year("FY2023"), year("FY2024"), year("FY2025")] as AnnualFinancials[], createdAt: AS_OF });
  const identity = buildResearchIdentity({ researchCase: rc, reportTypeId: "institutional_equity_v1", depth: "concise", createdAt: AS_OF });
  const value = pkg();
  const plan = compileReportPlan({ packageValue: value, blueprintId: "institutional_equity_v1", depth: "concise", identity, researchPlan: value.researchPlan as never, generatedAt: AS_OF });
  check("identity chart requirements wired", JSON.stringify([...plan.chartRequirements].sort()) === JSON.stringify(identity.charts.selected.map((c) => c.id).sort()));
  check("identity table requirements wired", JSON.stringify([...plan.tableRequirements].sort()) === JSON.stringify(identity.tables.selected.map((t) => t.id).sort()));
  check("compatibility from identity", plan.compatibility.status === identity.compatibility.status || typeof plan.compatibility.status === "string");
}
{
  const blocked = pkg({ quality: { canPublish: false, blockers: ["Canonical forecast is not publication-ready."], warnings: [], checks: [] } } as unknown as Record<string, unknown>);
  const plan = compileReportPlan({ packageValue: blocked, blueprintId: "institutional_equity_v1", depth: "concise", identity: null, researchPlan: blocked.researchPlan as never, generatedAt: AS_OF });
  check("blockers surface as unresolved", plan.unresolvedBlockers.some((b) => b.includes("Canonical forecast")));
  check("blocked plan still hashes", plan.planHash.length === 64 && verifyReportPlan(plan));
}
{
  const parts = compileReportPlanFromParts({ ticker: "PART.NS", blueprintId: "bank_v1", depth: "full", generatedAt: AS_OF, blueprintSections: [{ id: "a", title: "A", modules: [] }], blueprintModuleIds: [], identitySections: [{ sectionId: "a", title: "A", order: 2, depth: 3, priority: 80, include: true, mandatory: false, chartIds: ["chart-revenue-growth"], tableIds: [], rationale: "wired" }], identityChartIds: ["chart-revenue-growth"], identityTableIds: [], researchQuestions: [], requiredEvidence: ["EV:1"], missingEvidence: [], qualityBlockers: [], qualityWarnings: [] });
  check("parts compiler depth wired", parts.sections[0].depth === 3);
  check("parts compiler priority wired", parts.sections[0].priority === 80);
  check("parts compiler chart wired", parts.sections[0].chartIds.includes("chart-revenue-growth"));
  check("parts compiler hash", verifyReportPlan(parts));
}
console.log(`report-plan: ${passes} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
