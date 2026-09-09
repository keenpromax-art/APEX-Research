/**
 * APEX RESEARCH - Master Facts Ledger
 * 
 * Strict Financial Invariant:
 * Single Source of Truth for all financial figures, valuations, recommendations,
 * moats, scenarios, and data quality across the entire platform.
 * 
 * Data Flow:
 *   RAW SOURCE DATA (Yahoo / Statements)
 *         ↓
 *   NORMALIZATION & FACTORY
 *         ↓
 *   MASTER FACTS LEDGER (Immutable)
 *         ↓
 *   ├── Calculations & Financial Models
 *   ├── AI Analysts Context (Number-Blind / Placeholder-bound)
 *   ├── PDF Document Renderers
 *   ├── Web UI Visualizers
 *   └── QA Validation & Publication Gate
 */

import { FinancialMetric, Money, ShareCount, createMetric, createMoney, createShareCount } from "./units";
import { RecommendationRating, RecommendationResult, calculateRecommendation } from "./recommendation";
import { MoatFacts, evaluateCanonicalMoat } from "./moat";
import { UncertaintyFacts, calculateUncertainty } from "./uncertainty";
import { ScenarioSet, buildScenarioSet } from "./scenarios";
import { classifySector } from "./sectors/profiles";
import type { StockData, CompanyProfile, AnnualFinancials, Ratios, DuPontAnalysis, DCFResult, AssumptionsLedger } from "@/types/report";
import { stmtNum } from "@/types/report";

export type ProvenanceType = "REPORTED" | "DERIVED" | "ASSUMPTION" | "INFERENCE" | "HYPOTHESIS";

export interface CompanyFacts {
  ticker: string;
  name: string;
  sector: string;
  industry: string;
  currency: string;
  exchange: string;
  country: string;
  description: string;
  reportingScale: "crore" | "million" | "billion";
}

export interface MarketFacts {
  currentPrice: FinancialMetric<number>;
  sharesOutstanding: ShareCount;
  marketCap: FinancialMetric<number>;
  enterpriseValue: FinancialMetric<number>;
  beta: FinancialMetric<number>;
  week52High: FinancialMetric<number>;
  week52Low: FinancialMetric<number>;
  asOfDate: string;
}

export interface FinancialYearFact {
  year: string;
  revenue: FinancialMetric<number>;
  grossProfit: FinancialMetric<number>;
  ebitda: FinancialMetric<number>;
  operatingIncome: FinancialMetric<number>;
  netIncome: FinancialMetric<number>;
  totalDebt: FinancialMetric<number>;
  cashAndEquivalents: FinancialMetric<number>;
  netDebt: FinancialMetric<number>;
  totalAssets: FinancialMetric<number>;
  totalEquity: FinancialMetric<number>;
  operatingCashFlow: FinancialMetric<number>;
  capitalExpenditures: FinancialMetric<number>;
  freeCashFlow: FinancialMetric<number>;
  eps: FinancialMetric<number>;
}

export interface FinancialFacts {
  years: string[];
  history: FinancialYearFact[];
  latestYear: FinancialYearFact;
}

export interface RatioFacts {
  pe: FinancialMetric<number>;
  pb: FinancialMetric<number>;
  evToEbitda: FinancialMetric<number>;
  roe: FinancialMetric<number>;
  roce: FinancialMetric<number>;
  roa: FinancialMetric<number>;
  grossMargin: FinancialMetric<number>;
  ebitdaMargin: FinancialMetric<number>;
  netMargin: FinancialMetric<number>;
  debtToEquity: FinancialMetric<number>;
  netDebtToEbitda: FinancialMetric<number>;
  currentRatio: FinancialMetric<number>;
  interestCoverage: FinancialMetric<number>;
}

export interface ValuationBridge {
  sumPvFcff: number | null;
  pvTerminalValue: number | null;
  enterpriseValue: number | null;
  netDebt: number | null;
  equityValue: number | null;
  sharesOutstanding: number | null;
  fairValuePerShare: number | null;
}

