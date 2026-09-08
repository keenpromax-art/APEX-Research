// ============================================================
// Financial calculations — ratios, DuPont, DCF valuation
// ============================================================
import type {
  AnnualFinancials,
  Ratios,
  DuPontAnalysis,
  DCFResult,
  DCFAssumptions,
  DCFProjection,
  StockData,
} from "@/types/report";
import { calculateRecommendation } from "./recommendation";
import { computeReverseDCF } from "./valuation/reverse-dcf";
import type { ArchetypeProfile } from "./company-archetype";
import type { SectorProfile } from "./sectors/types";

const safe = (n: number, d = 0) =>
  isFinite(n) && !isNaN(n) ? n : d;

function div(a: number, b: number) {
  return b !== 0 ? a / b : 0;
}

// ─────────────────────────────────────────────
// Ratio Analysis for each year
// ─────────────────────────────────────────────
export function computeRatios(
  fin: AnnualFinancials,
  cmp: number
): Ratios {
  const {
    year,
    revenue,
    grossProfit,
    ebitda,
    operatingIncome,
    netIncome,
    totalEquity,
    totalAssets,
    totalDebt,
    cash,
    netFixedAssets,
    netWorkingCapital,
    currentAssets,
    currentLiabilities,
    netReceivables,
    inventory,
    interestExpense,
    dividendsPaid,
    eps,
    sharesOutstanding,
  } = fin;

  // Profitability
  const grossMargin = safe(div(grossProfit, revenue));
  const ebitdaMargin = safe(div(ebitda, revenue));
  const ebitMargin = safe(div(operatingIncome, revenue));
  const netMargin = safe(div(netIncome, revenue));
  const roe = safe(div(netIncome, totalEquity));
  const roa = safe(div(netIncome, totalAssets));
  const capitalEmployed = totalAssets - currentLiabilities;
  const roce = safe(div(operatingIncome, capitalEmployed));

  // Efficiency
  const assetTurnover = safe(div(revenue, totalAssets));
  const fixedAssetTurnover = safe(div(revenue, netFixedAssets > 0 ? netFixedAssets : 1));
  const wcTurnover = safe(div(revenue, netWorkingCapital !== 0 ? netWorkingCapital : 1));
  const invTurnover = safe(div(revenue, inventory > 0 ? inventory : 1));
  const arTurnover = safe(div(revenue, netReceivables > 0 ? netReceivables : 1));

  // Leverage
  const debtToEquity = safe(div(totalDebt, totalEquity));
  const equityMultiplier = safe(div(totalAssets, totalEquity));
  const interestCoverage = safe(div(operatingIncome, interestExpense > 0 ? interestExpense : 0.001));
  const netDebt = totalDebt - cash;
  const netDebtToEbitda = safe(div(netDebt, ebitda > 0 ? ebitda : 0.001));
  const totalDebtToAssets = safe(div(totalDebt, totalAssets));
  const currentRatio = safe(div(currentAssets, currentLiabilities > 0 ? currentLiabilities : 1));
  const quickRatio = safe(div(currentAssets - inventory, currentLiabilities > 0 ? currentLiabilities : 1));

  // Valuation (at current market price utilizing historical period-specific shares outstanding)
  const periodShares = sharesOutstanding > 0 ? sharesOutstanding : 1;
  const pe = eps > 0 ? safe(div(cmp, eps)) : 0;
  const marketCap = cmp * periodShares;
  const enterpriseValue = marketCap + netDebt;
  const evToEbitda = ebitda > 0 ? safe(div(enterpriseValue, ebitda)) : 0;
  const bookValuePerShare = safe(div(totalEquity, periodShares));
  const pb = safe(div(cmp * periodShares, totalEquity));
  const ps = safe(div(cmp * periodShares, revenue));
  const dividendYield = cmp > 0 ? safe(div(dividendsPaid / periodShares, cmp)) : 0;
  const dividendPayout = netIncome > 0 ? safe(div(dividendsPaid, netIncome)) : 0;

  return {
    year,
    grossMargin,
    ebitdaMargin,
    ebitMargin,
    netMargin,
    roe,
    roa,
    roce,
    assetTurnover,
    fixedAssetTurnover,
    workingCapitalTurnover: wcTurnover,
    inventoryTurnover: invTurnover,
    receivablesTurnover: arTurnover,
    debtToEquity,
    equityMultiplier,
    interestCoverage,
    netDebtToEbitda,
    totalDebtToAssets,
    currentRatio,
    quickRatio,
    pe,
    evToEbitda,
    pb,
    ps,
    bookValuePerShare,
    marketCap,
    enterpriseValue,
    dividendYield,
    dividendPayout,
    eps,
  };
}

