// ============================================================
// TypeScript types for the Equity Research Report Generator
// ============================================================

export interface CompanyProfile {
  ticker: string;
  name: string;
  exchange: string;
  exchangeTimezoneName: string;
  sector: string;
  industry: string;
  country: string;
  currency: string;
  description: string;
  website: string;
  employees: number;
  logo?: string;
  officers: Officer[];
}

export interface Officer {
  name: string;
  title: string;
  age?: number;
}

export interface StockData {
  currentPrice: number;
  previousClose: number;
  open: number;
  dayHigh: number;
  dayLow: number;
  marketCap: number;
  enterpriseValue: number;
  pe: number;
  forwardPE: number;
  pb: number;
  ps: number;
  dividendYield: number;
  dividendRate: number;
  beta: number;
  week52High: number;
  week52Low: number;
  sharesOutstanding: number;
  floatShares: number;
  avgVolume: number;
  volume: number;
  fiftyDayAvg: number;
  twoHundredDayAvg: number;
  eps: number;
  forwardEps: number;
  bookValue: number;
  priceToBook: number;
  returnOnEquity: number;
  returnOnAssets: number;
  debtToEquity: number;
  currentRatio: number;
  quickRatio: number;
  grossMargins: number;
  ebitdaMargins: number;
  operatingMargins: number;
  profitMargins: number;
  freeCashflow: number;
  totalDebt: number;
  totalCash: number;
  revenueGrowth: number;
  earningsGrowth: number;
  recommendationKey: string;
  numberOfAnalystOpinions: number;
  targetHighPrice: number;
  targetLowPrice: number;
  targetMeanPrice: number;
}

export interface AnnualFinancials {
  year: string; // e.g. "FY2025"
  fiscalYearEnd: string; // e.g. "2025-03-31"
  // Income Statement
  revenue: number;
  costOfRevenue: number;
  grossProfit: number;
  grossMargin: number;
  researchDevelopment: number;
  sellingGeneralAdministrative: number;
  totalOperatingExpenses: number;
  operatingIncome: number; // EBIT
  ebitda: number;
  ebitdaMargin: number;
  ebitMargin: number;
  interestExpense: number;
  otherIncome: number;
  pretaxIncome: number;
  incomeTaxExpense: number;
  netIncome: number;
  netMargin: number;
  depreciation: number;
  eps: number;
  dilutedEps: number;
  sharesOutstanding: number;
  // Balance Sheet
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
  cash: number;
  shortTermInvestments: number;
  netReceivables: number;
  inventory: number;
  currentAssets: number;
  netFixedAssets: number;
  totalDebt: number;
  shortTermDebt: number;
  longTermDebt: number;
  accountsPayable: number;
  currentLiabilities: number;
  netWorkingCapital: number;
  // Cash Flow
  operatingCashFlow: number;
  capitalExpenditures: number;
  freeCashFlow: number;
  investingCashFlow: number;
  financingCashFlow: number;
  dividendsPaid: number;
  changeInCash: number;
  // Granular Balance Sheet Breakdown
  commonStock?: number;
  retainedEarnings?: number;
  goodwill?: number;
  otherIntangibles?: number;
  otherCurrentAssets?: number;
  otherCurrentLiabilities?: number;
  otherNonCurrentAssets?: number;
  otherNonCurrentLiabilities?: number;
  deferredTaxLiabilities?: number;
  capitalLeaseObligations?: number;
  netDebt?: number;
  workingCapital?: number;
  investedCapital?: number;
  tangibleBookValue?: number;
  // Granular Income Statement & Cash Flow Breakdown
  interestIncome?: number;
  ebit?: number;
  issuanceOfDebt?: number;
  repaymentOfDebt?: number;
  issuanceOfCapitalStock?: number;
  repurchases?: number;
  stockBasedCompensation?: number;
  deferredIncomeTax?: number;
  changeInWorkingCapital?: number;
  changeInReceivables?: number;
  changeInInventory?: number;
  changeInPayables?: number;
  endCashPosition?: number;
  /** Names of fields synthesized from fixed-margin fallbacks (not reported). Empty/undefined = fully reported. */
  estimatesUsed?: string[];
}