export interface ValuationFacts {
  model: "FCFF_DCF" | "PB_RESIDUAL_INCOME" | "DDM" | "MULTIPLES";
  status: "valid" | "insufficient_data" | "invalid_inputs" | "calculation_error";
  fairValue: FinancialMetric<number>;
  upside: FinancialMetric<number>;
  wacc: number;
  terminalGrowth: number;
  bridge: ValuationBridge;
  assumptions: {
    revenueGrowthRates: number[];
    ebitMargins: number[];
    taxRate: number;
    wacc: number;
    terminalGrowthRate: number;
  };
  diagnostics: string[];
}

export interface PeerFacts {
  totalPeers: number;
  validPeers: number;
  peerCoverage: number; // 0.0 to 1.0
  coverageStatus: "adequate" | "warning" | "suppressed"; // >= 70% adequate, 50-69% warning, <50% suppressed
  peerList: Array<{
    ticker: string;
    name: string;
    marketCap: number | null;
    pe: number | null;
    evToEbitda: number | null;
    roe: number | null;
  }>;
}

export interface RiskFacts {
  uncertainty: UncertaintyFacts;
  solvencyRisk: "Low" | "Moderate" | "Elevated" | "High";
  governanceScore?: number;
  primaryRisks: string[];
}

export interface DataQuality {
  score: number; // 0 to 100
  historicalCoverage: "High" | "Medium" | "Low";
  peerCoverage: "High" | "Medium" | "Low";
  valuationConfidence: "High" | "Medium" | "Low";
  sourceCompleteness: "High" | "Medium" | "Low";
  issues: string[];
}

export interface MasterReportFacts {
  reportId: string;
  generatedAt: string;
  reportVersion: string;
  company: CompanyFacts;
  market: MarketFacts;
  financials: FinancialFacts;
  ratios: RatioFacts;
  dupont: DuPontAnalysis;
  valuation: ValuationFacts;
  scenarios: ScenarioSet;
  peers: PeerFacts;
  moat: MoatFacts;
  risks: RiskFacts;
  recommendation: RecommendationResult;
  provenance: Record<string, ProvenanceType>;
  quality: DataQuality;
}

/**
 * Factory function to construct an immutable MasterReportFacts instance
 * from normalized engine outputs and market data.
 */
