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

/** Discriminant for sector-native vs corporate-native statements. */
export type StatementType = "corporate" | "bank" | "nbfc" | "insurance" | "reit" | "asset-light";

/**
 * Statement architecture family (see src/lib/sectors/architectures.ts).
 * A = standard corporate, B = depository (bank/nbfc), C = insurance,
 * D = REIT, E = asset-light fee (asset management / ratings agency).
 */
export type StatementArchitecture = "A" | "B" | "C" | "D" | "E";

/** Bank-native statement — every field corresponds to a real bank filing line. No corporate-shaped fictions. */
export interface BankAnnualFinancials {
  year: string; // e.g. "FY2025"
  fiscalYearEnd: string;
  statementType: "bank" | "nbfc";
  isFinancialInstitution: true;
  // Income Statement — bank-native
  netInterestIncome: number; // NII = interestIncome - interestExpense (core spread)
  nonInterestIncome: number; // fees, commission, treasury, other income
  totalRevenue: number; // NII + nonInterestIncome (never grossProfit)
  interestIncome: number;
  interestExpense: number;
  provisionForCreditLosses: number;
  nonInterestExpenses: number; // operating expenses (staff, opex)
  operatingIncome: number; // pre-provision operating profit (PPOP)
  pretaxIncome: number;
  incomeTaxExpense: number;
  netIncome: number;
  netMargin: number;
  // Balance Sheet — bank-native
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
  cash: number;
  shortTermInvestments: number;
  loans: number; // net advances / loan book
  deposits: number; // customer deposits
  totalDebt: number; // borrowings (non-deposit)
  shortTermDebt: number;
  longTermDebt: number;
  currentAssets: number;
  currentLiabilities: number;
  netWorkingCapital: number; // not used for banks but kept for compat (=CA-CL)
  // Asset quality & capital — when disclosed
  grossNPA?: number;
  netNPA?: number;
  grossNPAPct?: number;
  netNPAPct?: number;
  provisionCoverageRatio?: number;
  capitalAdequacyRatio?: number;
  tier1Ratio?: number;
  netInterestMargin?: number;
  costToIncome?: number;
  casaRatio?: number;
  // Cash Flow (bank cash flow is regulatory, not FCF)
  operatingCashFlow: number;
  capitalExpenditures: number;
  freeCashFlow: number;
  investingCashFlow: number;
  financingCashFlow: number;
  dividendsPaid: number;
  changeInCash: number;
  // Common breakdown
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
  estimatesUsed?: string[];
  // Corporate-shaped fictions — zeroed for banks (never synthesized, always N/A = 0, validity NM)
  revenue: number; // alias to totalRevenue for pipeline compat (always = totalRevenue)
  costOfRevenue: number;
  grossProfit: number;
  grossMargin: number;
  inventory: number;
  netReceivables: number;
  netFixedAssets: number;
  accountsPayable: number;
  ebitda: number;
  ebitdaMargin: number;
  ebitMargin: number;
  researchDevelopment: number;
  sellingGeneralAdministrative: number;
  totalOperatingExpenses: number;
  depreciation: number;
  otherIncome: number;
  eps: number;
  dilutedEps: number;
  sharesOutstanding: number;
}

export interface CorporateAnnualFinancials {
  year: string; // e.g. "FY2025"
  fiscalYearEnd: string; // e.g. "2025-03-31"
  statementType?: "corporate";
  isFinancialInstitution?: false;
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
  // Bank-only — undefined for corporates (never accessed without isBankStatement guard)
  netInterestIncome?: number | undefined;
  nonInterestIncome?: number | undefined;
  totalRevenue?: number | undefined;
  provisionForCreditLosses?: number | undefined;
  nonInterestExpenses?: number | undefined;
  loans?: number | undefined;
  deposits?: number | undefined;
  grossNPA?: number | undefined;
  netNPA?: number | undefined;
  capitalAdequacyRatio?: number | undefined;
}

/**
 * Insurance-native statement — every field corresponds to a real insurer filing line.
 * Genuinely separate from BankAnnualFinancials: insurers have no deposits, loans,
 * CASA, NIM, or credit-cost provisioning as core assets — their economics are
 * underwriting (premium → claims → expenses) plus float investment income.
 * Corporate fictions (grossProfit, inventory, ebitda, receivables) and bank fields
 * (deposits, loans, netInterestIncome) are ABSENT by design — accessing them is a
 * compile error, not a silent zero.
 */