export interface QuarterlyFinancials {
  period: string; // e.g. "Q1FY27"
  endDate: string;
  revenue: number;
  revenueGrowthYoY: number;
  grossProfit: number;
  ebitda: number;
  ebitdaMargin: number;
  operatingIncome: number;
  netIncome: number;
  netMargin: number;
  eps: number;
}

export interface Ratios {
  year: string;
  // Profitability
  grossMargin: number;
  ebitdaMargin: number;
  ebitMargin: number;
  netMargin: number;
  roe: number;
  roa: number;
  roce: number;
  // Efficiency
  assetTurnover: number;
  fixedAssetTurnover: number;
  workingCapitalTurnover: number;
  inventoryTurnover: number;
  receivablesTurnover: number;
  // Leverage / Solvency
  debtToEquity: number;
  equityMultiplier: number;
  interestCoverage: number;
  netDebtToEbitda: number;
  totalDebtToAssets: number;
  currentRatio: number;
  quickRatio: number;
  // Valuation
  pe: number;
  evToEbitda: number;
  pb: number;
  ps: number;
  bookValuePerShare?: number;
  marketCap?: number;
  enterpriseValue?: number;
  dividendYield: number;
  dividendPayout: number;
  eps: number;
}

export interface DuPontAnalysis {
  year: string;
  netProfitMargin: number;
  assetTurnover: number;
  equityMultiplier: number;
  roe: number;
  roa: number;
}

export interface DCFProjection {
  year: string;
  revenue: number;
  revenueGrowth: number;
  ebitMargin: number;
  ebit: number;
  taxPayment: number;
  nopat: number;
  depreciation: number;
  capex: number;
  changeInWorkingCapital: number;
  fcff: number;
  discountFactor: number;
  pvFcff: number;
}

export interface DCFAssumptions {
  riskFreeRate: number;
  equityRiskPremium: number;
  beta: number;
  costOfEquity: number;
  costOfDebtPreTax: number;
  marginalTaxRate: number;
  costOfDebtPostTax: number;
  debtWeight: number;
  equityWeight: number;
  wacc: number;
  terminalGrowthRate: number;
  revenueGrowthRates: number[];
  ebitMargins: number[];
  /** Human-readable source of RF/ERP/tax parameters, e.g. "Country CAPM table v2026-09 (US)". */
  parameterSource?: string;
  /** Per-input WACC provenance (P0 #15 — sourcing quarantined from formula). */
  inputProvenance?: { beta: string; weights: string; country: string; spread: string; clamp: string };
}

export interface DCFResult {
  status?: "valid" | "insufficient_data" | "invalid_inputs" | "calculation_error";
  diagnostics?: string[];
  assumptions: DCFAssumptions;
  projections: DCFProjection[];
  sumPvFcff: number;
  terminalYearFcff: number;
  terminalValue: number;
  pvTerminalValue: number;
  enterpriseValue: number;
  totalDebt?: number;
  cashAndEquiv?: number;
  netDebt?: number;
  /**
   * Captive-finance receivables netted against debt in netDebt (SOTP-lite).
   * Zero for financials and for firms without excess receivables. Independently
   * re-verified by XREF-04 (bounded by reported receivables and total debt).
   */
  financeReceivablesOffset?: number;
  lessDebt: number;
  plusCash: number;
  equityValue: number;
  sharesOutstanding: number;
  intrinsicValue: number;
  fairValuePerShare?: number | null;
  currentMarketPrice: number;
  upsideDownside: number;
  verdict: "BUY" | "HOLD" | "SELL" | "NR";
  reverseDCF?: {
    impliedRevenueGrowthRate: number;
    impliedTerminalOperatingMargin: number;
    impliedGrowthPctDisplay: string;
    impliedMarginPctDisplay: string;
    modelGrowthPctDisplay: string;
    growthGapPctDisplay: string;
    verdict: string;
    confidence?: "High" | "Medium" | "Low";
    iterationsUsed?: number;
    residualPct?: number;
    converged?: boolean;
    outsideSolvableRange?: boolean;
    solvableRangeNote?: string;
  };
  terminalValueCapped?: boolean;
  unadjustedTerminalValue?: number;
  confidence?: "high" | "medium" | "low";
  calibration?: ValuationCalibration;
  /** Per-assumption evidence trail: assumption name → empirical basis string. */
  assumptionBasis?: Record<string, string>;
  /**
   * Structured derivation trail (P0 #20): every derived bridge value stores
   * its formula id + version, named inputs with source IDs, and transform.
   */
  derivationTrail?: import("@/lib/financial-kernel").DerivationEntry[];
  /** Model reinvestment intensities (P0 #17 — scenario vectors reuse them). */
  avgCapexPct?: number;
  avgDeptPct?: number;
  avgNwcChangePct?: number;
}

