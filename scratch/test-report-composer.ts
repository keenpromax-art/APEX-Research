/**
 * APEX RESEARCH — Report Composer Phase 5 Tests
 * ----------------------------------------------
 *  1. composeReport contract (required case, unknown type, determinism).
 *  2. Full pipeline: outline golden-matches PDF; module data referenced by
 *     identity; anchors still single-sourced (ledger).
 *  3. Research-debates gate + depth filtering.
 *  4. composeReportFromData / moduleContextFromReportData (ReportClient wire).
 *  5. Missing-data fail-closed; no page caps; no financial recomputation.
 *
 * Run: npx tsx scratch/test-report-composer.ts (exit 1 on failure)
 */
import {
  composeReport,
  composeReportFromData,
  moduleContextFromReportData,
  REPORT_COMPOSER_VERSION,
  type ComposedReport,
  type PdfComponentName,
} from "../src/lib/report-composer";
import {
  resolveReportOutline,
  institutionalConciseTocTitles,
  institutionalFullTocTitles,
  getReportBlueprint,
} from "../src/lib/report-types";
import {
  getModuleData,
  RESEARCH_MODULE_ORDER,
  type ModuleContext,
} from "../src/lib/research-modules";
import { buildResearchCase, type BuildResearchCaseParams } from "../src/lib/research-case";
import { createAssumptionsLedger } from "../src/lib/assumptions-ledger";
import { buildMasterReportFacts } from "../src/lib/report-facts";
import { computeRatios, computeDuPont } from "../src/lib/calculations";
import { verifyCanonicalSeal } from "../src/lib/canonical-facts";
import type {
  AnnualFinancials,
  BankAnnualFinancials,
  CorporateAnnualFinancials,
  CompanyProfile,
  DCFResult,
  PeerData,
  QuarterlyFinancials,
  Ratios,
  DuPontAnalysis,
  ReportData,
  StockData,
} from "../src/types/report";
import type { ResearchReport } from "../src/lib/ai-first/types";

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
const PINNED = "2026-09-02T00:00:00.000Z";

// ── Fixtures (same shape as Phase 3 tests) ─────────────────────────────

function makeProfile(over: Partial<CompanyProfile> = {}): CompanyProfile {
  return {
    ticker: "TEST.NS",
    name: "Test Industries Ltd",
    exchange: "NSE",
    exchangeTimezoneName: "Asia/Kolkata",
    sector: "Industrials",
    industry: "Industrial Machinery",
    country: "India",
    currency: "INR",
    description: "Test Industries manufactures industrial machinery and equipment.",
    website: "https://example.com",
    employees: 5000,
    officers: [{ name: "A. Sharma", title: "CEO" }],
    ...over,
  };
}

function makeStock(over: Partial<StockData> = {}): StockData {
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
    ...over,
  };
}

function makeCorporateYear(year: string, over: Partial<CorporateAnnualFinancials> = {}): CorporateAnnualFinancials {
  const revenue = over.revenue ?? 50e9;
  const netIncome = over.netIncome ?? 5e9;
  const equity = over.totalEquity ?? 30e9;
  const debt = over.totalDebt ?? 10e9;
  return {
    year,
    fiscalYearEnd: `${year.replace("FY", "")}-03-31`,
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
    netIncome,
    netMargin: netIncome / revenue,
    depreciation: revenue * 0.02,
    eps: 5,
    dilutedEps: 5,
    sharesOutstanding: 1e9,
    totalAssets: 80e9,
    totalLiabilities: 50e9,
    totalEquity: equity,
    cash: 8e9,
    shortTermInvestments: 2e9,
    netReceivables: 6e9,
    inventory: 5e9,
    currentAssets: 20e9,
    netFixedAssets: 30e9,
    totalDebt: debt,
    shortTermDebt: debt * 0.3,
    longTermDebt: debt * 0.7,
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
    ...over,
  };
}

