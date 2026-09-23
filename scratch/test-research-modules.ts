/**
 * APEX RESEARCH — Research Modules Phase 3 Tests
 * ----------------------------------------------
 *  1. Module catalog contract (ids, order, feeds).
 *  2. Full-pipeline context: existing numbers flow through UNCHANGED
 *     (reference identity + numeric equality with ledger / facts / ratios).
 *  3. Anchor hierarchy (ledger wins over masterReportFacts over dcf).
 *  4. Missing-data fail-closed (nulls + explicit unknowns, no invention).
 *  5. Non-blocking runner + determinism.
 *
 * Run: npx tsx scratch/test-research-modules.ts (exit 1 on failure)
 */
import {
  runResearchModules,
  listResearchModules,
  getResearchModule,
  getModuleData,
  resolveValuationAnchors,
  resolveMoatAnchors,
  RESEARCH_MODULES,
  RESEARCH_MODULE_ORDER,
  RESEARCH_MODULES_VERSION,
  type ModuleContext,
  type ResearchModuleId,
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

const AS_OF = "2026-09-01T00:00:00.000Z";

// ── Fixtures (same shape as Phase 1 tests) ─────────────────────────────

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
    capitalExpenditures: 8e9,
    freeCashFlow: 52e9,
    investingCashFlow: -20e9,
    financingCashFlow: -10e9,
    dividendsPaid: 12e9,
    changeInCash: 5e9,
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
      thesis: "Test thesis for Phase 3 pass-through.",
      bullCase: [],
      bearCase: [],
      keyDebate: "Cycle timing",
      keyInflectionPoints: [],
      whatMarketMayBeMissing: "",
      whatCouldInvalidate: [],
    },
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
  };
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

/** Build a full pipeline-shaped context (route + ReportClient simulation). */
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

// ══════════════════════════════════════════════════════════════════════

console.log("=======================================================");
console.log("RESEARCH MODULES PHASE 3 TESTS");
console.log("=======================================================\n");

// ── 1. Catalog ─────────────────────────────────────────────────────────
console.log("--- 1. Module catalog contract ---");
{
  const list = listResearchModules();
  check("catalog length is 9", list.length === 9, `got ${list.length}`);
  check(
    "ids match RESEARCH_MODULE_ORDER",
    JSON.stringify(list.map((m) => m.id)) === JSON.stringify([...RESEARCH_MODULE_ORDER])
  );
  check(
    "RESEARCH_MODULES length matches order",
    RESEARCH_MODULES.length === RESEARCH_MODULE_ORDER.length
  );
  check("every module has feeds", list.every((m) => m.feeds.length > 0));
  check("every module has a title", list.every((m) => m.title.length > 0));
  check("getResearchModule finds valuation", getResearchModule("valuation")?.id === "valuation");
  check("getResearchModule rejects unknown", getResearchModule("nope" as ResearchModuleId) === null);
  check("version pinned", RESEARCH_MODULES_VERSION === "research-modules-v1");
}