export interface ValuationCalibration {
  rawUpside: number;
  sectorMeanUpside: number;
  sectorStdDevUpside: number;
  sectorZScore: number;
  sectorPercentile: number;
  decile: number;
  decileLabel: string;
  spearmanRankCorrelation: number;
  informationCoefficient: number;
  confidenceLevel: "high" | "medium" | "low";
  isConfidenceCapped: boolean;
}

export interface ShareholdingCategory {
  category: string;
  percentage: number;
}

export interface InstitutionalHolder {
  name: string;
  percentage: number;
  shares: number;
  change?: string;
  assetsPct?: number;
  reportDate?: string;
}

export interface InsiderHolderItem {
  name: string;
  relation: string;
  shares: number;
  date?: string;
  transaction?: string;
}

export interface ShareholdingData {
  insiderOwnership: number;
  institutionalOwnership: number;
  fiiOwnership?: number;
  diiOwnership?: number;
  publicFloat: number;
  topInstitutions: InstitutionalHolder[];
  topFunds?: InstitutionalHolder[];
  insiderHolders?: InsiderHolderItem[];
  netActivity?: {
    netInstSharesBuying?: string;
    netInstBuyingPercent?: string;
    period?: string;
    totalInsiderShares?: number;
    buyInfoCount?: number;
    sellInfoCount?: number;
  };
  provenanceNote?: string;
  categories: ShareholdingCategory[];
}

export interface PeerData {
  ticker: string;
  name: string;
  marketCap: number | null;
  cmp: number | null;
  pe: number | null;
  evToEbitda: number | null;
  evToSales?: number | null;
  dividendYield?: number | null;
  pb: number | null;
  roe: number | null;
  netMargin: number | null;
  grossMargin?: number | null;
  ebitdaMargin?: number | null;
  operatingMargin?: number | null;
  debtToEquity?: number | null;
  currentRatio?: number | null;
  revenueGrowth: number | null;
  currency: string | null;
  sector?: string | null;
  industry?: string | null;
  /** 0–100 peer-relevance score (sector/industry overlap + size proximity). Null = unscored. */
  relevanceScore?: number | null;
}

export interface AIAnalysis {
  // Text sections
  companyOverview: string;
  economicContext: string;
  globalIndustryAnalysis: string;
  domesticIndustryAnalysis: string;
  segmentAnalysis: string;
  quarterlyResultsCommentary: string;
  managementCommentary: string;
  // Financial commentary
  revenueCommentary: string;
  ebitdaCommentary: string;
  ebitCommentary: string;
  patCommentary: string;
  balanceSheetCommentary: string;
  cashFlowCommentary: string;
  dupontCommentary: string;
  ratioCommentary: string;
  dcfCommentary: string;
  // Structured sections
  swotStrengths: string[];
  swotWeaknesses: string[];
  swotOpportunities: string[];
  swotThreats: string[];
  keyRisks: { risk: string; description: string; impact: "High" | "Medium" | "Low"; mitigation?: string; horizon?: string; valuationSensitivity?: string }[];
  investmentConclusion: string;
  competitiveMoat?: string;
  summary?: string;