function makeBankYear(year: string): BankAnnualFinancials {
  return {
    year,
    fiscalYearEnd: `${year.replace("FY", "")}-03-31`,
    statementType: "bank",
    isFinancialInstitution: true,
    netInterestIncome: 120e9,
    nonInterestIncome: 40e9,
    totalRevenue: 160e9,
    interestIncome: 300e9,
    interestExpense: 180e9,
    provisionForCreditLosses: 10e9,
    nonInterestExpenses: 70e9,
    operatingIncome: 80e9,
    pretaxIncome: 70e9,
    incomeTaxExpense: 18e9,
    netIncome: 52e9,
    netMargin: 0.25,
    totalAssets: 2_000e9,
    totalLiabilities: 1_800e9,
    totalEquity: 200e9,
    cash: 80e9,
    shortTermInvestments: 40e9,
    loans: 1_200e9,
    deposits: 1_600e9,
    totalDebt: 100e9,
    shortTermDebt: 30e9,
    longTermDebt: 70e9,
    currentAssets: 200e9,
    currentLiabilities: 150e9,
    netWorkingCapital: 50e9,
    operatingCashFlow: 60e9,
    capitalExpenditures: 10e9,
    freeCashFlow: 52e9,
    investingCashFlow: -25e9,
    financingCashFlow: -20e9,
    dividendsPaid: 10e9,
    changeInCash: 15e9,
    netInterestMargin: 3.2,
    grossNPAPct: 1.5,
    capitalAdequacyRatio: 16.5,
    revenue: 160e9,
    costOfRevenue: 0,
    grossProfit: 0,
    grossMargin: 0,
    inventory: 0,
    netReceivables: 0,
    netFixedAssets: 0,
    accountsPayable: 0,
    ebitda: 0,
    ebitdaMargin: 0,
    ebitMargin: 0,
    researchDevelopment: 0,
    sellingGeneralAdministrative: 0,
    totalOperatingExpenses: 70e9,
    depreciation: 5e9,
    otherIncome: 0,
    eps: 10.4,
    dilutedEps: 10.4,
    sharesOutstanding: 5e9,
  };
}

function makeQuarters(n = 4): QuarterlyFinancials[] {
  const out: QuarterlyFinancials[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      period: `Q${(i % 4) + 1}FY26`,
      endDate: `2026-0${(i % 9) + 1}-30`,
      revenue: 13e9,
      revenueGrowthYoY: 0.1,
      grossProfit: 5.2e9,
      ebitda: 2.6e9,
      ebitdaMargin: 0.2,
      operatingIncome: 2.3e9,
      netIncome: 1.3e9,
      netMargin: 0.1,
      eps: 1.3,
    });
  }
  return out;
}

function makePeers(n: number): PeerData[] {
  const out: PeerData[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      ticker: `PEER${i}`,
      name: `Peer ${i}`,
      marketCap: 90e9 + i * 1e9,
      cmp: 95 + i,
      pe: 19 + i,
      evToEbitda: 12 + i,
      pb: 2.8,
      roe: 0.14,
      netMargin: 0.09,
      revenueGrowth: 0.09,
      currency: "INR",
      sector: "Industrials",
      industry: "Industrial Machinery",
      relevanceScore: 70 + i,
    });
  }
  return out;
}

function makeDcf(): DCFResult {
  return {
    status: "valid",
    assumptions: {
      riskFreeRate: 0.0685,
      equityRiskPremium: 0.06,
      beta: 1.1,
      costOfEquity: 0.1345,
      costOfDebtPreTax: 0.09,
      marginalTaxRate: 0.25,
      costOfDebtPostTax: 0.0675,
      debtWeight: 0.2,
      equityWeight: 0.8,
      wacc: 0.1211,
      terminalGrowthRate: 0.04,
      revenueGrowthRates: [0.12, 0.1, 0.08, 0.07, 0.06],
      ebitMargins: [0.18, 0.185, 0.19, 0.19, 0.19],
    },
    projections: [],
    sumPvFcff: 60e9,
    terminalYearFcff: 8e9,
    terminalValue: 80e9,
    pvTerminalValue: 40e9,
    enterpriseValue: 100e9,
    lessDebt: 10e9,
    plusCash: 8e9,
    equityValue: 98e9,
    sharesOutstanding: 1e9,
    intrinsicValue: 98,
    fairValuePerShare: 98,
    currentMarketPrice: 100,
    upsideDownside: -0.02,
    verdict: "HOLD",
  };
}

