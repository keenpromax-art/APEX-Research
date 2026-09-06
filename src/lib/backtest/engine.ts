// ============================================================
// Backtesting Mathematics & Analytics Engine
// Computes win rate, decile performance, Spearman correlation, and alpha
// ============================================================
import type {
  BacktestRecord,
  BacktestSummary,
  DecilePerformance,
  RatingCohortPerformance,
  InFlightRecord
} from "./types";
import { computeSpearmanRankCorrelation } from "../valuation/calibration";

/**
 * Evaluates whether a signal was a WIN or LOSS based on strict institutional rules:
 * - BUY: Realized return >= +12%
 * - SELL: Realized return <= -12%
 * - HOLD: Realized return within [-12%, +12%]
 */
export function judgeSignalOutcome(
  rating: "BUY" | "HOLD" | "SELL" | "NR",
  realizedReturn: number
): { verdict: "WIN" | "LOSS" | "EXEMPT"; reason: string } {
  if (rating === "NR") {
    return { verdict: "EXEMPT", reason: "Signal was Not Rated (NR) due to confidence or parameter bounds." };
  }

  if (rating === "BUY") {
    if (realizedReturn >= 0.12) {
      return { verdict: "WIN", reason: `BUY call generated ${(realizedReturn * 100).toFixed(1)}% return, clearing +12% hurdle.` };
    } else {
      return { verdict: "LOSS", reason: `BUY call generated ${(realizedReturn * 100).toFixed(1)}% return, missing +12% hurdle.` };
    }
  }

  if (rating === "SELL") {
    if (realizedReturn <= -0.12) {
      return { verdict: "WIN", reason: `SELL call correctly anticipated contraction (${(realizedReturn * 100).toFixed(1)}% return).` };
    } else {
      return { verdict: "LOSS", reason: `SELL call failed as stock did not contract beyond -12% (${(realizedReturn * 100).toFixed(1)}% return).` };
    }
  }

  // HOLD
  if (realizedReturn >= -0.12 && realizedReturn <= 0.12) {
    return { verdict: "WIN", reason: `HOLD call verified: Stock traded within neutral ±12% risk corridor (${(realizedReturn * 100).toFixed(1)}%).` };
  } else {
    return { verdict: "LOSS", reason: `HOLD call breached neutral corridor (${(realizedReturn * 100).toFixed(1)}% return).` };
  }
}

/**
 * Computes aggregate summary statistics, decile performance, and rank calibration for a cohort.
 */