// ─────────────────────────────────────────────
// DuPont Analysis
// ─────────────────────────────────────────────
export function computeDuPont(
  fin: AnnualFinancials
): DuPontAnalysis {
  const netProfitMargin = safe(div(fin.netIncome, fin.revenue));
  const assetTurnover = safe(div(fin.revenue, fin.totalAssets));
  const equityMultiplier = safe(div(fin.totalAssets, fin.totalEquity));
  const roe = netProfitMargin * assetTurnover * equityMultiplier;
  const roa = netProfitMargin * assetTurnover;

  return {
    year: fin.year,
    netProfitMargin,
    assetTurnover,
    equityMultiplier,
    roe,
    roa,
  };
}

// ─────────────────────────────────────────────
// WACC Calculation (country-aware capital parameters)
// ─────────────────────────────────────────────
export interface CountryCapitalParams {
  riskFreeRate: number;
  equityRiskPremium: number;
  costOfDebtPreTax: number;
  marginalTaxRate: number;
  label: string;
}

// Country CAPM parameter table v2026-09. Previously every listing — including US
// names — was valued on India G-Sec RF/ERP with a 25% tax rate and no disclosure.
export const COUNTRY_CAPITAL_PARAMS: Record<string, CountryCapitalParams> = {
  IN: { riskFreeRate: 0.0685, equityRiskPremium: 0.060, costOfDebtPreTax: 0.075, marginalTaxRate: 0.25, label: "India 10Y G-Sec anchored" },
  US: { riskFreeRate: 0.0420, equityRiskPremium: 0.050, costOfDebtPreTax: 0.055, marginalTaxRate: 0.21, label: "US 10Y Treasury anchored" },
  GB: { riskFreeRate: 0.0400, equityRiskPremium: 0.050, costOfDebtPreTax: 0.055, marginalTaxRate: 0.25, label: "UK gilt anchored" },
  EU: { riskFreeRate: 0.0250, equityRiskPremium: 0.055, costOfDebtPreTax: 0.050, marginalTaxRate: 0.25, label: "Euro-area anchored" },
};

export function resolveCountryParams(country?: string): CountryCapitalParams {
  const c = (country || "").toUpperCase();
  if (c.includes("INDIA") || c === "IN" || c === "INR") return COUNTRY_CAPITAL_PARAMS.IN;
  if (c.includes("UNITED STATES") || c.includes("USA") || c === "US" || c === "USD") return COUNTRY_CAPITAL_PARAMS.US;
  if (c.includes("UNITED KINGDOM") || c.includes("BRITAIN") || c === "GB" || c === "UK") return COUNTRY_CAPITAL_PARAMS.GB;
  if (c.includes("EUROPE") || c.includes("GERMANY") || c.includes("FRANCE") || c === "EU" || c === "EUR") return COUNTRY_CAPITAL_PARAMS.EU;
  return { ...COUNTRY_CAPITAL_PARAMS.US, label: "Global default (US-anchored; override pending)" };
}