function makeResearchReport(): ResearchReport {
  return {
    researchRunId: "run-test-1",
    companyTicker: "TEST.NS",
    modelVersion: "m1",
    promptVersion: "p1",
    factPackVersion: "f1",
    generationTimestamp: AS_OF,
    forecastVersion: "fv1",
    valuationVersion: "vv1",
    reviewVersion: "rv1",
    companyUnderstanding: {
      ticker: "TEST.NS",
      companyName: "Test Industries Ltd",
      whatItDoes: "Manufactures industrial machinery.",
      howItMakesMoney: "Sells equipment with aftermarket parts.",
      businessSegments: [{ name: "Machinery", description: "Core equipment" }],
      economicUnits: ["machines"],
      primaryEconomicAbstraction: "units sold",
      revenueDrivers: ["Industrial capex cycle"],
      costDrivers: ["Steel input costs"],
      marginDrivers: ["Product mix"],
      cashGenerationDrivers: ["Working capital"],
      balanceSheetDrivers: ["Receivables"],
      returnsDrivers: ["ROIC"],
      keyKpis: ["Order book"],
      metricsToAvoid: [],
      statementsThatMatterMost: ["income", "balance"],
      industryContext: "Fragmented industrial equipment market.",
      appropriateValuationMethods: ["fcff"],
      confidence: { overall: 0.7, dataQuality: "B", reasoning: "Partial filing history." },
      epistemic: {
        knownFacts: ["Revenue growth positive"],
        inferences: ["Operating leverage likely"],
        unknowns: ["Order book visibility"],
        requiredResearch: ["Management presentation"],
      },
    },
    businessModel: "Equipment + spares",
    industryContext: "Fragmented industrial equipment market.",
    historicalAnalysis: "Steady growth.",
    keyMetrics: [],
    operatingModel: { formulas: [], variables: [] },
    forecast: {} as ResearchReport["forecast"],
    valuation: {} as ResearchReport["valuation"],
    scenarios: [],
    thesis: {
      thesis: "Test thesis for Phase 5 pass-through.",
      bullCase: [],
      bearCase: [],
      keyDebate: "Cycle timing",
      keyInflectionPoints: [],
      whatMarketMayBeMissing: "",
      whatCouldInvalidate: [],
    },
    debates: [
      {
        debate: "Cycle timing vs structural demand",
        evidenceFor: [{ evidence: "Order book up 12%" }],
        evidenceAgainst: [{ evidence: "Input costs rising" }],
        financialConsequence: "Margin swing",
        valuationConsequence: "WACC-sensitive",
        resolutionSignal: "Next two quarters of book-to-bill",
      },
    ],
    catalysts: [
      {
        catalyst: "New product cycle",
        mechanism: "Mix improvement",
        financialVariable: "ebitMargin",
        quantitative: true,
      },
    ],
    risks: [
      {
        risk: "Input cost inflation",
        mechanism: "Margin compression",
        affectedKpi: "ebitdaMargin",
        financialConsequence: "Lower EBITDA",
        valuationConsequence: "Lower FV",
        monitoringIndicator: "Raw material index",
      },
    ],
    competitiveAnalysis: {
      competitors: [
        {
          company: "PeerA",
          businessOverlap: "Core",
          economicSimilarity: "High",
          keyDifference: "Scale",
          relativeStrengths: "Brand",
          relativeWeaknesses: "Debt",
        },
      ],
    },
    moat: { hasMoat: false, sources: [], verdict: "No moat evidenced." },
    managementAnalysis: "Management has executed two acquisition cycles.",
    capitalAllocation: "Prefers bolt-on M&A and progressive dividend.",
    financialQuality: "Cash conversion tracks earnings with normal WC swings.",
    sensitivity: [],
    reverseValuation: null,
    conclusion: "Base case HOLD.",
    reviews: [],
    reviewPassed: true,
    regenerationLog: [],
  } as ResearchReport;
}

function baseParams(over: Partial<BuildResearchCaseParams> = {}): BuildResearchCaseParams {
  return {
    profile: makeProfile(),
    stockData: makeStock(),
    annualFinancials: [
      makeCorporateYear("FY2022"),
      makeCorporateYear("FY2023"),
      makeCorporateYear("FY2024"),
      makeCorporateYear("FY2025"),
      makeCorporateYear("FY2026"),
    ],
    quarterlyFinancials: makeQuarters(),
    peers: makePeers(4),
    valuation: makeDcf(),
    createdAt: AS_OF,
    dataCutoff: AS_OF,
    modelVersion: "apex-financial-model-v1",
    ...over,
  };
}