export interface InsuranceAnnualFinancials {
  year: string; // e.g. "FY2025"
  fiscalYearEnd: string;
  statementType: "insurance";
  isFinancialInstitution: true;
  // Underwriting — insurer-native
  grossWrittenPremium: number; // GWP
  netEarnedPremium: number; // NEP (net of reinsurance ceded)
  claimsIncurred: number; // net claims paid + reserve movement (losses)
  underwritingExpenses: number; // acquisition (commission) + attributable operating expenses
  underwritingResult: number; // NEP − claims − underwriting expenses
  lossRatio: number; // claims / NEP
  expenseRatio: number; // underwriting expenses / NEP (or GWP — disclosed per-year via estimatesUsed when proxied)
  combinedRatio: number; // lossRatio + expenseRatio (<1 = underwriting profit)
  // Investments on float — insurer-native
  investmentIncome: number; // yield on float (interest, dividends, realized gains attributable)
  float: number; // investable policyholder funds (reserves + payables − receivables)
  policyholderLiabilities: number; // outstanding claims + IBNR + unearned premium reserves
  // Bottom line & capital
  pretaxIncome: number;
  incomeTaxExpense: number;
  netIncome: number;
  netMargin: number; // netIncome / (netEarnedPremium + investmentIncome)
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number; // (embedded value proxy when EV undisclosed — never labeled EV)
  embeddedValue?: number; // disclosed EV for life insurers, when available
  solvencyRatio?: number; // disclosed solvency margin, when available
  cash: number;
  totalDebt: number; // non-policyholder borrowings (sub-debt etc.)
  currentAssets: number;
  currentLiabilities: number;
  netWorkingCapital: number; // compat (=CA−CL); not an insurer KPI
  // Cash flow (regulatory presentation, not corporate FCF)
  operatingCashFlow: number;
  capitalExpenditures: number;
  freeCashFlow: number;
  investingCashFlow: number;
  financingCashFlow: number;
  dividendsPaid: number;
  changeInCash: number;
  eps: number;
  dilutedEps: number;
  sharesOutstanding: number;
  /** Names of fields synthesized from fixed-ratio fallbacks (not reported). Empty/undefined = fully reported. */
  estimatesUsed?: string[];
  /** Pipeline-compat alias (= netEarnedPremium + investmentIncome). Corporate/bank code reads revenue; insurer code reads the native fields. */
  revenue: number;
}

/**
 * REIT-native statement — every field corresponds to a real REIT filing line.
 * REIT economics are rental annuity + occupancy + cap-rate NAV, not unit sales:
 * FFO/AFFO replace EBITDA/FCF, NOI replaces gross profit, occupancy/WALE/cap-rate
 * replace inventory/DSO/working-capital. Corporate fictions (grossProfit,
 * costOfRevenue, inventory, ebitda, receivables) are ABSENT by design.
 * Applies to equity REITs only — real-estate developers selling units stay on
 * CorporateAnnualFinancials (Architecture A); see isReitCompany classification.
 */
export interface ReitAnnualFinancials {
  year: string; // e.g. "FY2025"
  fiscalYearEnd: string;
  statementType: "reit";
  isFinancialInstitution?: false;
  // Property operations — REIT-native
  rentalIncome: number; // base rent + escalations + recoveries
  otherPropertyIncome: number; // parking, services, other operating income
  propertyOperatingExpenses: number; // maintenance, taxes, utilities, management attributable to properties
  netOperatingIncome: number; // NOI = rental + other − property opex
  noiMargin: number; // NOI / (rental + other)
  generalAdministrative: number; // corporate G&A (non-property)
  interestExpense: number;
  depreciationAmortization: number; // real-estate depreciation (added back for FFO, never an economic cost signal)
  gainsOnDispositions: number; // property sale gains (excluded from FFO)
  pretaxIncome: number;
  incomeTaxExpense: number;
  netIncome: number;
  netMargin: number; // netIncome / (rentalIncome + otherPropertyIncome)
  // Funds from operations — REIT-native (NAREIT-style: NI + RE depreciation − gains)
  fundsFromOperations: number; // FFO
  maintenanceCapex: number; // recurring capex / tenant improvements reserve
  leasingCommissions: number; // straight-line rent / leasing commission adjustments
  adjustedFundsFromOperations: number; // AFFO = FFO − maint. capex − leasing adjustments
  ffoPerShare: number;
  affoPerShare: number;
  // Portfolio & valuation — REIT-native
  occupancyPct?: number; // leased-area occupancy (0–1)
  sameStoreNoiGrowth?: number; // like-for-like NOI growth
  waleYears?: number; // weighted average lease expiry
  leasableAreaMsf?: number; // leasable area, million sq ft
  netAssetValue?: number; // disclosed NAV, when available
  navPerShare?: number;
  capRate?: number; // applied/indicative cap rate, when disclosed
  // Balance sheet — REIT-native leverage is debt/EBITDA-on-NOI-basis, not corporate WC ratios
  totalAssets: number;
  investmentPropertyValue: number; // investment properties at carrying/fair value
  totalLiabilities: number;
  totalEquity: number;
  totalDebt: number;
  cash: number;
  currentAssets: number;
  currentLiabilities: number;
  netWorkingCapital: number; // compat (=CA−CL); not a REIT KPI
  // Cash flow
  operatingCashFlow: number;
  capitalExpenditures: number;
  freeCashFlow: number;
  investingCashFlow: number;
  financingCashFlow: number;
  dividendsPaid: number; // distributions to unitholders/shareholders
  changeInCash: number;
  eps: number;
  dilutedEps: number;
  sharesOutstanding: number;
  /** Names of fields synthesized from fixed-ratio fallbacks (not reported). Empty/undefined = fully reported. */
  estimatesUsed?: string[];
  /** Pipeline-compat alias (= rentalIncome + otherPropertyIncome). REIT code reads the native fields. */
  revenue: number;
}

