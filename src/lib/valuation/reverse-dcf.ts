/**
 * APEX RESEARCH — Reverse DCF & Implied Expectations Engine
 *
 * Backs out the implied 5-year revenue growth rate and operating margin
 * that the Current Market Price (CMP) actually reflects.
 *
 * Solves the critical research defect:
 * "When your model says a major company is worth 80% less than the market,
 * simply declaring that the market is irrational is weak research.
 * The right question is: What revenue growth, margins and reinvestment
 * assumptions does today's price imply?"
 */

export interface ReverseDCFInput {
  currentMarketPrice: number;
  sharesOutstanding: number;
  netDebt: number; // totalDebt - cash
  latestRevenue: number;
  baseEbitMargin: number;
  wacc: number;
  terminalGrowthRate: number;
  marginalTaxRate: number;
  modelBaseGrowthRate: number;
  avgCapexPct?: number;
  avgDeptPct?: number;
  avgNwcChangePct?: number;
}

export interface ReverseDCFOutput {
  impliedRevenueGrowthRate: number;
  impliedTerminalOperatingMargin: number;
  impliedGrowthPctDisplay: string;
  impliedMarginPctDisplay: string;
  modelGrowthPctDisplay: string;
  growthGapPctDisplay: string;
  verdict: string;
  targetEnterpriseValue: number;
  confidence: "High" | "Medium" | "Low";
}