  // Private Equity Firm-Level Extended Sections
  investmentThesis?: string;
  moatPillars?: { pillar: string; durability: string; rationale: string }[];
  moatSources?: {
    switchingCosts: string;
    intangibleAssets: string;
    costAdvantage: string;
    moatTrend: string;
  };
  industryDynamicsCommentary?: string;
  fiveForces?: { force: string; level: string; commentary: string }[];
  businessStrategyCommentary?: string;
  catalysts?: { event: string; horizon: string; probability: string; impact: string }[];
  creditAnalysisCommentary?: {
    financialHealth: string;
    liquidityBuffers: string;
    debtMaturity: string;
    stressTesting: string;
  };
  enterpriseRiskCommentary?: { risk: string; severity: string; description: string; mitigation: string }[];
  governanceCommentary?: string;
  capitalAllocationCommentary?: string;
  capitalDeploymentHistory?: {
    narrative: string;
    dividends: string;
    repurchases: string;
    debtPaydown: string;
  };
  analystNotes?: { title: string; date: string; paragraphs: string[] }[];
  operatingProfileCommentary?: string;
  recentNewsAnalysis?: {
    headline: string;
    publisher?: string;
    date: string;
    strategicTakeaway: string;
  }[];

  // Council Quality & Audit Verification Agent (Agent 7)
  councilVerification?: CouncilVerificationAudit;

  // News Sentiment & Executive Briefing Desk (Agent 8)
  newsSummary?: NewsSummaryDeskAnalysis;
}

export interface MaterialDisclosureImpact {
  date: string;
  source: string;
  headline: string;
  category: string;
  valuationTransmission: string;
  riskRating: "LOW" | "MEDIUM" | "HIGH";
}

export interface NewsSummaryDeskAnalysis {
  executiveNewsSummary: string;
  mediaSentimentScore: number; // -1.0 to +1.0
  mediaSentimentLabel: "Bullish" | "Constructive" | "Neutral" | "Cautious" | "Bearish";
  keyNarrativeThemes: string[];
  topDisclosures: MaterialDisclosureImpact[];
  macroIndustryTransmission: string;
  earningsTransmissionVerdict: string;
}

export interface CouncilVerificationCheck {
  name: string;
  category: "VALUATION" | "RECOMMENDATION" | "SOLVENCY" | "FINANCIALS" | "ANTI_HALLUCINATION";
  status: "PASS" | "ADJUSTED" | "FLAG";
  observation: string;
}

export interface CouncilVerificationAudit {
  status: "VERIFIED" | "CORRECTED" | "FLAGGED";
  integrityScore: number;
  summary: string;
  checks: CouncilVerificationCheck[];
  correctionsApplied: string[];
  verificationTimestamp: string;
  auditorSignature: string;
}

export interface TickerNewsItem {
  title: string;
  publisher?: string;
  link?: string;
  publishedAt?: string;
  summary?: string;
  /** True only for model-generated placeholders. Must never render as verified news. */
  isSynthetic?: boolean;
}

export interface EventPriceTrajectoryPoint {
  dayOffset: number; // e.g. -5, -3, -1, 0, +1, +3, +5, +10
  label: string; // "T-5", "T-3", "T-1", "T0", "T+1", "T+3", "T+5", "T+10"
  date: string;
  price: number;
  normalizedPrice: number; // 100.0 baseline at T-1
  benchmarkNormalizedPrice: number; // sector benchmark normalized to 100 at T-1
}

export interface EventPriceMovement {
  id: string;
  headline: string;
  publisher?: string;
  eventDate: string;
  /** True when trajectory/volumes come from measured exchange sessions. */
  measured?: boolean;
  /** Benchmark (index) return over the event window, when measured. */
  benchmarkReturnPct?: number | null;
  /** True when |abnormal| exceeds ~2σ of trailing volatility. */
  abnormalSignificant?: boolean;
  category: "EARNINGS" | "CONTRACT_WIN" | "PRODUCT_LAUNCH" | "REGULATORY" | "STRATEGIC_MA" | "CAPEX_EXPANSION" | "GENERAL_CORPORATE";
  categoryLabel: string;
  summary: string;
  preEventPrice: number; // at T-1
  eventDayPrice: number; // at T0
  postEventPrice: number; // at T+5 / T+10
  immediateReturnPct: number; // (T0 / T-1) - 1
  multiDayReturnPct: number; // (T+5 / T-1) - 1
  abnormalReturnPct: number; // relative to sector benchmark
  volumeSpikeMultiplier: number; // e.g. 2.4x 30-day ADV
  verdict: "Bullish Inflection" | "Transitory Spike" | "Negative De-rating" | "Absorbed / Neutral";
  narrative: {
    whatHappened: string;
    priceImpact: string;
    modelImplication: string;
  };
  priceTrajectory: EventPriceTrajectoryPoint[];
}