export function computeWACC(
  stockData: StockData,
  fin: AnnualFinancials,
  archetypeProfile?: ArchetypeProfile,
  country?: string
): DCFAssumptions {
  const cp = resolveCountryParams(country);
  const riskFreeRate = cp.riskFreeRate;
  const equityRiskPremium = cp.equityRiskPremium;

  // Item 8: Sanity range check on beta before WACC calculation
  // Reject or clamp implausible-but-finite values (outside [0.35, 2.50])
  let rawBeta = stockData.beta;
  if (rawBeta === undefined || rawBeta === null || !Number.isFinite(rawBeta) || rawBeta <= 0) {
    rawBeta = 0.85;
  } else if (rawBeta < 0.35) {
    rawBeta = 0.35;
  } else if (rawBeta > 2.50) {
    rawBeta = 2.50;
  }
  // Blume adjustment towards market portfolio mean of 1.0
  const blumeBeta = 0.67 * rawBeta + 0.33 * 1.0;
  const beta = Math.max(0.5, Math.min(1.8, Number(blumeBeta.toFixed(3))));
  const costOfEquity = riskFreeRate + beta * equityRiskPremium;

  const costOfDebtPreTax = cp.costOfDebtPreTax;
  const marginalTaxRate = cp.marginalTaxRate;
  const costOfDebtPostTax = costOfDebtPreTax * (1 - marginalTaxRate);

  const totalMktCap = (stockData.currentPrice || 1) * (stockData.sharesOutstanding || fin.sharesOutstanding || 1);
  const totalDebtVal = fin.totalDebt || 0;
  const totalValue = totalMktCap + totalDebtVal;
  const equityWeight = totalValue > 0 ? totalMktCap / totalValue : 0.95;
  const debtWeight = 1 - equityWeight;

  // Item 6: Sector / Archetype classification feeds into WACC risk spreads
  let distressSpread = 0.0;
  if (archetypeProfile?.archetype === "DISTRESSED") {
    distressSpread = 0.020; // +200 bps distress risk premium for highly levered / restructuring firms
  } else if (archetypeProfile?.archetype === "EARLY_PLATFORM_GROWTH") {
    distressSpread = 0.015; // +150 bps platform cash-burn risk premium
  }

  const baseWacc = costOfEquity * equityWeight + costOfDebtPostTax * debtWeight;
  const wacc = Math.max(0.085, Math.min(0.16, Number((baseWacc + distressSpread).toFixed(4))));

  // Item 6: Archetype scenario margins feed directly into base EBIT margin
  const archetypeBaseMargin = archetypeProfile?.scenarioMargins?.baseMargin;
  const effectiveMargin = (archetypeBaseMargin !== undefined && archetypeBaseMargin > 0)
    ? archetypeBaseMargin
    : (fin.ebitMargin > 0.03
        ? fin.ebitMargin
        : (stockData.operatingMargins > 0 ? stockData.operatingMargins : 0.14));

  return {
    riskFreeRate,
    equityRiskPremium,
    beta,
    costOfEquity,
    costOfDebtPreTax,
    marginalTaxRate,
    costOfDebtPostTax,
    debtWeight,
    equityWeight,
    wacc,
    terminalGrowthRate: 0.04, // 4.0% long-term nominal GDP anchor — single source of truth
    parameterSource: `Country CAPM table v2026-09 (${cp.label})`,
    revenueGrowthRates: [0.18, 0.16, 0.14, 0.12, 0.10],
    ebitMargins: [
      Math.min(effectiveMargin + 0.010, 0.26),
      Math.min(effectiveMargin + 0.018, 0.27),
      Math.min(effectiveMargin + 0.024, 0.28),
      Math.min(effectiveMargin + 0.028, 0.29),
      Math.min(effectiveMargin + 0.030, 0.30),
    ],
  };
}