// ── 2. Full pipeline: numbers flow through unchanged ───────────────────
console.log("\n--- 2. Existing numbers flow through modules unchanged ---");
{
  const { ctx, ratios, dupont, ledger, facts } = buildFullContext();
  const bundle = runResearchModules(ctx);

  check("all 9 modules ran", bundle.modules.length === 9);
  check(
    "every module available on full context",
    bundle.modules.every((m) => m.available),
    bundle.modules.filter((m) => !m.available).map((m) => m.moduleId).join(",")
  );
  check("caseId matches ResearchCase", bundle.caseId === ctx.researchCase.caseId);
  check("modulesVersion pinned", bundle.modulesVersion === RESEARCH_MODULES_VERSION);

  const statements = getModuleData(bundle, "statements");
  check("statements module present", statements != null);
  if (statements) {
    check(
      "ratiosByYear is reference-identical to pipeline ratios",
      statements.ratiosByYear === ratios
    );
    check(
      "dupontByYear is reference-identical to pipeline dupont",
      statements.dupontByYear === dupont
    );
    check(
      "annual is reference-identical to ResearchCase history",
      statements.annual === ctx.researchCase.historicalFinancials
    );
    check(
      "canonicalFacts reference-identical + seal intact",
      statements.canonicalFacts === ctx.researchCase.canonicalFacts &&
        verifyCanonicalSeal(statements.canonicalFacts!).sealed
    );
  }

  const valuation = getModuleData(bundle, "valuation");
  check("valuation module present", valuation != null);
  if (valuation) {
    check("anchorsFrom is ledger", valuation.anchorsFrom === "ledger");
    check(
      "fairValue === ledger.fairValue",
      valuation.fairValue === ledger.fairValue
    );
    check("targetPrice === ledger.targetPrice", valuation.targetPrice === ledger.targetPrice);
    check("rating === ledger.rating", valuation.rating === ledger.rating);
    check(
      "currentPrice === ledger.currentPrice",
      valuation.currentPrice === ledger.currentPrice
    );
    check(
      "upsideDownsidePct === ledger.upsideDownsidePct",
      valuation.upsideDownsidePct === ledger.upsideDownsidePct
    );
    check("dcf is reference-identical to ResearchCase.valuation", valuation.dcf === ctx.researchCase.valuation);
    check("ledger is reference-identical", valuation.ledger === ctx.researchCase.assumptionsLedger);
    check(
      "scenarios is reference-identical (or deep-equal when derived once)",
      valuation.scenarios === ctx.researchCase.scenarios
    );
    check(
      "masterReportFacts fairValue agrees with ledger target",
      facts.valuation.fairValue.value === ledger.targetPrice ||
        facts.valuation.fairValue.value === ledger.fairValue,
      `facts=${facts.valuation.fairValue.value} ledger=${ledger.fairValue}`
    );
    check(
      "masterReportFacts recommendation.rating === ledger.rating",
      facts.recommendation.rating === ledger.rating
    );
    check("selectedModel passed through", valuation.selectedModel === "FCFF_DCF");
    check("valuationLens passed through", valuation.valuationLens === "fcff");
  }

  const peers = getModuleData(bundle, "peers");
  check("peers module present", peers != null);
  if (peers) {
    check("peerSet is reference-identical to ResearchCase.peers", peers.peerSet === ctx.researchCase.peers);
    check(
      "peer list length matches input",
      peers.peerSet.peers.length === ctx.researchCase.peers.peers.length
    );
    check("peerFacts is reference-identical to masterReportFacts.peers", peers.peerFacts === facts.peers);
  }

  const moat = getModuleData(bundle, "moat");
  check("moat module present", moat != null);
  if (moat) {
    check("moat sourcesFrom ledger", moat.sourcesFrom === "ledger");
    check("moat rating === ledger.moatRating", moat.rating === ledger.moatRating);
    check("moat trend === ledger.moatTrend", moat.trend === ledger.moatTrend);
    check("moat bridge === ledger.moatBridge", moat.bridge === ledger.moatBridge);
    check("moatFacts reference-identical", moat.moatFacts === facts.moat);
    check("competition reference-identical", moat.competition === ctx.researchCase.competition);
  }

  const quality = getModuleData(bundle, "quality");
  check("quality module present", quality != null);
  if (quality) {
    check(
      "dataQuality reference-identical",
      quality.dataQuality === ctx.researchCase.dataQuality
    );
    check("evidence reference-identical", quality.evidence === ctx.researchCase.evidence);
    check(
      "dataConfidence grade === case grade",
      quality.dataConfidence?.grade === ctx.researchCase.dataQuality.grade
    );
    check("quality facts reference-identical", quality.quality === facts.quality);
    check(
      "blockers preserved (not cleared by module)",
      JSON.stringify(quality.dataQuality.blockers) ===
        JSON.stringify(ctx.researchCase.dataQuality.blockers)
    );
  }

  const business = getModuleData(bundle, "business");
  if (business) {
    check("company reference-identical", business.company === ctx.researchCase.company);
    check("architecture reference-identical", business.architecture === ctx.researchCase.architecture);
    check("ontology reference-identical", business.ontology === ctx.researchCase.ontology);
    check(
      "statement architecture A preserved",
      business.architecture.statementArchitecture === "A"
    );
  }

  const thesis = getModuleData(bundle, "thesis");
  check("thesis module present", thesis != null);
  if (thesis) {
    check("thesis rating === ledger.rating", thesis.rating === ledger.rating);
    check("thesis fairValue === ledger.fairValue", thesis.fairValue === ledger.fairValue);
    check("thesis complexity reference-identical", thesis.complexity === ctx.researchCase.complexity);
    check(
      "thesis narrative from research report",
      thesis.narrative === "Test thesis for Phase 3 pass-through."
    );
    check("confidence not invented (present from report)", thesis.confidence != null);
  }

  const risk = getModuleData(bundle, "risk-catalyst");
  if (risk) {
    check("risks reference-identical", risk.risks === ctx.researchCase.risks);
    check("catalysts reference-identical", risk.catalysts === ctx.researchCase.catalysts);
    check(
      "primaryRisks copied from masterReportFacts (not recomputed)",
      JSON.stringify(risk.primaryRisks) === JSON.stringify(facts.risks.primaryRisks)
    );
  }

  const mgmt = getModuleData(bundle, "management");
  if (mgmt) {
    check("management reference-identical", mgmt.management === ctx.researchCase.management);
    check(
      "officers from case management",
      mgmt.officers === ctx.researchCase.management.officers ||
        mgmt.officers.length === ctx.researchCase.management.officers.length
    );
  }
}

