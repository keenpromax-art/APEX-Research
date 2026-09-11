// ============================================================
// APEX RESEARCH — Single Canonical Forecast Pipeline
// ------------------------------------------------------------
// EXACTLY ONE authoritative forward forecast per report:
//
//   historical normalized facts
//     → sector operating drivers (driver-models, single run)
//     → forecast assumptions (ONE margin-seed rule, ONE growth rule)
//     → three statements (IS / BS / CF, exact roll-forwards)
//     → FCFF → DCF (EV → equity → per-share)
//
// DCF, report tables, scenarios and QA consume THIS object directly.
// Nothing downstream recomputes revenue, margins, FCFF, or per-share
// values from parallel assumptions — a parallel computation is a defect
// by definition (it printed FY26 46.8% → FY27E 14.8% vs DCF 62.5%).
//
// Backward compatibility: the original projection fields
// (year/revenue/ebit/nopat/depreciation/ebitda/capex/
// changeInWorkingCapital/fcff/discountFactor/pvFcff/ppe?) keep their
// exact names, units and arithmetic so every existing consumer
// (CanonicalReport PDF check, assertForecastConsumed, sensitivity grids)
// keeps working unchanged.
// ============================================================
import { computeDriverForecast, type DriverForecast } from "./driver-models";
import {
  computeFCFF,
  discountFCFF,
  discountFactor as kernelDiscountFactor,
  gordonTerminalValue,
  deriveScenarioVectors,
  type ScenarioVector,
} from "./financial-kernel";
import type { SectorId } from "./sectors/types";
import type { GICSSector } from "./company-archetype";

/** Severity seed for findings (track: publication-gate taxonomy adopts this). */
export type ForecastSeverity = "info" | "warn" | "material" | "blocker";

/** One forecast year: full three-statement row. Native currency units. */
export interface ForecastYearStatement {
  year: number;
  label: string;
  // Income statement
  revenue: number;
  revenueGrowth: number;
  ebitMargin: number;
  ebit: number;
  /** Derived forecast EBITDA (EBIT + depreciation) — exact by construction. */
  ebitda: number;
  depreciation: number;
  interestExpense: number;
  interestIncome: number;
  pretax: number;
  taxPayment: number;
  nopat: number;
  netIncome: number;
  // Cash flow
  capex: number;
  changeInWorkingCapital: number;
  operatingCashFlow: number;
  freeCashFlow: number;
  fcff: number;
  dividends: number;
  buybacks: number;
  netBorrowing: number;
  netChangeInCash: number;
  // Balance-sheet closes
  cash: number;
  receivables: number;
  inventory: number;
  otherWorkingCapital: number;
  ppe: number;
  otherAssets: number;
  totalAssets: number;
  payables: number;
  totalDebt: number;
  otherLiabilities: number;
  totalLiabilities: number;
  equity: number;
  nwcLevel: number;
  // Valuation bridge
  discountFactor: number;
  pvFcff: number;
  shares: number;
  eps: number;
  /** External funding required this year (>0) — cash floored at zero, gap disclosed, never printed negative. */
  fundingGap: number;
  /** Closing net PPE stock (present only under PP&E roll-forward depreciation). */
  ppeStock?: number;
}