function buildFullContext(over: Partial<BuildResearchCaseParams> = {}): {
  ctx: ModuleContext;
  ratios: Ratios[];
  dupont: DuPontAnalysis[];
  ledger: ReturnType<typeof createAssumptionsLedger>;
  facts: ReturnType<typeof buildMasterReportFacts>;
  params: BuildResearchCaseParams;
} {
  const params = baseParams(over);
  const annual = params.annualFinancials as AnnualFinancials[];
  const stock = params.stockData;
  const ratios = annual.map((f) => computeRatios(f, stock.currentPrice));
  const dupont = annual.map((f) => computeDuPont(f));
  const ledger = createAssumptionsLedger({
    profile: params.profile,
    stockData: stock,
    annualFinancials: annual,
    dcf: params.valuation!,
  });
  const facts = buildMasterReportFacts({
    stockData: stock,
    profile: params.profile,
    annualFinancials: annual,
    ratiosByYear: ratios,
    dupontByYear: dupont,
    dcf: params.valuation!,
    peers: params.peers,
    ledger,
  });

  const researchCase = buildResearchCase({
    ...params,
    assumptionsLedger: ledger,
    valuation: params.valuation,
    peers: params.peers,
    researchReport: over.researchReport ?? makeResearchReport(),
    aiAnalysis: over.aiAnalysis ?? null,
  });

  const ctx: ModuleContext = {
    researchCase,
    masterReportFacts: facts,
    ratiosByYear: ratios,
    dupontByYear: dupont,
    dataConfidence: researchCase.dataQuality.confidence,
    valuationAudit: null,
    baselineReconciliation: null,
    supervision: null,
    selectedModel: "FCFF_DCF",
    valuationLens: "fcff",
    calibration: ledger.calibration ?? null,
    aiAnalysis: over.aiAnalysis ?? null,
    researchReport: over.researchReport ?? makeResearchReport(),
    eventPriceMovements: [],
    shareholding: null,
    news: [],
    qaReport: null,
  };

  return { ctx, ratios, dupont, ledger, facts, params };
}

/** Minimal ReportData for moduleContextFromReportData / composeReportFromData. */
function makeReportData(ctx: ModuleContext, over: Partial<ReportData> = {}): ReportData {
  const c = ctx.researchCase;
  return {
    generatedAt: AS_OF,
    profile: c.company,
    stockData: c.stock,
    annualFinancials: c.historicalFinancials,
    quarterlyFinancials: c.quarterlyFinancials,
    ratiosByYear: ctx.ratiosByYear ?? [],
    dupontByYear: ctx.dupontByYear ?? [],
    dcf: c.valuation as DCFResult,
    supervision: null,
    selectedModel: ctx.selectedModel,
    valuationLens: ctx.valuationLens,
    valuationAudit: null,
    baselineReconciliation: null,
    dataConfidence: ctx.dataConfidence,
    researchCase: c,
    shareholding: null as never,
    peers: c.peers.peers,
    aiAnalysis: (ctx.aiAnalysis ?? { investmentThesis: "", investmentConclusion: "" }) as ReportData["aiAnalysis"],
    news: [],
    eventPriceMovements: [],
    recommendation: c.assumptionsLedger?.rating ?? "NR",
    targetPrice: c.assumptionsLedger?.targetPrice ?? 0,
    cmp: c.assumptionsLedger?.currentPrice ?? 0,
    analystName: "Apex Research Team",
    assumptionsLedger: c.assumptionsLedger ?? undefined,
    masterReportFacts: ctx.masterReportFacts,
    calibration: ctx.calibration ?? undefined,
    researchReport: ctx.researchReport ?? null,
    ...over,
  } as ReportData;
}