// ─────────────────────────────────────────────
// DCF Valuation
// ─────────────────────────────────────────────
export function computeDCF(
  annualFinancials: AnnualFinancials[],
  stockData: StockData,
  sectorProfile?: SectorProfile,
  archetypeProfile?: ArchetypeProfile,
  country?: string
): DCFResult {
  const latest = annualFinancials[annualFinancials.length - 1];

  // Compute historical revenue CAGR
  const years = annualFinancials.length;
  const firstRev = annualFinancials[0]?.revenue || 1;
  const lastRev = latest.revenue;
  const cagr = years > 1 ? Math.pow(lastRev / (firstRev || 1), 1 / (years - 1)) - 1 : 0.15;

  const assumptions = computeWACC(stockData, latest, archetypeProfile, country);

  // Item 5: Winsorized blend of live revenue growth and historical CAGR
  const liveRevGrowth = stockData.revenueGrowth;
  const hasLive = Number.isFinite(liveRevGrowth) && liveRevGrowth !== 0;
  const winsorizedLive = Math.max(0.04, Math.min(0.35, hasLive ? liveRevGrowth : cagr));
  const winsorizedCagr = Math.max(0.04, Math.min(0.30, cagr > 0 ? cagr : 0.14));
  const baseGrowth = hasLive
    ? 0.55 * winsorizedCagr + 0.45 * winsorizedLive
    : winsorizedCagr;

  assumptions.revenueGrowthRates = [
    baseGrowth,
    baseGrowth * 0.90,
    baseGrowth * 0.82,
    baseGrowth * 0.74,
    baseGrowth * 0.66,
  ];

  // Item 6: Archetype capital intensity calibrations
  const nonZeroRevCount = annualFinancials.filter(f => f.revenue > 0).length || 1;
  const rawAvgCapexPct =
    annualFinancials.reduce((s, f) => s + (f.revenue > 0 ? f.capitalExpenditures / f.revenue : 0), 0) /
    nonZeroRevCount;
  const rawAvgDeptPct =
    annualFinancials.reduce((s, f) => s + (f.revenue > 0 ? f.depreciation / f.revenue : 0), 0) /
    nonZeroRevCount;

  let avgCapexPct = Math.min(0.08, Math.max(0.025, rawAvgCapexPct || 0.04));
  let avgDeptPct = Math.min(0.06, Math.max(0.020, rawAvgDeptPct || 0.035));
  let avgNwcChangePct = 0.02;

  if (archetypeProfile?.archetype === "CYCLICAL_CAPITAL_INTENSIVE") {
    avgCapexPct = Math.max(avgCapexPct, 0.065); // High capex cycle absorption
  } else if (archetypeProfile?.archetype === "EARLY_PLATFORM_GROWTH") {
    avgCapexPct = Math.min(avgCapexPct, 0.030); // Asset-light platform
    avgNwcChangePct = 0.035;                   // Customer acquisition / inventory buffer
  }

  const wacc = assumptions.wacc;
  const tg = assumptions.terminalGrowthRate;
  const taxRate = assumptions.marginalTaxRate;

  const projections: DCFProjection[] = [];
  let baseRevenue = latest.revenue;

  for (let i = 0; i < 5; i++) {
    const growthRate = assumptions.revenueGrowthRates[i];
    const revenue = baseRevenue * (1 + growthRate);
    const ebitMargin = assumptions.ebitMargins[i];
    const ebit = revenue * ebitMargin;
    const taxPayment = ebit * taxRate;
    const nopat = ebit - taxPayment;
    const depreciation = revenue * avgDeptPct;
    const capex = revenue * Math.max(avgCapexPct, avgDeptPct * 1.1);
    const changeInWorkingCapital = revenue * avgNwcChangePct;
    const fcff = nopat + depreciation - capex - changeInWorkingCapital;
    const midYearConvention = i + 0.5;
    const discountFactor = Math.pow(1 + wacc, -midYearConvention);
    const pvFcff = fcff * discountFactor;

    const yearNum = new Date().getFullYear() + i + 1;
    projections.push({
      year: `FY${yearNum}E`,
      revenue,
      revenueGrowth: growthRate,
      ebitMargin,
      ebit,
      taxPayment,
      nopat,
      depreciation,
      capex,
      changeInWorkingCapital,
      fcff,
      discountFactor,
      pvFcff,
    });

    baseRevenue = revenue;
  }

  const sumPvFcff = projections.reduce((s, p) => s + p.pvFcff, 0);
  const terminalYearFcff = projections[4].fcff;
  const rawTerminalValue = (terminalYearFcff * (1 + tg)) / Math.max(0.02, wacc - tg);

  // Item 2: Hard cap on terminal value (25x terminal-year FCFF) as a second safeguard
  const maxTerminalMultiple = 25.0;
  const terminalValueCap = Math.max(0, terminalYearFcff * maxTerminalMultiple);
  const isTvCapped = rawTerminalValue > terminalValueCap && terminalYearFcff > 0;
  const terminalValue = isTvCapped ? terminalValueCap : rawTerminalValue;
  const pvTerminalValue = terminalValue * Math.pow(1 + wacc, -5);
  const enterpriseValue = sumPvFcff + pvTerminalValue;

  const latestDebt = Number(latest.totalDebt) || ((Number(latest.shortTermDebt) || 0) + (Number(latest.longTermDebt) || 0));
  const latestCash = (Number(latest.cash) || 0) + (Number(latest.shortTermInvestments) || 0);
  const netDebt = latestDebt - latestCash;
  const rawEquityValue = enterpriseValue - netDebt;
  const sharesOutstanding = stockData.sharesOutstanding || latest.sharesOutstanding || 0;

  const diagnostics: string[] = [];
  if (isTvCapped) {
    diagnostics.push(`Terminal value capped at 25.0x terminal-year FCFF safeguard (reduced from ${Math.round(rawTerminalValue / (terminalYearFcff || 1))}x).`);
  }

  let status: "valid" | "insufficient_data" | "invalid_inputs" | "calculation_error" = "valid";

  if (!annualFinancials || annualFinancials.length === 0) {
    status = "insufficient_data";
    diagnostics.push("Insufficient financial history for DCF modeling.");
  } else if (!sharesOutstanding || sharesOutstanding <= 0) {
    status = "invalid_inputs";
    diagnostics.push("Shares outstanding is zero or missing.");
  } else if (rawEquityValue <= 0 || !Number.isFinite(rawEquityValue)) {
    status = "calculation_error";
    diagnostics.push(`Calculated equity value is non-positive or non-finite: ${rawEquityValue}`);
  }

  const isValid = status === "valid";
  const equityValue = isValid ? rawEquityValue : 0;
  const dcfIntrinsicPerShare = isValid && sharesOutstanding > 0 ? equityValue / sharesOutstanding : null;
  const intrinsicValue = dcfIntrinsicPerShare !== null ? Math.round(dcfIntrinsicPerShare * 100) / 100 : 0;
  const fairValuePerShare = dcfIntrinsicPerShare !== null ? Math.round(dcfIntrinsicPerShare * 100) / 100 : null;

  const cmp = stockData.currentPrice;
  const rec = calculateRecommendation(cmp, fairValuePerShare);
  const upsideDownside = rec.upside !== null ? rec.upside : 0;
  const verdict = rec.rating;

  const reverseDCF = computeReverseDCF({
    currentMarketPrice: cmp,
    sharesOutstanding,
    netDebt,
    latestRevenue: latest.revenue,
    baseEbitMargin: assumptions.ebitMargins[0] || 0.15,
    wacc,
    terminalGrowthRate: tg,
    marginalTaxRate: taxRate,
    modelBaseGrowthRate: baseGrowth,
    avgCapexPct,
    avgDeptPct,
    avgNwcChangePct,
  });

  return {
    status,
    diagnostics,
    assumptions,
    projections,
    sumPvFcff,
    terminalYearFcff,
    terminalValue,
    pvTerminalValue,
    terminalValueCapped: isTvCapped,
    unadjustedTerminalValue: rawTerminalValue,
    enterpriseValue,
    totalDebt: latestDebt,
    cashAndEquiv: latestCash,
    netDebt,
    lessDebt: Math.max(0, netDebt),
    plusCash: Math.max(0, -netDebt),
    equityValue,
    sharesOutstanding,
    intrinsicValue,
    fairValuePerShare,
    currentMarketPrice: cmp,
    upsideDownside,
    verdict,
    reverseDCF,
  };
}