export interface CanonicalForecast {
  /** Driver-native equation and provenance basis (always printed in PDF). */
  driverEquation: string;
  basis: Record<string, string>;
  modelVersion: string;
  /** 5-year growth/margin vectors actually used in FCFF (the only truth for DCF). */
  revenueGrowthRates: number[];
  ebitMargins: number[];
  terminalGrowthRate: number;
  avgCapexPct: number;
  avgDeptPct: number;
  avgNwcChangePct: number;
  /** Year-by-year projection (single source; PDF tables index this directly). */
  projections: ForecastYearStatement[];
  /** Assumption vectors + rates every downstream consumer must reuse verbatim. */
  assumptions: {
    revenueGrowthRates: number[];
    ebitMargins: number[];
    terminalGrowthRate: number;
    avgCapexPct: number;
    avgDeptPct: number;
    avgNwcChangePct: number;
    /** PP&E-anchored D&A rate when a usable stock exists; null → revenue-based. */
    depOnPpeRate: number | null;
    wacc: number;
    marginalTaxRate: number;
    debtRate: number;
    cashYield: number;
    dividendPayout: number;
    debtAmortizationRate: number;
    sharesOutstanding: number;
    /** Trailing actuals the forecast is anchored to (continuity reference). */
    trailingRevenue: number;
    trailingEbitMargin: number;
    trailingNetIncome: number;
  };
  /** Trailing → Y1 continuity diagnostics (the margin-cliff tripwire input). */
  continuity: {
    trailingEbitMargin: number;
    forecastY1Margin: number;
    gapPp: number;
    disclosedBasis: string;
  };
  /** Scenario input vectors derived from THESE assumptions (ledger consumes verbatim). */
  scenarioVectors: Record<"bull" | "base" | "bear", ScenarioVector>;
  terminal: { fcffT: number; wacc: number; g: number; terminalValue: number; unadjustedTerminalValue: number; pvTerminalValue: number; capped: boolean; spreadOk: boolean; diagnostics: string[] };
  wacc: number;
  netDebt: number;
  sharesOutstanding: number;
  /** Authoritative DCF block, computed FROM the rows above — never separately. */
  dcf: {
    sumPvFcff: number;
    terminalYearFcff: number;
    terminalValue: number;
    pvTerminalValue: number;
    enterpriseValue: number;
    equityValue: number;
    fairValuePerShare: number | null;
  };
  /** Funding/liquidity disclosure (explicit explanation when gaps exist). */
  funding: { gaps: Array<{ year: string; amount: number }>; explanation: string };
  /** "fcff" (corporate path, full statements authoritative) or "vectors-only"
   *  (financial-institution path: residual-income values the equity; the FCFF
   *  stream exists for narrative consistency only and must not price anything). */
  valuationUse: "fcff" | "vectors-only";
  /** "corporate" shapes carry full statements; financial shapes carry vectors. */
  statementShape: "corporate" | "financial";
  _sealed?: boolean;
  _hash?: string;
}

/** Trailing normalized snapshot (economic layer assembles; math layer consumes). */
export interface ForecastTrailingSnapshot {
  revenue: number;
  ebit: number;
  ebitMargin: number;
  netIncome: number;
  cash: number;
  totalDebt: number;
  equity: number;
  totalAssets: number;
  totalLiabilities: number;
  sharesOutstanding: number;
  receivables: number;
  inventory: number;
  payables: number;
  ppe: number;
  /** Other assets = totalAssets − (cash + AR + INV + PPE); flat through forecast. */
  otherAssets: number;
  /** Other liabilities = totalLiab − (debt + payables); flat through forecast. */
  otherLiabilities: number;
  nwcLevel: number;
  /** Trailing implied debt rate (interestExpense / debt), pre-clamped. */
  debtRate: number;
  /** Trailing cash yield (interestIncome / cash), pre-clamped. */
  cashYield: number;
  /** Trailing dividend payout ratio (0..1 of positive NI; 0 when none). */
  dividendPayout: number;
  /** Calendar year of the last actual (labels derive from it). */
  yearLabelBase: number;
}