export function buildMasterReportFacts(params: {
  stockData: StockData;
  profile: CompanyProfile;
  annualFinancials: AnnualFinancials[];
  ratiosByYear: Ratios[];
  dupontByYear: DuPontAnalysis[];
  dcf: DCFResult;
  peers?: any[];
  ledger?: AssumptionsLedger;
}): MasterReportFacts {
  const { stockData, profile, annualFinancials, ratiosByYear, dupontByYear, dcf, peers = [], ledger } = params;

  const currency = profile.currency || "USD";
  const reportingScale = currency === "INR" ? "crore" : "million";
  const cmp = ledger?.currentPrice ?? (stockData.currentPrice > 0 ? stockData.currentPrice : null);
  // Zero-tolerant chain: a fail-closed ledger 0 must not mask a valid count
  // from another source, and the model carry-through is a last resort.
  // A persistent 0 still yields missing ShareCount → DATA_INVALID_SHARES blocks.
  const latestShares = annualFinancials.length > 0 ? annualFinancials[annualFinancials.length - 1].sharesOutstanding : 0;
  const shares = [ledger?.sharesOutstanding, stockData.sharesOutstanding, latestShares, dcf?.sharesOutstanding]
    .map((v) => Number(v) || 0)
    .find((v) => v > 0) ?? 0;

  // 1. Company Facts
  const company: CompanyFacts = {
    ticker: profile.ticker,
    name: profile.name,
    sector: profile.sector,
    industry: profile.industry,
    currency,
    exchange: profile.exchange,
    country: profile.country,
    description: profile.description,
    reportingScale
  };

  // 2. Market Facts
  const marketCapVal = cmp && shares ? cmp * shares : (stockData.marketCap > 0 ? stockData.marketCap : null);
  const market: MarketFacts = {
    currentPrice: createMetric(cmp, currency, "valid", "Yahoo Market Data", "reported"),
    sharesOutstanding: createShareCount(shares, "Corporate Filings / Yahoo"),
    marketCap: createMetric(marketCapVal, currency, marketCapVal ? "valid" : "missing", "Calculated: CMP * Shares", "derived"),
    enterpriseValue: createMetric(ledger?.enterpriseValue ?? (dcf.enterpriseValue > 0 ? dcf.enterpriseValue : null), currency, (ledger?.enterpriseValue || dcf.enterpriseValue > 0) ? "valid" : "missing", "DCF Model", "derived"),
    beta: createMetric(stockData.beta > 0 ? stockData.beta : null, "x", stockData.beta > 0 ? "valid" : "missing", "Market Regression", "reported"),
    week52High: createMetric(stockData.week52High > 0 ? stockData.week52High : null, currency, "valid", "52-Week Range", "reported"),
    week52Low: createMetric(stockData.week52Low > 0 ? stockData.week52Low : null, currency, "valid", "52-Week Range", "reported"),
    asOfDate: new Date().toISOString()
  };

  // 3. Financial Facts
  const years = annualFinancials.map(f => f.year);
  const history: FinancialYearFact[] = annualFinancials.map(f => {
    const netDebt = f.totalDebt - f.cash - stmtNum(f, "shortTermInvestments");
    const fcf = f.freeCashFlow || (f.operatingCashFlow - f.capitalExpenditures);
    return {
      year: f.year,
      revenue: createMetric(f.revenue, currency, "valid", "Audited Income Statement", "reported"),
      grossProfit: createMetric(stmtNum(f, "grossProfit"), currency, "valid", "Audited Income Statement", "reported"),
      ebitda: createMetric(stmtNum(f, "ebitda"), currency, "valid", "Audited Income Statement", "reported"),
      operatingIncome: createMetric(stmtNum(f, "operatingIncome"), currency, "valid", "Audited Income Statement", "reported"),
      netIncome: createMetric(f.netIncome, currency, "valid", "Audited Income Statement", "reported"),
      totalDebt: createMetric(f.totalDebt, currency, "valid", "Balance Sheet", "reported"),
      cashAndEquivalents: createMetric(f.cash, currency, "valid", "Balance Sheet", "reported"),
      netDebt: createMetric(netDebt, currency, "valid", "Total Debt - Cash", "derived"),
      totalAssets: createMetric(f.totalAssets, currency, "valid", "Balance Sheet", "reported"),
      totalEquity: createMetric(f.totalEquity, currency, "valid", "Balance Sheet", "reported"),
      operatingCashFlow: createMetric(f.operatingCashFlow, currency, "valid", "Cash Flow Statement", "reported"),
      capitalExpenditures: createMetric(f.capitalExpenditures, currency, "valid", "Cash Flow Statement", "reported"),
      freeCashFlow: createMetric(fcf, currency, "valid", "CFO - Capex", "derived"),
      eps: createMetric(f.eps, currency, "valid", "Reported EPS", "reported")
    };
  });
  const latestYear = history[history.length - 1] || createEmptyYearFact(currency);

  // 4. Ratio Facts
  const latestRatio = ratiosByYear[ratiosByYear.length - 1];
  const ratios: RatioFacts = {
    pe: createMetric(latestRatio?.pe > 0 ? latestRatio.pe : null, "x", latestRatio?.pe > 0 ? "valid" : "missing", "P/E Ratio", "derived"),
    pb: createMetric(latestRatio?.pb > 0 ? latestRatio.pb : null, "x", latestRatio?.pb > 0 ? "valid" : "missing", "P/B Ratio", "derived"),
    evToEbitda: createMetric(latestRatio?.evToEbitda > 0 ? latestRatio.evToEbitda : null, "x", latestRatio?.evToEbitda > 0 ? "valid" : "missing", "EV/EBITDA", "derived"),
    roe: createMetric(latestRatio?.roe, "%", "valid", "Return on Equity", "derived"),
    roce: createMetric(latestRatio?.roce, "%", "valid", "Return on Capital Employed", "derived"),
    roa: createMetric(latestRatio?.roa, "%", "valid", "Return on Assets", "derived"),
    grossMargin: createMetric(latestRatio?.grossMargin, "%", "valid", "Gross Margin", "derived"),
    ebitdaMargin: createMetric(latestRatio?.ebitdaMargin, "%", "valid", "EBITDA Margin", "derived"),
    netMargin: createMetric(latestRatio?.netMargin, "%", "valid", "Net Margin", "derived"),
    debtToEquity: createMetric(latestRatio?.debtToEquity, "x", "valid", "Debt to Equity", "derived"),
    netDebtToEbitda: createMetric(latestRatio?.netDebtToEbitda, "x", "valid", "Net Debt to EBITDA", "derived"),
    currentRatio: createMetric(latestRatio?.currentRatio, "x", "valid", "Current Ratio", "derived"),
    interestCoverage: createMetric(latestRatio?.interestCoverage, "x", "valid", "Interest Coverage", "derived")
  };

  // 5. DuPont Facts
  const latestDuPont = dupontByYear[dupontByYear.length - 1] || {
    year: latestYear.year,
    netProfitMargin: 0,
    assetTurnover: 0,
    equityMultiplier: 0,
    roe: 0,
    roa: 0
  };

  // 6. Valuation Facts & Status
  const isDcfValid = (ledger?.targetPrice !== undefined && ledger.targetPrice > 0) || (dcf && dcf.intrinsicValue > 0 && Number.isFinite(dcf.intrinsicValue));
  const valuationStatus = isDcfValid ? "valid" : "insufficient_data";
  const fairValueVal = ledger?.targetPrice ?? (isDcfValid ? dcf.intrinsicValue : null);

  const bridge: ValuationBridge = {
    sumPvFcff: ledger ? ledger.sumPvFcff : (dcf?.sumPvFcff ?? null),
    pvTerminalValue: ledger ? ledger.pvTerminalValue : (dcf?.pvTerminalValue ?? null),
    enterpriseValue: ledger ? ledger.enterpriseValue : (dcf?.enterpriseValue ?? null),
    netDebt: ledger ? ledger.netDebt : (dcf ? (dcf.lessDebt - dcf.plusCash) : null),
    equityValue: ledger ? ledger.equityValue : (dcf?.equityValue ?? null),
    sharesOutstanding: ledger ? ledger.sharesOutstanding : (dcf?.sharesOutstanding ?? null),
    fairValuePerShare: fairValueVal
  };

  const upsideVal = ledger
    ? ledger.upsideDownsidePct
    : ((cmp && fairValueVal) ? (fairValueVal / cmp) - 1 : null);
  const isBankOrNbfc = classifySector(profile.sector, profile.industry, profile.description).isFinancialInstitution;

  const valuation: ValuationFacts = {
    model: isBankOrNbfc ? "PB_RESIDUAL_INCOME" : "FCFF_DCF",
    status: valuationStatus,
    fairValue: createMetric(fairValueVal, currency, isDcfValid ? "valid" : "invalid", isBankOrNbfc ? "Residual Income / Justified P/B Model" : "DCF FCFF Model", "derived"),
    upside: createMetric(upsideVal, "%", upsideVal !== null ? "valid" : "invalid", "Modeled Upside vs CMP", "derived"),
    wacc: ledger?.wacc || dcf?.assumptions?.wacc || 0.10,
    terminalGrowth: ledger?.terminalGrowthRate || dcf?.assumptions?.terminalGrowthRate || 0.04,
    bridge,
    assumptions: {
      revenueGrowthRates: dcf?.assumptions?.revenueGrowthRates || [0.12, 0.10, 0.08, 0.07, 0.06],
      ebitMargins: dcf?.assumptions?.ebitMargins || [0.15, 0.15, 0.15, 0.15, 0.15],
      taxRate: dcf?.assumptions?.marginalTaxRate || 0.25,
      wacc: ledger?.wacc || dcf?.assumptions?.wacc || 0.10,
      terminalGrowthRate: ledger?.terminalGrowthRate || dcf?.assumptions?.terminalGrowthRate || 0.04
    },
    diagnostics: isDcfValid ? [] : ["DCF model did not yield a positive intrinsic equity value per share."]
  };

  // 7. Deterministic Recommendation
  const baseRec = calculateRecommendation(cmp, fairValueVal);
  const recommendation: RecommendationResult = ledger?.rating
    ? {
        ...baseRec,
        rating: ledger.rating as RecommendationRating,
        upside: upsideVal,
        reasoning: ledger.ratingRationale || baseRec.reasoning
      }
    : baseRec;

  // 8. Scenario Facts
  const scenarios = buildScenarioSet({
    currentPrice: cmp || 100,
    baseTargetPrice: fairValueVal || cmp || 100,
    bullTarget: ledger?.scenarios?.bull?.targetPrice,
    bearTarget: ledger?.scenarios?.bear?.targetPrice,
    bullMultiplier: 1.25,
    bearMultiplier: 0.75
  });

  // 9. Canonical Moat
  const roceHistory = ratiosByYear.map(r => r.roce);
  // stmtNum: gross-profit history is N/A (NaN) on sector-native shapes — moat
  // evaluator treats non-finite as absent, never as zero-margin evidence.
  const gmHistory = annualFinancials.map(f => f.revenue > 0 ? stmtNum(f, "grossProfit", Number.NaN) / f.revenue : 0);
  const moat = evaluateCanonicalMoat({
    roceHistory,
    wacc: valuation.wacc,
    grossMarginHistory: gmHistory,
    debtToEquity: ratios.debtToEquity.value || 0
  });

  // 10. Peer Facts & Coverage Rules
  const totalPeers = peers.length;
  const validPeers = peers.filter(p => p.pe && p.pe > 0 && p.evToEbitda && p.evToEbitda > 0).length;
  const peerCoverage = totalPeers > 0 ? validPeers / totalPeers : 0;
  const coverageStatus = peerCoverage >= 0.70 ? "adequate" : (peerCoverage >= 0.50 ? "warning" : "suppressed");

  const peerFacts: PeerFacts = {
    totalPeers,
    validPeers,
    peerCoverage,
    coverageStatus,
    peerList: peers.map(p => ({
      ticker: p.ticker || "",
      name: p.name || "",
      marketCap: p.marketCap || null,
      pe: p.pe || null,
      evToEbitda: p.evToEbitda || null,
      roe: p.roe || null
    }))
  };

  // 11. Uncertainty & Risks
  const uncertainty = calculateUncertainty({
    isValuationValid: isDcfValid,
    debtToEquity: ratios.debtToEquity.value,
    netDebtToEbitda: ratios.netDebtToEbitda.value,
    beta: market.beta.value,
    dataCompletenessScore: Math.min(100, annualFinancials.length * 20),
    isCyclical: ["Basic Materials", "Energy", "Industrials"].includes(profile.sector)
  });

  const deVal = ratios.debtToEquity.value || 0;
  const solvencyRisk = deVal > 2.5 ? "High" : (deVal > 1.2 ? "Elevated" : (deVal > 0.5 ? "Moderate" : "Low"));

  const risks: RiskFacts = {
    uncertainty,
    solvencyRisk,
    primaryRisks: [
      `Cost of capital sensitivity: 100 bps WACC increase impacts valuation target.`,
      solvencyRisk === "High" ? "Elevated debt load requires consistent operational cash generation." : "Competitive industry dynamics and margin cyclicality."
    ]
  };

  // 12. Data Quality Engine (estimate-aware: synthesized fields cap confidence)
  const estimatedFieldsCount = annualFinancials.reduce((s, f) => s + (f.estimatesUsed?.length || 0), 0);
  const estimatedYears = annualFinancials.filter(f => (f.estimatesUsed?.length || 0) > 0).length;
  const estimateIssues: string[] = [];
  if (estimatedFieldsCount > 0) {
    estimateIssues.push(
      `Financial statements include ${estimatedFieldsCount} model-estimated field(s) across ${estimatedYears}/${annualFinancials.length} year(s) (fixed-margin fallbacks, not reported — see statement footnotes).`
    );
  }

  const dataQualityScore = Math.round(
    (annualFinancials.length >= 4 ? 40 : annualFinancials.length * 10) +
    (isDcfValid ? 30 : 0) +
    (peerCoverage >= 0.70 ? 20 : peerCoverage * 25) +
    (stockData.currentPrice > 0 ? 10 : 0)
  );

  const valuationConfidence: "High" | "Medium" | "Low" =
    !isDcfValid ? "Low" : estimatedFieldsCount >= 12 ? "Low" : estimatedFieldsCount >= 5 ? "Medium" : "High";

  const quality: DataQuality = {
    score: dataQualityScore,
    historicalCoverage: annualFinancials.length >= 4 ? "High" : (annualFinancials.length >= 2 ? "Medium" : "Low"),
    peerCoverage: peerCoverage >= 0.70 ? "High" : (peerCoverage >= 0.40 ? "Medium" : "Low"),
    valuationConfidence,
    sourceCompleteness: annualFinancials.length >= 3 && cmp !== null ? "High" : "Medium",
    issues: [...valuation.diagnostics, ...estimateIssues]
  };

  // 13. Provenance Map (financials marked INFERENCE when fallbacks were used)
  const provenance: Record<string, ProvenanceType> = {
    currentPrice: "REPORTED",
    sharesOutstanding: "REPORTED",
    marketCap: "DERIVED",
    enterpriseValue: "DERIVED",
    fairValue: "DERIVED",
    upside: "DERIVED",
    rating: "DERIVED",
    wacc: "ASSUMPTION",
    terminalGrowth: "ASSUMPTION",
    scenarios: "DERIVED",
    moat: "DERIVED",
    uncertainty: "DERIVED",
    financials: estimatedFieldsCount > 0 ? "INFERENCE" : "REPORTED"
  };

  return {
    reportId: `REP-${profile.ticker}-${Date.now().toString(36).toUpperCase()}`,
    generatedAt: new Date().toISOString(),
    reportVersion: "2.1.0-ENTERPRISE",
    company,
    market,
    financials: {
      years,
      history,
      latestYear
    },
    ratios,
    dupont: latestDuPont,
    valuation,
    scenarios,
    peers: peerFacts,
    moat,
    risks,
    recommendation,
    provenance,
    quality
  };
}

function createEmptyYearFact(currency: string): FinancialYearFact {
  const empty = createMetric<number>(null, currency, "missing", undefined, "reported");
  return {
    year: "FY00",
    revenue: empty,
    grossProfit: empty,
    ebitda: empty,
    operatingIncome: empty,
    netIncome: empty,
    totalDebt: empty,
    cashAndEquivalents: empty,
    netDebt: empty,
    totalAssets: empty,
    totalEquity: empty,
    operatingCashFlow: empty,
    capitalExpenditures: empty,
    freeCashFlow: empty,
    eps: empty
  };
}
