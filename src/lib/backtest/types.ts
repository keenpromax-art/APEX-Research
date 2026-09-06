// ============================================================
// Backtesting Engine Types & Data Contracts
// ============================================================

export type BacktestVerdict = "WIN" | "LOSS" | "PENDING" | "EXEMPT";

export interface BacktestRecord {
  id: string;
  ticker: string;
  name: string;
  sector: string;
  industry: string;
  region: "India" | "USA" | "Global";
  signalDate: string; // e.g. "2025-09-01"
  settledDate: string; // e.g. "2026-09-01"
  model: "FCFF_DCF" | "PB_RESIDUAL_INCOME" | "DDM";
  archetype?: string;

  // Signal / Model Output At Publication (T=0)
  signalPrice: number; // CMP at publication
  fairValue: number; // Modeled intrinsic value
  predictedUpside: number; // (fairValue / signalPrice) - 1
  rating: "BUY" | "HOLD" | "SELL" | "NR";
  decile: number; // 1 (highest conviction buy) to 10 (strongest sell)
  sectorZScore: number;
  bullTarget: number;
  bearTarget: number;

  // Realized Market Outcome (T=+1 Year)
  realizedPrice: number;
  realizedReturn: number; // (realizedPrice / signalPrice) - 1
  benchmarkTicker: "^NSEI" | "^GSPC";
  benchmarkReturn: number;
  alpha: number; // realizedReturn - benchmarkReturn

  // Outcome
  verdict: BacktestVerdict;
  verdictReason: string;
}

export interface InFlightRecord extends BacktestRecord {
  daysElapsed: number;
  daysRemaining: number;
  progressPct: number;
  currentReturn: number;
  currentPrice: number;
  pacingStatus: "ON_TRACK" | "IN_CORRIDOR" | "AT_RISK";
  projectedVerdict: "WIN" | "LOSS";
}

export interface DecilePerformance {
  decile: number;
  label: string;
  count: number;
  avgPredictedUpside: number;
  avgRealizedReturn: number;
  avgBenchmarkReturn: number;
  avgAlpha: number;
  winRate: number;
}

export interface RatingCohortPerformance {
  rating: "BUY" | "HOLD" | "SELL";
  totalCalls: number;
  wins: number;
  losses: number;
  winRate: number;
  avgPredictedUpside: number;
  avgRealizedReturn: number;
  avgAlpha: number;
  profitFactor: number;
  maxDrawdown: number;
  bestCall: { ticker: string; return: number };
  worstCall: { ticker: string; return: number };
}

export interface BacktestSummary {
  totalCohort: number;
  settledSignals: number;
  pendingOrNr: number;
  overallWinRate: number; // % of settled calls that met winning conditions
  overallAvgReturn: number;
  overallAvgBenchmarkReturn: number;
  overallAlpha: number;
  buyAlpha: number;
  directionalAlpha: number;
  spearmanRankCorrelation: number; // Correlation between predicted upside and realized return
  informationCoefficient: number; // IC
  profitFactor: number; // Gross gains / gross losses
  decileSpread: number; // Avg return Decile 1 - Avg return Decile 10
  decilePerformance: DecilePerformance[];
  ratingPerformance: Record<"BUY" | "HOLD" | "SELL", RatingCohortPerformance>;
  sectorBreakdown: {
    sector: string;
    count: number;
    winRate: number;
    avgRealizedReturn: number;
  }[];
}