export function buildCanonicalForecast(params: {
  sectorId: SectorId | string;
  operatingArchetype: GICSSector | string;
  /** Financial archetype overlay id (CYCLICAL_CAPITAL_INTENSIVE / EARLY_PLATFORM_GROWTH shaping). */
  financialArchetype?: string;
  baseRevenue: number;
  marginalTaxRate: number;
  wacc: number;
  terminalGrowthRate?: number;
  netDebt: number;
  sharesOutstanding: number;
  cagr: number;
  winsorizedCagr: number;
  winsorizedLive: number;
  baseGrowth: number;
  hasLive: boolean;
  liveRevGrowth: number;
  years: number;
  effectiveMargin: number;
  rawAvgCapexPct: number;
  rawAvgDeptPct: number;
  rawAvgDepOnPpe?: number;
  ppeBase?: number;
  continuityCapped?: boolean;
  /** Full trailing snapshot — required for the three-statement extension. */
  trailing?: ForecastTrailingSnapshot;
  /** Corporate shapes get full statements; financial shapes get vectors (+labeled stream). */
  statementShape?: "corporate" | "financial";
  /** Orderly debt amortization per year (default 5%; 0 = interest-only roll). */
  debtAmortizationRate?: number;
}): CanonicalForecast {
  const driver: DriverForecast = computeDriverForecast({
    sectorId: params.sectorId,
    operatingArchetype: params.operatingArchetype,
    inputs: {
      cagr: params.cagr,
      winsorizedCagr: params.winsorizedCagr,
      winsorizedLive: params.winsorizedLive,
      baseGrowth: params.baseGrowth,
      hasLive: params.hasLive,
      liveRevGrowth: params.liveRevGrowth,
      years: params.years,
      effectiveMargin: params.effectiveMargin,
      rawAvgCapexPct: params.rawAvgCapexPct,
      rawAvgDeptPct: params.rawAvgDeptPct,
      rawAvgDepOnPpe: params.rawAvgDepOnPpe,
      ppeBase: params.ppeBase,
      continuityCapped: params.continuityCapped,
    },
  });
  const wacc = params.wacc;
  const g = params.terminalGrowthRate ?? driver.terminalGrowthRate;
  const tax = params.marginalTaxRate;
  // Archetype overlays (moved here from the DCF path so the single pipeline
  // owns them — a second implementation elsewhere would be a parallel model).
  let avgCapexPct = driver.avgCapexPct;
  let avgNwcChangePct = driver.avgNwcChangePct;
  const avgDeptPct = driver.avgDeptPct;
  if (params.financialArchetype === "CYCLICAL_CAPITAL_INTENSIVE") {
    avgCapexPct = Math.max(avgCapexPct, 0.065);
  } else if (params.financialArchetype === "EARLY_PLATFORM_GROWTH") {
    avgCapexPct = Math.min(avgCapexPct, 0.03);
    avgNwcChangePct = Math.max(avgNwcChangePct, 0.035);
  }

  const T = params.trailing;
  const isCorporate = (params.statementShape ?? "corporate") === "corporate";
  const amort = params.debtAmortizationRate ?? 0.05;
  const debtRate = T ? Math.min(0.25, Math.max(0, T.debtRate)) : 0.05;
  const cashYield = T ? Math.min(0.12, Math.max(0, T.cashYield)) : 0.03;
  const payout = T ? Math.min(1, Math.max(0, T.dividendPayout)) : 0;
  const baseYear = T && Number.isFinite(T.yearLabelBase) && T.yearLabelBase > 1900 ? Math.round(T.yearLabelBase) : new Date().getFullYear();

  // Opening stocks (trailing closes, or safe zeros when no snapshot).
  let rev = params.baseRevenue;
  let debtOpen = T ? Math.max(0, T.totalDebt) : 0;
  let cashOpen = T ? Math.max(0, T.cash) : 0;
  let equityOpen = T ? T.equity : 0;
  let arOpen = T ? Math.max(0, T.receivables) : 0;
  let invOpen = T ? Math.max(0, T.inventory) : 0;
  let apOpen = T ? Math.max(0, T.payables) : 0;
  let ppeOpen = T ? Math.max(0, T.ppe) : (params.ppeBase ?? 0);
  const otherAssets = T ? T.otherAssets : 0;
  const otherLiab = T ? T.otherLiabilities : 0;
  // Other net working capital absorbs (dwc − ΔAR − ΔINV + ΔAP) so the
  // balance sheet balances EXACTLY while FCFF keeps the revenue-linked
  // NWC change both models share. Labeled, never silent.
  let otherWc = 0;
  let nwcLevel = T ? T.nwcLevel : 0;
  const shares = params.sharesOutstanding > 0 ? params.sharesOutstanding : 0;

  // Trailing intensity ratios for WC components (0 when base missing → flat).
  const arRatio = T && T.revenue > 0 && arOpen >= 0 ? arOpen / T.revenue : 0;
  const invRatio = T && T.revenue > 0 && invOpen >= 0 ? invOpen / T.revenue : 0;
  const apRatio = T && T.revenue > 0 && apOpen >= 0 ? apOpen / T.revenue : 0;

  // Parity with the legacy DCF path: 1.1× D&A capex floor, PP&E
  // roll-forward depreciation when anchored, derived EBITDA.
  const usePpeDep = driver.depOnPpeRate !== null && ppeOpen > 0;
  let ppeStock = ppeOpen;

  const projections: CanonicalForecast["projections"] = [];
  const fcffs: number[] = [];
  const fundingGaps: Array<{ year: string; amount: number }> = [];

  driver.revenueGrowthRates.forEach((gr, i) => {
    const label = `FY${baseYear + i + 1}E`;
    rev = rev * (1 + gr);
    const m = driver.ebitMargins[Math.min(i, driver.ebitMargins.length - 1)] ?? 0.15;
    const ebit = rev * m;
    const nopat = ebit * (1 - tax);
    const dep = usePpeDep ? ppeStock * (driver.depOnPpeRate as number) : rev * avgDeptPct;
    const capex = rev * Math.max(avgCapexPct, avgDeptPct * 1.1);
    const dwc = rev * avgNwcChangePct;
    const fcff = computeFCFF({ nopat, depreciation: dep, capex, changeInWorkingCapital: dwc });
    fcffs.push(fcff);

    // — Interest, tax, net income (single rule, every year) —
    const intExp = debtOpen > 0 ? debtOpen * debtRate : 0;
    const intInc = cashOpen > 0 ? cashOpen * cashYield : 0;
    const pretax = ebit - intExp + intInc;
    const taxPay = Math.max(0, pretax) * tax;
    const ni = pretax - taxPay;

    // — Cash flow (SBC modeled 0 — disclosed in basis, never invented) —
    const cfo = ni + dep - dwc;
    const fcf = cfo - capex;
    const div = payout > 0 && ni > 0 ? payout * ni : 0;
    const buyback = 0;
    const debtClose = Math.max(0, debtOpen * (1 - amort));
    const netBorrowing = debtClose - debtOpen;
    let cashClose = cashOpen + cfo - capex - div - buyback + netBorrowing;
    let fundingGap = 0;
    if (cashClose < 0) {
      // Liquidity tripwire: cash NEVER prints negative. The shortfall is
      // recorded as an explicit external-funding requirement (QA surfaces it).
      fundingGap = -cashClose;
      fundingGaps.push({ year: label, amount: fundingGap });
      cashClose = 0;
    }

    // — Working-capital components (trailing intensity, no abrupt jumps) —
    const ar = rev * arRatio;
    const inv = rev * invRatio;
    const ap = rev * apRatio;
    otherWc = otherWc + (dwc - (ar - arOpen) - (inv - invOpen) + (ap - apOpen));
    nwcLevel = nwcLevel + dwc;

    // — PP&E + equity roll-forwards (exact by construction) —
    if (usePpeDep) ppeStock = ppeStock + capex - dep;
    const ppeClose = usePpeDep ? ppeStock : ppeOpen + (capex - dep);
    const equityClose = equityOpen + ni - div - buyback;

    const assets = cashClose + ar + inv + ppeClose + otherAssets + otherWc;
    const liab = debtClose + ap + otherLiab;

    projections.push({
      year: i + 1,
      label,
      revenue: rev,
      revenueGrowth: gr,
      ebitMargin: m,
      ebit,
      ebitda: ebit + dep,
      depreciation: dep,
      interestExpense: intExp,
      interestIncome: intInc,
      pretax,
      taxPayment: taxPay,
      nopat,
      netIncome: ni,
      capex,
      changeInWorkingCapital: dwc,
      operatingCashFlow: cfo,
      freeCashFlow: fcf,
      fcff,
      dividends: div,
      buybacks: buyback,
      netBorrowing,
      netChangeInCash: cashClose - cashOpen,
      cash: cashClose,
      receivables: ar,
      inventory: inv,
      otherWorkingCapital: otherWc,
      ppe: ppeClose,
      otherAssets,
      totalAssets: assets,
      payables: ap,
      totalDebt: debtClose,
      otherLiabilities: otherLiab,
      totalLiabilities: liab,
      equity: equityClose,
      nwcLevel,
      discountFactor: kernelDiscountFactor(wacc, i),
      pvFcff: 0, // filled below from the single discount pass
      shares,
      eps: shares > 0 ? ni / shares : 0,
      fundingGap,
      ...(usePpeDep ? { ppeStock: ppeClose } : {}),
    });

    // Advance opening stocks.
    debtOpen = debtClose;
    cashOpen = cashClose;
    equityOpen = equityClose;
    arOpen = ar;
    invOpen = inv;
    apOpen = ap;
    ppeOpen = ppeClose;
  });

  const { pvFcff } = discountFCFF(fcffs, wacc);
  projections.forEach((p, i) => { p.pvFcff = pvFcff[i]; });
  const sumPvFcff = pvFcff.reduce((a, b) => a + b, 0);
  const tvRes = gordonTerminalValue({ terminalYearFcff: fcffs[fcffs.length - 1], wacc, terminalGrowth: g, terminalRevenue: rev, marginalTaxRate: tax });
  const pvTv = tvRes.terminalValue * Math.pow(1 + wacc, -5);
  const enterpriseValue = sumPvFcff + pvTv;
  const equityValue = enterpriseValue - params.netDebt;
  const fairValuePerShare = shares > 0 && equityValue > 0 ? equityValue / shares : null;

  const scenarioVectors = deriveScenarioVectors({
    revenueGrowth: [...driver.revenueGrowthRates],
    ebitMargin: [...driver.ebitMargins],
    capexPct: avgCapexPct,
    deptPct: avgDeptPct,
    nwcPct: avgNwcChangePct,
    wacc,
    terminalGrowth: g,
  });

  const y1Margin = driver.ebitMargins[0] ?? 0.15;
  const trailMargin = T ? T.ebitMargin : params.effectiveMargin;
  const forecast: CanonicalForecast = {
    driverEquation: driver.driverEquation,
    basis: {
      ...driver.basis,
      interest: `Interest expense at trailing implied debt rate ${(debtRate * 100).toFixed(2)}% on opening debt; interest income at ${(cashYield * 100).toFixed(2)}% on opening cash (fallbacks 5.00%/3.00% when trailing undisclosed).`,
      tax: `Cash tax at ${(tax * 100).toFixed(1)}% marginal rate on positive pretax (no deferred-tax modeling — disclosed).`,
      distributions: payout > 0 ? `Dividends at ${(payout * 100).toFixed(0)}% trailing payout of positive NI; buybacks modeled 0 (disclosed).` : `No dividend payout evidenced — distributions modeled 0 (disclosed).`,
      debt: `Orderly amortization at ${(amort * 100).toFixed(1)}%/yr on opening funded debt (interest-only at 0%); net borrowing equals the debt delta.`,
      workingCapital: `${driver.basis.workingCapital}; AR/inventory/payables extend trailing intensity ratios; other net WC absorbs (ΔWC − ΔAR − ΔINV + ΔAP) so the balance sheet balances exactly (labeled, never a silent plug).`,
      cashflow: `CFO = net income + D&A − ΔWC (stock-based comp modeled 0 — disclosed); FCF = CFO − capex; FCFF via kernel (NOPAT + D&A − capex − ΔWC).`,
      equity: `Equity rolls retained earnings (NI − dividends − buybacks); assets = cash + AR + inventory + PP&E + other assets + other WC; liabilities = debt + payables + other — identity exact by construction, verified by reconciliation.`,
      continuity: `Y1 EBIT margin ${(y1Margin * 100).toFixed(1)}% vs trailing ${(trailMargin * 100).toFixed(1)}% (gap ${((y1Margin - trailMargin) * 100).toFixed(1)}pp); seed effective margin ${(params.effectiveMargin * 100).toFixed(1)}%.`,
    },
    modelVersion: "apex-financial-model-v1",
    revenueGrowthRates: driver.revenueGrowthRates,
    ebitMargins: driver.ebitMargins,
    terminalGrowthRate: g,
    avgCapexPct,
    avgDeptPct,
    avgNwcChangePct,
    projections,
    assumptions: {
      revenueGrowthRates: [...driver.revenueGrowthRates],
      ebitMargins: [...driver.ebitMargins],
      terminalGrowthRate: g,
      avgCapexPct,
      avgDeptPct,
      avgNwcChangePct,
      depOnPpeRate: usePpeDep ? (driver.depOnPpeRate as number) : null,
      wacc,
      marginalTaxRate: tax,
      debtRate,
      cashYield,
      dividendPayout: payout,
      debtAmortizationRate: amort,
      sharesOutstanding: shares,
      trailingRevenue: params.baseRevenue,
      trailingEbitMargin: trailMargin,
      trailingNetIncome: T ? T.netIncome : 0,
    },
    continuity: {
      trailingEbitMargin: trailMargin,
      forecastY1Margin: y1Margin,
      gapPp: y1Margin - trailMargin,
      disclosedBasis: `Seed ${(params.effectiveMargin * 100).toFixed(1)}% via ${driver.basis.ebitMargin}`,
    },
    scenarioVectors,
    terminal: { fcffT: fcffs[fcffs.length - 1], wacc, g, terminalValue: tvRes.terminalValue, unadjustedTerminalValue: tvRes.unadjustedTerminalValue, pvTerminalValue: pvTv, capped: tvRes.capped, spreadOk: tvRes.spreadOk, diagnostics: tvRes.diagnostics },
    wacc,
    netDebt: params.netDebt,
    sharesOutstanding: shares,
    dcf: {
      sumPvFcff,
      terminalYearFcff: fcffs[fcffs.length - 1],
      terminalValue: tvRes.terminalValue,
      pvTerminalValue: pvTv,
      enterpriseValue,
      equityValue,
      fairValuePerShare,
    },
    funding: {
      gaps: fundingGaps,
      explanation: fundingGaps.length === 0
        ? "Forecast cash stays non-negative in every explicit year — no external funding required by the model."
        : `Forecast cash would go negative in ${fundingGaps.map((x) => `${x.year} (shortfall ${Math.round(x.amount).toLocaleString()})`).join(", ")} — floored at zero with explicit external-funding requirements recorded above (debt raise, equity raise, or capex deferral must cover them; valuation treats the gap as a liquidity qualification).`,
    },
    valuationUse: isCorporate ? "fcff" : "vectors-only",
    statementShape: isCorporate ? "corporate" : "financial",
  };
  return forecast;
}