export function computeBacktestMetrics(records: BacktestRecord[]): BacktestSummary {
  const settled = records.filter(r => r.verdict === "WIN" || r.verdict === "LOSS");
  const wins = settled.filter(r => r.verdict === "WIN");
  const pendingOrNr = records.filter(r => r.verdict === "PENDING" || r.verdict === "EXEMPT");

  const overallWinRate = settled.length > 0 ? wins.length / settled.length : 0;
  const overallAvgReturn = settled.length > 0
    ? settled.reduce((acc, r) => acc + r.realizedReturn, 0) / settled.length
    : 0;
  const overallAvgBenchmarkReturn = settled.length > 0
    ? settled.reduce((acc, r) => acc + r.benchmarkReturn, 0) / settled.length
    : 0;
  const overallAlpha = overallAvgReturn - overallAvgBenchmarkReturn;

  const buyRecords = settled.filter(r => r.rating === "BUY");
  const buyAlpha = buyRecords.length > 0
    ? buyRecords.reduce((s, r) => s + r.alpha, 0) / buyRecords.length
    : 0;

  // Directional alpha: long on BUY (+alpha), short on SELL (+alpha if dropped)
  const directionalAlpha = settled.length > 0
    ? settled.reduce((acc, r) => {
        if (r.rating === "BUY") return acc + (r.realizedReturn - r.benchmarkReturn);
        if (r.rating === "SELL") return acc + (r.benchmarkReturn - r.realizedReturn);
        return acc + 0;
      }, 0) / settled.length
    : 0;

  // 1. Spearman Rank Correlation (Predicted Upside vs Realized Return)
  const predictedVals = settled.map(r => r.predictedUpside);
  const realizedVals = settled.map(r => r.realizedReturn);
  const spearmanRankCorrelation = computeSpearmanRankCorrelation(predictedVals, realizedVals);
  const informationCoefficient = settled.length > 0
    ? Number((spearmanRankCorrelation * Math.sqrt(settled.length) / 4.0).toFixed(3)) // Standard normalized IC
    : 0;

  // 2. Profit Factor: Gross Winning Returns / Gross Losing Returns
  const grossGains = settled.filter(r => r.realizedReturn > 0).reduce((s, r) => s + r.realizedReturn, 0);
  const grossLosses = Math.abs(settled.filter(r => r.realizedReturn < 0).reduce((s, r) => s + r.realizedReturn, 0));
  const profitFactor = grossLosses > 0 ? Number((grossGains / grossLosses).toFixed(2)) : grossGains > 0 ? 99.9 : 1.0;

  // 3. Performance by Rating Cohort
  const calcRatingCohort = (rating: "BUY" | "HOLD" | "SELL"): RatingCohortPerformance => {
    const subset = settled.filter(r => r.rating === rating);
    const subWins = subset.filter(r => r.verdict === "WIN");
    const subLosses = subset.filter(r => r.verdict === "LOSS");
    const winRate = subset.length > 0 ? subWins.length / subset.length : 0;
    const avgPredictedUpside = subset.length > 0 ? subset.reduce((s, r) => s + r.predictedUpside, 0) / subset.length : 0;
    const avgRealizedReturn = subset.length > 0 ? subset.reduce((s, r) => s + r.realizedReturn, 0) / subset.length : 0;
    const avgAlpha = subset.length > 0 ? subset.reduce((s, r) => s + r.alpha, 0) / subset.length : 0;

    const subGains = subset.filter(r => r.realizedReturn > 0).reduce((s, r) => s + r.realizedReturn, 0);
    const subLossesSum = Math.abs(subset.filter(r => r.realizedReturn < 0).reduce((s, r) => s + r.realizedReturn, 0));
    const pf = subLossesSum > 0 ? Number((subGains / subLossesSum).toFixed(2)) : 5.0;

    let bestCall = { ticker: "N/A", return: 0 };
    let worstCall = { ticker: "N/A", return: 0 };
    if (subset.length > 0) {
      const sorted = [...subset].sort((a, b) => b.realizedReturn - a.realizedReturn);
      bestCall = { ticker: sorted[0].ticker, return: sorted[0].realizedReturn };
      worstCall = { ticker: sorted[sorted.length - 1].ticker, return: sorted[sorted.length - 1].realizedReturn };
    }

    return {
      rating,
      totalCalls: subset.length,
      wins: subWins.length,
      losses: subLosses.length,
      winRate,
      avgPredictedUpside,
      avgRealizedReturn,
      avgAlpha,
      profitFactor: pf,
      maxDrawdown: Math.abs(worstCall.return < 0 ? worstCall.return : 0),
      bestCall,
      worstCall,
    };
  };

  const ratingPerformance: Record<"BUY" | "HOLD" | "SELL", RatingCohortPerformance> = {
    BUY: calcRatingCohort("BUY"),
    HOLD: calcRatingCohort("HOLD"),
    SELL: calcRatingCohort("SELL"),
  };

  // 4. Decile-by-Decile Performance (D1 through D10)
  const decilePerformance: DecilePerformance[] = [];
  for (let d = 1; d <= 10; d++) {
    const inDecile = settled.filter(r => r.decile === d);
    const dWins = inDecile.filter(r => r.verdict === "WIN");
    const count = inDecile.length;
    const avgPredictedUpside = count > 0 ? inDecile.reduce((s, r) => s + r.predictedUpside, 0) / count : 0;
    const avgRealizedReturn = count > 0 ? inDecile.reduce((s, r) => s + r.realizedReturn, 0) / count : 0;
    const avgBenchmarkReturn = count > 0 ? inDecile.reduce((s, r) => s + r.benchmarkReturn, 0) / count : 0;
    const avgAlpha = avgRealizedReturn - avgBenchmarkReturn;
    const winRate = count > 0 ? dWins.length / count : 0;

    const label = d <= 2 ? `D${d} (Top Conviction BUY)` : d >= 9 ? `D${d} (Strong SELL)` : `D${d} (Core / Neutral)`;
    decilePerformance.push({
      decile: d,
      label,
      count,
      avgPredictedUpside,
      avgRealizedReturn,
      avgBenchmarkReturn,
      avgAlpha,
      winRate,
    });
  }

  // Decile Spread: D1 vs D10 (or top available decile vs bottom available decile)
  const d1Return = decilePerformance[0]?.count > 0 ? decilePerformance[0].avgRealizedReturn : ratingPerformance.BUY.avgRealizedReturn;
  const d10Return = decilePerformance[9]?.count > 0 ? decilePerformance[9].avgRealizedReturn : ratingPerformance.SELL.avgRealizedReturn;
  const decileSpread = d1Return - d10Return;

  // 5. Breakdown by Sector
  const sectorsSet = Array.from(new Set(records.map(r => r.sector)));
  const sectorBreakdown = sectorsSet.map(sector => {
    const secRecords = settled.filter(r => r.sector === sector);
    const secWins = secRecords.filter(r => r.verdict === "WIN");
    const count = secRecords.length;
    const winRate = count > 0 ? secWins.length / count : 0;
    const avgRealizedReturn = count > 0 ? secRecords.reduce((s, r) => s + r.realizedReturn, 0) / count : 0;
    return {
      sector,
      count,
      winRate,
      avgRealizedReturn,
    };
  }).sort((a, b) => b.count - a.count);

  return {
    totalCohort: records.length,
    settledSignals: settled.length,
    pendingOrNr: pendingOrNr.length,
    overallWinRate,
    overallAvgReturn,
    overallAvgBenchmarkReturn,
    overallAlpha,
    buyAlpha,
    directionalAlpha,
    spearmanRankCorrelation,
    informationCoefficient,
    profitFactor,
    decileSpread,
    decilePerformance,
    ratingPerformance,
    sectorBreakdown,
  };
}

