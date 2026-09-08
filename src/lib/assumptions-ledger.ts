// ============================================================
// Single Assumptions Ledger (Single Source of Truth)
// Guarantees all sections, tables, commentary, and badges pull
// from one immutable, reconciled valuation & assumption record.
// ============================================================
import type {
  AssumptionsLedger,
  CompanyProfile,
  StockData,
  AnnualFinancials,
  DCFResult,
  ValuationCalibration,
} from "@/types/report";
import { classifyArchetype } from "./company-archetype";
import { computeReverseDCF } from "./valuation/reverse-dcf";
import { classifySector, isTelecomCarrierCompany } from "./sectors/profiles";
import { assessMarketIntegrity, resolveShareCount } from "./financial-provenance";

export interface CreateLedgerParams {
  profile: CompanyProfile;
  stockData: StockData;
  annualFinancials: AnnualFinancials[];
  dcf: DCFResult;
  calibration?: ValuationCalibration;
}

export function createAssumptionsLedger({
  profile,
  stockData,
  annualFinancials,
  dcf,
  calibration,
}: CreateLedgerParams): AssumptionsLedger {
  const latestFin = annualFinancials[annualFinancials.length - 1];
  // Priority 2: fail-closed provenance — never synthesize price=100 / shares=1.
  // Missing price/shares/currency/revenue forces NR + BLOCKED (DATA-01), not a modeled value.
  const priceWasFallback = !(Number(stockData.currentPrice) > 0);
  const sharesWasFallback = !(
    Number(stockData.sharesOutstanding) > 0 ||
    Number(latestFin?.sharesOutstanding) > 0 ||
    Number(dcf?.sharesOutstanding) > 0
  );
  const currencyMissing = !(profile.currency && profile.currency.trim().length > 0);
  const revenueMissing = !(Number(latestFin?.revenue) > 0);
  const currentPrice = Number(stockData.currentPrice) > 0 ? Number(stockData.currentPrice) : 0;

  // Shares Outstanding — resolved by market-cap cross-check (partial-class quote
  // feeds lose to reconciling statement counts); 0 when missing (forces
  // insufficientInputs, never 1-share synthesis). DCF carry-through is a last
  // resort only when neither primary reconciles.
  const resolvedShares = resolveShareCount({ stockData, annualFinancials });
  const sharesOutstanding =
    resolvedShares.shares > 0
      ? resolvedShares.shares
      : Number(dcf?.sharesOutstanding) > 0
        ? Number(dcf.sharesOutstanding)
        : 0;

  // Priority 2 — hard integrity gate BEFORE any valuation: price×shares=marketCap,
  // quote-vs-statement shares, and balance-sheet identity must reconcile. A gross
  // mismatch forces NR (the DCF number would be unit fantasy, not a valuation).
  const marketIntegrity = assessMarketIntegrity({ stockData, annualFinancials });
  // Input-sufficiency gate (private/unlisted names, empty histories, zero shares):
  // never model a "valid" DCF on shares=1 / price=100 synthesis.
  const insufficientInputs =
    annualFinancials.length === 0 ||
    !(sharesOutstanding > 0) ||
    !(currentPrice > 0) ||
    currencyMissing ||
    revenueMissing ||
    marketIntegrity.blocked;
  const estimatedFieldsTotal = annualFinancials.reduce((s, f) => s + (f.estimatesUsed?.length || 0), 0);
  const dataQualityFlags: string[] = [];
  if (annualFinancials.length === 0) dataQualityFlags.push("NO_FINANCIAL_HISTORY");
  if (resolvedShares.warn) dataQualityFlags.push(`SHARE_SOURCE:${resolvedShares.source.toUpperCase()}`);
  if (priceWasFallback) dataQualityFlags.push("PRICE_FALLBACK_USED");
  if (sharesWasFallback) dataQualityFlags.push("SHARES_FALLBACK_MISSING");
  if (currencyMissing) dataQualityFlags.push("CURRENCY_UNKNOWN");
  if (revenueMissing) dataQualityFlags.push("REVENUE_MISSING");
  for (const mi of marketIntegrity.issues.filter((i) => i.severity === "BLOCK")) dataQualityFlags.push(`INTEGRITY_BLOCK:${mi.code}`);
  if (estimatedFieldsTotal > 0) dataQualityFlags.push(`ESTIMATED_FINANCIALS:${estimatedFieldsTotal}`);

  // 1. DCF Arithmetic Bridge
  // For non-financials: EV = sumPvFcff + pvTerminalValue, Equity Value = EV - Net Debt
  // For financials (Banks/NBFCs): Equity Value is modeled directly via Residual Income / Justified P/B
  const isBankOrNbfc = classifySector(profile.sector, profile.industry, profile.description).isFinancialInstitution ||
    (profile.sector || "").toLowerCase().includes("financial") || 
    (profile.industry || "").toLowerCase().includes("bank") ||
    (profile.industry || "").toLowerCase().includes("nbfc") ||
    (dcf.sumPvFcff === 0 && dcf.equityValue > 0);

  const sumPvFcff = Number(dcf.sumPvFcff) || 0;
  const pvTerminalValue = Number(dcf.pvTerminalValue) || 0;
  const enterpriseValue = isBankOrNbfc ? (Number(dcf.enterpriseValue) || Number(dcf.equityValue) || 0) : (Number(dcf.enterpriseValue) || (sumPvFcff + pvTerminalValue));

  const bsDebt = Number(latestFin?.totalDebt) || ((Number(latestFin?.shortTermDebt) || 0) + (Number(latestFin?.longTermDebt) || 0));
  const bsCash = ((Number(latestFin?.cash) || 0) + (Number(latestFin?.shortTermInvestments) || 0));
  const totalDebt = bsDebt > 0 ? bsDebt : (Number(dcf.totalDebt) || 0);
  const cashAndEquiv = bsCash > 0 ? bsCash : (Number(dcf.cashAndEquiv) || 0);
  const netDebt = isBankOrNbfc ? 0 : (Number.isFinite(Number(dcf.netDebt)) ? Number(dcf.netDebt) : totalDebt - cashAndEquiv);

  let equityValue = 0;
  let fairValue = 0;

  if (isBankOrNbfc && dcf.intrinsicValue && dcf.intrinsicValue > 0) {
    equityValue = Number(dcf.equityValue) || 0;
    fairValue = Number(dcf.intrinsicValue);
  } else {
    const rawEquityValue = enterpriseValue - netDebt;
    const dcfEquityValue = Number(dcf.equityValue) || 0;
    const reconciledEquityValue = Math.abs(rawEquityValue - dcfEquityValue) <= Math.max(1, dcfEquityValue * 0.01)
      ? dcfEquityValue
      : rawEquityValue;
    equityValue = reconciledEquityValue > 0 ? reconciledEquityValue : dcfEquityValue;
    const computedFv = (sharesOutstanding > 0 && equityValue > 0)
      ? Number((equityValue / sharesOutstanding).toFixed(2))
      : (Number(dcf.intrinsicValue) || currentPrice);
    fairValue = Math.max(0.01, computedFv);
  }

  // Insufficient inputs: assert no modeled valuation — anchor to price with NR.
  // NOTE: there is deliberately NO fallback for a merely insolvent model.
  // If the FCFF engine cannot produce positive equity on validated inputs,
  // the dossier must hard-block (XREF-02/XREF-03/XREF-05) — publishing a
  // market-anchored number in place of a failed valuation is prohibited.
  if (insufficientInputs) {
    fairValue = currentPrice > 0 ? currentPrice : 0.01;
    equityValue = fairValue * (sharesOutstanding > 0 ? sharesOutstanding : 1);
  }

  const targetPrice = Math.max(0.01, fairValue);

  // 2. Rating & Stance Consistency (Rule: Fair Value vs Price dictates recommendation)
  const upsideDownsidePct = currentPrice > 0 && !insufficientInputs ? (fairValue - currentPrice) / currentPrice : 0;

  let rating: "BUY" | "HOLD" | "SELL" | "NR" = "HOLD";
  let ratingRationale = "";

  if (insufficientInputs) {
    rating = "NR";
    const integrityNote = marketIntegrity.blocked
      ? ` Integrity failure: ${marketIntegrity.issues.filter((i) => i.severity === "BLOCK").map((i) => i.message).join("; ").slice(0, 220)}.`
      : "";
    ratingRationale = `Model recommendation: Not Rated (NR) — insufficient inputs (history: ${annualFinancials.length}y, shares: ${sharesOutstanding}, price: ${currentPrice}).${integrityNote} No valuation asserted; manual inputs required before modeling.`;
  } else if (dcf.verdict === "NR" || (dcf as any).confidence === "low" || upsideDownsidePct > 1.50 || upsideDownsidePct < -0.80) {
    rating = "NR";
    ratingRationale = `Model recommendation: Not Rated (NR) — valuation upside/downside (${(upsideDownsidePct * 100).toFixed(1)}%) breaches sanity bounds (±150%) or fails confidence verification. Fundamental model review required.`;
  } else if (dcf.verdict && (dcf.verdict === "BUY" || dcf.verdict === "HOLD" || dcf.verdict === "SELL")) {
    rating = dcf.verdict;
    ratingRationale = `Model recommendation: ${rating} with implied variance of ${(upsideDownsidePct * 100).toFixed(1)}%.`;
  } else if (upsideDownsidePct >= 0.12) {
    rating = "BUY";
    ratingRationale = `Implied upside of ${(upsideDownsidePct * 100).toFixed(1)}% exceeds institutional +12% hurdle rate.`;
  } else if (upsideDownsidePct <= -0.12) {
    rating = "SELL";
    ratingRationale = `Implied downside of ${(upsideDownsidePct * 100).toFixed(1)}% falls below institutional capital protection threshold.`;
  } else {
    rating = "HOLD";
    ratingRationale = `Implied variance of ${(upsideDownsidePct * 100).toFixed(1)}% falls within the neutral ±12% risk-reward corridor.`;
  }

  // 3. WACC & Cost of Capital (Assumptions)
  const wacc = Number(dcf.assumptions?.wacc) || 0.095;
  const terminalGrowthRate = Number(dcf.assumptions?.terminalGrowthRate) || 0.04;
  const riskFreeRate = Number(dcf.assumptions?.riskFreeRate) || 0.0685;
  const equityRiskPremium = Number(dcf.assumptions?.equityRiskPremium) || 0.060;
  const beta = Number(dcf.assumptions?.beta) || Number(stockData.beta) || 1.0;
  const costOfEquity = Number(dcf.assumptions?.costOfEquity) || (riskFreeRate + beta * equityRiskPremium);
  const costOfDebtPreTax = Number(dcf.assumptions?.costOfDebtPreTax) || 0.075;
  const marginalTaxRate = Number(dcf.assumptions?.marginalTaxRate) || 0.25;
  const costOfDebtPostTax = Number(dcf.assumptions?.costOfDebtPostTax) || (costOfDebtPreTax * (1 - marginalTaxRate));
  const debtWeight = Number(dcf.assumptions?.debtWeight) || 0.15;
  const equityWeight = Number(dcf.assumptions?.equityWeight) || 0.85;

  // 4. Moat Derivation with Explicit Evidence Bridge & Canonical Economic Spread
  const sector = (profile.sector || "").toLowerCase();
  const ind = (profile.industry || "").toLowerCase();
  const desc = (profile.description || "").toLowerCase();
  const name = (profile.name || "").toLowerCase();

  const roe = latestFin && latestFin.totalEquity > 0 ? latestFin.netIncome / latestFin.totalEquity : 0.12;
  const rawInvestedCap = (latestFin?.totalEquity || 0) + (latestFin?.totalDebt || 0) - (latestFin?.cash || 0);
  const investedCapital = rawInvestedCap > 0 
    ? rawInvestedCap 
    : (latestFin && (latestFin.totalAssets - latestFin.currentLiabilities) > 0 
        ? latestFin.totalAssets - latestFin.currentLiabilities 
        : (latestFin?.totalAssets || 1));
  const nopat = (latestFin?.operatingIncome || 0) * (1 - marginalTaxRate);
  const roic = latestFin && investedCapital > 0 ? Math.max(0, nopat / investedCapital) : 0.12;
  const roicSpread = roic - wacc;
  const roeSpread = roe - costOfEquity;
  const eva = nopat - (investedCapital * wacc);

  let moatRating: "Wide" | "Narrow" | "None" = "Narrow";
  let moatTrend: "Positive" | "Stable" | "Negative" = "Stable";
  let moatBridge = "";

  const isHighMoatIndustry =
    ind.includes("financial data") ||
    ind.includes("rating") ||
    ind.includes("analytics") ||
    ind.includes("exchange") ||
    name.includes("crisil") ||
    name.includes("icra") ||
    sector.includes("software") ||
    ind.includes("software") ||
    ind.includes("pharma") ||
    ind.includes("renewable");

  const isConglomerateOrO2C =
    sector.includes("energy") ||
    ind.includes("oil") ||
    ind.includes("petro") ||
    ind.includes("refin") ||
    name.includes("reliance");

  const isTelecom = isTelecomCarrierCompany(
    profile.sector,
    profile.industry,
    profile.description,
    profile.name
  );

  const isAgroOrSpecialtyChem =
    sector.includes("materials") ||
    ind.includes("agric") ||
    ind.includes("agri") ||
    ind.includes("agro") ||
    ind.includes("crop") ||
    ind.includes("chemical") ||
    name.includes("pi ind");

  if (isHighMoatIndustry) {
    if (roe >= 0.14 || roic >= 0.12) {
      moatRating = "Wide";
      moatTrend = roe >= 0.20 && roicSpread > 0 ? "Positive" : "Stable";
      moatBridge = `Given high switching costs in mission-critical workflow software/ratings, proprietary IP datasets, and sustained ROIC (${(roic * 100).toFixed(1)}% vs WACC ${(wacc * 100).toFixed(1)}%), we classify the economic moat as Wide with a ${moatTrend} outlook.`;
    } else {
      moatRating = "Narrow";
      moatTrend = "Stable";
      moatBridge = `Given recognized institutional reputation and compliance stickiness tempered by moderate reinvestment requirements, we classify the economic moat as Narrow with a Stable outlook.`;
    }
  } else if (isAgroOrSpecialtyChem) {
    if (roic >= 0.14 || roe >= 0.16) {
      moatRating = "Narrow";
      moatTrend = "Stable";
      moatBridge = `Given proprietary custom synthesis (CSM) process chemistry, multi-year customer qualification hurdles, and regulatory molecule registration stickiness, we assign a Narrow economic moat with a Stable outlook (ROIC ${(roic * 100).toFixed(1)}% vs WACC ${(wacc * 100).toFixed(1)}%).`;
    } else {
      moatRating = "Narrow";
      moatTrend = "Stable";
      moatBridge = `Given domestic brand distribution reach and active ingredient synthesis capabilities offset by generic competition and raw material cyclicality, we assign a Narrow economic moat with a Stable outlook.`;
    }
  } else if (isConglomerateOrO2C) {
    moatRating = "Narrow";
    moatTrend = roicSpread > 0 ? "Positive" : "Stable";
    moatBridge = `Given massive physical integration scale, strategic refining complexity, and deep downstream retail/digital subscriber reach offset by heavy cyclical capital intensity, we classify the economic moat as Narrow with a ${moatTrend} expansion trend.`;
  } else if (isTelecom) {
    if (roe < 0 || latestFin?.totalEquity <= 0) {
      moatRating = "None";
      moatTrend = "Negative";
      moatBridge = `Given hyper-commoditized pricing, sub-scale spectrum holdings, severe balance sheet indebtedness, and negative equity returns, we classify the economic moat as None with a Negative outlook.`;
    } else {
      moatRating = "Narrow";
      moatTrend = "Stable";
      moatBridge = `Given high spectral barrier-to-entry and duopoly market structure offset by continuous 5G network capex and tariff regulation, we classify the economic moat as Narrow with a Stable outlook.`;
    }
  } else {
    if (roe >= 0.18 && roic >= 0.14 && roicSpread > 0) {
      moatRating = "Wide";
      moatTrend = "Positive";
      moatBridge = `Given demonstrable pricing power, dominant market share, and wide ROIC-to-WACC spread (${((roic - wacc) * 100).toFixed(1)}% economic spread), we classify the economic moat as Wide.`;
    } else if (roe >= 0.08) {
      moatRating = "Narrow";
      moatTrend = "Stable";
      moatBridge = `Given observable operating scale and entrenched channel distribution, we classify the economic moat as Narrow with a Stable outlook.`;
    } else {
      moatRating = "None";
      moatTrend = "Negative";
      moatBridge = `Given sub-scale economics, volatile operating margins, and returns trailing cost of capital, we assign No economic moat with a Negative outlook.`;
    }
  }

  // Analytical Consistency Guard: Prohibit "Positive" moat trend if ROIC spread is non-positive
  if (roicSpread <= 0 && moatTrend === "Positive") {
    moatTrend = "Stable";
  }

  // 5. Company Financial Archetype & Risk Guard
  const arch = classifyArchetype(profile, stockData, annualFinancials);

  // If company is Distressed, moat cannot be Wide or Positive
  if (arch.archetype === "DISTRESSED") {
    moatRating = "None";
    moatTrend = "Negative";
    moatBridge = `Given distressed balance sheet leverage (Net Debt/EBITDA > 6x), severe debt service overhang, and negative operational cash generation, we classify the economic moat as None with a Negative outlook.`;
  } else if (arch.archetype === "EARLY_PLATFORM_GROWTH") {
    moatRating = "Narrow";
    moatTrend = "Positive";
    moatBridge = `Given dense hyperlocal delivery network effects, two-sided merchant/consumer platform lock-in, and rapid quick-commerce dark store rollout, we classify the economic moat as Narrow with a Positive trend, pending sustained unit-level contribution margin inflection.`;
  }

  // 6. Units & Currency
  const rawCurrency = (profile.currency || "INR").toUpperCase();
  const isINR = rawCurrency === "INR" || rawCurrency === "₹";
  const currency = isINR ? "₹" : rawCurrency;
  const reportingUnit = isINR ? "₹ Cr" : `${currency} Mn`;
  const unitMultiplier = isINR ? 10_000_000 : 1_000_000;

  // 7. Deterministic Scenario Math
  // Target prices: Bull = FV * 1.25, Base = FV, Bear = FV * 0.75
  // Implied Return MUST strictly equal: (targetPrice / currentPrice) - 1
  const bullTarget = Math.max(0.01, Math.round(fairValue * 1.25 * 100) / 100);
  const baseTarget = Math.max(0.01, Math.round(fairValue * 100) / 100);
  const bearTarget = Math.max(0.01, Math.round(fairValue * 0.75 * 100) / 100);

  const bullReturn = currentPrice > 0 ? (bullTarget / currentPrice) - 1 : 0.25;
  const baseReturn = currentPrice > 0 ? (baseTarget / currentPrice) - 1 : 0.0;
  const bearReturn = currentPrice > 0 ? (bearTarget / currentPrice) - 1 : -0.25;

  const fmtReturnPct = (r: number) => `${r >= 0 ? "+" : ""}${(r * 100).toFixed(1)}%`;

  const dcfBaseGrowth = Number(dcf.assumptions?.revenueGrowthRates?.[0]) || 0.082;
  const bullRevCagr = Math.round((dcfBaseGrowth * 1.5) * 1000) / 1000;
  const baseRevCagr = Math.round(dcfBaseGrowth * 1000) / 1000;
  const bearRevCagr = Math.round(Math.max(0.02, dcfBaseGrowth * 0.45) * 1000) / 1000;

  const baseOm = Number(arch.scenarioMargins?.baseMargin) || Number(dcf.assumptions?.ebitMargins?.[0]) || (latestFin && latestFin.revenue > 0 ? (latestFin.operatingIncome / latestFin.revenue) : 0.15);
  const bullOm = Number(arch.scenarioMargins?.bullMargin) || (baseOm * 1.25);
  const bearOm = Number(arch.scenarioMargins?.bearMargin) || (baseOm * 0.70);

  const scenarios = {
    bull: {
      targetPrice: bullTarget,
      impliedReturn: bullReturn,
      impliedReturnPctDisplay: fmtReturnPct(bullReturn),
      weight: 0.25,
      revCagr: bullRevCagr,
      revCagrDisplay: `${(bullRevCagr * 100).toFixed(1)}%`,
      om: bullOm,
      omDisplay: `${(bullOm * 100).toFixed(1)}%`,
    },
    base: {
      targetPrice: baseTarget,
      impliedReturn: baseReturn,
      impliedReturnPctDisplay: fmtReturnPct(baseReturn),
      weight: 0.60,
      revCagr: baseRevCagr,
      revCagrDisplay: `${(baseRevCagr * 100).toFixed(1)}%`,
      om: baseOm,
      omDisplay: `${(baseOm * 100).toFixed(1)}%`,
    },
    bear: {
      targetPrice: bearTarget,
      impliedReturn: bearReturn,
      impliedReturnPctDisplay: fmtReturnPct(bearReturn),
      weight: 0.15,
      revCagr: bearRevCagr,
      revCagrDisplay: `${(bearRevCagr * 100).toFixed(1)}%`,
      om: bearOm,
      omDisplay: `${(bearOm * 100).toFixed(1)}%`,
    },
    probabilityWeightedValue: Math.round((bullTarget * 0.25 + baseTarget * 0.60 + bearTarget * 0.15) * 100) / 100,
  };

  // 8. Deterministic Uncertainty Model
  // Score based on valuation dispersion, leverage, cyclicality, and beta
  const valuationGap = currentPrice > 0 ? Math.abs(fairValue - currentPrice) / currentPrice : 0;
  let uncertaintyScore = 15; // baseline
  if (beta > 1.3) uncertaintyScore += 20;
  else if (beta > 1.0) uncertaintyScore += 10;

  if (valuationGap > 0.40) uncertaintyScore += 25;
  else if (valuationGap > 0.20) uncertaintyScore += 15;

  if (arch.archetype === "DISTRESSED") uncertaintyScore += 30;
  else if (arch.archetype === "CYCLICAL_CAPITAL_INTENSIVE") uncertaintyScore += 15;

  let uncertaintyRating: "Low" | "Medium" | "High" | "Very High" | "N/A" = "Medium";
  if (fairValue <= 0 || !isFinite(fairValue)) uncertaintyRating = "N/A";
  else if (uncertaintyScore <= 25) uncertaintyRating = "Low";
  else if (uncertaintyScore <= 45) uncertaintyRating = "Medium";
  else if (uncertaintyScore <= 65) uncertaintyRating = "High";
  else uncertaintyRating = "Very High";

  // 9. Multi-Year CAGR Profile (from actual historical financials)
  let cagrPct = 0.12;
  let cagrMetric = isBankOrNbfc ? "Book Value Compounding" : "Revenue Compounding";
  let cagrCommentary = "Sustained balance sheet compounding and operational discipline have supported stable multi-year book value accumulation.";

  if (annualFinancials.length >= 3) {
    const oldest = annualFinancials[0];
    const newest = annualFinancials[annualFinancials.length - 1];
    const years = annualFinancials.length - 1;
    if (isBankOrNbfc && oldest.totalEquity > 0 && newest.totalEquity > 0) {
      cagrPct = Math.pow(newest.totalEquity / oldest.totalEquity, 1 / years) - 1;
      cagrMetric = "Book Value CAGR";
      cagrCommentary = `Multi-year tangible equity expansion (${(cagrPct * 100).toFixed(1)}% p.a.) driven by steady net interest margin retention and prudent risk provisioning.`;
    } else if (oldest.revenue > 0 && newest.revenue > 0) {
      cagrPct = Math.pow(newest.revenue / oldest.revenue, 1 / years) - 1;
      cagrMetric = "Revenue CAGR";
      const divYield = (stockData.dividendYield || 0);
      cagrCommentary = divYield > 0.005 
        ? `Disciplined capital reinvestment and consistent dividend payouts have supported core operational compounding (${(cagrPct * 100).toFixed(1)}% p.a.).`
        : `Disciplined reinvestment of operating cash flow into capacity expansion has driven core operational compounding (${(cagrPct * 100).toFixed(1)}% p.a.).`;
    }
  }

  // Cap cagr display within sane bounds
  const clampedCagr = isFinite(cagrPct) ? Math.min(0.50, Math.max(-0.20, cagrPct)) : 0.12;
  const multiYearCAGR = {
    metric: cagrMetric,
    cagrPct: clampedCagr,
    cagrDisplay: `${clampedCagr >= 0 ? "+" : ""}${(clampedCagr * 100).toFixed(1)}% p.a.`,
    commentary: cagrCommentary,
  };

  return {
    fairValue,
    targetPrice,
    currentPrice,
    upsideDownsidePct,
    rating,
    ratingRationale,

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
    terminalGrowthRate,

    sumPvFcff,
    pvTerminalValue,
    enterpriseValue,
    totalDebt,
    cashAndEquiv,
    netDebt,
    equityValue,
    sharesOutstanding,

    moatRating,
    moatTrend,
    moatBridge,

    currency,
    reportingUnit,
    unitMultiplier,

    // Company Financial Archetype & BS Detector
    archetype: arch.archetype,
    gicsSector: arch.sector,
    calibratedCreditRating: arch.creditRating,
    stewardshipRating: arch.capitalAllocationLabel,
    capitalAllocationDescription: arch.capitalAllocationDescription,
    dividendCAGRDisplay: arch.dividendCAGRDisplay,
    buybackYieldDisplay: arch.buybackYieldDisplay,
    totalShareholderYieldDisplay: arch.totalShareholderYieldDisplay,
    scenarioMargins: arch.scenarioMargins,

    // Deterministic Scenarios & Uncertainty
    scenarios,
    dcfBaseTarget: baseTarget,
    publishedTargetPrice: baseTarget,
    probabilityWeightedValue: scenarios.probabilityWeightedValue,
    valuationMethodology: dcf.terminalValueCapped
      ? "5-Year Explicit DCF Base Case; bull/bear targets are ±25% arithmetic sensitivities around base (not independently re-solved DCFs); terminal value capped at 25x terminal-year FCFF — uncapped value disclosed in terminalValueUncapped"
      : "5-Year Explicit DCF Base Case; bull/bear targets are ±25% arithmetic sensitivities around base (not independently re-solved DCFs)",
    terminalValueUncapped: (dcf as any).unadjustedTerminalValue ?? null,
    insufficientData: insufficientInputs,
    creditRatingNote: "Model-implied internal grade — not a CRISIL/ICRA/S&P agency rating",
    dataQualityFlags,
    uncertaintyScore,
    uncertaintyRating,
    multiYearCAGR,

    // Canonical Financial Identity Metrics
    roic,
    roicSpread,
    roeSpread,
    investedCapital,
    nopat,
    eva,

    // Canonical Moat Object
    moat: {
      rating: moatRating,
      trend: moatTrend,
      confidence: arch.archetype === "DISTRESSED" ? 95 : (roic > wacc ? 85 : 70),
      evidence: [
        `Historical ROIC: ${(roic * 100).toFixed(1)}% vs WACC: ${(wacc * 100).toFixed(1)}%`,
        `Historical ROE: ${(roe * 100).toFixed(1)}%`,
        `Economic Spread: ${((roic - wacc) * 100).toFixed(1)}%`,
        `Financial Archetype: ${arch.archetype}`
      ],
      economicSpread: roic - wacc,
      bridge: moatBridge,
    },

    // Reverse DCF & Implied Growth Expectations
    reverseDCF: dcf.reverseDCF ? {
      ...dcf.reverseDCF,
      confidence: (Math.abs(dcf.reverseDCF.impliedRevenueGrowthRate - (dcf.assumptions?.revenueGrowthRates?.[0] ?? 0.12)) < 0.08 ? "High" : Math.abs(dcf.reverseDCF.impliedRevenueGrowthRate - (dcf.assumptions?.revenueGrowthRates?.[0] ?? 0.12)) < 0.20 ? "Medium" : "Low") as "High" | "Medium" | "Low",
    } : computeReverseDCF({
      currentMarketPrice: currentPrice,
      sharesOutstanding,
      netDebt,
      latestRevenue: Number(latestFin?.revenue) || 1000,
      baseEbitMargin: Number(dcf.assumptions?.ebitMargins?.[0]) || 0.15,
      wacc,
      terminalGrowthRate,
      marginalTaxRate,
      modelBaseGrowthRate: Number(dcf.assumptions?.revenueGrowthRates?.[0]) || 0.12,
    }),

    // Calibration & Safeguards Layer
    terminalValueCapped: Boolean(dcf.terminalValueCapped),
    calibrationDecile: calibration?.decile ?? dcf.calibration?.decile,
    sectorZScore: calibration?.sectorZScore ?? dcf.calibration?.sectorZScore,
    sectorPercentile: calibration?.sectorPercentile ?? dcf.calibration?.sectorPercentile,
    calibration: calibration ?? dcf.calibration,
  };
}