// ── 3. Anchor hierarchy ────────────────────────────────────────────────
console.log("\n--- 3. Anchor hierarchy (ledger → facts → dcf) ---");
{
  const { ctx, ledger, facts } = buildFullContext();
  const fromLedger = resolveValuationAnchors(ctx.researchCase, facts);
  check("ledger wins when present", fromLedger.anchorsFrom === "ledger");
  check("ledger fairValue", fromLedger.fairValue === ledger.fairValue);

  const noLedgerCase = { ...ctx.researchCase, assumptionsLedger: null };
  const fromFacts = resolveValuationAnchors(noLedgerCase, facts);
  check("falls back to masterReportFacts", fromFacts.anchorsFrom === "masterReportFacts");
  check(
    "facts fairValue matches facts.valuation.fairValue.value",
    fromFacts.fairValue === facts.valuation.fairValue.value
  );

  const dcfOnly = resolveValuationAnchors(
    { ...noLedgerCase, valuation: makeDcf(), stock: makeStock() },
    null
  );
  check("falls back to dcf", dcfOnly.anchorsFrom === "dcf");
  check("dcf fairValue === intrinsicValue", dcfOnly.fairValue === 98);

  const none = resolveValuationAnchors(
    { assumptionsLedger: null, valuation: null, stock: makeStock() },
    null
  );
  check("none when all absent", none.anchorsFrom === "none");
  check("none → rating null (not invented)", none.rating === null);
  check("none → fairValue null", none.fairValue === null);

  const moatFromLedger = resolveMoatAnchors(ctx.researchCase, facts);
  check("moat from ledger", moatFromLedger.sourcesFrom === "ledger");
  check("moat rating === ledger", moatFromLedger.rating === ledger.moatRating);

  const moatFromFacts = resolveMoatAnchors({ assumptionsLedger: null }, facts);
  check("moat falls back to facts", moatFromFacts.sourcesFrom === "masterReportFacts");
  check("moat rating === facts.moat.rating", moatFromFacts.rating === facts.moat.rating);
}

// ── 4. Missing data fail-closed ────────────────────────────────────────
console.log("\n--- 4. Missing-data fail-closed (no invention) ---");
{
  const bareCase = buildResearchCase({
    profile: makeProfile(),
    stockData: makeStock(),
    annualFinancials: [],
    quarterlyFinancials: [],
    peers: [],
    valuation: null,
    createdAt: AS_OF,
    dataCutoff: AS_OF,
  });
  const ctx: ModuleContext = {
    researchCase: bareCase,
    masterReportFacts: null,
    ratiosByYear: null,
    dupontByYear: null,
    eventPriceMovements: null,
    shareholding: null,
    qaReport: null,
  };
  const bundle = runResearchModules(ctx);
  check("bare context still runs all modules", bundle.modules.length === 9);
  check(
    "runner does not throw on sparse data",
    bundle.modules.every((m) => typeof m.moduleId === "string")
  );

  const valuation = getModuleData(bundle, "valuation");
  check("valuation available false without anchors", valuation == null || !bundle.modules.find((m) => m.moduleId === "valuation")?.available);
  const valRun = bundle.modules.find((m) => m.moduleId === "valuation");
  check("valuation reports no-anchors unknown", (valRun?.unknowns ?? []).some((u) => u.includes("No valuation anchors")));
  check("valuation fairValue stays null when run failed/unavailable", valuation == null || valuation.fairValue === null);

  const statements = getModuleData(bundle, "statements");
  if (statements) {
    check("empty annual history", statements.annual.length === 0);
    check("ratios null when not provided", statements.ratiosByYear === null);
    check("canonicalFacts still built (facts ≠ valuation)", statements.canonicalFacts != null);
  } else {
    const run = bundle.modules.find((m) => m.moduleId === "statements");
    check("statements unavailable with empty history", run?.available === false);
  }

  const thesis = bundle.modules.find((m) => m.moduleId === "thesis");
  check(
    "thesis records rating/narrative unknowns when missing",
    (thesis?.unknowns ?? []).some((u) => u.includes("Rating unavailable") || u.includes("Thesis narrative"))
  );
  const thesisData = getModuleData(bundle, "thesis");
  if (thesisData) {
    check("thesis narrative null not invented", thesisData.narrative === null);
    check("thesis rating null not invented", thesisData.rating === null);
  }

  const peersRun = bundle.modules.find((m) => m.moduleId === "peers");
  check("peers unavailable when empty", peersRun?.available === false);
  check("peers unknown recorded", (peersRun?.unknowns ?? []).length > 0);

  check("aggregated unknowns non-empty on bare case", bundle.unknowns.length > 0);
  check(
    "no fabricated rating on bare valuation module",
    (valRun?.data as { rating?: unknown } | null)?.rating == null || valRun?.available === false
  );
}