export interface AssumptionsLedger {
  // Core Valuation & Target
  fairValue: number;
  targetPrice: number;
  currentPrice: number;
  upsideDownsidePct: number;
  rating: "BUY" | "HOLD" | "SELL" | "NR";
  ratingRationale: string;
  terminalValueCapped?: boolean;
  calibrationDecile?: number;
  sectorZScore?: number;
  sectorPercentile?: number;
  calibration?: ValuationCalibration;

  // Cost of Capital & Long-term Anchor
  riskFreeRate: number;
  equityRiskPremium: number;
  beta: number;
  costOfEquity: number;
  costOfDebtPreTax: number;
  marginalTaxRate: number;
  costOfDebtPostTax: number;
  debtWeight: number;
  equityWeight: number;
  wacc: number;
  terminalGrowthRate: number;

  // DCF Arithmetic Bridge
  sumPvFcff: number;
  pvTerminalValue: number;
  enterpriseValue: number;
  totalDebt?: number;
  cashAndEquiv?: number;
  netDebt: number;
  equityValue: number;
  sharesOutstanding: number;

  // Moat Derivation
  moatRating: "Wide" | "Narrow" | "None";
  moatTrend: "Positive" | "Stable" | "Negative";
  moatBridge: string;

  // Units & Currency
  currency: string;
  reportingUnit: string;
  unitMultiplier: number;

  // Company Financial Archetype & Risk Guard (BS Detector)
  archetype?: "DISTRESSED" | "EARLY_PLATFORM_GROWTH" | "CYCLICAL_CAPITAL_INTENSIVE" | "MATURE_COMPOUNDER";
  gicsSector?: string;
  calibratedCreditRating?: string;
  stewardshipRating?: string;
  capitalAllocationDescription?: string;
  dividendCAGRDisplay?: string;
  buybackYieldDisplay?: string;
  totalShareholderYieldDisplay?: string;
  scenarios?: {
    bull: { targetPrice: number; impliedReturn: number; impliedReturnPctDisplay: string; weight: number; revCagr?: number; revCagrDisplay?: string; om?: number; omDisplay?: string; inputVector?: import("@/lib/financial-kernel").ScenarioVector };
    base: { targetPrice: number; impliedReturn: number; impliedReturnPctDisplay: string; weight: number; revCagr?: number; revCagrDisplay?: string; om?: number; omDisplay?: string; inputVector?: import("@/lib/financial-kernel").ScenarioVector };
    bear: { targetPrice: number; impliedReturn: number; impliedReturnPctDisplay: string; weight: number; revCagr?: number; revCagrDisplay?: string; om?: number; omDisplay?: string; inputVector?: import("@/lib/financial-kernel").ScenarioVector };
    probabilityWeightedValue: number;
    /** Kernel re-solution notes per scenario vector (P0 #17 — operating cross-check). */
    vectorDiagnostics?: string[];
  };
  uncertaintyScore?: number;
  uncertaintyRating?: "Low" | "Medium" | "High" | "Very High" | "N/A";
  multiYearCAGR?: {
    metric: string;
    cagrPct: number;
    cagrDisplay: string;
    commentary: string;
  };
  scenarioMargins?: {
    bearMargin: number;
    baseMargin: number;
    bullMargin: number;
    bearMarginDisplay: string;
    baseMarginDisplay: string;
    bullMarginDisplay: string;
  };
  roic?: number;
  roicSpread?: number;
  roeSpread?: number;
  investedCapital?: number;
  nopat?: number;
  eva?: number;
  reverseDCF?: {
    impliedRevenueGrowthRate: number;
    impliedTerminalOperatingMargin: number;
    impliedGrowthPctDisplay: string;
    impliedMarginPctDisplay: string;
    modelGrowthPctDisplay: string;
    growthGapPctDisplay: string;
    verdict: string;
    confidence: "High" | "Medium" | "Low";
    iterationsUsed?: number;
    residualPct?: number;
    converged?: boolean;
    outsideSolvableRange?: boolean;
    solvableRangeNote?: string;
  };
  dcfBaseTarget?: number;
  publishedTargetPrice?: number;
  probabilityWeightedValue?: number;
  valuationMethodology?: string;
  /** Uncapped terminal value (when terminalValueCapped). Null when not applicable. */
  terminalValueUncapped?: number | null;
  /** True when inputs were insufficient — rating forced to NR. */
  insufficientData?: boolean;
  /** Mandatory label for the model-implied credit grade, e.g. "Model-implied — not a CRISIL/ICRA/S&P rating". */
  creditRatingNote?: string;
  /** Machine-readable data-quality flags, e.g. "ESTIMATED_FINANCIALS:4", "SYNTHETIC_FALLBACK_USED". */
  dataQualityFlags?: string[];
  moat?: {
    rating: "Wide" | "Narrow" | "None";
    trend: "Positive" | "Stable" | "Negative";
    confidence: number;
    evidence: string[];
    economicSpread: number;
    bridge: string;
  };
}