function fmtPct(n: number): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${(n * 100).toFixed(1)}%`;
}

/**
 * Calculates Enterprise Value for a given constant revenue growth rate g
 */
function calculateEVForGrowth(
  g: number,
  input: ReverseDCFInput,
  capexPct: number,
  deptPct: number,
  nwcPct: number
): number {
  const { latestRevenue, baseEbitMargin, wacc, terminalGrowthRate, marginalTaxRate } = input;
  const safeWacc = Math.max(0.06, wacc);
  const safeTg = Math.min(safeWacc - 0.015, Math.max(0.01, terminalGrowthRate));

  let currentRev = latestRevenue;
  let sumPvFcff = 0;
  let lastFcff = 0;

  for (let i = 1; i <= 5; i++) {
    currentRev = currentRev * (1 + g);
    const ebit = currentRev * baseEbitMargin;
    const nopat = ebit * (1 - marginalTaxRate);
    const depreciation = currentRev * deptPct;
    const capex = currentRev * capexPct;
    const nwc = currentRev * nwcPct;
    const fcff = nopat + depreciation - capex - nwc;
    lastFcff = fcff;

    const discountFactor = Math.pow(1 + safeWacc, -(i - 0.5)); // Mid-year convention
    sumPvFcff += fcff * discountFactor;
  }

  // Terminal value
  const terminalFcff = lastFcff * (1 + safeTg);
  const terminalVal = terminalFcff / (safeWacc - safeTg);
  const pvTerminalVal = terminalVal * Math.pow(1 + safeWacc, -5);

  return sumPvFcff + pvTerminalVal;
}

/**
 * Calculates Enterprise Value for a given operating margin M
 */
function calculateEVForMargin(
  m: number,
  input: ReverseDCFInput,
  growthRate: number,
  capexPct: number,
  deptPct: number,
  nwcPct: number
): number {
  const { latestRevenue, wacc, terminalGrowthRate, marginalTaxRate } = input;
  const safeWacc = Math.max(0.06, wacc);
  const safeTg = Math.min(safeWacc - 0.015, Math.max(0.01, terminalGrowthRate));

  let currentRev = latestRevenue;
  let sumPvFcff = 0;
  let lastFcff = 0;

  for (let i = 1; i <= 5; i++) {
    currentRev = currentRev * (1 + growthRate);
    const ebit = currentRev * m;
    const nopat = ebit * (1 - marginalTaxRate);
    const depreciation = currentRev * deptPct;
    const capex = currentRev * capexPct;
    const nwc = currentRev * nwcPct;
    const fcff = nopat + depreciation - capex - nwc;
    lastFcff = fcff;

    const discountFactor = Math.pow(1 + safeWacc, -(i - 0.5));
    sumPvFcff += fcff * discountFactor;
  }

  const terminalFcff = lastFcff * (1 + safeTg);
  const terminalVal = terminalFcff / (safeWacc - safeTg);
  const pvTerminalVal = terminalVal * Math.pow(1 + safeWacc, -5);

  return sumPvFcff + pvTerminalVal;
}

/**
 * Main reverse DCF solver
 */
export function computeReverseDCF(input: ReverseDCFInput): ReverseDCFOutput {
  const {
    currentMarketPrice,
    sharesOutstanding,
    netDebt,
    latestRevenue,
    baseEbitMargin,
    modelBaseGrowthRate,
    avgCapexPct = 0.045,
    avgDeptPct = 0.035,
    avgNwcChangePct = 0.02,
  } = input;

  const marketCap = currentMarketPrice * sharesOutstanding;
  const targetEV = marketCap + netDebt;

  // Fallback if inputs are economically nonsensical
  if (targetEV <= 0 || latestRevenue <= 0 || sharesOutstanding <= 0) {
    return {
      impliedRevenueGrowthRate: modelBaseGrowthRate,
      impliedTerminalOperatingMargin: baseEbitMargin,
      impliedGrowthPctDisplay: fmtPct(modelBaseGrowthRate),
      impliedMarginPctDisplay: fmtPct(baseEbitMargin),
      modelGrowthPctDisplay: fmtPct(modelBaseGrowthRate),
      growthGapPctDisplay: "0.0%",
      verdict: "Market expectations are in-line with modeled fundamental baseline.",
      targetEnterpriseValue: Math.max(0, targetEV),
      confidence: "Low",
    };
  }

  // 1. Solve for Implied Revenue Growth Rate via Bisection
  let lowG = -0.50; // -50% CAGR
  let highG = 1.20; // +120% CAGR

  // Check boundaries
  const evAtLow = calculateEVForGrowth(lowG, input, avgCapexPct, avgDeptPct, avgNwcChangePct);
  const evAtHigh = calculateEVForGrowth(highG, input, avgCapexPct, avgDeptPct, avgNwcChangePct);

  let impliedG = modelBaseGrowthRate;
  if (targetEV <= evAtLow) {
    impliedG = lowG;
  } else if (targetEV >= evAtHigh) {
    impliedG = highG;
  } else {
    // Binary search over monotonic function
    for (let iter = 0; iter < 45; iter++) {
      const midG = (lowG + highG) / 2;
      const evMid = calculateEVForGrowth(midG, input, avgCapexPct, avgDeptPct, avgNwcChangePct);
      if (evMid < targetEV) {
        lowG = midG;
      } else {
        highG = midG;
      }
    }
    impliedG = (lowG + highG) / 2;
  }

  // 2. Solve for Implied Operating Margin (holding growth at model base)
  let lowM = -0.10;
  let highM = 0.80;
  const evAtLowM = calculateEVForMargin(lowM, input, modelBaseGrowthRate, avgCapexPct, avgDeptPct, avgNwcChangePct);
  const evAtHighM = calculateEVForMargin(highM, input, modelBaseGrowthRate, avgCapexPct, avgDeptPct, avgNwcChangePct);

  let impliedM = baseEbitMargin;
  if (targetEV <= evAtLowM) {
    impliedM = lowM;
  } else if (targetEV >= evAtHighM) {
    impliedM = highM;
  } else {
    for (let iter = 0; iter < 45; iter++) {
      const midM = (lowM + highM) / 2;
      const evMid = calculateEVForMargin(midM, input, modelBaseGrowthRate, avgCapexPct, avgDeptPct, avgNwcChangePct);
      if (evMid < targetEV) {
        lowM = midM;
      } else {
        highM = midM;
      }
    }
    impliedM = (lowM + highM) / 2;
  }

  // 3. Growth Gap & Institutional Verdict
  const growthGap = impliedG - modelBaseGrowthRate;

  let verdict = "";
  if (growthGap > 0.12) {
    verdict = `Current market price implies aggressive top-line growth (${fmtPct(impliedG)} CAGR vs ${fmtPct(modelBaseGrowthRate)} modeled), reflecting elevated execution expectations.`;
  } else if (growthGap > 0.04) {
    verdict = `Current market price reflects a moderate growth premium (${fmtPct(impliedG)} CAGR implied vs ${fmtPct(modelBaseGrowthRate)} modeled base case).`;
  } else if (growthGap < -0.12) {
    verdict = `Current market price implies deep structural deceleration or margin compression (${fmtPct(impliedG)} CAGR vs ${fmtPct(modelBaseGrowthRate)} modeled), reflecting excessive market pessimism.`;
  } else if (growthGap < -0.04) {
    verdict = `Current market price incorporates conservative growth expectations (${fmtPct(impliedG)} CAGR vs ${fmtPct(modelBaseGrowthRate)} modeled baseline).`;
  } else {
    verdict = `Current market price is broadly balanced with fundamental growth expectations (${fmtPct(impliedG)} CAGR implied vs ${fmtPct(modelBaseGrowthRate)} modeled).`;
  }

  const confidence: "High" | "Medium" | "Low" =
    Math.abs(growthGap) < 0.08 ? "High" : Math.abs(growthGap) < 0.20 ? "Medium" : "Low";

  return {
    impliedRevenueGrowthRate: impliedG,
    impliedTerminalOperatingMargin: impliedM,
    impliedGrowthPctDisplay: fmtPct(impliedG),
    impliedMarginPctDisplay: fmtPct(impliedM),
    modelGrowthPctDisplay: fmtPct(modelBaseGrowthRate),
    growthGapPctDisplay: fmtPct(growthGap),
    verdict,
    targetEnterpriseValue: targetEV,
    confidence,
  };
}