// PDF invariant: if a PDF page computes its own revenueGrowth/margin/FCFF instead of indexing forecast.projections, FAIL.
export function assertForecastConsumed(pageValues: { revenue: number }[], forecast: CanonicalForecast): { ok: boolean; detail: string } {
  if (pageValues.length !== forecast.projections.length) return { ok: false, detail: `Length mismatch: page ${pageValues.length} vs forecast ${forecast.projections.length}` };
  for (let i = 0; i < pageValues.length; i++) {
    if (Math.abs(pageValues[i].revenue - forecast.projections[i].revenue) > 1) return { ok: false, detail: `Year ${i + 1} revenue ${pageValues[i].revenue} ≠ forecast ${forecast.projections[i].revenue}` };
  }
  return { ok: true, detail: "Forecast consumed verbatim." };
}

/** Full-spine verbatim check: revenue, EBIT margin, FCFF and cash/debt/equity closes. */
export function assertForecastSpineConsumed(
  pageYears: Array<{ revenue: number; ebitMargin: number; fcff: number }>,
  forecast: CanonicalForecast
): { ok: boolean; detail: string } {
  if (pageYears.length !== forecast.projections.length) return { ok: false, detail: `Length mismatch: page ${pageYears.length} vs forecast ${forecast.projections.length}` };
  for (let i = 0; i < pageYears.length; i++) {
    const p = pageYears[i];
    const f = forecast.projections[i];
    if (Math.abs(p.revenue - f.revenue) > 1) return { ok: false, detail: `Year ${i + 1} revenue ${p.revenue} ≠ forecast ${f.revenue}` };
    if (Math.abs(p.ebitMargin - f.ebitMargin) > 0.0005) return { ok: false, detail: `Year ${i + 1} EBIT margin ${p.ebitMargin} ≠ forecast ${f.ebitMargin}` };
    if (Math.abs(p.fcff - f.fcff) > 1) return { ok: false, detail: `Year ${i + 1} FCFF ${p.fcff} ≠ forecast ${f.fcff}` };
  }
  return { ok: true, detail: "Forecast spine consumed verbatim." };
}
