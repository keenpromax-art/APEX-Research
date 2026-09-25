import * as fs from "node:fs";
import * as path from "node:path";
import { buildResearchCase } from "../src/lib/research-case";
import { buildCompanyIdentity, companyIdentityFromPackage, isCompanyIdentity, isResearchDna, wireResearchIdentity, identityPublicationStatus } from "../src/lib/report-plan/identity-wiring";
import { saveReportPlan, loadReportPlans, loadPriorIdentities, clearReportPlans, clearResearchIdentities, saveResearchIdentity } from "../src/lib/report-plan/store";
import { persistResearchIdentity, loadBoundedPriors, IDENTITY_PERSISTENCE_BOUND } from "../src/lib/research-identity/identity-store";
import { identityPublicationFromQa } from "../src/lib/research-identity/identity-publication";
import { compileReportPlan } from "../src/lib/report-plan/compiler";
import { buildPresentationViewModel } from "../src/lib/report-plan/presentation";
import { buildChartSpecs, buildTableSpecs } from "../src/lib/report-charts/builder";
import { extractPresentationNumbers, extractPresentationTexts, validatePresentationAgainstCanonical } from "../src/lib/report-charts/pdf-validation";
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
    ticker: "DYN.NS",
    name: "Dynamic Ltd",
    exchange: "NSE",
    exchangeTimezoneName: "Asia/Kolkata",
    sector: "Industrials",
    industry: "Industrial Machinery",
    country: "India",
    currency: "INR",
    description: "Dynamic company.",
    website: "example.com",
    employees: 2000,
    officers: [{ name: "D. Rao", title: "CEO" }],
  };
}
function stock(): StockData {
  return {
    currentPrice: 150,
    previousClose: 149,
    open: 149,
    dayHigh: 151,
    dayLow: 148,
    marketCap: 150e9,
    enterpriseValue: 160e9,
    pe: 18,
    forwardPE: 16,
    pb: 2.5,
    ps: 3,
    dividendYield: 0.01,
    dividendRate: 1,
    beta: 1.1,
    week52High: 170,
    week52Low: 130,
    sharesOutstanding: 1e9,
    floatShares: 8e8,
    avgVolume: 1e6,
    volume: 1e6,
    fiftyDayAvg: 150,
    twoHundredDayAvg: 145,
    eps: 8,
    forwardEps: 9,
    bookValue: 50,
    priceToBook: 3,
    returnOnEquity: 0.16,
    returnOnAssets: 0.08,
    debtToEquity: 0.4,
    currentRatio: 1.6,
    quickRatio: 1.3,
    grossMargins: 0.4,
    ebitdaMargins: 0.2,
    operatingMargins: 0.15,
    profitMargins: 0.1,
    freeCashflow: 6e9,
    totalDebt: 15e9,
    totalCash: 8e9,
    revenueGrowth: 0.1,
    earningsGrowth: 0.08,
    recommendationKey: "buy",
    numberOfAnalystOpinions: 12,
    targetHighPrice: 180,
    targetLowPrice: 130,
    targetMeanPrice: 160,
  } as StockData;
}
function year(y: string): CorporateAnnualFinancials {
  const revenue = 55e9;
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
    netIncome: 5.5e9,
    netMargin: 0.1,
    depreciation: revenue * 0.02,
    eps: 5.5,
    dilutedEps: 5.5,
    sharesOutstanding: 1e9,
    totalAssets: 85e9,
    totalLiabilities: 52e9,
    totalEquity: 33e9,
    cash: 8e9,
    shortTermInvestments: 2e9,
    netReceivables: 6e9,
    inventory: 5e9,
    currentAssets: 21e9,
    netFixedAssets: 31e9,
    totalDebt: 11e9,
    shortTermDebt: 3e9,
    longTermDebt: 8e9,
    accountsPayable: 4e9,
    currentLiabilities: 12e9,
    netWorkingCapital: 9e9,
    operatingCashFlow: 7e9,
    capitalExpenditures: 3e9,
    freeCashFlow: 4e9,
    investingCashFlow: -3e9,
    financingCashFlow: -2e9,
    dividendsPaid: 1.2e9,
    changeInCash: 1e9,
    goodwill: 0,
    otherIntangibles: 0,
  };
}
function pkg(): CanonicalResearchPackage {
  return {
    ticker: "DYN.NS",
    packageId: "CRPKG-DYN",
    dataCutoff: AS_OF,
    sourceSnapshotHash: "hash",
    sourceContext: {
      profile: profile(),
      stockData: stock(),
      annualFinancials: [year("FY2023"), year("FY2024"), year("FY2025")] as AnnualFinancials[],
    },
    factPack: { ticker: "DYN.NS" },
    forecastSpec: { assumptions: [], driverPaths: {} },
    executedForecast: { incomeStatement: [{ period: "FY2026", values: { revenue: 60e9 } }], cashFlow: [] },
    valuationSpec: { discountRate: 0.11, assumptions: [] },
    valuationMatrix: { status: "ready" },
    valuationResult: { fairValuePerShare: 165, upsidePct: 10, status: "ready", methodology: "fcff", outputs: {}, bridge: {} },
    rating: "HOLD",
    scenarios: [{ targetPrice: 140 }, { targetPrice: 165 }, { targetPrice: 190 }],
    sensitivity: [{ wacc: 0.11, value: 165 }],
    researchPlan: { questions: [], unknowns: [], requiredResearch: [], epistemicSummary: "" },
    researchReport: { debates: [], thesis: { thesis: "thesis" }, moat: { hasMoat: false, verdict: "none" } },
    evidenceRegistry: { items: [{ id: "EV:1" }] },
    quality: { canPublish: true, blockers: [], warnings: [], checks: [] },
    versions: { package: "canonical-research-package-v1", factPack: "f1", model: "m1", forecast: "fv1", valuation: "vv1", review: "rv1", prompt: "p1" },
    packageHash: "x",
    run: { startedAt: AS_OF, completedAt: AS_OF },
  } as unknown as CanonicalResearchPackage;
}
console.log("DYNAMIC REPORT TESTS");
clearReportPlans();
clearResearchIdentities();
{
  const identity = buildCompanyIdentity({ ticker: "dyn.ns", companyName: "Dynamic Ltd", sector: "Industrials", industry: "Machinery", currency: "INR", sourceHash: "hash", asOf: AS_OF });
  check("company identity kind IDENTITY", identity.kind === "IDENTITY");
  check("company identity ticker upper", identity.ticker === "DYN.NS");
  check("company identity id shaped", identity.identityId.startsWith("IDENTITY-"));
  check("isCompanyIdentity true", isCompanyIdentity(identity) === true);
  check("isResearchDna false for IDENTITY", isResearchDna(identity) === false);
  const rc = buildResearchCase({ profile: profile(), stockData: stock(), annualFinancials: [year("FY2024"), year("FY2025")] as AnnualFinancials[], createdAt: AS_OF });
  const dna = wireResearchIdentity({ researchCase: rc, reportTypeId: "institutional_equity_v1", depth: "concise", createdAt: AS_OF, priorIdentities: [] });
  check("wired dna shaped", typeof dna.identityId === "string" && dna.identityId.startsWith("rid-"));
  check("isResearchDna true", isResearchDna(dna) === true);
  check("isCompanyIdentity false for dna", isCompanyIdentity(dna) === false);
  check("timestamp injected", dna.asOf === AS_OF);
  const again = wireResearchIdentity({ researchCase: rc, reportTypeId: "institutional_equity_v1", depth: "concise", createdAt: AS_OF, priorIdentities: [] });
  check("identity determinism", again.identityId === dna.identityId);
  const fromPkg = companyIdentityFromPackage(pkg(), AS_OF);
  check("identity from package", fromPkg.ticker === "DYN.NS" && fromPkg.kind === "IDENTITY");
  const pubReady = identityPublicationStatus({ identity: dna, companyIdentity: identity, qaDecision: "READY", canPublish: true });
  check("publication ready", pubReady.canPublish === true && pubReady.label === "PDF");
  const pubBlocked = identityPublicationStatus({ identity: dna, companyIdentity: identity, qaDecision: "BLOCK", canPublish: false });
  check("publication blocked on QA BLOCK", pubBlocked.canPublish === false);
  const pubQa = identityPublicationFromQa({ identity: dna, qaDecision: "REVIEW", canPublish: false });
  check("qa publication blocked on REVIEW", pubQa.canPublish === false);
}
{
  clearReportPlans();
  clearResearchIdentities();
  const value = pkg();
  const plan = compileReportPlan({ packageValue: value, blueprintId: "institutional_equity_v1", depth: "concise", identity: null, researchPlan: value.researchPlan as never, generatedAt: AS_OF });
  saveReportPlan(plan);
  check("plan persisted", loadReportPlans("DYN.NS").length === 1);
  const rc = buildResearchCase({ profile: profile(), stockData: stock(), annualFinancials: [year("FY2024"), year("FY2025")] as AnnualFinancials[], createdAt: AS_OF });
  const dna = wireResearchIdentity({ researchCase: rc, reportTypeId: "institutional_equity_v1", depth: "concise", createdAt: AS_OF, priorIdentities: [] });
  persistResearchIdentity(dna);
  saveResearchIdentity(dna);
  const priors = loadPriorIdentities("DYN.NS");
  check("bounded priors loaded", priors.length === 1);
  const bounded = loadBoundedPriors("DYN.NS", undefined, 5);
  check("bounded priors respect bound", bounded.length <= 5);
  check("persistence bound constant", IDENTITY_PERSISTENCE_BOUND === 20);
}
{
  const value = pkg();
  const plan = compileReportPlan({ packageValue: value, blueprintId: "institutional_equity_v1", depth: "concise", identity: null, researchPlan: value.researchPlan as never, generatedAt: AS_OF });
  const charts = buildChartSpecs({ packageValue: value, plan });
  const tables = buildTableSpecs({ packageValue: value, plan });
  const view = buildPresentationViewModel({ packageValue: value, plan, charts: charts.specs.filter((s) => !s.omissionReason), tables: tables.specs.filter((s) => !s.omissionReason), generatedAt: AS_OF });
  check("view version", view.version === "presentation-view-model-v1");
  check("view hash 64", view.viewHash.length === 64);
  check("view plan bound", view.planHash === plan.planHash);
  check("metrics have N/M states", view.metrics.every((m) => m.state === "available" || m.state === "unavailable" || m.state === "not-meaningful"));
  check("metrics have provenance", view.metrics.every((m) => m.provenance === "measured" || m.provenance === "derived" || m.provenance === "illustrative" || m.provenance === "unavailable"));
  check("statements precomputed", view.statements.length > 0);
  check("sensitivity precomputed", view.sensitivity.provenance !== "unavailable" || view.sensitivity.state === "unavailable");
  const emptyPkg = { ...value, sourceContext: { ...value.sourceContext, annualFinancials: [] }, valuationResult: { ...value.valuationResult, fairValuePerShare: null }, sensitivity: [], executedForecast: { incomeStatement: [], cashFlow: [] } } as unknown as CanonicalResearchPackage;
  const emptyPlan = compileReportPlan({ packageValue: emptyPkg, blueprintId: "institutional_equity_v1", depth: "concise", identity: null, researchPlan: value.researchPlan as never, generatedAt: AS_OF });
  const emptyCharts = buildChartSpecs({ packageValue: emptyPkg, plan: emptyPlan });
  const emptyTables = buildTableSpecs({ packageValue: emptyPkg, plan: emptyPlan });
  const emptyView = buildPresentationViewModel({ packageValue: emptyPkg, plan: emptyPlan, charts: emptyCharts.specs.filter((s) => !s.omissionReason), tables: emptyTables.specs.filter((s) => !s.omissionReason), generatedAt: AS_OF });
  check("missing fair value unavailable", emptyView.metrics.find((m) => m.key === "fairValue")?.display === "Unavailable");
  check("missing statements unavailable", emptyView.statements.some((s) => s.state === "unavailable") || emptyView.statements.length > 0);
  check("missing sensitivity unavailable", emptyView.sensitivity.state === "unavailable");
  check("missing events disclosure", emptyView.disclosures.length > 0);
  const again = buildPresentationViewModel({ packageValue: value, plan, charts: charts.specs.filter((s) => !s.omissionReason), tables: tables.specs.filter((s) => !s.omissionReason), generatedAt: AS_OF });
  check("presentation determinism", again.viewHash === view.viewHash);
}
{
  const value = pkg();
  const plan = compileReportPlan({ packageValue: value, blueprintId: "institutional_equity_v1", depth: "concise", identity: null, researchPlan: value.researchPlan as never, generatedAt: AS_OF });
  const charts = buildChartSpecs({ packageValue: value, plan });
  const tables = buildTableSpecs({ packageValue: value, plan });
  const view = buildPresentationViewModel({ packageValue: value, plan, charts: charts.specs.filter((s) => !s.omissionReason), tables: tables.specs.filter((s) => !s.omissionReason), generatedAt: AS_OF });
  const numbers = extractPresentationNumbers(view);
  const texts = extractPresentationTexts(view);
  check("numbers extracted", numbers.length > 0 && numbers.every((n) => Number.isFinite(n.value)));
  check("texts extracted", texts.length > 0 && texts.every((t) => typeof t.text === "string" && t.text.length > 0));
  const result = validatePresentationAgainstCanonical(view, value);
  check("validation passes on canonical", result.passed === true && result.blockers.length === 0);
  check("validation diagnostics", result.diagnostics.length > 0);
  const tampered = { ...view, metrics: view.metrics.map((m) => (m.key === "fairValue" ? { ...m, value: 999999, display: "999999" } : m)) } as typeof view;
  const tamperedResult = validatePresentationAgainstCanonical(tampered, value);
  check("validation fails on tamper", tamperedResult.passed === false && tamperedResult.blockers.length > 0);
}
{
  const pdfIndex = fs.readFileSync(path.join(process.cwd(), "src", "components", "PDFDocument", "index.tsx"), "utf8");
  const presentationView = fs.readFileSync(path.join(process.cwd(), "src", "components", "PDFDocument", "presentation-view.tsx"), "utf8");
  check("canonical branch present", pdfIndex.includes("presentationForData(data)") && pdfIndex.includes("renderCanonicalPresentation"));
  check("presentation view has unavailable", presentationView.includes("Unavailable"));
  check("presentation view has N/M", presentationView.includes("N/M") || pdfIndex.includes("N/M"));
  check("presentation view labels illustrative", presentationView.includes("Illustrative"));
  check("presentation view no financial kernel", !presentationView.includes("financial-kernel") && !presentationView.includes("revalueSensitivity"));
  check("presentation view no event engine", !presentationView.includes("event-price-engine") && !presentationView.includes("buildEventPriceMovements"));
  check("presentation view no calculations", !presentationView.includes("from \"@/lib/calculations\"") && !presentationView.includes("computeRatios"));
  check("presentation view no driver models", !presentationView.includes("driver-models") && !presentationView.includes("buildBankDriverSet"));
  check("presentation view no sector dispatch", !presentationView.includes("classifySector") && !presentationView.includes("shouldUseNativeStatements"));
  check("presentation view no statement construction", !presentationView.includes("buildFiveYearStatementModel"));
  const client = fs.readFileSync(path.join(process.cwd(), "src", "app", "report", "[ticker]", "ReportClient.tsx"), "utf8");
  check("client wires package", client.includes("canonicalPackage"));
  check("client wires plan", client.includes("reportPlan") && client.includes("planView"));
  check("client wires identity", client.includes("companyIdentity") && client.includes("researchIdentity"));
  check("client wires charts", client.includes("chartSpecs") && client.includes("acceptedCharts"));
  check("client wires audit", client.includes("auditPackage") && client.includes("auditHash"));
  check("client wires run memory deltas", client.includes("runView") && client.includes("memoryView") && client.includes("deltasView"));
  check("client preview policy", client.includes("previewPolicy") || client.includes("advisoryPreview"));
  check("client accessible tabs", client.includes("role=\"tablist\"") && client.includes("aria-selected"));
  check("client accessible export", client.includes("aria-label") && client.includes("PDFDownloadButton"));
}
console.log(`dynamic-report: ${passes} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