export interface QACheckItem {
  id: string;
  category: "CROSS_REFERENCE" | "BALANCE_SHEET" | "RATING_CONSISTENCY" | "DEGENERATE_RATIO" | "KEYWORD_BLOCKLIST" | "BS_DETECTOR" | "SCENARIO_MATH" | "MOAT_INTEGRITY";
  name: string;
  status: "PASS" | "WARN" | "FAIL";
  details: string;
  expected?: string | number;
  actual?: string | number;
}

export interface ReportQAResult {
  passed: boolean;
  score: number;
  gateStatus: "READY" | "READY_WITH_WARNINGS" | "BLOCKED";
  tierSummary: {
    consistency: "PASS" | "FAIL";
    plausibility: "PASS" | "WARN" | "FAIL";
    appropriateness: "PASS" | "FAIL";
  };
  timestamp: string;
  checks: QACheckItem[];
  checksums: {
    fairValueMatchCount: number;
    fairValueLedger: number;
    waccLedger: number;
    tgrLedger: number;
    balanceSheetVariance: number;
    ratingAlignedWithUpside: boolean;
  };
}

export interface ReportData {
  generatedAt: string;
  profile: CompanyProfile;
  stockData: StockData;
  annualFinancials: AnnualFinancials[]; // 5 years, oldest to newest
  quarterlyFinancials: QuarterlyFinancials[]; // last 8 quarters
  ratiosByYear: Ratios[];
  dupontByYear: DuPontAnalysis[];
  dcf: DCFResult;
  shareholding: ShareholdingData;
  peers: PeerData[];
  aiAnalysis: AIAnalysis;
  news?: TickerNewsItem[];
  eventPriceMovements?: EventPriceMovement[];
  recommendation: "BUY" | "HOLD" | "SELL" | "NR";
  targetPrice: number;
  cmp: number;
  analystName: string;
  assumptionsLedger?: AssumptionsLedger;
  qaReport?: ReportQAResult;
  masterReportFacts?: any;
  finalQAResult?: any;
  calibration?: ValuationCalibration;
  /** Terms the sector sanitizer rewrote (disclosed, QA-gated — never silent). */
  sanitizerReport?: { rewrittenTerms: string[] };
}

export interface SearchResult {
  symbol: string;
  shortname: string;
  longname: string;
  exchange: string;
  exchDisp: string;
  typeDisp: string;
  sector?: string;
  industry?: string;
}

export interface AgentCheckpoint {
  id: string;
  name: string;
  role: string;
  status: "pending" | "running" | "verifying" | "complete" | "error";
  completedAt?: number;
  durationMs?: number;
  verifiedByCouncil?: boolean;
  councilAuditNote?: string;
}

export type GenerationStep =
  | "idle"
  | "searching"
  | "fetching_data"
  | "calculating"
  | "generating_ai"
  | "building_pdf"
  | "done"
  | "error";

export interface GenerationState {
  step: GenerationStep;
  progress: number;
  message: string;
  error?: string;
  data?: ReportData;
  agentCheckpoints?: AgentCheckpoint[];
}
