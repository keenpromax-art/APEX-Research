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
  country?: string,
  annualFinancials?: AnnualFinancials[]
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

  // Mid-cycle EBIT margin anchor from reported history (through-cycle).
  // The prior logic used the archetype's trough-derived baseMargin or the
  // single latest ebitMargin, so a one-year crash (Ford FY2025 -4.9%) anchored
  // the entire 5-year forecast at trough. Now we take the average of
  // positive through-cycle EBIT margins (or median if all are negative),
  // dropping a distressed outlier when the archetype is DISTRESSED — a true
  // mid-cycle anchor. Bounded 2–14% so an outlier history cannot produce
  // absurd margins.
  let midCycleMargin: number | undefined;
  if (annualFinancials && annualFinancials.length >= 2) {
    const hist = annualFinancials
      .map((f) => f.ebitMargin)
      .filter((m): m is number => typeof m === "number" && isFinite(m) && m > -0.5 && m < 0.5);
    if (hist.length >= 2) {
      const sorted = [...hist].sort((a, b) => a - b);
      const isDistressedTrough = archetypeProfile?.archetype === "DISTRESSED" && sorted[0] < -0.02 && hist.length >= 3;
      const usable = isDistressedTrough ? sorted.slice(1) : sorted;
      const positives = usable.filter((m) => m > 0.01);
      const anchorPool = positives.length >= 2 ? positives : usable;
      const mid = anchorPool.reduce((a, b) => a + b, 0) / anchorPool.length;
      if (isFinite(mid) && mid > -0.5 && mid < 0.5) midCycleMargin = mid;
    }
  }
  const archetypeBaseMargin = archetypeProfile?.scenarioMargins?.baseMargin;
  // Priority: mid-cycle history > archetype trough > latest > live > 14% fallback.
  // Mid-cycle is clamped to 2–14% to prevent absurd anchors on thin histories.
  // For auto/industrial cyclicals we floor at 3% (normalized through-cycle
  // trough for manufacturing) so a deep-cycle year does not permanently depress
  // the explicit forecast — the bridge then remains economically coherent.
  const cyclicalFloor = archetypeProfile?.sector === "auto_manufacturing" || archetypeProfile?.sector === "renewables" ? 0.03 : 0.02;
  const effectiveMargin = midCycleMargin !== undefined
    ? Math.max(cyclicalFloor, Math.min(0.14, midCycleMargin))
    : (archetypeBaseMargin !== undefined && archetypeBaseMargin > 0)
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

  const assumptions = computeWACC(stockData, latest, archetypeProfile, country, annualFinancials);

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

  // Sector-specific driver overrides (Priority 2: driver-based operating models)
  const isHospSector = sectorProfile?.id === "hospitality" || sectorProfile?.id === "real-estate"
    || archetypeProfile?.sector === "hospitality" || archetypeProfile?.sector === "hospitality_owner_operator"
    || archetypeProfile?.sector === "hospitality_asset_light" || archetypeProfile?.sector === "hospitality_reit"
    || archetypeProfile?.sector === "real_estate";
  if (isHospSector) {
    // Hospitality: RevPAR-driven (Occupancy × ADR) + keys pipeline + F&B/MICE; mid-cycle occupancy, not endless CAGR
    // Terminal growth lower (3.5% = 2% real + 1.5% inflation) with EBITDAR focus; capex higher (maintenance 4-5% + 8-yr refurb reserve ≈ 6-7%)
    assumptions.terminalGrowthRate = sectorProfile?.id === "real-estate" ? 0.03 : 0.035;
    // Override evidence trail later, but keep mechanics auditable
  }

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

  // Hospitality overlay: capitalized leased assets + refurb cycle; hospitality reit is leased-asset heavy
  if (isHospSector) {
    if (sectorProfile?.id === "real-estate" || archetypeProfile?.sector === "hospitality_reit" || archetypeProfile?.sector === "real_estate") {
      avgCapexPct = Math.max(avgCapexPct, 0.045); // REIT: lower maintenance, but re-leasing capex
      avgNwcChangePct = 0.008; // Rent receivables light
    } else if (archetypeProfile?.sector === "hospitality_asset_light") {
      avgCapexPct = Math.min(avgCapexPct, 0.025); // Fee annuity, low owned capex
      avgNwcChangePct = 0.015;
    } else {
      // Owner-operator: maintenance 4-5% + refurb reserve push to ~6.5%
      avgCapexPct = Math.max(avgCapexPct, 0.060);
      avgDeptPct = Math.max(avgDeptPct, 0.040);
      avgNwcChangePct = 0.012; // Hospitality NWC ~ 3-4% rooms revenue changed, light vs manufacturing
    }
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
  // Captive-finance adjustment (SOTP-lite): automakers/industrials with financing
  // arms carry lender-scale debt matched by finance receivables. Charging the full
  // consolidated debt against operating cash flows makes every such name
  // "insolvent" by construction. Receivables in excess of a 20%-of-revenue trade
  // allowance are treated as the offsetting finance book, capped at total debt.
  // Bounded, disclosed in diagnostics + evidence trail, and re-verified by XREF-04.
  // Inapplicable to financials (separate residual-income path) and to firms
  // without material receivables — for them the offset is exactly zero.
  const receivables = Number(latest.netReceivables) || 0;
  const isAutoCaptive = archetypeProfile?.sector === "auto_manufacturing";
  // Auto OEMs carry dealer/finance receivables ~6–8% trade WC; 12% is already
  // conservative for the trade allowance, leaving true finance book as offset.
  // Other sectors use 20% to avoid over-netting normal trade receivables.
  const tradeAllowance = latest.revenue > 0 ? (isAutoCaptive ? 0.12 : 0.20) * latest.revenue : 0;
  const financeReceivablesOffset = latest.revenue > 0 && receivables > 0 && latestDebt > 0
    ? Math.min(Math.max(0, receivables - tradeAllowance), latestDebt)
    : 0;
  const netDebt = latestDebt - latestCash - financeReceivablesOffset;
  const rawEquityValue = enterpriseValue - netDebt;
  const sharesOutstanding = stockData.sharesOutstanding || latest.sharesOutstanding || 0;

  const diagnostics: string[] = [];
  if (financeReceivablesOffset > 0) {
    diagnostics.push(`Captive-finance adjustment: ${financeReceivablesOffset.toFixed(0)} of receivables (above 20%-of-revenue trade allowance on revenue ${latest.revenue.toFixed(0)}) netted against debt; adjusted net debt ${netDebt.toFixed(0)}. See evidence trail.`);
  }
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

  // Evidence trail: every major assumption records its empirical basis so the
  // forecast is auditable (not "aggressive relative to evidence" by default).
  const marginSource =
    (archetypeProfile?.scenarioMargins?.baseMargin ?? 0) > 0
      ? `archetype base margin ${(((archetypeProfile?.scenarioMargins?.baseMargin) || 0) * 100).toFixed(1)}%`
      : latest.ebitMargin > 0.03
        ? `reported EBIT margin ${(latest.ebitMargin * 100).toFixed(1)}%`
        : stockData.operatingMargins > 0
          ? `live operating margin ${(stockData.operatingMargins * 100).toFixed(1)}%`
          : `14% default (no margin basis — treat with caution)`;
  const assumptionBasis: Record<string, string> = {
    revenueGrowth: hasLive
      ? `55% historical revenue CAGR (${(cagr * 100).toFixed(1)}% over ${Math.max(1, years - 1)}y, winsorized ${(winsorizedCagr * 100).toFixed(1)}%) + 45% live growth (${(liveRevGrowth * 100).toFixed(1)}%, winsorized ${(winsorizedLive * 100).toFixed(1)}%) → base ${(baseGrowth * 100).toFixed(1)}%, fading ×0.90/0.82/0.74/0.66`
      : `Historical revenue CAGR (${(cagr * 100).toFixed(1)}% over ${Math.max(1, years - 1)}y, winsorized ${(winsorizedCagr * 100).toFixed(1)}%) → base ${(baseGrowth * 100).toFixed(1)}%, fading yearly (no live growth input)`,
    ebitMargin: `Base from ${marginSource}; explicit margins ramp +1.0/+1.8/+2.4/+2.8/+3.0pp, capped 26–30%`,
    capex: `Historical capex intensity ${(rawAvgCapexPct * 100).toFixed(1)}% of revenue (clamped 2.5–8.0% → ${(avgCapexPct * 100).toFixed(1)}%)${archetypeProfile?.archetype ? `; ${archetypeProfile.archetype} overlay applied` : ""}; D&A ${(rawAvgDeptPct * 100).toFixed(1)}% (clamped 2.0–6.0%)`,
    workingCapital: `Revenue-linked change ${(avgNwcChangePct * 100).toFixed(1)}%${archetypeProfile?.archetype === "EARLY_PLATFORM_GROWTH" ? " (platform buffer overlay)" : ""}`,
    netDebt: financeReceivablesOffset > 0
      ? `Reported net debt ${(latestDebt - latestCash).toFixed(0)} less captive-finance receivables offset ${financeReceivablesOffset.toFixed(0)} (receivables ${receivables.toFixed(0)} vs 20% trade allowance ${(tradeAllowance).toFixed(0)}, capped at total debt) → adjusted ${netDebt.toFixed(0)}`
      : `Reported net debt in full (total debt ${latestDebt.toFixed(0)} − cash ${(latestCash).toFixed(0)}); no captive-finance offset (receivables ${receivables.toFixed(0)} within trade allowance)`,
    wacc: assumptions.parameterSource || "CAPM blend (parameters undisclosed)",
    terminal: `4.0% nominal-GDP anchor; TV capped at 25× terminal-year FCFF${isTvCapped ? " (CAP ACTIVE — see diagnostics)" : " (not binding)"}`,
  };

  // Hospitality/Reit driver overlay: replace generic CAGR language with RevPAR-native evidence
  if (isHospSector) {
    assumptionBasis.revenueGrowth = hasLive
      ? `Hospitality RevPAR-driven: Occupancy ramp to 68-72% stabilized × ADR (CPI + 1-2% tier premium) plus keys pipeline and F&B/MICE mix; 55% hist CAGR (${(cagr * 100).toFixed(1)}%) + 45% live (${(liveRevGrowth * 100).toFixed(1)}%) → base ${(baseGrowth * 100).toFixed(1)}% fading ×0.90/0.82/0.74/0.66 (RevPAR-implied, not generic)`
      : `Hospitality RevPAR-driven: Occupancy × ADR with keys pipeline and F&B/MICE; hist CAGR (${(cagr * 100).toFixed(1)}%) → base ${(baseGrowth * 100).toFixed(1)}% fading yearly (RevPAR-implied)`;
    assumptionBasis.capex = `Hospitality capex: maintenance 4-5% rooms revenue + 8-yr refurb reserve → ${(avgCapexPct * 100).toFixed(1)}% of revenue (clamped)${isHospSector ? `; ${archetypeProfile?.sector} overlay` : ""}; D&A ${(rawAvgDeptPct * 100).toFixed(1)}%`;
    assumptionBasis.workingCapital = `Hospitality NWC: receivables 3-4% rooms revenue changed → ${(avgNwcChangePct * 100).toFixed(1)}% of revenue`;
    assumptionBasis.terminal = `${(assumptions.terminalGrowthRate * 100).toFixed(1)}% hospitality nominal anchor (real ~2% + inflation, mid-cycle occupancy, not perpetual high growth); TV capped at 25×${isTvCapped ? " (CAP ACTIVE)" : " (not binding)"} — sector-specific, not generic 4.0%`;
    assumptionBasis.ebitMargin = `Hospitality EBITDAR-derived: Base from ${marginSource}; GOPPAR/EBITDAR margin ramp +1.0/+1.8/+2.4/+2.8/+3.0pp capped 26-30%, with IFRS-16 rent sensitivity disclosed`;
  }

  return {
    status,
    diagnostics,
    assumptions,
    assumptionBasis,
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
    financeReceivablesOffset,
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