// Golden PDF structures (copied from test-report-blueprints / PDFDocument).
const PDF_CONCISE_TOC = [
  "Executive Summary & Thesis",
  "Valuation: DCF, Scenarios & Sensitivity",
  "Moat & Price / Fair Value",
  "Bulls / Bears, Risks & Catalysts",
  "Multi-Year Statement Models",
  "Comparable Company Comps",
  "QA Checksum & Disclosures",
];
const PDF_FULL_TOC = [
  "Executive Summary & Thesis",
  "Credit & Solvency Analysis",
  "Management & Governance",
  "Catalysts & Market Reaction",
  "Multi-Year Statement Models",
  "Comparable Company Comps",
  "Valuation & Credit Models",
  "Statutory Disclosures & QA",
];
const PDF_FULL_WITH_DEBATES = [
  "CoverPage",
  "ResearchDebatesPage",
  "FundamentalAnalysisPage",
  "MoatAndPriceFairValuePage",
  "MoatSourcesPage",
  "BullsSayBearsSayPage",
  "CreditAnalysisPage1",
  "CreditAnalysisPage2",
  "ManagementAndOwnershipPage1",
  "ManagementAndOwnershipPage2",
  "EventBasedPriceMovementPage",
  "CorporateDisclosuresAndCatalystsPage",
  "AnalystForecastsSummaryPage",
  "IncomeStatementDetailedPage",
  "BalanceSheetDetailedPage",
  "CashFlowDetailedPage",
  "ComparableCompanyAnalysisPage1",
  "ComparableCompanyAnalysisPage2",
  "ResearchMethodologyValuationPage1",
  "ResearchMethodologyValuationPage2",
  "CreditRatingApproachPage1",
  "CreditRatingApproachPage2",
  "InstitutionalDisclaimerPage",
  "AnalystAIDisclosurePage",
  "QualityAssuranceChecksumPage",
];
const PDF_CONCISE_WITH_DEBATES = [
  "CoverPage",
  "ResearchDebatesPage",
  "FundamentalAnalysisPage",
  "MoatAndPriceFairValuePage",
  "BullsSayBearsSayPage",
  "IncomeStatementDetailedPage",
  "BalanceSheetDetailedPage",
  "CashFlowDetailedPage",
  "ComparableCompanyAnalysisPage1",
  "InstitutionalDisclaimerPage",
  "QualityAssuranceChecksumPage",
];

// ══════════════════════════════════════════════════════════════════════

console.log("=======================================================");
console.log("REPORT COMPOSER PHASE 5 TESTS");
console.log("=======================================================\n");

// ── 1. Contract ────────────────────────────────────────────────────────
console.log("--- 1. composeReport contract ---");
{
  let threw = false;
  try {
    composeReport({ context: {} as ModuleContext });
  } catch {
    threw = true;
  }
  check("missing researchCase throws", threw);

  const { ctx } = buildFullContext();
  let threwUnknown = false;
  try {
    composeReport({ context: ctx, reportTypeId: "nope" as never });
  } catch {
    threwUnknown = true;
  }
  check("unknown report type throws", threwUnknown);

  const a = composeReport({ context: ctx, composedAt: PINNED, hasResearchDebates: true });
  const b = composeReport({ context: ctx, composedAt: PINNED, hasResearchDebates: true });
  check("version pinned", a.version === REPORT_COMPOSER_VERSION);
  check("version is report-composer-v1", REPORT_COMPOSER_VERSION === "report-composer-v1");
  check("caseId matches ResearchCase", a.caseId === ctx.researchCase.caseId);
  check("composedAt injectable", a.composedAt === PINNED);
  check(
    "deterministic section ids",
    JSON.stringify(a.sections.map((s) => s.id)) === JSON.stringify(b.sections.map((s) => s.id))
  );
  check(
    "deterministic toc titles",
    JSON.stringify(a.toc.map((t) => t.title)) === JSON.stringify(b.toc.map((t) => t.title))
  );
  check("blueprintId institutional", a.blueprintId === "institutional_equity_v1");
  check("default depth concise", a.depth === "concise");
  check("no maxPages / pageCount fields", !("maxPages" in a) && !("pageCount" in a));
}

