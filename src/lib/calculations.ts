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
import { computeDriverForecast } from "./driver-models";
import { resolveShareCount } from "./financial-provenance";
import {
  guardedDiv,
  canonicalCAGR,
  canonicalMargin,
  computeFCFF,
  discountFactor as kernelDiscountFactor,
  gordonTerminalValue,
  WACCFormulaEngine,
  ProvenanceTrail,
  type WACCInputs,
  type DenominatorState,
} from "./financial-kernel";

const safe = (n: number, d = 0) =>
  isFinite(n) && !isNaN(n) ? n : d;

function div(a: number, b: number) {
  return b !== 0 ? a / b : 0;
}

/** Numeric value out of a kernel scalar (identical to legacy div/safe results). */
const kval = (s: { value: number }) => s.value;

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

  // Profitability — every division routes through the kernel denominator
  // state machine (numerics bit-identical to legacy div/safe; validity is
  // exposed separately via computeRatioValidity, never silently valid).
  const grossMargin = kval(canonicalMargin(grossProfit, revenue, "gross"));
  const ebitdaMargin = kval(canonicalMargin(ebitda, revenue, "ebitda"));
  const ebitMargin = kval(canonicalMargin(operatingIncome, revenue, "ebit"));
  const netMargin = kval(canonicalMargin(netIncome, revenue, "net"));
  const roe = kval(guardedDiv(netIncome, totalEquity, { label: "netIncome/totalEquity" }));
  const roa = kval(guardedDiv(netIncome, totalAssets, { label: "netIncome/totalAssets" }));
  const capitalEmployed = totalAssets - currentLiabilities;
  const roce = kval(guardedDiv(operatingIncome, capitalEmployed, { label: "operatingIncome/capitalEmployed" }));

  // Efficiency
  const assetTurnover = kval(guardedDiv(revenue, totalAssets, { label: "revenue/totalAssets" }));
  const fixedAssetTurnover = kval(guardedDiv(revenue, netFixedAssets > 0 ? netFixedAssets : 1, { label: "revenue/netFixedAssets" }));
  const wcTurnover = kval(guardedDiv(revenue, netWorkingCapital !== 0 ? netWorkingCapital : 1, { label: "revenue/netWorkingCapital" }));
  const invTurnover = kval(guardedDiv(revenue, inventory > 0 ? inventory : 1, { label: "revenue/inventory" }));
  const arTurnover = kval(guardedDiv(revenue, netReceivables > 0 ? netReceivables : 1, { label: "revenue/netReceivables" }));

  // Leverage
  const debtToEquity = kval(guardedDiv(totalDebt, totalEquity, { label: "totalDebt/totalEquity" }));
  const equityMultiplier = kval(guardedDiv(totalAssets, totalEquity, { label: "totalAssets/totalEquity" }));
  const interestCoverage = kval(guardedDiv(operatingIncome, interestExpense > 0 ? interestExpense : 0.001, { label: "operatingIncome/interestExpense" }));
  const netDebt = totalDebt - cash;
  const netDebtToEbitda = kval(guardedDiv(netDebt, ebitda > 0 ? ebitda : 0.001, { label: "netDebt/ebitda" }));
  const totalDebtToAssets = kval(guardedDiv(totalDebt, totalAssets, { label: "totalDebt/totalAssets" }));
  const currentRatio = kval(guardedDiv(currentAssets, currentLiabilities > 0 ? currentLiabilities : 1, { label: "currentAssets/currentLiabilities" }));
  const quickRatio = kval(guardedDiv(currentAssets - inventory, currentLiabilities > 0 ? currentLiabilities : 1, { label: "quickAssets/currentLiabilities" }));

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

export interface RatioValidity {
  validity: DenominatorState;
  /** Machine-readable reason, e.g. NEGATIVE_DENOMINATOR:totalEquity<0. */
  reason: string;
  /** Presentation directive — N_M renders N/M, never the number. */
  display: "VALUE" | "N_M";
  /** True when the numeric field was synthesized for lack of a share base. */
  imputedShareBase: boolean;
}