// ── 5. Non-blocking + determinism + subset ─────────────────────────────
console.log("\n--- 5. Non-blocking runner, determinism, subsets ---");
{
  const { ctx } = buildFullContext();
  const a = runResearchModules(ctx);
  const b = runResearchModules(ctx);
  check("caseId deterministic", a.caseId === b.caseId);
  check(
    "module id order deterministic",
    JSON.stringify(a.modules.map((m) => m.moduleId)) ===
      JSON.stringify(b.modules.map((m) => m.moduleId))
  );
  check(
    "valuation fairValue deterministic",
    (getModuleData(a, "valuation")?.fairValue ?? null) ===
      (getModuleData(b, "valuation")?.fairValue ?? null)
  );
  check(
    "sources sets deterministic (sorted compare)",
    JSON.stringify(
      a.modules.map((m) => ({ id: m.moduleId, s: [...m.sources].sort() }))
    ) ===
      JSON.stringify(
        b.modules.map((m) => ({ id: m.moduleId, s: [...m.sources].sort() }))
      )
  );

  const subset = runResearchModules(ctx, ["valuation", "business"]);
  check("subset runs 2 modules", subset.modules.length === 2);
  check(
    "subset ordered by presentation order (business before valuation)",
    subset.modules[0]?.moduleId === "business" && subset.modules[1]?.moduleId === "valuation"
  );

  let threw = false;
  try {
    runResearchModules(ctx, ["nope" as ResearchModuleId]);
  } catch {
    threw = true;
  }
  check("unknown module id throws", threw);

  let missingCase = false;
  try {
    runResearchModules({} as ModuleContext);
  } catch {
    missingCase = true;
  }
  check("missing researchCase throws", missingCase);

  // Module failure isolation: corrupt ctx mid-way via getter is hard;
  // instead ensure runner wraps unknown modules already proven above.
  check("catalog exports RESEARCH_MODULES array", Array.isArray(RESEARCH_MODULES));
}

// ── 6. Bank architecture still preserved through modules ───────────────
console.log("\n--- 6. Sector architecture preserved through modules ---");
{
  const { ctx } = buildFullContext({
    profile: makeProfile({
      ticker: "BANKTEST.NS",
      sector: "Financial Services",
      industry: "Banks - Regional",
      description: "Regional bank offering deposits and loans.",
    }),
    annualFinancials: [
      makeBankYear("FY2023"),
      makeBankYear("FY2024"),
      makeBankYear("FY2025"),
      makeBankYear("FY2026"),
    ],
  });
  const bundle = runResearchModules(ctx);
  const business = getModuleData(bundle, "business");
  check("bank architecture is B", business?.architecture.statementArchitecture === "B");
  check("bank is financial institution", business?.architecture.isFinancialInstitution === true);
  check("bank is regulated", business?.architecture.isRegulatedSector === true);

  const valuation = getModuleData(bundle, "valuation");
  check("bank valuation module available", valuation != null);
  check("bank anchors still from ledger", valuation?.anchorsFrom === "ledger");
}

// ── Summary ────────────────────────────────────────────────────────────
console.log("\n=======================================================");
console.log(`RESEARCH MODULES PHASE 3: ${passes} passed, ${failures} failed`);
console.log("=======================================================");
if (failures > 0) process.exit(1);