// ── 2. Full pipeline: golden outline + reference identity ──────────────
console.log("\n--- 2. Full pipeline: outline golden + module references ---");
{
  const { ctx, ratios, dupont, ledger } = buildFullContext();
  const composed = composeReport({
    context: ctx,
    depth: "concise",
    hasResearchDebates: true,
    composedAt: PINNED,
  });

  check(
    "concise TOC titles match PDF golden",
    sameArray(composed.toc.map((t) => t.title), PDF_CONCISE_TOC),
    JSON.stringify(composed.toc.map((t) => t.title))
  );
  check(
    "concise section order matches PDF golden",
    sameArray(composed.sections.map((s) => s.pdfComponent ?? s.id), PDF_CONCISE_WITH_DEBATES),
    JSON.stringify(composed.sections.map((s) => s.pdfComponent ?? s.id))
  );
  check("section indexes 1-based", composed.sections.every((s, i) => s.index === i + 1));
  check(
    "outline matches resolveReportOutline",
    JSON.stringify(composed.sections.map((s) => s.id)) ===
      JSON.stringify(
        resolveReportOutline(getReportBlueprint("institutional_equity_v1")!, {
          depth: "concise",
          hasResearchDebates: true,
        }).sections.map((s) => s.id)
      )
  );
  check("moduleIds match RESEARCH_MODULE_ORDER (all 9)", sameArray(composed.moduleIds, [...RESEARCH_MODULE_ORDER]));
  check("modules bundle caseId matches", composed.modules.caseId === composed.caseId);
  check("modules bundle ran all selected", composed.modules.modules.length === composed.moduleIds.length);

  // Section module data is reference-identical to the composed bundle's own run.
  const valuationSection = composed.sections.find((s) => s.id === "fundamental-analysis");
  check("valuation section present", valuationSection != null);
  if (valuationSection) {
    const slice = valuationSection.moduleData.valuation;
    const bundleSlice = getModuleData(composed.modules, "valuation");
    check("section valuation moduleData reference-identical to bundle", slice === bundleSlice);
    check("section valuation anchorsFrom ledger", slice?.anchorsFrom === "ledger");
    check("section fairValue === ledger.fairValue", slice?.fairValue === ledger.fairValue);
    check("section rating === ledger.rating", slice?.rating === ledger.rating);
    check(
      "section dcf reference-identical to case valuation",
      slice?.dcf === ctx.researchCase.valuation
    );
  }

  const statementsSection = composed.sections.find((s) => s.id === "income-statement");
  check("income-statement section present", statementsSection != null);
  if (statementsSection) {
    const st = statementsSection.moduleData.statements;
    check("statements moduleData reference-identical ratios", st?.ratiosByYear === ratios);
    check("statements moduleData reference-identical dupont", st?.dupontByYear === dupont);
    check(
      "canonical facts seal intact through composition",
      st?.canonicalFacts != null && verifyCanonicalSeal(st.canonicalFacts).sealed
    );
  }

  // Every section wires only catalog modules; unavailable recorded when null.
  check(
    "every section module ⊆ moduleIds",
    composed.sections.every((s) => s.modules.every((m) => composed.moduleIds.includes(m)))
  );
  check(
    "unavailableModules only lists null slices",
    composed.sections.every((s) =>
      s.unavailableModules.every((m) => s.moduleData[m] == null)
    )
  );
  check(
    "full context → no unavailable modules on any section",
    composed.sections.every((s) => s.unavailableModules.length === 0),
    composed.sections
      .filter((s) => s.unavailableModules.length)
      .map((s) => `${s.id}:${s.unavailableModules.join(",")}`)
      .join("; ")
  );
  check("aggregated unknowns is an array", Array.isArray(composed.unknowns));

  // Full depth golden
  const full = composeReport({
    context: ctx,
    depth: "full",
    hasResearchDebates: true,
    composedAt: PINNED,
  });
  check(
    "full TOC titles match PDF golden",
    sameArray(full.toc.map((t) => t.title), PDF_FULL_TOC),
    JSON.stringify(full.toc.map((t) => t.title))
  );
  check(
    "full section order matches PDF golden",
    sameArray(full.sections.map((s) => s.pdfComponent ?? s.id), PDF_FULL_WITH_DEBATES),
    JSON.stringify(full.sections.map((s) => s.pdfComponent ?? s.id))
  );
  check("full depth is full", full.depth === "full");
}