export type RatioValidityMap = Record<string, RatioValidity>;

const _v = (s: { validity: DenominatorState; reason: string; display: "VALUE" | "N_M" }, imputedShareBase = false): RatioValidity => ({
  validity: s.validity,
  reason: s.reason,
  display: s.display,
  imputedShareBase,
});

/**
 * Validity sidecar for computeRatios (P0 #7, #8, #21).
 * Numbers stay in `Ratios`; trust lives HERE. Negative/zero denominators
 * (negative equity, zero revenue/shares) yield N_M — a −478% ROE on
 * distressed equity can never again present as a valid measurement.
 * Valuation multiples additionally record whether the share base was
 * imputed (MISSING discipline: imputed ≠ reported).
 */
export function computeRatioValidity(fin: AnnualFinancials, cmp: number): RatioValidityMap {
  const {
    revenue, grossProfit, ebitda, operatingIncome, netIncome, totalEquity,
    totalAssets, totalDebt, cash, netFixedAssets, netWorkingCapital,
    currentAssets, currentLiabilities, netReceivables, inventory,
    interestExpense, dividendsPaid, eps, sharesOutstanding,
  } = fin;
  const out: RatioValidityMap = {};
  const rec = (key: string, s: { validity: DenominatorState; reason: string; display: "VALUE" | "N_M" }, imputed = false) => { out[key] = _v(s, imputed); };
  rec("grossMargin", canonicalMargin(grossProfit, revenue, "gross"));
  rec("ebitdaMargin", canonicalMargin(ebitda, revenue, "ebitda"));
  rec("ebitMargin", canonicalMargin(operatingIncome, revenue, "ebit"));
  rec("netMargin", canonicalMargin(netIncome, revenue, "net"));
  rec("roe", guardedDiv(netIncome, totalEquity, { label: "netIncome/totalEquity" }));
  rec("roa", guardedDiv(netIncome, totalAssets, { label: "netIncome/totalAssets" }));
  rec("roce", guardedDiv(operatingIncome, totalAssets - currentLiabilities, { label: "operatingIncome/capitalEmployed" }));
  rec("assetTurnover", guardedDiv(revenue, totalAssets, { label: "revenue/totalAssets" }));
  rec("fixedAssetTurnover", guardedDiv(revenue, netFixedAssets, { label: "revenue/netFixedAssets" }));
  rec("workingCapitalTurnover", guardedDiv(revenue, netWorkingCapital, { label: "revenue/netWorkingCapital" }));
  rec("inventoryTurnover", guardedDiv(revenue, inventory, { label: "revenue/inventory" }));
  rec("receivablesTurnover", guardedDiv(revenue, netReceivables, { label: "revenue/netReceivables" }));
  rec("debtToEquity", guardedDiv(totalDebt, totalEquity, { label: "totalDebt/totalEquity" }));
  rec("equityMultiplier", guardedDiv(totalAssets, totalEquity, { label: "totalAssets/totalEquity" }));
  rec(
    "interestCoverage",
    (interestExpense || 0) <= 0
      ? { validity: "NM" as DenominatorState, reason: "NO_DEBT:no-interest-expense", display: "N_M" as const }
      : guardedDiv(operatingIncome, interestExpense, { label: "operatingIncome/interestExpense" })
  );
  rec("netDebtToEbitda", guardedDiv(totalDebt - cash, ebitda, { label: "netDebt/ebitda" }));
  rec("totalDebtToAssets", guardedDiv(totalDebt, totalAssets, { label: "totalDebt/totalAssets" }));
  rec("currentRatio", guardedDiv(currentAssets, currentLiabilities, { label: "currentAssets/currentLiabilities" }));
  rec("quickRatio", guardedDiv(currentAssets - inventory, currentLiabilities, { label: "quickAssets/currentLiabilities" }));
  // Valuation multiples are per-share constructs: no share base ⇒ MISSING.
  const imputed = !(sharesOutstanding > 0);
  const noBase = { validity: "NM" as DenominatorState, reason: "MISSING:sharesOutstanding≤0", display: "N_M" as const };
  rec("pe", (eps || 0) > 0 && cmp > 0 && !imputed ? { validity: "VALID" as DenominatorState, reason: "OK:cmp/eps", display: "VALUE" as const } : ((eps || 0) <= 0 ? { validity: "NM" as DenominatorState, reason: "NON_POSITIVE_EARNINGS:eps≤0", display: "N_M" as const } : noBase), imputed);
  rec("evToEbitda", (ebitda || 0) > 0 && !imputed ? { validity: "VALID" as DenominatorState, reason: "OK:ev/ebitda", display: "VALUE" as const } : ((ebitda || 0) <= 0 ? { validity: "NEGATIVE" as DenominatorState, reason: "NEGATIVE_DENOMINATOR:ebitda≤0", display: "N_M" as const } : noBase), imputed);
  rec("pb", !imputed ? guardedDiv(cmp * (sharesOutstanding || 0), totalEquity, { label: "marketCap/totalEquity" }) : noBase, imputed);
  rec("ps", !imputed ? guardedDiv(cmp * (sharesOutstanding || 0), revenue, { label: "marketCap/revenue" }) : noBase, imputed);
  rec("bookValuePerShare", !imputed ? guardedDiv(totalEquity, sharesOutstanding || 0, { label: "totalEquity/shares" }) : noBase, imputed);
  rec("dividendYield", cmp > 0 && !imputed ? { validity: "VALID" as DenominatorState, reason: "OK:dps/cmp", display: "VALUE" as const } : noBase, imputed);
  rec("dividendPayout", (netIncome || 0) > 0 ? guardedDiv(dividendsPaid, netIncome, { label: "dividends/netIncome" }) : noBase, imputed);
  return out;
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

export interface WACCInputProvenance {
  beta: string;
  weights: string;
  country: string;
  spread: string;
  clamp: string;
}

/**
 * Input SOURCING for WACC (P0 #15 — methodology quarantined from formula).
 * Every input records where it came from, including fallbacks, so the
 * formula engine below can stay pure. Numeric outcomes are unchanged.
 */
export function sourceWACCInputs(
  stockData: StockData,
  fin: AnnualFinancials,
  archetypeProfile?: ArchetypeProfile,
  country?: string,
  annualFinancials?: AnnualFinancials[]
): { inputs: WACCInputs; beta: number; distressSpread: number; provenance: WACCInputProvenance; countryLabel: string } {
  const cp = resolveCountryParams(country);
  const riskFreeRate = cp.riskFreeRate;
  const equityRiskPremium = cp.equityRiskPremium;

  // Item 8: Sanity range check on beta before WACC calculation
  // Reject or clamp implausible-but-finite values (outside [0.35, 2.50])
  let rawBeta = stockData.beta;
  let betaNote: string;
  if (rawBeta === undefined || rawBeta === null || !Number.isFinite(rawBeta) || rawBeta <= 0) {
    rawBeta = 0.85;
    betaNote = "missing/invalid beta → 0.85 default (ASSUMPTION, not market-measured)";
  } else if (rawBeta < 0.35) {
    rawBeta = 0.35;
    betaNote = "beta clamped to 0.35 floor";
  } else if (rawBeta > 2.50) {
    rawBeta = 2.50;
    betaNote = "beta clamped to 2.50 cap";
  } else {
    betaNote = "reported beta, Blume-adjusted";
  }
  // Blume adjustment towards market portfolio mean of 1.0
  const blumeBeta = 0.67 * rawBeta + 0.33 * 1.0;
  const beta = Math.max(0.5, Math.min(1.8, Number(blumeBeta.toFixed(3))));

  // Resolved share base (market-cap cross-checked) so WACC weights agree with the DCF/ledger per-share base.
  const waccShares = (() => {
    try {
      const r = resolveShareCount({ stockData, annualFinancials: annualFinancials && annualFinancials.length > 0 ? annualFinancials : [fin] });
      if (r.shares > 0) return r.shares;
    } catch { /* fall through to legacy priority */ }
    return stockData.sharesOutstanding || fin.sharesOutstanding || 1;
  })();
  const totalMktCap = (stockData.currentPrice || 1) * waccShares;
  const totalDebtVal = fin.totalDebt || 0;
  const totalValue = totalMktCap + totalDebtVal;
  const equityWeight = totalValue > 0 ? totalMktCap / totalValue : 0.95;
  const debtWeight = 1 - equityWeight;

  // Item 6: Sector / Archetype classification feeds into WACC risk spreads
  let distressSpread = 0.0;
  let spreadNote = "no archetype spread";
  if (archetypeProfile?.archetype === "DISTRESSED") {
    distressSpread = 0.020; // +200 bps distress risk premium for highly levered / restructuring firms
    spreadNote = "+200bps DISTRESSED archetype spread (ASSUMPTION)";
  } else if (archetypeProfile?.archetype === "EARLY_PLATFORM_GROWTH") {
    distressSpread = 0.015; // +150 bps platform cash-burn risk premium
    spreadNote = "+150bps EARLY_PLATFORM_GROWTH spread (ASSUMPTION)";
  }

  return {
    inputs: {
      riskFreeRate,
      equityRiskPremium,
      beta,
      preTaxCostOfDebt: cp.costOfDebtPreTax,
      marginalTaxRate: cp.marginalTaxRate,
      equityWeight,
    },
    beta,
    distressSpread,
    provenance: {
      beta: `${betaNote}; effective beta ${beta.toFixed(3)} after Blume 0.67/0.33 and [0.5, 1.8] clamp`,
      weights: `market-cap weights from price ${stockData.currentPrice} × resolved shares ${waccShares.toFixed(0)} vs debt ${totalDebtVal.toFixed(0)}`,
      country: `Country CAPM table v2026-09 (${cp.label})`,
      spread: spreadNote,
      clamp: "WACC clamped to [8.5%, 16%] institutional band",
    },
    countryLabel: cp.label,
  };
}

export function computeWACC(
  stockData: StockData,
  fin: AnnualFinancials,
  archetypeProfile?: ArchetypeProfile,
  country?: string,
  annualFinancials?: AnnualFinancials[]
): DCFAssumptions {
  const cp = resolveCountryParams(country);
  const sourced = sourceWACCInputs(stockData, fin, archetypeProfile, country, annualFinancials);
  const { inputs, beta, distressSpread, provenance } = sourced;
  const riskFreeRate = inputs.riskFreeRate;
  const equityRiskPremium = inputs.equityRiskPremium;
  // Pure formula engine (P0 #15): identical arithmetic, independently re-solvable.
  const formula = WACCFormulaEngine.compute(inputs);
  const costOfEquity = formula.costOfEquity;
  const costOfDebtPreTax = cp.costOfDebtPreTax;
  const marginalTaxRate = cp.marginalTaxRate;
  const costOfDebtPostTax = formula.costOfDebtPostTax;
  const debtWeight = formula.debtWeight;
  const equityWeight = formula.equityWeight;

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
    inputProvenance: { ...provenance },
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

  // Compute historical revenue CAGR via the universal kernel primitive
  // (P0 #5 — identical mathematics; validity tracked, never asserted).
  const years = annualFinancials.length;
  const firstRev = annualFinancials[0]?.revenue || 1;
  const lastRev = latest.revenue;
  const cagrScalar = years > 1
    ? canonicalCAGR(firstRev || 1, lastRev, years - 1)
    : { value: 0.15, validity: "NM" as DenominatorState, reason: "INSUFFICIENT_HISTORY:single-period-default-15%", display: "N_M" as const };
  const cagr = cagrScalar.display === "VALUE" ? cagrScalar.value : 0.15;

  const assumptions = computeWACC(stockData, latest, archetypeProfile, country, annualFinancials);

  // Item 5: Winsorized blend of live revenue growth and historical CAGR
  const liveRevGrowth = stockData.revenueGrowth;
  const hasLive = Number.isFinite(liveRevGrowth) && liveRevGrowth !== 0;
  const winsorizedLive = Math.max(0.04, Math.min(0.35, hasLive ? liveRevGrowth : cagr));
  const winsorizedCagr = Math.max(0.04, Math.min(0.30, cagr > 0 ? cagr : 0.14));
  const baseGrowth = hasLive
    ? 0.55 * winsorizedCagr + 0.45 * winsorizedLive
    : winsorizedCagr;

  // Priority 3: sector/segment driver forecast (replaces single generic CAGR).
  // Base growth stays winsorized history+live; shape, margins, capex, terminal
  // are driver-native per business type (auto volume×ASP, hospitality Occ×ADR,
  // IT utilization×realization, platform DAU×price-per-ad, etc.).
  const nonZeroRevCount = annualFinancials.filter(f => f.revenue > 0).length || 1;
  const rawAvgCapexPct =
    annualFinancials.reduce((s, f) => s + (f.revenue > 0 ? f.capitalExpenditures / f.revenue : 0), 0) /
    nonZeroRevCount;
  const rawAvgDeptPct =
    annualFinancials.reduce((s, f) => s + (f.revenue > 0 ? f.depreciation / f.revenue : 0), 0) /
    nonZeroRevCount;
  // effectiveMargin mirrors computeWACC's mid-cycle anchor (first explicit margin minus 1pp ramp).
  const effectiveMarginSeed = (assumptions.ebitMargins?.[0] ?? 0.14) - 0.01;
  const sectorIdForDrivers = sectorProfile?.id ?? "general";
  const driver = computeDriverForecast({
    sectorId: sectorIdForDrivers,
    operatingArchetype: archetypeProfile?.sector ?? "general_industrial",
    inputs: {
      cagr,
      winsorizedCagr,
      winsorizedLive,
      baseGrowth,
      hasLive,
      liveRevGrowth: hasLive ? liveRevGrowth : cagr,
      years,
      effectiveMargin: effectiveMarginSeed,
      rawAvgCapexPct,
      rawAvgDeptPct,
    },
  });
  assumptions.revenueGrowthRates = driver.revenueGrowthRates;
  assumptions.ebitMargins = driver.ebitMargins;
  assumptions.terminalGrowthRate = driver.terminalGrowthRate;

  const isHospSector = sectorProfile?.id === "hospitality" || sectorProfile?.id === "real-estate"
    || archetypeProfile?.sector === "hospitality" || archetypeProfile?.sector === "hospitality_owner_operator"
    || archetypeProfile?.sector === "hospitality_asset_light" || archetypeProfile?.sector === "hospitality_reit"
    || archetypeProfile?.sector === "real_estate";

  let avgCapexPct = driver.avgCapexPct;
  let avgDeptPct = driver.avgDeptPct;
  let avgNwcChangePct = driver.avgNwcChangePct;

  if (archetypeProfile?.archetype === "CYCLICAL_CAPITAL_INTENSIVE") {
    avgCapexPct = Math.max(avgCapexPct, 0.065); // High capex cycle absorption
  } else if (archetypeProfile?.archetype === "EARLY_PLATFORM_GROWTH") {
    avgCapexPct = Math.min(avgCapexPct, 0.030); // Asset-light platform
    avgNwcChangePct = Math.max(avgNwcChangePct, 0.035); // Customer acquisition / inventory buffer
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
    // Universal FCFF kernel (P0 #12 — identical arithmetic, formula-tagged).
    const fcff = computeFCFF({ nopat, depreciation, capex, changeInWorkingCapital });
    // Kernel mid-year discount (P0 #13 — bit-identical to legacy convention).
    const discountFactor = kernelDiscountFactor(wacc, i);
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
  // Gordon terminal value via the kernel (P0 #13, #14 — identical math plus
  // explicit spread enforcement, 25× cap, and implied-margin sanity).
  const tvResult = gordonTerminalValue({
    terminalYearFcff,
    wacc,
    terminalGrowth: tg,
    terminalRevenue: projections[4].revenue,
    marginalTaxRate: taxRate,
  });
  const rawTerminalValue = tvResult.unadjustedTerminalValue;
  const isTvCapped = tvResult.capped;
  const terminalValue = tvResult.terminalValue;
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
  // Priority 2: resolved share base (market-cap cross-checked; partial-class
  // quote feeds lose) so model and ledger divide by the SAME count.
  const sharesOutstanding = resolveShareCount({ stockData, annualFinancials }).shares;

  const diagnostics: string[] = [];
  if (financeReceivablesOffset > 0) {
    diagnostics.push(`Captive-finance adjustment: ${financeReceivablesOffset.toFixed(0)} of receivables (above 20%-of-revenue trade allowance on revenue ${latest.revenue.toFixed(0)}) netted against debt; adjusted net debt ${netDebt.toFixed(0)}. See evidence trail.`);
  }
  if (isTvCapped) {
    diagnostics.push(`Terminal value capped at 25.0x terminal-year FCFF safeguard (reduced from ${Math.round(rawTerminalValue / (terminalYearFcff || 1))}x).`);
  }
  // Kernel terminal-guard diagnostics (spread enforcement, margin sanity).
  for (const d of tvResult.diagnostics) {
    if (!diagnostics.some((x) => x.includes("Terminal value capped") && d.includes("capped at"))) diagnostics.push(d);
  }
  // TV-concentration flag: a valuation that is almost entirely terminal value
  // is a perpetuity bet, not a 5-year forecast — disclosed, never silent.
  if (enterpriseValue > 0 && pvTerminalValue / enterpriseValue > 0.85) {
    diagnostics.push(
      `Terminal value is ${((pvTerminalValue / enterpriseValue) * 100).toFixed(0)}% of enterprise value — valuation is terminal-driven; treat explicit-period precision accordingly.`
    );
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
    revenueGrowth: `${driver.driverEquation}; 55% hist CAGR (${(cagr * 100).toFixed(1)}% over ${Math.max(1, years - 1)}y, winsorized ${(winsorizedCagr * 100).toFixed(1)}%) + 45% live (${hasLive ? `${(liveRevGrowth * 100).toFixed(1)}%, winsorized ${(winsorizedLive * 100).toFixed(1)}%` : "n/a"}) → base ${(baseGrowth * 100).toFixed(1)}% driver-shaped fade`,
    ebitMargin: `Driver-shaped (${sectorIdForDrivers}): base from ${marginSource}; explicit path ${driver.ebitMargins.map((m) => `${(m * 100).toFixed(1)}%`).join(" → ")}`,
    capex: `Driver capex ${(avgCapexPct * 100).toFixed(1)}% of revenue (hist ${(rawAvgCapexPct * 100).toFixed(1)}% clamped 2.5–8.0%)${archetypeProfile?.archetype ? `; ${archetypeProfile.archetype} overlay` : ""}; D&A ${(rawAvgDeptPct * 100).toFixed(1)}% (clamped 2.0–6.0%)`,
    workingCapital: `Driver NWC change ${(avgNwcChangePct * 100).toFixed(1)}% of revenue (revenue-linked, sector-calibrated for ${sectorIdForDrivers})${archetypeProfile?.archetype === "EARLY_PLATFORM_GROWTH" ? " with platform buffer overlay" : ""}`,
    netDebt: financeReceivablesOffset > 0
      ? `Reported net debt ${(latestDebt - latestCash).toFixed(0)} less captive-finance receivables offset ${financeReceivablesOffset.toFixed(0)} (receivables ${receivables.toFixed(0)} vs 20% trade allowance ${(tradeAllowance).toFixed(0)}, capped at total debt) → adjusted ${netDebt.toFixed(0)}`
      : `Reported net debt in full (total debt ${latestDebt.toFixed(0)} − cash ${(latestCash).toFixed(0)}); no captive-finance offset (receivables ${receivables.toFixed(0)} within trade allowance)`,
    wacc: assumptions.parameterSource || "CAPM blend (parameters undisclosed)",
    terminal: `${(assumptions.terminalGrowthRate * 100).toFixed(1)}% sector anchor (${sectorIdForDrivers}); TV capped at 25× terminal-year FCFF${isTvCapped ? " (CAP ACTIVE — see diagnostics)" : " (not binding)"}`,
    driverEquation: driver.driverEquation,
  };

  // Structured derivation trail (P0 #20): every bridge value carries its
  // formula id + version, named inputs with source IDs, and transform.
  const trail = new ProvenanceTrail();
  trail.trace("sumPvFcff", "cashflow.fcff", projections.map((p, i) => ({ name: `fcff[Y${i + 1}]`, value: Math.round(p.fcff), sourceId: `dcf.projections[${i}].fcff` })), "mid-year discount Σ fcff×(1+wacc)^-(i+0.5)");
  trail.trace("terminalValue", "valuation.gordonTV", [
    { name: "fcffT", value: Math.round(terminalYearFcff), sourceId: "dcf.projections[4].fcff" },
    { name: "wacc", value: wacc, sourceId: "dcf.assumptions.wacc" },
    { name: "terminalGrowth", value: tg, sourceId: "dcf.assumptions.terminalGrowthRate" },
  ], tvResult.capped ? "Gordon value, 25× terminal-FCFF cap applied" : "Gordon value, uncapped");
  trail.trace("enterpriseValue", "valuation.gordonTV", [
    { name: "sumPvFcff", value: Math.round(sumPvFcff), sourceId: "dcf.sumPvFcff" },
    { name: "pvTerminalValue", value: Math.round(pvTerminalValue), sourceId: "dcf.pvTerminalValue" },
  ], "EV = ΣPV(FCFF) + PV(TV)");
  trail.trace("netDebt", "capital.netDebt", [
    { name: "grossDebt", value: latestDebt, sourceId: "statements.totalDebt" },
    { name: "cash", value: latestCash, sourceId: "statements.cash+shortTermInvestments" },
    { name: "financeReceivablesOffset", value: financeReceivablesOffset, sourceId: "dcf.financeReceivablesOffset" },
  ], "netDebt = grossDebt − cash − verified offset");
  trail.trace("equityValue", "valuation.gordonTV", [
    { name: "enterpriseValue", value: Math.round(enterpriseValue), sourceId: "dcf.enterpriseValue" },
    { name: "netDebt", value: Math.round(netDebt), sourceId: "dcf.netDebt" },
  ], "equity = EV − netDebt");
  trail.trace("intrinsicValue", "valuation.perShare", [
    { name: "equityValue", value: Math.round(equityValue), sourceId: "dcf.equityValue" },
    { name: "dilutedShares", value: sharesOutstanding, sourceId: "marketIntegrity.resolveShareCount" },
  ], "per-share = equity / resolved shares");

  return {
    status,
    diagnostics,
    assumptions,
    assumptionBasis,
    derivationTrail: trail.all(),
    avgCapexPct,
    avgDeptPct,
    avgNwcChangePct,
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