/**
 * Asset-light fee-native statement — covers asset/wealth managers AND credit
 * rating agencies (economically similar: fee-based, asset-light, revenue driven
 * by AUM or subscription/data fees rather than a balance-sheet spread).
 * Revenue as % of AUM and operating margin ARE meaningful here (unlike banks);
 * inventory, loans, deposits, combined ratio, NIM are ABSENT by design.
 */
export interface AssetLightFeeAnnualFinancials {
  year: string; // e.g. "FY2025"
  fiscalYearEnd: string;
  statementType: "asset-light";
  isFinancialInstitution?: false;
  // Fee engine — asset-light-native
  aumBeginning: number; // beginning-period AUM (ratings agencies: rated debt volume proxy, 0 when undisclosed)
  aumEnding: number; // ending-period AUM
  netFlows: number; // net inflows (+)/outflows (−); 0 when undisclosed
  marketAppreciation: number; // AUM change from market moves (derived, 0 when undisclosed)
  managementFeeRateBps?: number; // base fee realization (bps of avg AUM)
  managementFees: number; // base/advisory fees (ratings: rating-fee revenue)
  performanceFees: number; // performance/incentive fees (ratings: 0)
  technologyServicesRevenue: number; // platform/analytics/subscription revenue (e.g. Aladdin; ratings: research & analytics)
  totalFeeRevenue: number; // management + performance + technology services
  revenueAsPctOfAum?: number; // totalFeeRevenue / avg AUM (the core unit-economics KPI)
  // Profitability — operating margin IS economically meaningful here
  operatingExpenses: number;
  operatingIncome: number;
  operatingMargin: number;
  pretaxIncome: number;
  incomeTaxExpense: number;
  netIncome: number;
  netMargin: number;
  // Balance sheet — minimal capex / working-capital relevance, but real fields
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
  cash: number;
  totalDebt: number;
  currentAssets: number;
  currentLiabilities: number;
  netWorkingCapital: number; // compat (=CA−CL)
  // Cash flow — FCF conversion IS a KPI here (unlike banks)
  operatingCashFlow: number;
  capitalExpenditures: number;
  freeCashFlow: number;
  investingCashFlow: number;
  financingCashFlow: number;
  dividendsPaid: number;
  changeInCash: number;
  eps: number;
  dilutedEps: number;
  sharesOutstanding: number;
  /** Names of fields synthesized from fixed-ratio fallbacks (not reported). Empty/undefined = fully reported. */
  estimatesUsed?: string[];
  /** Pipeline-compat alias (= totalFeeRevenue). Fee-native code reads the native fields. */
  revenue: number;
}

/** Union — pipeline must branch on statementType / architecture guards. */
export type AnnualFinancials =
  | CorporateAnnualFinancials
  | BankAnnualFinancials
  | InsuranceAnnualFinancials
  | ReitAnnualFinancials
  | AssetLightFeeAnnualFinancials;