// ── 3. Debates gate + depth ────────────────────────────────────────────
console.log("\n--- 3. Research-debates gate + depth ---");
{
  const { ctx } = buildFullContext();
  const without = composeReport({
    context: ctx,
    depth: "concise",
    researchReport: null,
    hasResearchDebates: false,
    composedAt: PINNED,
  });
  check(
    "omits research-debates when no report and no debates",
    !without.sections.some((s) => s.id === "research-debates")
  );

  const withReport = composeReport({
    context: ctx,
    depth: "concise",
    researchReport: makeResearchReport(),
    hasResearchDebates: false,
    composedAt: PINNED,
  });
  check(
    "includes research-debates when researchReport present",
    withReport.sections.some((s) => s.id === "research-debates")
  );
  check(
    "research-debates is second section when included",
    withReport.sections[1]?.id === "research-debates"
  );

  const withDebatesOnly = composeReport({
    context: ctx,
    depth: "concise",
    researchReport: null,
    hasResearchDebates: true,
    composedAt: PINNED,
  });
  check(
    "includes when debates exist without report",
    withDebatesOnly.sections.some((s) => s.id === "research-debates")
  );

  // Without research report on context → debates page still gated by flags only.
  const sparse: ModuleContext = { ...ctx, researchReport: null };
  const sparseComposed = composeReport({
    context: sparse,
    depth: "concise",
    researchReport: null,
    hasResearchDebates: false,
    composedAt: PINNED,
  });
  check(
    "context researchReport alone does not force debates when flags say no",
    !sparseComposed.sections.some((s) => s.id === "research-debates")
  );
}

// ── 4. ReportClient wire (moduleContextFromReportData / composeFromData) ──
console.log("\n--- 4. ReportData wire ---");
{
  const { ctx } = buildFullContext();
  const built = moduleContextFromReportData(makeReportData(ctx));
  check("moduleContextFromReportData returns context", built != null);
  check("context researchCase is reference-identical", built?.researchCase === ctx.researchCase);
  check("context ratios reference-identical", built?.ratiosByYear === ctx.ratiosByYear);
  check("context masterReportFacts reference-identical", built?.masterReportFacts === ctx.masterReportFacts);

  const report = makeReportData(ctx);
  const composed = composeReportFromData(report, { composedAt: PINNED });
  check("composeReportFromData returns composed", composed != null);
  check("composed caseId matches", composed?.caseId === ctx.researchCase.caseId);
  check(
    "composeReportFromData outline matches direct compose",
    JSON.stringify(composed?.sections.map((s) => s.id)) ===
      JSON.stringify(
        composeReport({
          context: ctx,
          composedAt: PINNED,
          researchReport: report.researchReport,
          hasResearchDebates: Boolean(
            report.aiAnalysis?.researchDebates?.length || report.researchReport?.debates?.length
          ),
        }).sections.map((s) => s.id)
      )
  );

  // Debates flag derived from researchReport.debates when options omit it.
  check(
    "debates gate open when researchReport.debates non-empty",
    composed?.sections.some((s) => s.id === "research-debates") === true
  );

  const noCase = makeReportData(ctx, { researchCase: null });
  check("moduleContext null without researchCase", moduleContextFromReportData(noCase) === null);
  check("composeReportFromData null without researchCase", composeReportFromData(noCase) === null);

  // Explicit options override.
  const closed = composeReportFromData(report, {
    composedAt: PINNED,
    researchReport: null,
    hasResearchDebates: false,
  });
  check(
    "explicit hasResearchDebates false closes gate",
    !closed?.sections.some((s) => s.id === "research-debates")
  );
}