// ─────────────────────────────────────────────
// Formatting helpers
// ─────────────────────────────────────────────
export function formatCurrency(
  value: number,
  currency = "USD",
  short = false
): string {
  const abs = Math.abs(value);
  let divisor = 1;
  let suffix = "";

  if (short) {
    if (currency === "INR") {
      if (abs >= 1e7) { divisor = 1e7; suffix = " Cr"; }
      else if (abs >= 1e5) { divisor = 1e5; suffix = " L"; }
    } else {
      if (abs >= 1e9) { divisor = 1e9; suffix = "B"; }
      else if (abs >= 1e6) { divisor = 1e6; suffix = "M"; }
      else if (abs >= 1e3) { divisor = 1e3; suffix = "K"; }
    }
  }

  const formatted = (value / divisor).toFixed(1);
  const sym = currency === "INR" ? "₹" : currency === "USD" ? "$" : currency === "GBP" ? "£" : currency === "EUR" ? "€" : "";
  return `${sym}${formatted}${suffix}`;
}

export function formatPct(value: number, decimals = 1): string {
  return `${(value * 100).toFixed(decimals)}%`;
}

export function formatNum(value: number, decimals = 2): string {
  return value.toFixed(decimals);
}

export function formatLargeNum(value: number, currency = "USD"): string {
  return formatCurrency(value, currency, true);
}