/** Type guard — true means bank/NBFC-native shape (loan-book/spread economics). Insurance has its own shape. */
export function isBankStatement(f: AnnualFinancials): f is BankAnnualFinancials {
  return (f as BankAnnualFinancials).statementType === "bank" || (f as BankAnnualFinancials).statementType === "nbfc";
}

/** Type guard — true means insurer-native shape (underwriting + float economics). Never touch deposits/loans/NIM. */
export function isInsuranceStatement(f: AnnualFinancials): f is InsuranceAnnualFinancials {
  return (f as InsuranceAnnualFinancials).statementType === "insurance";
}

/** Type guard — true means REIT-native shape (NOI/FFO/AFFO/NAV economics). Never touch grossProfit/inventory/EBITDA. */
export function isReitStatement(f: AnnualFinancials): f is ReitAnnualFinancials {
  return (f as ReitAnnualFinancials).statementType === "reit";
}

/** Type guard — true means asset-light fee shape (AUM/fee-rate economics). Never touch loans/deposits/combined-ratio. */
export function isAssetLightStatement(f: AnnualFinancials): f is AssetLightFeeAnnualFinancials {
  return (f as AssetLightFeeAnnualFinancials).statementType === "asset-light";
}

/** Type guard — true means standard corporate shape (Architecture A). */
export function isCorporateStatement(f: AnnualFinancials): f is CorporateAnnualFinancials {
  const st = (f as unknown as Record<string, unknown>).statementType;
  return st === undefined || st === "corporate";
}

/**
 * Compat numeric reader for legacy Architecture-A display paths (narrative
 * prompts, peer tables, QA bridges) that predate multi-archetype statements.
 * Returns the field when the row carries it (corporate reported, bank zeroed
 * N/A), else `fallback` (default 0) — identical runtime to the old single-shape
 * pipeline. New sector-native surfaces (PDF statement pages, ratio engines, QA
 * identities) MUST branch on the architecture guards instead of using this.
 */
export function stmtNum(f: AnnualFinancials | undefined | null, key: string, fallback = 0): number {
  if (!f) return fallback;
  const v = (f as unknown as Record<string, unknown>)[key];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/**
 * Architecture family for a statement row. Single routing authority for
 * ratio engines, drivers, PDF sections, and QA identities.
 */
export function getStatementArchitecture(f: AnnualFinancials): StatementArchitecture {
  if (isInsuranceStatement(f)) return "C";
  if (isReitStatement(f)) return "D";
  if (isAssetLightStatement(f)) return "E";
  if (isBankStatement(f)) return "B";
  return "A";
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
  /** Derived forecast EBITDA (EBIT + depreciation) — exact by construction. */
  ebitda: number;
  capex: number;
  changeInWorkingCapital: number;
  fcff: number;
  discountFactor: number;
  pvFcff: number;
  /** Closing net PPE stock (present only under PP&E roll-forward depreciation). */
  ppe?: number;
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
  /** Through-cycle margin anchor + demonstrated ceiling (margin provenance). */
  midCycleMargin?: number;
  marginCeiling?: number;
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
   * Structured assumption provenance (P0 #17): material assumption key →
   * numeric value + source. Machine-readable twin of assumptionBasis prose.
   */
  assumptionInputs?: Record<string, { value: number | string; source: string }>;
  /** Financial-model version that produced this result (P0 #95 reproducibility). */
  modelVersion?: string;
  /**
   * Structured derivation trail (P0 #20): every derived bridge value stores
   * its formula id + version, named inputs with source IDs, and transform.
   */
  derivationTrail?: import("@/lib/financial-kernel").DerivationEntry[];
  /** Model reinvestment intensities (P0 #17 — scenario vectors reuse them). */
  avgCapexPct?: number;
  avgDeptPct?: number;
  avgNwcChangePct?: number;
  /**
   * Single canonical forecast (P0 #4): the ONLY authoritative forward
   * numbers. Tables, scenarios and QA consume its rows directly — parallel
   * DCF assumptions that differ from it are a publication blocker.
   */
  canonicalForecast?: import("@/lib/canonical-forecast").CanonicalForecast;
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
  /** Point-in-time equity beta for the peer-median beta engine (P0 #57). Null when undisclosed. */
  beta?: number | null;
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
  /**
   * Evidence registry (TRACK 3): every priced/evidenced number carries an
   * EV:<TIER>:<SOURCE>:<FIELD> ID. Attached by /api/company; absent on
   * legacy fixtures (claim-validator treats absence as unevidenced).
   */
  evidenceRegistry?: import("@/lib/evidence-registry").EvidenceRegistry;
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