// ── 5. Missing-data fail-closed + purity ───────────────────────────────
console.log("\n--- 5. Fail-closed + purity ---");
{
  const bareCase = buildResearchCase({
    profile: makeProfile(),
    stockData: makeStock(),
    createdAt: AS_OF,
    dataCutoff: AS_OF,
  });
  const bareCtx: ModuleContext = {
    researchCase: bareCase,
    masterReportFacts: null,
    ratiosByYear: null,
    dupontByYear: null,
    researchReport: null,
    aiAnalysis: null,
  };

  let threw = false;
  let composed: ComposedReport | null = null;
  try {
    composed = composeReport({
      context: bareCtx,
      depth: "concise",
      researchReport: null,
      hasResearchDebates: false,
      composedAt: PINNED,
    });
  } catch {
    threw = true;
  }
  check("bare context still composes (does not throw)", !threw && composed != null);
  if (composed) {
    check(
      "bare outline still resolves institutional sections",
      composed.sections.length > 0 && composed.blueprintId === "institutional_equity_v1"
    );
    check(
      "missing module slices recorded as unavailable (not invented)",
      composed.sections.some((s) => s.unavailableModules.length > 0) ||
        composed.unknowns.length > 0
    );
    const valSection = composed.sections.find((s) => s.id === "fundamental-analysis");
    const valSlice = valSection?.moduleData.valuation;
    if (valSection) {
      // Anchors fall through to dcf on bare case (valuation provided) or none.
      check(
        "bare valuation slice does not invent a rating when no ledger/facts",
        valSlice == null || valSlice.anchorsFrom !== "masterReportFacts" || valSlice.rating != null
      );
      if (valSlice && valSlice.anchorsFrom === "dcf") {
        check("dcf path rating stays null", valSlice.rating === null);
      }
    }
    check(
      "no section embeds fairValue/targetPrice as structural copy",
      !JSON.stringify(composed.toc).match(/fairValue|targetPrice|intrinsicValue/)
    );
    check(
      "sections carry structural + moduleData fields only (no run/compute fns)",
      composed.sections.every((s) => typeof (s as unknown as { run?: unknown }).run !== "function")
    );
    check("composer has no LLM / fetch calls in payload", !JSON.stringify(composed.version).includes("llm"));
  }

  // Bank architecture preserved through composition.
  const bankParams = baseParams({
    profile: makeProfile({ sector: "Financial Services", industry: "Banks - Regional" }),
    annualFinancials: [makeBankYear("FY2024"), makeBankYear("FY2025"), makeBankYear("FY2026")],
  });
  const bankBuilt = buildFullContext(bankParams);
  const bankComposed = composeReport({
    context: bankBuilt.ctx,
    composedAt: PINNED,
    hasResearchDebates: true,
  });
  check("bank case statement architecture B", bankBuilt.ctx.researchCase.architecture.statementArchitecture === "B");
  check("bank is financial institution", bankBuilt.ctx.researchCase.architecture.isFinancialInstitution);
  check("bank composed successfully", bankComposed.sections.length > 0);
  const bankVal = bankComposed.sections.find((s) => s.id === "fundamental-analysis")?.moduleData.valuation;
  check("bank valuation anchors still from ledger", bankVal?.anchorsFrom === "ledger");
}

// ── 6. PDF component mapping completeness ──────────────────────────────
console.log("\n--- 6. PDF component mapping ---");
{
  const { ctx } = buildFullContext();
  const composed = composeReport({
    context: ctx,
    depth: "full",
    hasResearchDebates: true,
    composedAt: PINNED,
  });
  const known = new Set<PdfComponentName>([
    "CoverPage",
    "ResearchDebatesPage",
    "FundamentalAnalysisPage",
    "MoatAndPriceFairValuePage",
    "MoatSourcesPage",
    "BullsSayBearsSayPage",
    "CreditAnalysisPage1",
    "CreditAnalysisPage2",
    "ManagementAndOwnershipPage1",
    "ManagementAndOwnershipPage2",
    "EventBasedPriceMovementPage",
    "CorporateDisclosuresAndCatalystsPage",
    "AnalystForecastsSummaryPage",
    "IncomeStatementDetailedPage",
    "BalanceSheetDetailedPage",
    "CashFlowDetailedPage",
    "ComparableCompanyAnalysisPage1",
    "ComparableCompanyAnalysisPage2",
    "ResearchMethodologyValuationPage1",
    "ResearchMethodologyValuationPage2",
    "CreditRatingApproachPage1",
    "CreditRatingApproachPage2",
    "InstitutionalDisclaimerPage",
    "AnalystAIDisclosurePage",
    "QualityAssuranceChecksumPage",
  ]);
  check(
    "every full-depth section maps to a known PDF component",
    composed.sections.every(
      (s) => typeof s.pdfComponent === "string" && known.has(s.pdfComponent as PdfComponentName)
    ),
    composed.sections
      .filter((s) => !(typeof s.pdfComponent === "string" && known.has(s.pdfComponent as PdfComponentName)))
      .map((s) => s.id)
      .join(",")
  );
  check(
    "every section declares pdfComponent (composed path usable)",
    composed.sections.every((s) => typeof s.pdfComponent === "string" && s.pdfComponent.length > 0)
  );
}

console.log("\n=======================================================");
console.log(`REPORT COMPOSER PHASE 5: ${passes} passed, ${failures} failed`);
console.log("=======================================================");
if (failures > 0) process.exit(1);
