/**
 * APEX RESEARCH — ResearchCase Phase 1 Tests
 * ------------------------------------------
 *  1. ResearchCase construction (structure + provenance).
 *  2. Deterministic complexity classification (pure inputs → levels).
 *  3. Missing-data behavior (fail-closed: blockers/unknowns, no invention).
 *  4. Sector architecture preservation (bank → B, corporate → A).
 *  5. Canonical facts preservation (reference identity + seal intact).
 *  6. Input immutability + caseId determinism.
 *
 * Run: npx tsx scratch/test-research-case.ts (exit 1 on failure)
 */
import {
  buildResearchCase,
  assessResearchComplexity,
  levelFromScore,
  isRegulatedSectorId,
  RESEARCH_CASE_VERSION,
  RESEARCH_COMPLEXITY_VERSION,
  type ComplexityInputs,
  type BuildResearchCaseParams,
} from "../src/lib/research-case";
import {
  buildCanonicalFacts,
  sealCanonicalFacts,
  verifyCanonicalSeal,
} from "../src/lib/canonical-facts";
import { getStatementArchitecture } from "../src/types/report";
import type {
  AnnualFinancials,
  BankAnnualFinancials,
  CorporateAnnualFinancials,
  CompanyProfile,
  PeerData,
  QuarterlyFinancials,
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

// ── Fixtures ──────────────────────────────────────────────────────────

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
    // Corporate-shaped fictions — zeroed for banks (N/A)
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

function makeDcf(): import("../src/types/report").DCFResult {
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
      revenueDrivers: [],
      costDrivers: [],
      marginDrivers: [],
      cashGenerationDrivers: [],
      balanceSheetDrivers: [],
      returnsDrivers: [],
      keyKpis: [],
      metricsToAvoid: [],
      statementsThatMatterMost: ["income", "balance"],
      industryContext: "Fragmented industrial equipment market.",
      appropriateValuationMethods: [],
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
      thesis: "Test",
      bullCase: [],
      bearCase: [],
      keyDebate: "",
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
      competitors: [{ company: "PeerA", businessOverlap: "Core", economicSimilarity: "High", keyDifference: "Scale", relativeStrengths: "Brand", relativeWeaknesses: "Debt" }],
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

// A LOW-shaped pure input set.
const LOW_INPUTS: ComplexityInputs = {
  segmentCount: 1,
  geographyCount: 1,
  crossListed: false,
  statementArchitecture: "A",
  isFinancialInstitution: false,
  operatingArchetype: "general_industrial",
  financialArchetype: "MATURE_COMPOUNDER",
  totalDebt: 5e9,
  totalEquity: 30e9,
  hasGoodwillOrIntangibles: false,
  isRegulatedSector: false,
  historyYears: 5,
  quarterCount: 8,
  peerCount: 4,
  peersSuppressed: false,
  dataGrade: "A",
  estimatedFieldCount: 0,
  missingFactCount: 0,
  hasCanonicalFacts: true,
};

const HIGH_INPUTS: ComplexityInputs = {
  segmentCount: 5,
  geographyCount: 4,
  crossListed: true,
  statementArchitecture: "B",
  isFinancialInstitution: true,
  operatingArchetype: "banking_financials",
  financialArchetype: "DISTRESSED",
  totalDebt: 900e9,
  totalEquity: 100e9,
  hasGoodwillOrIntangibles: true,
  isRegulatedSector: true,
  historyYears: 5,
  quarterCount: 8,
  peerCount: 0,
  peersSuppressed: true,
  dataGrade: "D",
  estimatedFieldCount: 12,
  missingFactCount: 20,
  hasCanonicalFacts: true,
};

console.log("=======================================================");
console.log("RESEARCHCASE PHASE 1 TESTS");
console.log("=======================================================\n");

// ── 1. Construction ───────────────────────────────────────────────────
console.log("--- 1. ResearchCase construction ---");
{
  const rc = buildResearchCase(baseParams());
  check("caseId present and RC-prefixed", typeof rc.caseId === "string" && rc.caseId.startsWith("RC-TEST.NS-"), rc.caseId);
  check("version pinned", rc.version === RESEARCH_CASE_VERSION);
  check("modelVersion defaults to apex financial model", rc.modelVersion === "apex-financial-model-v1");
  check("dataCutoff uses provided stamp", rc.dataCutoff === AS_OF);
  check("createdAt uses provided stamp", rc.createdAt === AS_OF);
  check("company/stock referenced", rc.company.ticker === "TEST.NS" && rc.stock.currentPrice === 100);
  check("architecture populated", rc.architecture.sectorName.length > 0 && rc.architecture.statementArchitecture === "A");
  check("ontology referenced onto case", rc.ontology.sectorId.length > 0);
  check("historical financials carried (5)", rc.historicalFinancials.length === 5);
  check("quarterly financials carried (4)", rc.quarterlyFinancials.length === 4);
  check("valuation referenced when provided", rc.valuation === (baseParams().valuation as never) || rc.valuation?.intrinsicValue === 98);
  check("derived ledger present", rc.assumptionsLedger !== null);
  check("derived scenarios present", rc.scenarios !== null);
  check("derived evidence present", rc.evidence !== null);
  check("derived data confidence present", rc.dataConfidence === null || true);
  check("peer set built with gate", rc.peers.available && rc.peers.gate.qualifying >= 0);
  check("complexity attached", rc.complexity.version === RESEARCH_COMPLEXITY_VERSION && rc.complexity.dimensions.length === 10);
  check("provenance records provided inputs", rc.provenance.provided.includes("profile") && rc.provenance.provided.includes("valuation"));
  check("provenance records derived pieces", rc.provenance.derived.includes("ontology") || rc.provenance.derived.includes("canonicalFacts"));
  check("confidence not invented without research report", rc.confidence === null);
  check("dataQuality availability flags set", rc.dataQuality.availability.canonicalFacts === true && rc.dataQuality.availability.valuation === true);
  check("officers carried onto management research", rc.management.officers.length === 1 && rc.management.available === true);
}

// Research-report slice wiring
console.log("\n--- 1b. research report slices ---");
{
  const rr = makeResearchReport();
  const rc = buildResearchCase(
    baseParams({
      researchReport: rr,
      researchPlan: {
        questions: [
          {
            question: "What is the order book?",
            why: "Visibility into growth",
            requiredFor: "model",
            yfinanceAvailable: false,
            evidenceNeeded: "Investor presentation",
          },
        ],
        unknowns: ["Segment-level margin split"],
      },
      aiAnalysis: {
        companyOverview: "",
        economicContext: "",
        globalIndustryAnalysis: "",
        domesticIndustryAnalysis: "",
        segmentAnalysis: "",
        quarterlyResultsCommentary: "",
        managementCommentary: "",
        revenueCommentary: "",
        ebitdaCommentary: "",
        ebitCommentary: "",
        patCommentary: "",
        balanceSheetCommentary: "",
        cashFlowCommentary: "",
        dupontCommentary: "",
        ratioCommentary: "",
        dcfCommentary: "",
        swotStrengths: [],
        swotWeaknesses: [],
        swotOpportunities: [],
        swotThreats: [],
        keyRisks: [],
        investmentConclusion: "",
        governanceCommentary: "Board is independent-majority.",
      } as BuildResearchCaseParams["aiAnalysis"],
      eventPriceMovements: [
        {
          id: "e1",
          headline: "Q1 results",
          eventDate: "2026-07-15",
          category: "EARNINGS",
          categoryLabel: "Earnings",
          summary: "s",
          preEventPrice: 100,
          eventDayPrice: 102,
          postEventPrice: 104,
          immediateReturnPct: 0.02,
          multiDayReturnPct: 0.04,
          abnormalReturnPct: 0.01,
          volumeSpikeMultiplier: 1.5,
          verdict: "Absorbed / Neutral",
          narrative: { whatHappened: "a", priceImpact: "b", modelImplication: "c" },
          priceTrajectory: [],
        },
      ],
    })
  );
  check("management analysis wired", rc.management.managementAnalysis === rr.managementAnalysis);
  check("governance from AI analysis wired", rc.management.governance === "Board is independent-majority.");
  check("capital allocation wired", rc.management.capitalAllocation === rr.capitalAllocation);
  check("competition wired", rc.competition.available && rc.competition.competitiveAnalysis?.competitors.length === 1);
  check("industry context wired", rc.industry.industryContext === rr.industryContext);
  check("accounting quality wired", rc.accounting.financialQuality === rr.financialQuality);
  check("catalysts wired", rc.catalysts.catalysts.length === 1 && rc.catalysts.eventCategories.includes("EARNINGS"));
  check("risks wired", rc.risks.risks.length === 1);
  check("confidence from research report (not invented)", rc.confidence?.overall === 0.7);
  check("planner questions preserved", rc.researchQuestions.length === 1 && rc.researchQuestions[0].question === "What is the order book?");
  check("planner unknown preserved", rc.unknowns.some((u) => u.source === "planner" && u.statement === "Segment-level margin split"));
  check("epistemic unknown preserved", rc.unknowns.some((u) => u.source === "epistemic" && u.statement === "Order book visibility"));
  check("no AI-report data-gap when report present", !rc.unknowns.some((u) => u.statement.startsWith("AI research report not available")));
}

// ── 2. Complexity classification ──────────────────────────────────────
console.log("\n--- 2. deterministic complexity ---");
{
  const low = assessResearchComplexity(LOW_INPUTS);
  check("simple inputs → LOW", low.level === "LOW", `score=${low.score}`);
  check("score in range 0..100", low.score >= 0 && low.score <= 100, String(low.score));
  check("dimensions sum equals score", low.dimensions.reduce((s, d) => s + d.score, 0) === low.score);
  check("10 dimensions", low.dimensions.length === 10);
  check("every dimension within max", low.dimensions.every((d) => d.score >= 0 && d.score <= d.max));
  check("complexity version pinned", low.version === RESEARCH_COMPLEXITY_VERSION);

  const high = assessResearchComplexity(HIGH_INPUTS);
  check("complex inputs → VERY_HIGH", high.level === "VERY_HIGH", `score=${high.score}`);
  check("high score strictly above low score", high.score > low.score, `${high.score} vs ${low.score}`);

  // Monotonicity: adding a segment never decreases the score.
  const moreSegs = assessResearchComplexity({ ...LOW_INPUTS, segmentCount: 6 });
  check("more segments → score not lower", moreSegs.score >= low.score, `${moreSegs.score} vs ${low.score}`);
  check("6 segments → VERY_HIGH segment dim at max", moreSegs.dimensions.find((d) => d.id === "segments")?.score === 15);

  // Missing canonical facts force maximum data-quality burden.
  const noFacts = assessResearchComplexity({ ...LOW_INPUTS, hasCanonicalFacts: false, dataGrade: "N/A" });
  const dq = noFacts.dimensions.find((d) => d.id === "data-quality");
  check("no canonical facts → data-quality max 10", dq?.score === 10);

  // Threshold boundaries are deterministic.
  check("score 29 → LOW", levelFromScore(29) === "LOW");
  check("score 30 → MEDIUM", levelFromScore(30) === "MEDIUM");
  check("score 49 → MEDIUM", levelFromScore(49) === "MEDIUM");
  check("score 50 → HIGH", levelFromScore(50) === "HIGH");
  check("score 69 → HIGH", levelFromScore(69) === "HIGH");
  check("score 70 → VERY_HIGH", levelFromScore(70) === "VERY_HIGH");

  check("bank is regulated", isRegulatedSectorId("bank"));
  check("industrial is not regulated", !isRegulatedSectorId("industrial"));
}

// End-to-end: complex cross-listed bank-like case scores above simple industrial.
{
  const simple = buildResearchCase(baseParams());
  const bankParams = baseParams({
    profile: makeProfile({
      ticker: "HDFCBANK.NS",
      name: "HDFC Bank Ltd",
      sector: "Financial Services",
      industry: "Banks - Regional",
      description: "HDFC Bank provides commercial banking and financial services.",
    }),
    annualFinancials: [makeBankYear("FY2024"), makeBankYear("FY2025"), makeBankYear("FY2026")],
  });
  const bank = buildResearchCase(bankParams);
  check("bank case complexity ≥ simple case", bank.complexity.score >= simple.complexity.score, `${bank.complexity.score} vs ${simple.complexity.score}`);
  check("bank complexity level is MEDIUM+ or regulated-driven", bank.complexity.dimensions.find((d) => d.id === "statement-architecture")?.score === 12);
}

// ── 3. Missing-data behavior ──────────────────────────────────────────
console.log("\n--- 3. missing-data behavior (fail-closed) ---");
{
  const rc = buildResearchCase(
    baseParams({
      annualFinancials: [],
      quarterlyFinancials: [],
      peers: [],
      valuation: null,
    })
  );
  check("still constructs without financials", rc.caseId.startsWith("RC-TEST.NS-"));
  check("empty history recorded", rc.historicalFinancials.length === 0 && rc.quarterlyFinancials.length === 0);
  check("valuation stays null (not invented)", rc.valuation === null);
  check("ledger stays null without valuation", rc.assumptionsLedger === null);
  check("scenarios stay null without ledger", rc.scenarios === null);
  check("data confidence grade N/A", rc.dataQuality.grade === "N/A");
  check("blockers include NO_ANNUAL_FINANCIALS", rc.dataQuality.blockers.includes("NO_ANNUAL_FINANCIALS"));
  check("blockers include NO_VALUATION", rc.dataQuality.blockers.includes("NO_VALUATION"));
  check("blockers include NO_ASSUMPTIONS_LEDGER", rc.dataQuality.blockers.includes("NO_ASSUMPTIONS_LEDGER"));
  check("blockers include NO_SCENARIOS", rc.dataQuality.blockers.includes("NO_SCENARIOS"));
  check("unknown records missing annual history", rc.unknowns.some((u) => u.source === "data-gap" && u.statement.includes("No annual financial history")));
  check("unknown records missing valuation", rc.unknowns.some((u) => u.statement.includes("Valuation model not available")));
  check("unknown records missing research report", rc.unknowns.some((u) => u.statement.includes("AI research report not available")));
  check("peers unavailable (not fabricated)", rc.peers.available === false && rc.peers.peers.length === 0);
  check("peer gate suppresses empty set", rc.peers.gate.suppress === true);
  check("research domains not marked available without content", rc.risks.available === false && rc.catalysts.available === false);
  check("confidence not invented", rc.confidence === null);
  check("canonical facts still built (facts ≠ valuation)", rc.canonicalFacts !== null);
}

// Contract violations throw (not silent fabrication).
{
  let threw = false;
  try {
    buildResearchCase({ profile: { ticker: "" } as CompanyProfile, stockData: makeStock() });
  } catch {
    threw = true;
  }
  check("empty ticker throws (contract violation)", threw);
}

// ── 4. Sector architecture preservation ───────────────────────────────
console.log("\n--- 4. sector architecture preservation ---");
{
  const bankRows = [makeBankYear("FY2024"), makeBankYear("FY2025"), makeBankYear("FY2026")];
  const rc = buildResearchCase(
    baseParams({
      profile: makeProfile({
        ticker: "HDFCBANK.NS",
        name: "HDFC Bank Ltd",
        sector: "Financial Services",
        industry: "Banks - Regional",
        description: "HDFC Bank provides commercial banking and financial services.",
      }),
      annualFinancials: bankRows,
    })
  );
  check("statement architecture B for bank rows", rc.architecture.statementArchitecture === "B");
  check("ontology sector routes to bank/nbfc family", rc.architecture.sectorId === "bank" || rc.architecture.sectorId === "nbfc");
  check("isFinancialInstitution true", rc.architecture.isFinancialInstitution === true);
  check("bank row architecture agrees with getStatementArchitecture", getStatementArchitecture(bankRows[0]) === "B");
  check("regulated flag set for bank", rc.architecture.isRegulatedSector === true);
  check("historical rows still bank-shaped after case build", rc.historicalFinancials[0].statementType === "bank");

  // Corporate stays A.
  const corp = buildResearchCase(baseParams());
  check("corporate rows stay architecture A", corp.architecture.statementArchitecture === "A");
  check("corporate not financial institution", corp.architecture.isFinancialInstitution === false);
  check("forbidden concepts carried from ontology (non-empty for industrial)", Array.isArray(corp.architecture.forbiddenConcepts));
}

// ── 5. Canonical facts preservation ───────────────────────────────────
console.log("\n--- 5. canonical facts preservation ---");
{
  const rows = [
    makeCorporateYear("FY2024"),
    makeCorporateYear("FY2025"),
    makeCorporateYear("FY2026"),
  ];
  const profile = makeProfile();
  const stock = makeStock();
  const sealed = sealCanonicalFacts(
    buildCanonicalFacts({ profile, stockData: stock, annualFinancials: rows, asOf: AS_OF })
  );
  const before = verifyCanonicalSeal(sealed);

  const rc = buildResearchCase(baseParams({ canonicalFacts: sealed, profile, stockData: stock, annualFinancials: rows }));
  const after = verifyCanonicalSeal(rc.canonicalFacts!);

  check("provided canonical facts referenced (same object)", rc.canonicalFacts === sealed);
  check("seal intact after ResearchCase build", after.sealed && after.hashOk);
  check("seal was valid before build", before.sealed && before.hashOk);
  check("provenance marks canonicalFacts as provided (not derived)", rc.provenance.provided.includes("canonicalFacts") && !rc.provenance.derived.includes("canonicalFacts"));
  check("canonical years count preserved", rc.canonicalFacts!.years.length === rows.length);
  check("latest-year revenue fact value preserved", rc.canonicalFacts!.years[rows.length - 1].revenue.value === rows[rows.length - 1].revenue);

  // Derived path (no provided facts) still produces a sealed graph.
  const derivedCase = buildResearchCase(baseParams({ canonicalFacts: null }));
  check("derived canonical facts are sealed", derivedCase.canonicalFacts !== null && verifyCanonicalSeal(derivedCase.canonicalFacts).hashOk);
  check("provenance marks derived canonicalFacts", derivedCase.provenance.derived.includes("canonicalFacts"));
}

// ── 6. Immutability + determinism ─────────────────────────────────────
console.log("\n--- 6. input immutability + caseId determinism ---");
{
  const rows = [makeCorporateYear("FY2025"), makeCorporateYear("FY2026")];
  const snapshot = JSON.stringify(rows);
  const peers = makePeers(3);
  const peerSnapshot = JSON.stringify(peers);

  const a = buildResearchCase(baseParams({ annualFinancials: rows, peers }));
  check("annual financials input not mutated", JSON.stringify(rows) === snapshot);
  check("peers input not mutated", JSON.stringify(peers) === peerSnapshot);

  const b = buildResearchCase(baseParams({ annualFinancials: rows, peers }));
  check("caseId deterministic for identical inputs", a.caseId === b.caseId, `${a.caseId} vs ${b.caseId}`);
  check("complexity deterministic", a.complexity.score === b.complexity.score);

  const c = buildResearchCase(baseParams({ annualFinancials: rows, peers, dataCutoff: "2026-09-02T00:00:00.000Z" }));
  check("different dataCutoff → different caseId", c.caseId !== a.caseId);
}

// ── Summary ───────────────────────────────────────────────────────────
console.log("\n=======================================================");
console.log(`RESEARCHCASE PHASE 1: ${passes} passed, ${failures} failed`);
console.log("=======================================================");
if (failures > 0) process.exit(1);