/**
 * Dynamically partitions the backtest universe into Settled vs In-Flight based on an As-Of Date.
 * Demonstrates how results evolve dynamically as calendar days elapse and signals complete their 1-year holding test.
 */
export function partitionCohortByDate(
  records: BacktestRecord[],
  asOfDate: string = "2024-09-01"
): {
  settled: BacktestRecord[];
  inFlight: InFlightRecord[];
  asOfDate: string;
} {
  const asOfTime = new Date(asOfDate).getTime();
  const settled: BacktestRecord[] = [];
  const inFlight: InFlightRecord[] = [];

  for (const r of records) {
    const t0 = new Date(r.signalDate).getTime();
    const t1 = new Date(r.settledDate).getTime();

    if (asOfTime >= t1) {
      // 1-Year test is fully complete
      settled.push(r);
    } else if (asOfTime >= t0) {
      // In-flight active tracking
      const totalSpan = Math.max(1, (t1 - t0) / (86400 * 1000));
      const daysElapsed = Math.max(0, Math.floor((asOfTime - t0) / (86400 * 1000)));
      const daysRemaining = Math.max(0, Math.floor((t1 - asOfTime) / (86400 * 1000)));
      const progressFraction = Math.min(1.0, Math.max(0, daysElapsed / totalSpan));

      const priceGap = r.realizedPrice - r.signalPrice;
      const currentPrice = Number((r.signalPrice + priceGap * progressFraction).toFixed(1));
      const currentReturn = Number(((currentPrice / r.signalPrice) - 1).toFixed(3));

      let pacingStatus: "ON_TRACK" | "IN_CORRIDOR" | "AT_RISK" = "IN_CORRIDOR";
      let projectedVerdict: "WIN" | "LOSS" = "LOSS";

      if (r.rating === "BUY") {
        const requiredPace = 0.12 * progressFraction;
        if (currentReturn >= requiredPace) {
          pacingStatus = "ON_TRACK";
          projectedVerdict = "WIN";
        } else {
          pacingStatus = "AT_RISK";
          projectedVerdict = "LOSS";
        }
      } else if (r.rating === "SELL") {
        const requiredPace = -0.12 * progressFraction;
        if (currentReturn <= requiredPace) {
          pacingStatus = "ON_TRACK";
          projectedVerdict = "WIN";
        } else {
          pacingStatus = "AT_RISK";
          projectedVerdict = "LOSS";
        }
      } else {
        if (Math.abs(currentReturn) <= 0.12) {
          pacingStatus = "ON_TRACK";
          projectedVerdict = "WIN";
        } else {
          pacingStatus = "AT_RISK";
          projectedVerdict = "LOSS";
        }
      }

      inFlight.push({
        ...r,
        verdict: "PENDING",
        daysElapsed,
        daysRemaining,
        progressPct: Math.round(progressFraction * 100),
        currentReturn,
        currentPrice,
        pacingStatus,
        projectedVerdict,
      });
    }
  }

  return { settled, inFlight, asOfDate };
}

